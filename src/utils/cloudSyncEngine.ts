import type {
  DailyActivityPoint,
  DictationAttempt,
  DictationMode,
  LearnerProfile,
  Lesson,
  VocabularyRecord,
  VocabularyReviewLog,
} from '../types/domain';
import { stripStressMarks } from './transcriptDiff';

export type CloudSyncStatus = 'local_only' | 'syncing' | 'synced' | 'sync_failed';

export type SentenceInputStyle = 'slots' | 'free';

export interface SyncableDraft {
  lessonId: string;
  mode: DictationMode;
  sentenceInputs: Record<string, string>;
  wordSlotInputs?: Record<string, string[]>;
  sentenceInputStyle?: SentenceInputStyle;
  fullInput: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface SyncableSavedLesson {
  lessonId: string;
  lessonSnapshot?: Lesson | null;
  savedAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface SyncableVocabularyRecord extends VocabularyRecord {
  updatedAt?: string;
  deletedAt?: string | null;
}

export interface SyncableAiLesson extends Lesson {
  updatedAt?: string;
  deletedAt?: string | null;
}

export type SyncQueueOp =
  | { type: 'upsert_profile'; updatedAt: string; profile: LearnerProfile }
  | { type: 'upsert_vocabulary'; updatedAt: string; item: SyncableVocabularyRecord }
  | { type: 'delete_vocabulary'; updatedAt: string; id: string; deletedAt: string }
  | { type: 'upsert_draft'; updatedAt: string; draft: SyncableDraft }
  | { type: 'delete_draft'; updatedAt: string; lessonId: string; deletedAt: string }
  | { type: 'upsert_attempt'; updatedAt: string; attempt: DictationAttempt }
  | { type: 'upsert_review_log'; updatedAt: string; log: VocabularyReviewLog }
  | { type: 'upsert_daily_activity'; updatedAt: string; point: DailyActivityPoint }
  | { type: 'upsert_ai_lesson'; updatedAt: string; lesson: SyncableAiLesson }
  | { type: 'delete_ai_lesson'; updatedAt: string; id: string; deletedAt: string }
  | { type: 'upsert_saved_lesson'; updatedAt: string; saved: SyncableSavedLesson }
  | { type: 'delete_saved_lesson'; updatedAt: string; lessonId: string; deletedAt: string };

export interface SyncDatasetSnapshot {
  profile: LearnerProfile;
  profileUpdatedAt?: string;
  vocabulary: SyncableVocabularyRecord[];
  drafts: Record<string, SyncableDraft>;
  attempts: DictationAttempt[];
  reviewLogs: VocabularyReviewLog[];
  dailyActivity: DailyActivityPoint[];
  aiLessons: SyncableAiLesson[];
  savedLessons: Record<string, SyncableSavedLesson>;
}

function toEpochMs(iso?: string | null): number {
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeVocabWordKey(word: string): string {
  return stripStressMarks(word).trim().toLowerCase().replace(/\s+/g, ' ');
}

function getOpEntityKey(op: SyncQueueOp): string {
  switch (op.type) {
    case 'upsert_profile':
      return 'profile';
    case 'upsert_vocabulary':
      return `vocab:${op.item.id}`;
    case 'delete_vocabulary':
      return `vocab:${op.id}`;
    case 'upsert_draft':
      return `draft:${op.draft.lessonId}`;
    case 'delete_draft':
      return `draft:${op.lessonId}`;
    case 'upsert_attempt':
      return `attempt:${op.attempt.id}`;
    case 'upsert_review_log':
      return `review:${op.log.id}`;
    case 'upsert_daily_activity':
      return `activity:${op.point.date}`;
    case 'upsert_ai_lesson':
      return `ai_lesson:${op.lesson.id}`;
    case 'delete_ai_lesson':
      return `ai_lesson:${op.id}`;
    case 'upsert_saved_lesson':
      return `saved_lesson:${op.saved.lessonId}`;
    case 'delete_saved_lesson':
      return `saved_lesson:${op.lessonId}`;
  }
}

export function coalesceSyncQueue(queue: SyncQueueOp[]): SyncQueueOp[] {
  const byKey = new Map<string, SyncQueueOp>();
  for (const op of queue) {
    const key = getOpEntityKey(op);
    const existing = byKey.get(key);
    if (!existing || toEpochMs(op.updatedAt) >= toEpochMs(existing.updatedAt)) {
      byKey.set(key, op);
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) => toEpochMs(a.updatedAt) - toEpochMs(b.updatedAt),
  );
}

export function enqueueSyncOp(queue: SyncQueueOp[], op: SyncQueueOp): SyncQueueOp[] {
  return coalesceSyncQueue([...queue, op]);
}

export function mergeProfiles(
  localProfile: LearnerProfile,
  localUpdatedAt: string | undefined,
  cloudProfile: LearnerProfile | null,
  cloudUpdatedAt: string | undefined,
): { profile: LearnerProfile; updatedAt: string } {
  if (!cloudProfile) {
    return {
      profile: localProfile,
      updatedAt: localUpdatedAt || new Date().toISOString(),
    };
  }

  const localTs = toEpochMs(localUpdatedAt);
  const cloudTs = toEpochMs(cloudUpdatedAt);
  const primary = cloudTs >= localTs ? cloudProfile : localProfile;
  const secondary = cloudTs >= localTs ? localProfile : cloudProfile;

  // Merge CEFR history cleanly without duplicates
  const historyMap = new Map<string, LearnerProfile['cefrHistory'][number]>();
  for (const entry of [...secondary.cefrHistory, ...primary.cefrHistory]) {
    const k = `${entry.date}::${entry.estimatedLevel}`;
    const prev = historyMap.get(k);
    if (!prev || entry.compositeScore > prev.compositeScore) {
      historyMap.set(k, entry);
    }
  }
  const cefrHistory = Array.from(historyMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  // Never lose highest practice streak/latest practice date
  const lastPracticeDate =
    localProfile.lastPracticeDate >= cloudProfile.lastPracticeDate
      ? localProfile.lastPracticeDate
      : cloudProfile.lastPracticeDate;

  let streakDays = primary.streakDays;
  if (localProfile.lastPracticeDate === cloudProfile.lastPracticeDate) {
    streakDays = Math.max(localProfile.streakDays, cloudProfile.streakDays);
  } else if (lastPracticeDate === localProfile.lastPracticeDate) {
    streakDays = Math.max(localProfile.streakDays, streakDays);
  } else {
    streakDays = Math.max(cloudProfile.streakDays, streakDays);
  }

  return {
    profile: {
      ...primary,
      verifiedLevel: primary.verifiedLevel ?? secondary.verifiedLevel ?? null,
      streakDays,
      lastPracticeDate,
      cefrHistory,
    },
    updatedAt:
      cloudTs >= localTs
        ? cloudUpdatedAt || new Date().toISOString()
        : localUpdatedAt || new Date().toISOString(),
  };
}

function getVocabEffectiveTs(v: SyncableVocabularyRecord): number {
  return Math.max(
    toEpochMs(v.deletedAt),
    toEpochMs(v.updatedAt),
    toEpochMs(v.lastReviewedAt),
    toEpochMs(v.createdAt),
  );
}

function chooseWinningVocab(
  a: SyncableVocabularyRecord,
  b: SyncableVocabularyRecord,
): SyncableVocabularyRecord {
  const aDelTs = toEpochMs(a.deletedAt);
  const bDelTs = toEpochMs(b.deletedAt);
  const aTs = getVocabEffectiveTs(a);
  const bTs = getVocabEffectiveTs(b);

  // Respect latest tombstone vs latest edit
  if (aDelTs > 0 && aDelTs >= bTs) return a;
  if (bDelTs > 0 && bDelTs >= aTs) return b;

  // Prefer higher SRS progress if neither is deleted and timestamps are equal/close
  const aNonDeleted = !a.deletedAt;
  const bNonDeleted = !b.deletedAt;
  if (aNonDeleted && bNonDeleted) {
    const newer = aTs >= bTs ? a : b;
    const older = aTs >= bTs ? b : a;
    const moreReviewed =
      a.repetitions !== b.repetitions
        ? a.repetitions > b.repetitions
          ? a
          : b
        : toEpochMs(a.lastReviewedAt) >= toEpochMs(b.lastReviewedAt)
          ? a
          : b;

    return {
      ...moreReviewed,
      notes: newer.notes || older.notes,
      stressedWord: newer.stressedWord || older.stressedWord,
      meaningVi: newer.meaningVi || older.meaningVi,
      updatedAt:
        aTs >= bTs
          ? a.updatedAt ?? a.lastReviewedAt ?? a.createdAt
          : b.updatedAt ?? b.lastReviewedAt ?? b.createdAt,
      deletedAt: null,
    };
  }

  return aTs >= bTs ? a : b;
}

export function mergeVocabulary(
  localItems: SyncableVocabularyRecord[],
  cloudItems: SyncableVocabularyRecord[],
): SyncableVocabularyRecord[] {
  const byId = new Map<string, SyncableVocabularyRecord>();
  for (const item of [...localItems, ...cloudItems]) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
    } else {
      byId.set(item.id, chooseWinningVocab(existing, item));
    }
  }

  // Second pass: deduplicate by normalized Cyrillic word so migration never creates duplicates
  const byWord = new Map<string, SyncableVocabularyRecord>();
  for (const item of byId.values()) {
    const wordKey = normalizeVocabWordKey(item.word);
    if (!wordKey) continue;
    const existing = byWord.get(wordKey);
    if (!existing) {
      byWord.set(wordKey, item);
    } else {
      byWord.set(wordKey, chooseWinningVocab(existing, item));
    }
  }

  return Array.from(byWord.values()).sort(
    (a, b) => toEpochMs(b.createdAt) - toEpochMs(a.createdAt),
  );
}

export function mergeDrafts(
  localDrafts: Record<string, SyncableDraft>,
  cloudDrafts: Record<string, SyncableDraft>,
): Record<string, SyncableDraft> {
  const keys = new Set([...Object.keys(localDrafts), ...Object.keys(cloudDrafts)]);
  const merged: Record<string, SyncableDraft> = {};

  for (const lessonId of keys) {
    const local = localDrafts[lessonId];
    const cloud = cloudDrafts[lessonId];
    if (!local && cloud) {
      merged[lessonId] = cloud;
      continue;
    }
    if (local && !cloud) {
      merged[lessonId] = local;
      continue;
    }
    if (local && cloud) {
      const localTs = Math.max(toEpochMs(local.updatedAt), toEpochMs(local.deletedAt));
      const cloudTs = Math.max(toEpochMs(cloud.updatedAt), toEpochMs(cloud.deletedAt));
      merged[lessonId] = cloudTs >= localTs ? cloud : local;
    }
  }

  return merged;
}

export function mergeAttempts(
  localAttempts: DictationAttempt[],
  cloudAttempts: DictationAttempt[],
): DictationAttempt[] {
  const byId = new Map<string, DictationAttempt>();
  for (const att of [...cloudAttempts, ...localAttempts]) {
    if (!byId.has(att.id)) {
      byId.set(att.id, att);
    }
  }
  // Secondary fingerprint dedup for identical lesson + timestamp
  const byFingerprint = new Map<string, DictationAttempt>();
  for (const att of byId.values()) {
    const fp = `${att.lessonId}::${att.completedAt}`;
    if (!byFingerprint.has(fp)) {
      byFingerprint.set(fp, att);
    }
  }

  return Array.from(byFingerprint.values()).sort(
    (a, b) => toEpochMs(b.completedAt) - toEpochMs(a.completedAt),
  );
}

export function mergeReviewLogs(
  localLogs: VocabularyReviewLog[],
  cloudLogs: VocabularyReviewLog[],
): VocabularyReviewLog[] {
  const byId = new Map<string, VocabularyReviewLog>();
  for (const log of [...cloudLogs, ...localLogs]) {
    if (!byId.has(log.id)) {
      byId.set(log.id, log);
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => toEpochMs(b.reviewedAt) - toEpochMs(a.reviewedAt))
    .slice(0, 300);
}

export function mergeDailyActivity(
  localActivity: DailyActivityPoint[],
  cloudActivity: DailyActivityPoint[],
): DailyActivityPoint[] {
  const byDate = new Map<string, DailyActivityPoint>();
  for (const point of [...cloudActivity, ...localActivity]) {
    const prev = byDate.get(point.date);
    if (!prev) {
      byDate.set(point.date, point);
    } else {
      byDate.set(point.date, {
        date: point.date,
        minutes: Math.max(prev.minutes, point.minutes),
        sentencesCompleted: Math.max(prev.sentencesCompleted, point.sentencesCompleted),
        dictationAccuracy: point.dictationAccuracy ?? prev.dictationAccuracy,
      });
    }
  }
  return Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-90);
}

export function mergeAiLessons(
  localLessons: SyncableAiLesson[],
  cloudLessons: SyncableAiLesson[],
): SyncableAiLesson[] {
  const byId = new Map<string, SyncableAiLesson>();
  for (const lesson of [...localLessons, ...cloudLessons]) {
    const prev = byId.get(lesson.id);
    if (!prev) {
      byId.set(lesson.id, lesson);
    } else {
      const prevTs = Math.max(
        toEpochMs(prev.deletedAt),
        toEpochMs(prev.updatedAt),
        toEpochMs(prev.createdAt),
      );
      const currTs = Math.max(
        toEpochMs(lesson.deletedAt),
        toEpochMs(lesson.updatedAt),
        toEpochMs(lesson.createdAt),
      );
      byId.set(lesson.id, currTs >= prevTs ? lesson : prev);
    }
  }
  return Array.from(byId.values()).sort(
    (a, b) => toEpochMs(b.createdAt) - toEpochMs(a.createdAt),
  );
}

export function mergeSavedLessons(
  localSaved: Record<string, SyncableSavedLesson>,
  cloudSaved: Record<string, SyncableSavedLesson>,
): Record<string, SyncableSavedLesson> {
  const keys = new Set([...Object.keys(localSaved), ...Object.keys(cloudSaved)]);
  const merged: Record<string, SyncableSavedLesson> = {};

  for (const lessonId of keys) {
    const local = localSaved[lessonId];
    const cloud = cloudSaved[lessonId];
    if (!local && cloud) {
      merged[lessonId] = cloud;
      continue;
    }
    if (local && !cloud) {
      merged[lessonId] = local;
      continue;
    }
    if (local && cloud) {
      const localTs = Math.max(toEpochMs(local.updatedAt), toEpochMs(local.deletedAt));
      const cloudTs = Math.max(toEpochMs(cloud.updatedAt), toEpochMs(cloud.deletedAt));
      const winner = cloudTs >= localTs ? cloud : local;
      merged[lessonId] = {
        ...winner,
        lessonSnapshot: winner.lessonSnapshot ?? local.lessonSnapshot ?? cloud.lessonSnapshot ?? null,
      };
    }
  }
  return merged;
}

export function filterActiveVocabulary(items: SyncableVocabularyRecord[]): VocabularyRecord[] {
  return items
    .filter((v) => !v.deletedAt)
    .map(({ updatedAt: _u, deletedAt: _d, ...rest }) => rest);
}

export function filterActiveDrafts(
  drafts: Record<string, SyncableDraft>,
): Record<string, Omit<SyncableDraft, 'deletedAt'>> {
  const out: Record<string, Omit<SyncableDraft, 'deletedAt'>> = {};
  for (const [id, d] of Object.entries(drafts)) {
    if (!d.deletedAt) {
      const { deletedAt: _del, ...clean } = d;
      out[id] = clean;
    }
  }
  return out;
}

export function filterActiveAiLessons(lessons: SyncableAiLesson[]): Lesson[] {
  return lessons
    .filter((l) => !l.deletedAt)
    .map(({ updatedAt: _u, deletedAt: _d, ...rest }) => rest);
}

export function filterActiveSavedLessons(
  saved: Record<string, SyncableSavedLesson>,
): Record<string, SyncableSavedLesson> {
  const out: Record<string, SyncableSavedLesson> = {};
  for (const [id, rec] of Object.entries(saved)) {
    if (!rec.deletedAt) out[id] = rec;
  }
  return out;
}

export type SeedVocabBaselineMap = Map<
  string,
  { notes: string; repetitions: number; correctCount: number; incorrectCount: number }
>;

export function isUntouchedSeedDataset(
  local: SyncDatasetSnapshot,
  seedAttemptIds: Set<string>,
  seedVocabIds: Set<string>,
  seedVocabBaseline?: SeedVocabBaselineMap,
): boolean {
  const hasCustomAttempts = local.attempts.some((a) => !seedAttemptIds.has(a.id));
  const hasCustomVocab = local.vocabulary.some((v) => {
    if (!seedVocabIds.has(v.id) || Boolean(v.deletedAt)) return true;
    const base = seedVocabBaseline?.get(v.id);
    if (!base) return false;
    return (
      v.notes !== base.notes ||
      v.repetitions !== base.repetitions ||
      v.correctCount !== base.correctCount ||
      v.incorrectCount !== base.incorrectCount
    );
  });
  const hasDrafts = Object.values(local.drafts).some((d) => !d.deletedAt);
  const hasAiLessons = local.aiLessons.some((l) => !l.deletedAt);
  const hasSavedLessons = Object.values(local.savedLessons).some((s) => !s.deletedAt);
  const hasReviewLogs = local.reviewLogs.length > 0;
  return (
    !hasCustomAttempts &&
    !hasCustomVocab &&
    !hasDrafts &&
    !hasAiLessons &&
    !hasSavedLessons &&
    !hasReviewLogs
  );
}

export function mergeCloudAndLocalState(
  local: SyncDatasetSnapshot,
  cloud: Partial<SyncDatasetSnapshot> & { hasAnyCloudRecords: boolean },
  seedAttemptIds: Set<string>,
  seedVocabIds: Set<string>,
  seedVocabBaseline?: SeedVocabBaselineMap,
): SyncDatasetSnapshot {
  const localIsPureSeed = isUntouchedSeedDataset(
    local,
    seedAttemptIds,
    seedVocabIds,
    seedVocabBaseline,
  );

  // If signing in on a second device with untouched seed data while cloud already has user records,
  // avoid injecting seed demo data into the user's real cloud account.
  const effectiveLocalVocab =
    cloud.hasAnyCloudRecords && localIsPureSeed ? [] : local.vocabulary;
  const effectiveLocalAttempts =
    cloud.hasAnyCloudRecords && localIsPureSeed ? [] : local.attempts;
  const effectiveLocalActivity =
    cloud.hasAnyCloudRecords && localIsPureSeed ? [] : local.dailyActivity;

  const { profile, updatedAt: profileUpdatedAt } = mergeProfiles(
    local.profile,
    local.profileUpdatedAt,
    cloud.profile ?? null,
    cloud.profileUpdatedAt,
  );

  return {
    profile,
    profileUpdatedAt,
    vocabulary: mergeVocabulary(effectiveLocalVocab, cloud.vocabulary ?? []),
    drafts: mergeDrafts(local.drafts, cloud.drafts ?? {}),
    attempts: mergeAttempts(effectiveLocalAttempts, cloud.attempts ?? []),
    reviewLogs: mergeReviewLogs(local.reviewLogs, cloud.reviewLogs ?? []),
    dailyActivity: mergeDailyActivity(effectiveLocalActivity, cloud.dailyActivity ?? []),
    aiLessons: mergeAiLessons(local.aiLessons, cloud.aiLessons ?? []),
    savedLessons: mergeSavedLessons(local.savedLessons, cloud.savedLessons ?? {}),
  };
}
