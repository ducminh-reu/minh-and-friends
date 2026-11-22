import assert from 'node:assert/strict';
import test from 'node:test';
import type { OfflineLessonRecord } from '../services/offlineLessonStore';
import { formatStorageBytes, summarizeOfflineStorage } from './offlineFormatters';

test('formatStorageBytes formats KB and MB cleanly', () => {
  assert.equal(formatStorageBytes(0), '0 KB');
  assert.equal(formatStorageBytes(512), '1 KB');
  assert.equal(formatStorageBytes(24576), '24 KB');
  assert.equal(formatStorageBytes(1024 * 1024 * 2.5), '2.5 MB');
});

test('summarizeOfflineStorage aggregates lesson counts, audio clips, and bytes', () => {
  const sample: OfflineLessonRecord[] = [
    {
      lessonId: 'l1',
      titleRu: 'Диалог 1',
      titleVi: 'Hội thoại 1',
      level: 'B1',
      downloadedAt: '2026-01-01T00:00:00.000Z',
      sentenceCount: 8,
      cachedAudioCount: 8,
      totalAudioBytes: 512000,
      lessonSnapshot: {} as OfflineLessonRecord['lessonSnapshot'],
    },
    {
      lessonId: 'l2',
      titleRu: 'Диалог 2',
      titleVi: 'Hội thoại 2',
      level: 'B2',
      downloadedAt: '2026-01-02T00:00:00.000Z',
      sentenceCount: 10,
      cachedAudioCount: 0,
      totalAudioBytes: 0,
      lessonSnapshot: {} as OfflineLessonRecord['lessonSnapshot'],
    },
  ];
  const summary = summarizeOfflineStorage(sample);
  assert.deepEqual(summary, {
    lessonCount: 2,
    totalAudioClips: 8,
    totalBytes: 512000,
  });
});
