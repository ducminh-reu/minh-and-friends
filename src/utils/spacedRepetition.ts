import type { ReviewFormat, VocabularyRecord } from '../types/domain';
import { stripStressMarks } from './transcriptDiff';

export interface ReviewPrompt {
  vocabulary: VocabularyRecord;
  format: ReviewFormat;
  promptText: string;
  subPromptText?: string;
  choices?: string[];
  expectedAnswer: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Updates spaced repetition metadata for a vocabulary record using SM-2 inspired scheduling.
 * Quality: 0 (Forgot), 3 (Hard), 4 (Good), 5 (Easy).
 */
export function applyReviewOutcome(
  record: VocabularyRecord,
  quality: 0 | 3 | 4 | 5,
  nowIso: string = new Date().toISOString(),
): VocabularyRecord {
  const nowMs = new Date(nowIso).getTime();
  const isCorrect = quality >= 3;

  let { easeFactor, intervalDays, repetitions, lapses, correctCount, incorrectCount } = record;

  if (isCorrect) {
    correctCount += 1;
    if (repetitions === 0) {
      intervalDays = 1;
    } else if (repetitions === 1) {
      intervalDays = quality === 5 ? 4 : 3;
    } else {
      const bonus = quality === 5 ? 1.25 : quality === 3 ? 0.8 : 1;
      intervalDays = Math.max(1, Math.round(intervalDays * easeFactor * bonus));
    }
    repetitions += 1;
  } else {
    incorrectCount += 1;
    lapses += 1;
    repetitions = 0;
    intervalDays = 0; // Review again soon (same day / next session)
  }

  easeFactor = Math.max(
    1.3,
    Number((easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))).toFixed(2)),
  );

  const nextMs =
    intervalDays === 0 ? nowMs + 10 * 60 * 1000 : nowMs + intervalDays * MS_PER_DAY;

  let status = record.status;
  if (!isCorrect) {
    status = 'learning';
  } else if (repetitions >= 4 && intervalDays >= 14 && getRetentionRate({ ...record, correctCount, incorrectCount }) >= 80) {
    status = 'mastered';
  } else if (repetitions >= 2) {
    status = 'reviewing';
  } else {
    status = 'learning';
  }

  return {
    ...record,
    status,
    lastReviewedAt: nowIso,
    nextReviewAt: new Date(nextMs).toISOString(),
    intervalDays,
    easeFactor,
    repetitions,
    correctCount,
    incorrectCount,
    lapses,
  };
}

export function getRetentionRate(record: Pick<VocabularyRecord, 'correctCount' | 'incorrectCount'>): number {
  const total = record.correctCount + record.incorrectCount;
  if (total === 0) return 100;
  return Math.round((record.correctCount / total) * 100);
}

/**
 * Prioritizes overdue cards and cards the learner repeatedly gets wrong (high lapses, low retention).
 */
export function selectReviewQueue(
  records: VocabularyRecord[],
  nowIso: string = new Date().toISOString(),
  limit: number = 20,
): VocabularyRecord[] {
  const nowMs = new Date(nowIso).getTime();

  return [...records]
    .sort((a, b) => {
      const aDue = new Date(a.nextReviewAt).getTime() <= nowMs ? 1 : 0;
      const bDue = new Date(b.nextReviewAt).getTime() <= nowMs ? 1 : 0;
      if (aDue !== bDue) return bDue - aDue;

      // Prioritize struggling words (more lapses & lower retention)
      const aRetention = getRetentionRate(a);
      const bRetention = getRetentionRate(b);
      if (a.lapses !== b.lapses) return b.lapses - a.lapses;
      if (aRetention !== bRetention) return aRetention - bRetention;

      return new Date(a.nextReviewAt).getTime() - new Date(b.nextReviewAt).getTime();
    })
    .slice(0, limit);
}

export function buildReviewPrompt(
  target: VocabularyRecord,
  allRecords: VocabularyRecord[],
  format: ReviewFormat,
): ReviewPrompt {
  const cleanWord = stripStressMarks(target.word);
  const cleanExample = stripStressMarks(target.exampleRu);

  const otherChoices = allRecords
    .filter((r) => r.id !== target.id)
    .slice(0, 8);

  if (format === 'ru_to_vi') {
    const distractors = otherChoices.slice(0, 3).map((r) => r.meaningVi);
    return {
      vocabulary: target,
      format,
      promptText: target.stressedWord || target.word,
      subPromptText: target.definitionRu,
      choices: shuffleDeterministic([target.meaningVi, ...distractors], target.id + format),
      expectedAnswer: target.meaningVi,
    };
  }

  if (format === 'vi_to_ru') {
    return {
      vocabulary: target,
      format,
      promptText: target.meaningVi,
      subPromptText: `${target.partOfSpeech} · ${target.forms}`,
      expectedAnswer: cleanWord,
    };
  }

  if (format === 'fill_blank' || format === 'complete_sentence') {
    const regex = new RegExp(escapeRegExp(cleanWord.split(' ')[0]), 'i');
    const masked = regex.test(cleanExample)
      ? cleanExample.replace(regex, '________')
      : `${cleanExample} (________)`;

    const distractors = otherChoices.slice(0, 3).map((r) => stripStressMarks(r.word));
    return {
      vocabulary: target,
      format,
      promptText: masked,
      subPromptText: target.exampleVi,
      choices:
        format === 'fill_blank'
          ? shuffleDeterministic([cleanWord, ...distractors], target.id + format)
          : undefined,
      expectedAnswer: cleanWord,
    };
  }

  if (format === 'choose_word') {
    const distractors = otherChoices.slice(0, 3).map((r) => stripStressMarks(r.word));
    return {
      vocabulary: target,
      format,
      promptText: target.meaningVi,
      subPromptText: target.definitionRu,
      choices: shuffleDeterministic([cleanWord, ...distractors], target.id + format),
      expectedAnswer: cleanWord,
    };
  }

  // listen_identify
  const distractors = otherChoices.slice(0, 3).map((r) => stripStressMarks(r.word));
  return {
    vocabulary: target,
    format: 'listen_identify',
    promptText: cleanWord,
    subPromptText: target.meaningVi,
    choices: shuffleDeterministic([cleanWord, ...distractors], target.id + format),
    expectedAnswer: cleanWord,
  };
}

export function checkTypedAnswer(userInput: string, expected: string): boolean {
  const norm = (s: string) =>
    stripStressMarks(s)
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[.,!?;:—–\-"«»()]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  return norm(userInput) === norm(expected);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shuffleDeterministic(items: string[], seedStr: string): string[] {
  const unique = Array.from(new Set(items));
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash * 31 + seedStr.charCodeAt(i)) | 0;
  }
  const arr = [...unique];
  for (let i = arr.length - 1; i > 0; i--) {
    hash = (hash * 1664525 + 1013904223) | 0;
    const j = Math.abs(hash) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
