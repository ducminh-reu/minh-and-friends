import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAdaptiveProgress } from './adaptiveEngine';
import type { DictationAttempt, DictationErrorCategory } from '../types/domain';

const zeroErrors: Record<DictationErrorCategory, number> = {
  listening: 0,
  missing: 0,
  extra: 0,
  word_form: 0,
  spelling: 0,
  grammar: 0,
  case: 0,
  gender_number: 0,
  aspect: 0,
  punctuation: 0,
};

function makeAttempt(
  id: string,
  level: 'B1' | 'B2' | 'C1' | 'C2',
  score: number,
): DictationAttempt {
  return {
    id,
    lessonId: `l-${id}`,
    lessonTitleVi: 'Test',
    lessonTitleRu: 'Тест',
    lessonLevel: level,
    lessonSource: 'curated',
    mode: 'sentence',
    completedAt: '2026-11-21T10:00:00.000Z',
    durationSec: 120,
    listeningAccuracy: score,
    lexicalAccuracy: score,
    spellingGrammarAccuracy: score,
    punctuationAccuracy: 100,
    errorCounts: zeroErrors,
    sentenceInputs: {},
  };
}

test('never promotes CEFR level solely on 1 perfect dictation', () => {
  const assessment = evaluateAdaptiveProgress(
    'B1',
    null,
    [makeAttempt('1', 'B1', 100)],
    [],
  );
  assert.equal(assessment.estimatedLevel, 'B1');
  assert.equal(assessment.verifiedLevel, null);
  assert.equal(assessment.action, 'test_higher');
});

test('promotes estimated CEFR level only after multiple strong attempts', () => {
  const assessment = evaluateAdaptiveProgress(
    'B1',
    null,
    [
      makeAttempt('1', 'B1', 96),
      makeAttempt('2', 'B1', 97),
      makeAttempt('3', 'B1', 98),
    ],
    [],
  );
  assert.equal(assessment.estimatedLevel, 'B2');
  assert.equal(assessment.verifiedLevel, null);
  assert.equal(assessment.action, 'test_higher');
});

test('recommends reinforcement when score is below 70%', () => {
  const assessment = evaluateAdaptiveProgress(
    'B2',
    'B1',
    [makeAttempt('1', 'B2', 62), makeAttempt('2', 'B2', 64)],
    [],
  );
  assert.equal(assessment.action, 'reinforce');
  assert.equal(assessment.estimatedLevel, 'B2');
  assert.equal(assessment.verifiedLevel, 'B1');
  assert.equal(assessment.nextTargetLevel, 'B2');
});

test('recommendNextLesson does not jump from B1 directly to C1 when B1 lessons were completed', async () => {
  const { recommendNextLesson } = await import('./adaptiveEngine');
  const assessment = evaluateAdaptiveProgress(
    'B1',
    null,
    [makeAttempt('b1-done', 'B1', 78)],
    [],
  );
  const lessons = [
    { id: 'l-b1-done', level: 'B1' },
    { id: 'l-c1-unseen', level: 'C1' },
  ] as unknown as import('../types/domain').Lesson[];
  const rec = recommendNextLesson(lessons, [makeAttempt('b1-done', 'B1', 78)], assessment);
  assert.equal(rec?.id, 'l-b1-done');
});
