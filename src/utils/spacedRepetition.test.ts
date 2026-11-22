import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyReviewOutcome,
  buildReviewPrompt,
  checkTypedAnswer,
  selectReviewQueue,
} from './spacedRepetition';
import type { VocabularyRecord } from '../types/domain';

function makeVocab(overrides: Partial<VocabularyRecord>): VocabularyRecord {
  return {
    id: 'v-1',
    word: 'собеседование',
    stressedWord: 'собесе́дование',
    partOfSpeech: 'существительное',
    forms: 'ср. р., -я',
    meaningVi: 'buổi phỏng vấn',
    definitionRu: 'встреча с работодателем для оценки кандидата',
    exampleRu: 'У меня завтра важное собеседование.',
    exampleVi: 'Ngày mai tôi có một buổi phỏng vấn quan trọng.',
    sourceLessonId: 'l-1',
    sourceLessonTitle: 'Test Lesson',
    notes: '',
    status: 'learning',
    createdAt: '2026-11-01T10:00:00.000Z',
    lastReviewedAt: null,
    nextReviewAt: '2026-11-21T10:00:00.000Z',
    intervalDays: 1,
    easeFactor: 2.5,
    repetitions: 1,
    correctCount: 1,
    incorrectCount: 0,
    lapses: 0,
    ...overrides,
  };
}

test('prioritizes due cards with higher lapses / lower retention first', () => {
  const now = '2026-11-21T12:00:00.000Z';
  const easy = makeVocab({ id: 'easy', lapses: 0, correctCount: 5, incorrectCount: 0 });
  const struggled = makeVocab({ id: 'hard', lapses: 3, correctCount: 2, incorrectCount: 3 });
  const future = makeVocab({
    id: 'future',
    lapses: 5,
    nextReviewAt: '2026-11-28T12:00:00.000Z',
  });

  const queue = selectReviewQueue([easy, future, struggled], now);
  assert.equal(queue[0].id, 'hard');
  assert.equal(queue[1].id, 'easy');
  assert.equal(queue[2].id, 'future');
});

test('incorrect review resets interval and increments lapses', () => {
  const v = makeVocab({ repetitions: 3, intervalDays: 6, lapses: 0 });
  const updated = applyReviewOutcome(v, 0, '2026-11-21T12:00:00.000Z');
  assert.equal(updated.repetitions, 0);
  assert.equal(updated.intervalDays, 0);
  assert.equal(updated.lapses, 1);
  assert.equal(updated.incorrectCount, 1);
  assert.equal(updated.status, 'learning');
});

test('correct typed answer normalizes ё/е and stress marks', () => {
  assert.equal(checkTypedAnswer('еще', 'ещё'), true);
  assert.equal(checkTypedAnswer('собеседование', 'собесе́дование'), true);
});

test('buildReviewPrompt generates valid choices for all choice formats', () => {
  const v1 = makeVocab({ id: 'v1', word: 'собеседование', meaningVi: 'buổi phỏng vấn' });
  const v2 = makeVocab({ id: 'v2', word: 'резюме', meaningVi: 'sơ yếu lý lịch' });
  const v3 = makeVocab({ id: 'v3', word: 'опыт', meaningVi: 'kinh nghiệm' });
  const v4 = makeVocab({ id: 'v4', word: 'зарплата', meaningVi: 'tiền lương' });

  const prompt = buildReviewPrompt(v1, [v1, v2, v3, v4], 'choose_word');
  assert.ok(prompt.choices && prompt.choices.length === 4);
  assert.ok(prompt.choices.includes('собеседование'));
});
