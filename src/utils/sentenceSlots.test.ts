import test from 'node:test';
import assert from 'node:assert/strict';
import {
  distributePastedText,
  joinWordSlots,
  parseSentenceToWordSlots,
  resizeWordSlotValues,
} from './sentenceSlots.ts';
import { compareSentence, tokenizeLexicalWords } from './transcriptDiff.ts';

test('parseSentenceToWordSlots matches tokenizeLexicalWords count 1-to-1 including stress marks and punctuation', () => {
  const samples = [
    'Приве́т, Макси́м! Как хорошо́, что ты успе́л прие́хать до нача́ла про́бок.',
    '— «Что-то» пошло́ не так, из-за э́того мы опозда́ли.',
    'В 2025 году́ экспорт вы́рос на 12 проце́нтов.',
    'Да!',
  ];

  for (const text of samples) {
    const parsed = parseSentenceToWordSlots(text);
    const lexical = tokenizeLexicalWords(text);
    assert.equal(parsed.wordCount, lexical.length, `Word count mismatch for: ${text}`);

    const wordSegments = parsed.segments.filter((s) => s.type === 'word');
    assert.equal(wordSegments.length, lexical.length);
    wordSegments.forEach((seg, idx) => {
      assert.equal(seg.wordIndex, idx);
      assert.ok(seg.charLength >= 1);
    });
  }
});

test('parseSentenceToWordSlots attaches punctuation cleanly without exposing reference words', () => {
  const parsed = parseSentenceToWordSlots('Привет, «друг»!');
  assert.equal(parsed.wordCount, 2);
  assert.deepEqual(parsed.segments, [
    { type: 'word', wordIndex: 0, charLength: 6 },
    { type: 'punct', text: ',', attach: 'left' },
    { type: 'punct', text: '«', attach: 'right' },
    { type: 'word', wordIndex: 1, charLength: 4 },
    { type: 'punct', text: '»!', attach: 'left' },
  ]);
});

test('joinWordSlots returns empty string when all slots are empty and full sentence when filled', () => {
  const ref = 'Привет, Максим! Как дела?';
  const parsed = parseSentenceToWordSlots(ref);

  assert.equal(joinWordSlots(parsed.segments, ['', '', '', '']), '');
  assert.equal(joinWordSlots(parsed.segments, ['  ', '', '', '']), '');

  const joinedFull = joinWordSlots(parsed.segments, ['Привет', 'Максим', 'Как', 'дела']);
  assert.equal(joinedFull, 'Привет, Максим! Как дела?');

  const comparison = compareSentence(
    { id: 's1', order: 1, speaker: 'Анна', text: ref, translationVi: 'Xin chào', startSec: 0, endSec: 3 },
    joinedFull,
  );
  assert.equal(comparison.lexicalAccuracy, 100);
  assert.equal(comparison.listeningAccuracy, 100);
  assert.equal(comparison.punctuationAccuracy, 100);
});

test('joinWordSlots handles missing middle slots accurately during grading', () => {
  const ref = 'Я вчера купил новый словарь.';
  const parsed = parseSentenceToWordSlots(ref);

  // User leaves slot 2 ('купил') empty
  const joinedPartial = joinWordSlots(parsed.segments, ['Я', 'вчера', '', 'новый', 'словарь']);
  assert.equal(joinedPartial, 'Я вчера новый словарь.');

  const comparison = compareSentence(
    { id: 's1', order: 1, speaker: 'Анна', text: ref, translationVi: 'Hôm qua tôi đã mua từ điển mới.', startSec: 0, endSec: 3 },
    joinedPartial,
  );
  assert.equal(comparison.errors.length, 1);
  assert.equal(comparison.errors[0].category, 'missing');
  assert.equal(comparison.errors[0].referenceSnippet, 'купил');
});

test('distributePastedText splits multi-word paste and strips outer punctuation', () => {
  const initial = ['', '', '', '', ''];
  const { nextValues, lastFilledIndex } = distributePastedText(
    initial,
    1,
    'Приве́т, «Максим»! Как дела?',
  );
  assert.deepEqual(nextValues, ['', 'Привет', 'Максим', 'Как', 'дела']);
  assert.equal(lastFilledIndex, 4);
});

test('resizeWordSlotValues preserves existing entries and pads to wordCount', () => {
  assert.deepEqual(resizeWordSlotValues(['Привет'], 3), ['Привет', '', '']);
  assert.deepEqual(resizeWordSlotValues(['А', 'Б', 'В'], 2), ['А', 'Б']);
});
