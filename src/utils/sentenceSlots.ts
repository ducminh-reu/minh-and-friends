import { stripStressMarks } from './transcriptDiff';

export type PunctuationAttach = 'left' | 'right' | 'inline';

export type SentenceSegment =
  | {
      type: 'word';
      wordIndex: number;
      charLength: number;
    }
  | {
      type: 'punct';
      text: string;
      attach: PunctuationAttach;
    };

export interface ParsedSentenceSlots {
  segments: SentenceSegment[];
  wordCount: number;
}

const LEXICAL_TOKEN_REGEX = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu;
const NON_WHITESPACE_REGEX = /\S+/g;

function pushGapSegments(
  segments: SentenceSegment[],
  gap: string,
  hasWordBefore: boolean,
  hasWordAfter: boolean,
): void {
  if (!gap) return;
  const matches = Array.from(gap.matchAll(NON_WHITESPACE_REGEX));
  for (const m of matches) {
    const text = m[0];
    const start = m.index ?? 0;
    const end = start + text.length;
    const touchesLeft = hasWordBefore && start === 0;
    const touchesRight = hasWordAfter && end === gap.length;

    let attach: PunctuationAttach = 'inline';
    if (touchesLeft && !touchesRight) {
      attach = 'left';
    } else if (!touchesLeft && touchesRight) {
      attach = 'right';
    } else if (touchesLeft && touchesRight) {
      attach = 'left';
    }

    segments.push({
      type: 'punct',
      text,
      attach,
    });
  }
}

/**
 * Parses a Russian reference sentence into ordered word slots and punctuation segments.
 * Uses the exact same lexical tokenization pattern as `tokenizeLexicalWords` so the number
 * of blank slots matches the grading engine's word count 1-to-1 without exposing answer text.
 */
export function parseSentenceToWordSlots(referenceText: string): ParsedSentenceSlots {
  const clean = stripStressMarks(referenceText);
  if (!clean.trim()) {
    return { segments: [], wordCount: 0 };
  }

  const matches = Array.from(clean.matchAll(LEXICAL_TOKEN_REGEX));
  if (matches.length === 0) {
    const segments: SentenceSegment[] = [];
    pushGapSegments(segments, clean, false, false);
    return { segments, wordCount: 0 };
  }

  const segments: SentenceSegment[] = [];
  let cursor = 0;

  matches.forEach((match, idx) => {
    const matchStart = match.index ?? cursor;
    const gap = clean.slice(cursor, matchStart);
    pushGapSegments(segments, gap, idx > 0, true);

    segments.push({
      type: 'word',
      wordIndex: idx,
      charLength: match[0].length,
    });

    cursor = matchStart + match[0].length;
  });

  const trailingGap = clean.slice(cursor);
  pushGapSegments(segments, trailingGap, true, false);

  return {
    segments,
    wordCount: matches.length,
  };
}

/**
 * Joins learner word-slot entries back into a sentence string for grading & draft sync.
 * Returns `""` if all slots are blank so untouched sentences remain marked empty.
 */
export function joinWordSlots(segments: SentenceSegment[], slotValues: string[]): string {
  const hasAnyFilled = slotValues.some((val) => val.trim().length > 0);
  if (!hasAnyFilled) return '';

  const wordFilled = new Map<number, boolean>();
  for (const seg of segments) {
    if (seg.type === 'word') {
      wordFilled.set(seg.wordIndex, (slotValues[seg.wordIndex] ?? '').trim().length > 0);
    }
  }

  let output = '';
  let lastWordIdx: number | null = null;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type === 'word') {
      const val = (slotValues[seg.wordIndex] ?? '').trim();
      lastWordIdx = seg.wordIndex;
      if (!val) continue;
      if (output && !output.endsWith(' ') && !/[«„(\[]$/.test(output)) {
        output += ' ';
      }
      output += val;
    } else {
      // Find next word index if any
      let nextWordIdx: number | null = null;
      for (let j = i + 1; j < segments.length; j++) {
        const nextSeg = segments[j];
        if (nextSeg.type === 'word') {
          nextWordIdx = nextSeg.wordIndex;
          break;
        }
      }

      const prevFilled = lastWordIdx !== null && (wordFilled.get(lastWordIdx) ?? false);
      const nextFilled = nextWordIdx !== null && (wordFilled.get(nextWordIdx) ?? false);

      if (seg.attach === 'left') {
        if (!prevFilled) continue;
        if (!output.endsWith(seg.text)) {
          output += seg.text;
        }
      } else if (seg.attach === 'right') {
        if (!nextFilled) continue;
        if (output && !output.endsWith(' ')) {
          output += ' ';
        }
        output += seg.text;
      } else {
        if (!prevFilled && !nextFilled) continue;
        if (output && !output.endsWith(' ')) {
          output += ' ';
        }
        output += seg.text;
      }
    }
  }

  return output.trim();
}

/**
 * Normalizes slot array length to match `wordCount`.
 */
export function resizeWordSlotValues(existing: string[] | undefined, wordCount: number): string[] {
  const out = Array.from({ length: wordCount }, (_, idx) => existing?.[idx] ?? '');
  return out;
}

/**
 * Distributes multi-word pasted text across sequential word slots starting at `startSlotIndex`.
 */
export function distributePastedText(
  currentValues: string[],
  startSlotIndex: number,
  pastedText: string,
): { nextValues: string[]; lastFilledIndex: number } {
  const tokens = stripStressMarks(pastedText)
    .trim()
    .split(/\s+/)
    .map((tok) => tok.replace(/^[«„"'(—–]+|[.,!?;:»”"')]+$/g, ''))
    .filter(Boolean);

  if (tokens.length === 0 || startSlotIndex < 0 || startSlotIndex >= currentValues.length) {
    return { nextValues: currentValues, lastFilledIndex: startSlotIndex };
  }

  const nextValues = [...currentValues];
  let lastFilledIndex = startSlotIndex;

  for (let i = 0; i < tokens.length; i++) {
    const targetIdx = startSlotIndex + i;
    if (targetIdx >= nextValues.length) break;
    nextValues[targetIdx] = tokens[i];
    lastFilledIndex = targetIdx;
  }

  return { nextValues, lastFilledIndex };
}
