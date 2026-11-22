import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import type {
  DailyActivityPoint,
  DictationAttempt,
  LearnerProfile,
  Lesson,
  VocabularyReviewLog,
} from '../types/domain';
import type {
  SyncableAiLesson,
  SyncableDraft,
  SyncableSavedLesson,
  SyncableVocabularyRecord,
  SyncDatasetSnapshot,
  SyncQueueOp,
} from '../utils/cloudSyncEngine';

export type SyncErrorKind =
  | 'SCHEMA_MISSING'
  | 'RLS_DENIED'
  | 'AUTH_REQUIRED'
  | 'NETWORK_OFFLINE'
  | 'UNKNOWN';

export interface ClassifiedSyncError {
  kind: SyncErrorKind;
  message: string;
  rawMessage: string;
}

export function classifySyncError(err: unknown): ClassifiedSyncError {
  const raw =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err ?? 'Unknown sync error');
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  const lower = `${code} ${raw}`.toLowerCase();

  if (
    code === '42P01' ||
    code === 'PGRST205' ||
    lower.includes('could not find the table') ||
    (lower.includes('relation') && lower.includes('does not exist')) ||
    lower.includes('schema cache')
  ) {
    return {
      kind: 'SCHEMA_MISSING',
      message:
        'Các bảng dữ liệu đồng bộ trên Supabase chưa được tạo. Hãy chạy tệp SQL Schema trong Cài đặt → Supabase SQL Editor.',
      rawMessage: raw,
    };
  }

  if (
    code === '42501' ||
    lower.includes('row-level security') ||
    lower.includes('permission denied')
  ) {
    return {
      kind: 'RLS_DENIED',
      message:
        'Không đủ quyền truy cập dữ liệu theo chính sách Row Level Security (RLS). Vui lòng kiểm tra phiên đăng nhập hoặc SQL policy.',
      rawMessage: raw,
    };
  }

  if (
    code === 'PGRST301' ||
    lower.includes('jwt') ||
    lower.includes('not authenticated') ||
    lower.includes('invalid refresh token') ||
    lower.includes('session missing')
  ) {
    return {
      kind: 'AUTH_REQUIRED',
      message: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.',
      rawMessage: raw,
    };
  }

  if (
    (typeof navigator !== 'undefined' && !navigator.onLine) ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('fetch failed')
  ) {
    return {
      kind: 'NETWORK_OFFLINE',
      message:
        'Mất kết nối mạng khi đồng bộ. Mọi thay đổi vẫn được lưu cục bộ và sẽ tự đồng bộ khi có mạng.',
      rawMessage: raw,
    };
  }

  return {
    kind: 'UNKNOWN',
    message: raw || 'Đồng bộ đám mây gặp lỗi không xác định.',
    rawMessage: raw,
  };
}

export async function signUpWithEmail(
  client: SupabaseClient,
  email: string,
  password: string,
  displayName?: string,
): Promise<{
  user: User | null;
  session: Session | null;
  needsEmailConfirmation: boolean;
}> {
  const redirectTo =
    typeof window !== 'undefined' ? `${window.location.origin}/settings` : undefined;
  console.info('[Supabase Auth] Attempting sign up with email:', email.trim());
  const { data, error } = await client.auth.signUp({
    email: email.trim(),
    password,
    options: {
      emailRedirectTo: redirectTo,
      data: displayName?.trim() ? { display_name: displayName.trim() } : undefined,
    },
  });
  if (error) {
    console.error('[Supabase Auth] Sign up error:', error.message);
    throw error;
  }
  console.info('[Supabase Auth] Sign up success. User ID:', data.user?.id);
  return {
    user: data.user ?? null,
    session: data.session ?? null,
    needsEmailConfirmation: Boolean(data.user && !data.session),
  };
}

export async function signInWithEmail(
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<{ user: User; session: Session }> {
  console.info('[Supabase Auth] Attempting sign in with password for email:', email.trim());
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) {
    console.error('[Supabase Auth] Sign in error:', error.message);
    throw error;
  }
  if (!data.user || !data.session) {
    console.error('[Supabase Auth] Sign in returned null user or session.');
    throw new Error('Không nhận được phiên đăng nhập hợp lệ từ Supabase.');
  }
  console.info('[Supabase Auth] Sign in success. User ID:', data.user.id);
  return { user: data.user, session: data.session };
}

