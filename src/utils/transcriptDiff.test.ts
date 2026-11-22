import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeDictationSubmission,
  classifyWordSubstitution,
  compareSentence,
} from './transcriptDiff';
import type { DialogueSentence } from '../types/domain';

const sampleSentence: DialogueSentence = {
  id: 's-1',
  order: 1,
  speaker: 'Анна',
  text: 'Я вчера́ весь ве́чер гото́вилась к ва́жному собесе́дованию.',
  translationVi: 'Hôm qua cả buổi tối tôi đã chuẩn bị cho buổi phỏng vấn quan trọng.',
  startSec: 0,
  endSec: 5,
};

test('perfect dictation ignoring stress marks scores 100%', () => {
  const result = compareSentence(
    sampleSentence,
    'Я вчера весь вечер готовилась к важному собеседованию.',
  );
  assert.equal(result.listeningAccuracy, 100);
  assert.equal(result.lexicalAccuracy, 100);
  assert.equal(result.spellingGrammarAccuracy, 100);
  assert.equal(result.punctuationAccuracy, 100);
  assert.equal(result.errors.length, 0);
});

test('punctuation difference does not reduce lexical or listening accuracy', () => {
  const result = compareSentence(
    sampleSentence,
    'Я вчера весь вечер готовилась к важному собеседованию',
  );
  assert.equal(result.listeningAccuracy, 100);
  assert.equal(result.lexicalAccuracy, 100);
  assert.equal(result.punctuationAccuracy, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].category, 'punctuation');
  assert.equal(result.errors[0].severity, 'minor');
});

test('missing word and case error are classified accurately', () => {
  const result = compareSentence(
    sampleSentence,
    'Я вчера вечер готовилась к важное собеседованию.',
  );
  const categories = result.errors.map((e) => e.category);
  assert.ok(categories.includes('missing'));
  assert.ok(categories.includes('case') || categories.includes('gender_number'));
  assert.ok((result.lexicalAccuracy ?? 100) < 90);
});

test('verb aspect pair confusion is classified as aspect', () => {
  const classified = classifyWordSubstitution('сделал', 'делал');
  assert.equal(classified.category, 'aspect');
});

test('empty reference transcript never claims listening accuracy', () => {
  const report = analyzeDictationSubmission(
    'empty-lesson',
    [{ ...sampleSentence, text: '   ' }],
    'sentence',
    { 's-1': 'Привет' },
  );
  assert.equal(report.referenceAvailable, false);
  assert.equal(report.listeningAccuracy, null);
  assert.equal(report.lexicalAccuracy, null);
});

test('blank learner input scores 0% across all accuracy metrics', () => {
  const result = compareSentence(sampleSentence, '');
  assert.equal(result.listeningAccuracy, 0);
  assert.equal(result.lexicalAccuracy, 0);
  assert.equal(result.spellingGrammarAccuracy, 0);
});
