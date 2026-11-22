import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coalesceSyncQueue,
  filterActiveDrafts,
  filterActiveVocabulary,
  mergeAttempts,
  mergeCloudAndLocalState,
  mergeDrafts,
  mergeProfiles,
  mergeVocabulary,
  type SyncDatasetSnapshot,
  type SyncQueueOp,
  type SyncableDraft,
  type SyncableVocabularyRecord,
} from './cloudSyncEngine';
import { SEED_ATTEMPTS, SEED_DAILY_ACTIVITY, SEED_PROFILE, SEED_VOCABULARY } from '../data/seedUserData';

const SEED_ATTEMPT_IDS = new Set(SEED_ATTEMPTS.map((a) => a.id));
const SEED_VOCAB_IDS = new Set(SEED_VOCABULARY.map((v) => v.id));

test('coalesceSyncQueue collapses multiple edits for the same entity and keeps newest timestamp', () => {
  const queue: SyncQueueOp[] = [
    {
      type: 'upsert_draft',
      updatedAt: '2026-11-21T10:00:00.000Z',
      draft: {
        lessonId: 'l1',
        mode: 'sentence',
        sentenceInputs: { s1: 'прив' },
        fullInput: '',
        updatedAt: '2026-11-21T10:00:00.000Z',
      },
    },
    {
      type: 'delete_draft',
      lessonId: 'l1',
      deletedAt: '2026-11-21T10:05:00.000Z',
      updatedAt: '2026-11-21T10:05:00.000Z',
    },
    {
      type: 'upsert_vocabulary',
      updatedAt: '2026-11-21T10:01:00.000Z',
      item: { ...SEED_VOCABULARY[0], notes: 'old' },
    },
    {
      type: 'upsert_vocabulary',
      updatedAt: '2026-11-21T10:02:00.000Z',
      item: { ...SEED_VOCABULARY[0], notes: 'updated' },
    },
  ];

  const coalesced = coalesceSyncQueue(queue);
  assert.equal(coalesced.length, 2);
  assert.equal(coalesced[0].type, 'upsert_vocabulary');
  if (coalesced[0].type === 'upsert_vocabulary') {
    assert.equal(coalesced[0].item.notes, 'updated');
  }
  assert.equal(coalesced[1].type, 'delete_draft');
});

test('mergeVocabulary deduplicates identical Russian words with or without stress marks and keeps higher progress', () => {
  const localItem: SyncableVocabularyRecord = {
    ...SEED_VOCABULARY[0],
    id: 'voc-local-1',
    word: 'привыкнуть',
    stressedWord: 'привы́кнуть',
    repetitions: 1,
    notes: 'ghi chu moi',
    updatedAt: '2026-11-21T09:00:00.000Z',
  };
  const cloudItem: SyncableVocabularyRecord = {
    ...SEED_VOCABULARY[0],
    id: 'voc-cloud-1',
    word: 'привы́кнуть',
    repetitions: 4,
    notes: '',
    lastReviewedAt: '2026-11-21T12:00:00.000Z',
    updatedAt: '2026-11-21T12:00:00.000Z',
  };

  const merged = mergeVocabulary([localItem], [cloudItem]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].repetitions, 4);
  assert.equal(merged[0].notes, 'ghi chu moi');
});

test('mergeVocabulary respects newer tombstone deletion over older upsert', () => {
  const localUpsert: SyncableVocabularyRecord = {
    ...SEED_VOCABULARY[0],
    updatedAt: '2026-11-21T10:00:00.000Z',
  };
  const cloudDeleted: SyncableVocabularyRecord = {
    ...SEED_VOCABULARY[0],
    updatedAt: '2026-11-21T11:00:00.000Z',
    deletedAt: '2026-11-21T11:00:00.000Z',
  };

  const merged = mergeVocabulary([localUpsert], [cloudDeleted]);
  const active = filterActiveVocabulary(merged);
  assert.equal(active.length, 0);
});

test('mergeDrafts uses latest timestamp across devices including tombstones', () => {
  const localDrafts: Record<string, SyncableDraft> = {
    'lesson-1': {
      lessonId: 'lesson-1',
      mode: 'sentence',
      sentenceInputs: { s1: 'Доброе утро' },
      fullInput: '',
      updatedAt: '2026-11-21T10:00:00.000Z',
    },
    'lesson-2': {
      lessonId: 'lesson-2',
      mode: 'full',
      sentenceInputs: {},
      fullInput: 'Offline text',
      updatedAt: '2026-11-21T12:00:00.000Z',
    },
  };
  const cloudDrafts: Record<string, SyncableDraft> = {
    'lesson-1': {
      lessonId: 'lesson-1',
      mode: 'sentence',
      sentenceInputs: {},
      fullInput: '',
      updatedAt: '2026-11-21T11:30:00.000Z',
      deletedAt: '2026-11-21T11:30:00.000Z',
    },
  };

  const merged = mergeDrafts(localDrafts, cloudDrafts);
  const active = filterActiveDrafts(merged);
  assert.equal(active['lesson-1'], undefined);
  assert.equal(active['lesson-2']?.fullInput, 'Offline text');
});