export async function signInWithGoogle(client: SupabaseClient): Promise<void> {
  const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/` : undefined;
  console.info('[Supabase Auth] Initiating Google OAuth sign in with redirectTo:', redirectTo);
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });
  if (error) {
    console.error('[Supabase Auth] Google OAuth error:', error.message);
    throw error;
  }
}

export async function signOutFromSupabase(client: SupabaseClient): Promise<void> {
  console.info('[Supabase Auth] Signing out from Supabase');
  const { error } = await client.auth.signOut();
  if (error) {
    console.error('[Supabase Auth] Sign out error:', error.message);
    throw error;
  }
}

export async function requestPasswordResetEmail(
  client: SupabaseClient,
  email: string,
): Promise<void> {
  const redirectTo =
    typeof window !== 'undefined' ? `${window.location.origin}/settings` : undefined;
  const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
    redirectTo,
  });
  if (error) throw error;
}

export async function updateAuthenticatedPassword(
  client: SupabaseClient,
  newPassword: string,
): Promise<User | null> {
  const { data, error } = await client.auth.updateUser({
    password: newPassword,
  });
  if (error) throw error;
  return data.user ?? null;
}

// --- Row mappers ---

function mapProfileRowToLocal(row: Record<string, unknown>): {
  profile: LearnerProfile;
  updatedAt: string;
} {
  return {
    profile: {
      displayName: String(row.display_name ?? 'Học viên'),
      estimatedLevel: (row.estimated_level as LearnerProfile['estimatedLevel']) || 'B1',
      verifiedLevel: (row.verified_level as LearnerProfile['verifiedLevel']) ?? null,
      dailyGoalLessons: Number(row.daily_goal_lessons ?? 2),
      dailyGoalMinutes: Number(row.daily_goal_minutes ?? 25),
      streakDays: Number(row.streak_days ?? 0),
      lastPracticeDate: String(row.last_practice_date ?? ''),
      interfaceLanguage: (row.interface_language as LearnerProfile['interfaceLanguage']) || 'vi',
      preferredMode: (row.preferred_mode as LearnerProfile['preferredMode']) || 'sentence',
      preferredSpeed: (Number(row.preferred_speed ?? 1) as LearnerProfile['preferredSpeed']) || 1,
      ttsPreference: (row.tts_preference as LearnerProfile['ttsPreference']) || 'auto',
      cefrHistory: Array.isArray(row.cefr_history)
        ? (row.cefr_history as LearnerProfile['cefrHistory'])
        : [],
    },
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

function mapProfileLocalToRow(userId: string, profile: LearnerProfile, updatedAt: string) {
  return {
    id: userId,
    display_name: profile.displayName,
    estimated_level: profile.estimatedLevel,
    verified_level: profile.verifiedLevel,
    daily_goal_lessons: profile.dailyGoalLessons,
    daily_goal_minutes: profile.dailyGoalMinutes,
    streak_days: profile.streakDays,
    last_practice_date: profile.lastPracticeDate,
    interface_language: profile.interfaceLanguage,
    preferred_mode: profile.preferredMode,
    preferred_speed: profile.preferredSpeed,
    tts_preference: profile.ttsPreference,
    cefr_history: profile.cefrHistory,
    updated_at: updatedAt,
  };
}

function mapVocabRowToLocal(row: Record<string, unknown>): SyncableVocabularyRecord {
  return {
    id: String(row.id),
    word: String(row.word ?? ''),
    stressedWord: String(row.stressed_word ?? row.word ?? ''),
    partOfSpeech: String(row.part_of_speech ?? 'существительное'),
    forms: String(row.forms ?? ''),
    meaningVi: String(row.meaning_vi ?? ''),
    definitionRu: String(row.definition_ru ?? ''),
    exampleRu: String(row.example_ru ?? ''),
    exampleVi: String(row.example_vi ?? ''),
    sourceLessonId: row.source_lesson_id ? String(row.source_lesson_id) : '',
    sourceLessonTitle: String(row.source_lesson_title ?? ''),
    notes: String(row.notes ?? ''),
    status: (row.status as SyncableVocabularyRecord['status']) || 'new',
    createdAt: String(row.created_at ?? new Date().toISOString()),
    lastReviewedAt: row.last_reviewed_at ? String(row.last_reviewed_at) : null,
    nextReviewAt: String(row.next_review_at ?? new Date().toISOString()),
    intervalDays: Number(row.interval_days ?? 0),
    easeFactor: Number(row.ease_factor ?? 2.5),
    repetitions: Number(row.repetitions ?? 0),
    correctCount: Number(row.correct_count ?? 0),
    incorrectCount: Number(row.incorrect_count ?? 0),
    lapses: Number(row.lapses ?? 0),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
  };
}

function mapVocabLocalToRow(userId: string, item: SyncableVocabularyRecord, updatedAt?: string) {
  return {
    id: item.id,
    user_id: userId,
    word: item.word,
    stressed_word: item.stressedWord || item.word,
    meaning_vi: item.meaningVi,
    definition_ru: item.definitionRu,
    example_ru: item.exampleRu,
    example_vi: item.exampleVi,
    part_of_speech: item.partOfSpeech,
    forms: item.forms,
    source_lesson_id: item.sourceLessonId ?? null,
    source_lesson_title: item.sourceLessonTitle || '',
    notes: item.notes || '',
    status: item.status,
    last_reviewed_at: item.lastReviewedAt,
    next_review_at: item.nextReviewAt,
    interval_days: item.intervalDays,
    ease_factor: item.easeFactor,
    repetitions: item.repetitions,
    correct_count: item.correctCount,
    incorrect_count: item.incorrectCount,
    lapses: item.lapses,
    created_at: item.createdAt,
    updated_at: updatedAt || item.updatedAt || item.lastReviewedAt || item.createdAt,
    deleted_at: item.deletedAt ?? null,
  };
}

function mapDraftRowToLocal(row: Record<string, unknown>): SyncableDraft {
  return {
    lessonId: String(row.lesson_id),
    mode: (row.mode as SyncableDraft['mode']) || 'sentence',
    sentenceInputs:
      row.sentence_inputs && typeof row.sentence_inputs === 'object'
        ? (row.sentence_inputs as Record<string, string>)
        : {},
    wordSlotInputs:
      row.word_slot_inputs && typeof row.word_slot_inputs === 'object'
        ? (row.word_slot_inputs as Record<string, string[]>)
        : undefined,
    sentenceInputStyle:
      row.sentence_input_style === 'free' ? 'free' : 'slots',
    fullInput: String(row.full_input ?? ''),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
  };
}

function mapDraftLocalToRow(userId: string, draft: SyncableDraft) {
  return {
    user_id: userId,
    lesson_id: draft.lessonId,
    mode: draft.mode,
    sentence_inputs: draft.sentenceInputs,
    word_slot_inputs: draft.wordSlotInputs ?? {},
    sentence_input_style: draft.sentenceInputStyle ?? 'slots',
    full_input: draft.fullInput,
    updated_at: draft.updatedAt,
    deleted_at: draft.deletedAt ?? null,
  };
}

function mapAttemptRowToLocal(row: Record<string, unknown>): DictationAttempt {
  return {
    id: String(row.id),
    lessonId: String(row.lesson_id),
    lessonTitleVi: String(row.lesson_title_vi ?? ''),
    lessonTitleRu: String(row.lesson_title_ru ?? ''),
    lessonLevel: (row.lesson_level as DictationAttempt['lessonLevel']) || 'B1',
    lessonSource: (row.lesson_source as DictationAttempt['lessonSource']) || 'curated',
    mode: (row.mode as DictationAttempt['mode']) || 'sentence',
    completedAt: String(row.completed_at ?? new Date().toISOString()),
    durationSec: Number(row.duration_sec ?? 0),
    listeningAccuracy:
      row.listening_accuracy === null || row.listening_accuracy === undefined
        ? null
        : Number(row.listening_accuracy),
    lexicalAccuracy:
      row.lexical_accuracy === null || row.lexical_accuracy === undefined
        ? null
        : Number(row.lexical_accuracy),
    spellingGrammarAccuracy:
      row.spelling_grammar_accuracy === null || row.spelling_grammar_accuracy === undefined
        ? null
        : Number(row.spelling_grammar_accuracy),
    punctuationAccuracy:
      row.punctuation_accuracy === null || row.punctuation_accuracy === undefined
        ? null
        : Number(row.punctuation_accuracy),
    errorCounts:
      row.error_counts && typeof row.error_counts === 'object'
        ? (row.error_counts as DictationAttempt['errorCounts'])
        : ({} as DictationAttempt['errorCounts']),
    sentenceInputs:
      row.sentence_inputs && typeof row.sentence_inputs === 'object'
        ? (row.sentence_inputs as Record<string, string>)
        : {},
    fullInput: row.full_input ? String(row.full_input) : undefined,
  };
}

function mapAttemptLocalToRow(userId: string, att: DictationAttempt) {
  return {
    id: att.id,
    user_id: userId,
    lesson_id: att.lessonId,
    lesson_title_vi: att.lessonTitleVi,
    lesson_title_ru: att.lessonTitleRu,
    lesson_level: att.lessonLevel,
    lesson_source: att.lessonSource,
    mode: att.mode,
    duration_sec: att.durationSec,
    listening_accuracy: att.listeningAccuracy,
    lexical_accuracy: att.lexicalAccuracy,
    spelling_grammar_accuracy: att.spellingGrammarAccuracy,
    punctuation_accuracy: att.punctuationAccuracy,
    error_counts: att.errorCounts,
    sentence_inputs: att.sentenceInputs,
    full_input: att.fullInput ?? null,
    completed_at: att.completedAt,
  };
}

function mapReviewLogRowToLocal(row: Record<string, unknown>): VocabularyReviewLog {
  return {
    id: String(row.id),
    vocabularyId: String(row.vocabulary_id),
    format: (row.format as VocabularyReviewLog['format']) || 'ru_to_vi',
    correct: Boolean(row.correct),
    quality: (Number(row.quality ?? 0) as VocabularyReviewLog['quality']) ?? 0,
    reviewedAt: String(row.reviewed_at ?? new Date().toISOString()),
  };
}

function mapReviewLogLocalToRow(userId: string, log: VocabularyReviewLog) {
  return {
    id: log.id,
    user_id: userId,
    vocabulary_id: log.vocabularyId,
    format: log.format,
    correct: log.correct,
    quality: log.quality,
    reviewed_at: log.reviewedAt,
  };
}

function mapDailyActivityRowToLocal(row: Record<string, unknown>): DailyActivityPoint {
  return {
    date: String(row.activity_date),
    minutes: Number(row.minutes ?? 0),
    sentencesCompleted: Number(row.sentences_completed ?? 0),
    dictationAccuracy:
      row.dictation_accuracy === null || row.dictation_accuracy === undefined
        ? null
        : Number(row.dictation_accuracy),
  };
}

function mapDailyActivityLocalToRow(userId: string, point: DailyActivityPoint, updatedAt?: string) {
  return {
    user_id: userId,
    activity_date: point.date,
    minutes: point.minutes,
    sentences_completed: point.sentencesCompleted,
    dictation_accuracy: point.dictationAccuracy,
    updated_at: updatedAt || new Date().toISOString(),
  };
}

function mapLessonRowToLocal(row: Record<string, unknown>): SyncableAiLesson | null {
  const payload = row.payload;
  if (!payload || typeof payload !== 'object') return null;
  const lesson = payload as Lesson;
  return {
    ...lesson,
    id: String(row.id),
    source: (row.source as Lesson['source']) || lesson.source || 'ai_generated',
    verified: Boolean(row.verified),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
  };
}

function mapLessonLocalToRow(ownerId: string, lesson: SyncableAiLesson, updatedAt?: string) {
  const { updatedAt: _u, deletedAt: _d, ...cleanLesson } = lesson;
  return {
    id: lesson.id,
    owner_id: ownerId,
    title_ru: lesson.titleRu,
    title_vi: lesson.titleVi,
    level: lesson.level,
    topic: lesson.topic,
    source: lesson.source,
    verified: Boolean(lesson.verified),
    payload: cleanLesson,
    created_at: lesson.createdAt,
    updated_at: updatedAt || lesson.updatedAt || lesson.createdAt || new Date().toISOString(),
    deleted_at: lesson.deletedAt ?? null,
  };
}

function mapSavedLessonRowToLocal(row: Record<string, unknown>): SyncableSavedLesson {
  return {
    lessonId: String(row.lesson_id),
    lessonSnapshot:
      row.lesson_snapshot && typeof row.lesson_snapshot === 'object'
        ? (row.lesson_snapshot as Lesson)
        : null,
    savedAt: String(row.saved_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.saved_at ?? new Date().toISOString()),
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
  };
}

function mapSavedLessonLocalToRow(userId: string, saved: SyncableSavedLesson) {
  return {
    user_id: userId,
    lesson_id: saved.lessonId,
    lesson_snapshot: saved.lessonSnapshot ?? null,
    saved_at: saved.savedAt,
    updated_at: saved.updatedAt,
    deleted_at: saved.deletedAt ?? null,
  };
}

// --- Cloud Fetch & Push ---

export interface CloudFetchResult {
  snapshot: Partial<SyncDatasetSnapshot>;
  hasAnyCloudRecords: boolean;
}

export async function fetchCloudSnapshot(
  client: SupabaseClient,
  userId: string,
): Promise<CloudFetchResult> {
  const [
    profileRes,
    vocabRes,
    draftsRes,
    attemptsRes,
    reviewsRes,
    activityRes,
    lessonsRes,
    savedLessonsRes,
  ] = await Promise.all([
    client.from('learner_profiles').select('*').eq('id', userId).maybeSingle(),
    client.from('vocabulary').select('*').eq('user_id', userId),
    client.from('dictation_drafts').select('*').eq('user_id', userId),
    client
      .from('dictation_attempts')
      .select('*')
      .eq('user_id', userId)
      .order('completed_at', { ascending: false })
      .limit(250),
    client
      .from('vocabulary_review_logs')
      .select('*')
      .eq('user_id', userId)
      .order('reviewed_at', { ascending: false })
      .limit(300),
    client
      .from('daily_activity')
      .select('*')
      .eq('user_id', userId)
      .order('activity_date', { ascending: true })
      .limit(90),
    client.from('lessons').select('*').eq('owner_id', userId),
    client.from('saved_lessons').select('*').eq('user_id', userId),
  ]);

  const errors = [
    profileRes.error,
    vocabRes.error,
    draftsRes.error,
    attemptsRes.error,
    reviewsRes.error,
    activityRes.error,
    lessonsRes.error,
    savedLessonsRes.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    throw errors[0];
  }

  const mappedProfile = profileRes.data
    ? mapProfileRowToLocal(profileRes.data as Record<string, unknown>)
    : null;
  const vocabulary = (vocabRes.data ?? []).map((r) =>
    mapVocabRowToLocal(r as Record<string, unknown>),
  );
  const drafts: Record<string, SyncableDraft> = {};
  for (const row of draftsRes.data ?? []) {
    const d = mapDraftRowToLocal(row as Record<string, unknown>);
    drafts[d.lessonId] = d;
  }
  const attempts = (attemptsRes.data ?? []).map((r) =>
    mapAttemptRowToLocal(r as Record<string, unknown>),
  );
  const reviewLogs = (reviewsRes.data ?? []).map((r) =>
    mapReviewLogRowToLocal(r as Record<string, unknown>),
  );
  const dailyActivity = (activityRes.data ?? []).map((r) =>
    mapDailyActivityRowToLocal(r as Record<string, unknown>),
  );
  const aiLessons = (lessonsRes.data ?? [])
    .map((r) => mapLessonRowToLocal(r as Record<string, unknown>))
    .filter((l): l is SyncableAiLesson => Boolean(l));

  const savedLessons: Record<string, SyncableSavedLesson> = {};
  for (const row of savedLessonsRes.data ?? []) {
    const s = mapSavedLessonRowToLocal(row as Record<string, unknown>);
    savedLessons[s.lessonId] = s;
  }

  const hasAnyCloudRecords = Boolean(
    mappedProfile ||
      vocabulary.length > 0 ||
      Object.keys(drafts).length > 0 ||
      attempts.length > 0 ||
      reviewLogs.length > 0 ||
      dailyActivity.length > 0 ||
      aiLessons.length > 0 ||
      Object.keys(savedLessons).length > 0,
  );

  return {
    snapshot: {
      profile: mappedProfile?.profile,
      profileUpdatedAt: mappedProfile?.updatedAt,
      vocabulary,
      drafts,
      attempts,
      reviewLogs,
      dailyActivity,
      aiLessons,
      savedLessons,
    },
    hasAnyCloudRecords,
  };
}

export async function pushSyncOps(
  client: SupabaseClient,
  userId: string,
  ops: SyncQueueOp[],
): Promise<{ remainingOps: SyncQueueOp[]; error?: unknown }> {
  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    try {
      switch (op.type) {
        case 'upsert_profile': {
          const { error } = await client
            .from('learner_profiles')
            .upsert(mapProfileLocalToRow(userId, op.profile, op.updatedAt), {
              onConflict: 'id',
            });
          if (error) throw error;
          break;
        }
        case 'upsert_vocabulary': {
          const { error } = await client
            .from('vocabulary')
            .upsert(mapVocabLocalToRow(userId, op.item, op.updatedAt), {
              onConflict: 'user_id,id',
            });
          if (error) throw error;
          break;
        }
        case 'delete_vocabulary': {
          const { error } = await client
            .from('vocabulary')
            .update({ deleted_at: op.deletedAt, updated_at: op.updatedAt })
            .eq('user_id', userId)
            .eq('id', op.id);
          if (error) throw error;
          break;
        }
        case 'upsert_draft': {
          const { error } = await client
            .from('dictation_drafts')
            .upsert(mapDraftLocalToRow(userId, op.draft), {
              onConflict: 'user_id,lesson_id',
            });
          if (error) throw error;
          break;
        }
        case 'delete_draft': {
          const { error } = await client
            .from('dictation_drafts')
            .upsert(
              {
                user_id: userId,
                lesson_id: op.lessonId,
                mode: 'sentence',
                sentence_inputs: {},
                word_slot_inputs: {},
                sentence_input_style: 'slots',
                full_input: '',
                updated_at: op.updatedAt,
                deleted_at: op.deletedAt,
              },
              { onConflict: 'user_id,lesson_id' },
            );
          if (error) throw error;
          break;
        }
        case 'upsert_attempt': {
          const { error } = await client
            .from('dictation_attempts')
            .upsert(mapAttemptLocalToRow(userId, op.attempt), {
              onConflict: 'user_id,id',
            });
          if (error) throw error;
          break;
        }
        case 'upsert_review_log': {
          const { error } = await client
            .from('vocabulary_review_logs')
            .upsert(mapReviewLogLocalToRow(userId, op.log), {
              onConflict: 'user_id,id',
            });
          if (error) throw error;
          break;
        }
        case 'upsert_daily_activity': {
          const { error } = await client
            .from('daily_activity')
            .upsert(mapDailyActivityLocalToRow(userId, op.point, op.updatedAt), {
              onConflict: 'user_id,activity_date',
            });
          if (error) throw error;
          break;
        }
        case 'upsert_ai_lesson': {
          const { error } = await client
            .from('lessons')
            .upsert(mapLessonLocalToRow(userId, op.lesson, op.updatedAt), {
              onConflict: 'owner_id,id',
            });
          if (error) throw error;
          break;
        }
        case 'delete_ai_lesson': {
          const { error } = await client
            .from('lessons')
            .update({ deleted_at: op.deletedAt, updated_at: op.updatedAt })
            .eq('owner_id', userId)
            .eq('id', op.id);
          if (error) throw error;
          break;
        }
        case 'upsert_saved_lesson': {
          const { error } = await client
            .from('saved_lessons')
            .upsert(mapSavedLessonLocalToRow(userId, op.saved), {
              onConflict: 'user_id,lesson_id',
            });
          if (error) throw error;
          break;
        }
        case 'delete_saved_lesson': {
          const { error } = await client
            .from('saved_lessons')
            .upsert(
              {
                user_id: userId,
                lesson_id: op.lessonId,
                lesson_snapshot: null,
                saved_at: op.updatedAt,
                updated_at: op.updatedAt,
                deleted_at: op.deletedAt,
              },
              { onConflict: 'user_id,lesson_id' },
            );
          if (error) throw error;
          break;
        }
      }
    } catch (err) {
      return { remainingOps: ops.slice(i), error: err };
    }
  }
  return { remainingOps: [] };
}

export async function pushMergedSnapshotToCloud(
  client: SupabaseClient,
  userId: string,
  merged: SyncDatasetSnapshot,
  cloud: Partial<SyncDatasetSnapshot>,
): Promise<void> {
  const ops: PromiseLike<{ error: unknown }>[] = [];

  // 1. Profile: always ensure cloud profile exists or gets updated if local was newer/missing
  const profileUpdatedAt = merged.profileUpdatedAt || new Date().toISOString();
  if (
    !cloud.profile ||
    JSON.stringify(cloud.profile) !== JSON.stringify(merged.profile)
  ) {
    ops.push(
      client
        .from('learner_profiles')
        .upsert(mapProfileLocalToRow(userId, merged.profile, profileUpdatedAt), {
          onConflict: 'id',
        }),
    );
  }

  // 2. Vocabulary: upsert any merged record not identical in cloud
  const cloudVocabMap = new Map((cloud.vocabulary ?? []).map((v) => [v.id, v]));
  const vocabToPush = merged.vocabulary.filter((item) => {
    const c = cloudVocabMap.get(item.id);
    if (!c) return true;
    return (
      c.deletedAt !== item.deletedAt ||
      c.repetitions !== item.repetitions ||
      c.notes !== item.notes ||
      c.nextReviewAt !== item.nextReviewAt ||
      c.status !== item.status
    );
  });
  if (vocabToPush.length > 0) {
    ops.push(
      client
        .from('vocabulary')
        .upsert(
          vocabToPush.map((v) => mapVocabLocalToRow(userId, v)),
          { onConflict: 'user_id,id' },
        ),
    );
  }

  // 3. Drafts
  const cloudDrafts = cloud.drafts ?? {};
  const draftsToPush = Object.values(merged.drafts).filter((d) => {
    const c = cloudDrafts[d.lessonId];
    return !c || c.updatedAt !== d.updatedAt || c.deletedAt !== d.deletedAt;
  });
  if (draftsToPush.length > 0) {
    ops.push(
      client
        .from('dictation_drafts')
        .upsert(
          draftsToPush.map((d) => mapDraftLocalToRow(userId, d)),
          { onConflict: 'user_id,lesson_id' },
        ),
    );
  }

  // 4. Attempts
  const cloudAttemptIds = new Set((cloud.attempts ?? []).map((a) => a.id));
  const attemptsToPush = merged.attempts.filter((a) => !cloudAttemptIds.has(a.id));
  if (attemptsToPush.length > 0) {
    ops.push(
      client
        .from('dictation_attempts')
        .upsert(
          attemptsToPush.map((a) => mapAttemptLocalToRow(userId, a)),
          { onConflict: 'user_id,id' },
        ),
    );
  }

  // 5. Review logs
  const cloudReviewIds = new Set((cloud.reviewLogs ?? []).map((r) => r.id));
  const reviewsToPush = merged.reviewLogs.filter((r) => !cloudReviewIds.has(r.id));
  if (reviewsToPush.length > 0) {
    ops.push(
      client
        .from('vocabulary_review_logs')
        .upsert(
          reviewsToPush.map((r) => mapReviewLogLocalToRow(userId, r)),
          { onConflict: 'user_id,id' },
        ),
    );
  }

  // 6. Daily activity
  const cloudActivityMap = new Map((cloud.dailyActivity ?? []).map((p) => [p.date, p]));
  const activityToPush = merged.dailyActivity.filter((p) => {
    const c = cloudActivityMap.get(p.date);
    return (
      !c ||
      c.minutes !== p.minutes ||
      c.sentencesCompleted !== p.sentencesCompleted ||
      c.dictationAccuracy !== p.dictationAccuracy
    );
  });
  if (activityToPush.length > 0) {
    const nowIso = new Date().toISOString();
    ops.push(
      client
        .from('daily_activity')
        .upsert(
          activityToPush.map((p) => mapDailyActivityLocalToRow(userId, p, nowIso)),
          { onConflict: 'user_id,activity_date' },
        ),
    );
  }

  // 7. AI Lessons
  const cloudLessonMap = new Map((cloud.aiLessons ?? []).map((l) => [l.id, l]));
  const lessonsToPush = merged.aiLessons.filter((l) => {
    const c = cloudLessonMap.get(l.id);
    return !c || c.deletedAt !== l.deletedAt || c.updatedAt !== l.updatedAt;
  });
  if (lessonsToPush.length > 0) {
    ops.push(
      client
        .from('lessons')
        .upsert(
          lessonsToPush.map((l) => mapLessonLocalToRow(userId, l)),
          { onConflict: 'owner_id,id' },
        ),
    );
  }

  // 8. Saved Lessons
  const cloudSaved = cloud.savedLessons ?? {};
  const savedToPush = Object.values(merged.savedLessons).filter((s) => {
    const c = cloudSaved[s.lessonId];
    return !c || c.updatedAt !== s.updatedAt || c.deletedAt !== s.deletedAt;
  });
  if (savedToPush.length > 0) {
    ops.push(
      client
        .from('saved_lessons')
        .upsert(
          savedToPush.map((s) => mapSavedLessonLocalToRow(userId, s)),
          { onConflict: 'user_id,lesson_id' },
        ),
    );
  }

  if (ops.length === 0) return;

  const results = await Promise.all(ops);
  const firstErr = results.find((r) => Boolean(r.error))?.error;
  if (firstErr) {
    throw firstErr;
  }
}