test('mergeAttempts deduplicates by id and keeps chronological descending order', () => {
  const merged = mergeAttempts(SEED_ATTEMPTS, [
    SEED_ATTEMPTS[0],
    {
      ...SEED_ATTEMPTS[0],
      id: 'att-cloud-new',
      completedAt: '2026-11-21T14:00:00.000Z',
    },
  ]);
  assert.equal(merged.length, SEED_ATTEMPTS.length + 1);
  assert.equal(merged[0].id, 'att-cloud-new');
});

test('mergeCloudAndLocalState migrates local custom data into empty cloud account without duplicates', () => {
  const customVocab: SyncableVocabularyRecord = {
    ...SEED_VOCABULARY[0],
    id: 'voc-custom-99',
    word: 'достижение',
    stressedWord: 'достиже́ние',
    meaningVi: 'thành tựu',
    createdAt: '2026-11-21T13:00:00.000Z',
  };
  const local: SyncDatasetSnapshot = {
    profile: { ...SEED_PROFILE, displayName: 'Minh Offline' },
    profileUpdatedAt: '2026-11-21T13:00:00.000Z',
    vocabulary: [customVocab, ...SEED_VOCABULARY],
    drafts: {
      'curated-b1-arbat-cafe': {
        lessonId: 'curated-b1-arbat-cafe',
        mode: 'sentence',
        sentenceInputs: { s1: 'Доброе утро' },
        fullInput: '',
        updatedAt: '2026-11-21T13:05:00.000Z',
      },
    },
    attempts: SEED_ATTEMPTS,
    reviewLogs: [],
    dailyActivity: SEED_DAILY_ACTIVITY,
    aiLessons: [],
    savedLessons: {},
  };

  const merged = mergeCloudAndLocalState(
    local,
    { hasAnyCloudRecords: false },
    SEED_ATTEMPT_IDS,
    SEED_VOCAB_IDS,
  );
  assert.equal(merged.profile.displayName, 'Minh Offline');
  assert.equal(filterActiveVocabulary(merged.vocabulary).length, SEED_VOCABULARY.length + 1);
  assert.equal(merged.attempts.length, SEED_ATTEMPTS.length);
  assert.equal(filterActiveDrafts(merged.drafts)['curated-b1-arbat-cafe']?.sentenceInputs.s1, 'Доброе утро');
});

test('mergeCloudAndLocalState avoids polluting populated cloud account with untouched local seed data on second device', () => {
  const localUntouched: SyncDatasetSnapshot = {
    profile: SEED_PROFILE,
    vocabulary: SEED_VOCABULARY,
    drafts: {},
    attempts: SEED_ATTEMPTS,
    reviewLogs: [],
    dailyActivity: SEED_DAILY_ACTIVITY,
    aiLessons: [],
    savedLessons: {},
  };
  const cloudVocab: SyncableVocabularyRecord = {
    ...SEED_VOCABULARY[0],
    id: 'voc-real-1',
    word: 'ответственность',
    stressedWord: 'отве́тственность',
    meaningVi: 'trách nhiệm',
  };

  const merged = mergeCloudAndLocalState(
    localUntouched,
    {
      hasAnyCloudRecords: true,
      profile: { ...SEED_PROFILE, displayName: 'Device 1 User', streakDays: 12 },
      profileUpdatedAt: '2026-11-21T14:00:00.000Z',
      vocabulary: [cloudVocab],
      attempts: [],
      drafts: {},
      reviewLogs: [],
      dailyActivity: [],
      aiLessons: [],
      savedLessons: {},
    },
    SEED_ATTEMPT_IDS,
    SEED_VOCAB_IDS,
  );

  assert.equal(merged.profile.displayName, 'Device 1 User');
  assert.equal(merged.profile.streakDays, 12);
  assert.equal(filterActiveVocabulary(merged.vocabulary).length, 1);
  assert.equal(filterActiveVocabulary(merged.vocabulary)[0].id, 'voc-real-1');
  assert.equal(merged.attempts.length, 0);
});

test('mergeProfiles preserves higher streak and merges cefrHistory without duplicates', () => {
  const res = mergeProfiles(
    {
      ...SEED_PROFILE,
      streakDays: 8,
      lastPracticeDate: '2026-11-21',
      cefrHistory: [{ date: '2026-11-21', estimatedLevel: 'B2', compositeScore: 87, noteVi: 'A' }],
    },
    '2026-11-21T10:00:00.000Z',
    {
      ...SEED_PROFILE,
      displayName: 'Cloud Name',
      streakDays: 6,
      lastPracticeDate: '2026-11-20',
      cefrHistory: [{ date: '2026-11-21', estimatedLevel: 'B2', compositeScore: 84, noteVi: 'B' }],
    },
    '2026-11-21T12:00:00.000Z',
  );

  assert.equal(res.profile.displayName, 'Cloud Name');
  assert.equal(res.profile.streakDays, 8);
  assert.equal(res.profile.cefrHistory.length, 1);
  assert.equal(res.profile.cefrHistory[0].compositeScore, 87);
});
