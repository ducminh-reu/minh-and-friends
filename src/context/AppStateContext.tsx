import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { CURATED_LESSONS } from '../data/curatedLessons';
import {
  SEED_ATTEMPTS,
  SEED_DAILY_ACTIVITY,
  SEED_PROFILE,
  SEED_VOCABULARY,
} from '../data/seedUserData';
import type {
  AdaptiveAssessment,
  DailyActivityPoint,
  DictationAnalysisReport,
  DictationAttempt,
  DictationMode,
  LearnerProfile,
  Lesson,
  LessonVocabulary,
  ReviewFormat,
  VocabularyRecord,
  VocabularyReviewLog,
} from '../types/domain';
import { usePwaConnectivity } from '../hooks/usePwaConnectivity';
import {
  clearAllOfflineData,
  downloadLessonForOffline,
  getAllOfflineLessons,
  removeOfflineLesson,
  type OfflineLessonRecord,
} from '../services/offlineLessonStore';
import { getSupabaseClient } from '../services/supabaseClient';
import {
  classifySyncError,
  fetchCloudSnapshot,
  pushMergedSnapshotToCloud,
  pushSyncOps,
  requestPasswordResetEmail,
  signInWithEmail,
  signInWithGoogle,
  signOutFromSupabase,
  signUpWithEmail,
  updateAuthenticatedPassword,
  type ClassifiedSyncError,
} from '../services/cloudSyncService';
import { evaluateAdaptiveProgress, recommendNextLesson } from '../utils/adaptiveEngine';
import {
  enqueueSyncOp,
  filterActiveAiLessons,
  filterActiveDrafts,
  filterActiveSavedLessons,
  filterActiveVocabulary,
  mergeCloudAndLocalState,
  normalizeVocabWordKey,
  type CloudSyncStatus,
  type SyncableAiLesson,
  type SyncableDraft,
  type SyncableSavedLesson,
  type SyncableVocabularyRecord,
  type SyncQueueOp,
} from '../utils/cloudSyncEngine';
import { applyReviewOutcome } from '../utils/spacedRepetition';

export interface ServerCapabilities {
  geminiConfigured: boolean;
  ttsAvailable: boolean;
  ttsProvider: string;
  supabaseConfigured: boolean;
  mode: 'hybrid' | 'demo';
  loaded: boolean;
}

export type SentenceInputStyle = 'slots' | 'free';

export interface DictationDraft {
  lessonId: string;
  mode: DictationMode;
  sentenceInputs: Record<string, string>;
  wordSlotInputs?: Record<string, string[]>;
  sentenceInputStyle?: SentenceInputStyle;
  fullInput: string;
  updatedAt: string;
}

interface SyncTombstones {
  vocabulary: Record<string, SyncableVocabularyRecord>;
  drafts: Record<string, SyncableDraft>;
  aiLessons: Record<string, SyncableAiLesson>;
  savedLessons: Record<string, SyncableSavedLesson>;
}

const EMPTY_TOMBSTONES: SyncTombstones = {
  vocabulary: {},
  drafts: {},
  aiLessons: {},
  savedLessons: {},
};

const SEED_ATTEMPT_IDS = new Set(SEED_ATTEMPTS.map((a) => a.id));
const SEED_VOCAB_IDS = new Set(SEED_VOCABULARY.map((v) => v.id));
const SEED_VOCAB_BASELINE = new Map(
  SEED_VOCABULARY.map((v) => [
    v.id,
    {
      notes: v.notes,
      repetitions: v.repetitions,
      correctCount: v.correctCount,
      incorrectCount: v.incorrectCount,
    },
  ]),
);

interface AppStateContextValue {
  profile: LearnerProfile;
  attempts: DictationAttempt[];
  vocabulary: VocabularyRecord[];
  reviewLogs: VocabularyReviewLog[];
  aiLessons: Lesson[];
  serverNewsLessons: Lesson[];
  refreshServerNewsLessons: () => Promise<void>;
  allLessons: Lesson[];
  dailyActivity: DailyActivityPoint[];
  savedLessons: Record<string, SyncableSavedLesson>;
  savedLessonIds: Set<string>;
  isLessonSaved: (lessonId: string) => boolean;
  toggleSaveLesson: (lesson: Lesson) => boolean;
  capabilities: ServerCapabilities;
  adaptiveAssessment: AdaptiveAssessment;
  recommendedLesson: Lesson | null;
  updateProfile: (patch: Partial<LearnerProfile>) => void;
  saveDraft: (draft: DictationDraft) => void;
  getDraft: (lessonId: string) => DictationDraft | null;
  clearDraft: (lessonId: string) => void;
  recordAttempt: (
    lesson: Lesson,
    mode: DictationMode,
    report: DictationAnalysisReport,
    durationSec: number,
    sentenceInputs: Record<string, string>,
    fullInput?: string,
  ) => DictationAttempt;
  saveLessonVocabulary: (lesson: Lesson, item: LessonVocabulary) => boolean;
  addCustomVocabulary: (
    entry: Omit<
      VocabularyRecord,
      | 'id'
      | 'createdAt'
      | 'lastReviewedAt'
      | 'nextReviewAt'
      | 'intervalDays'
      | 'easeFactor'
      | 'repetitions'
      | 'correctCount'
      | 'incorrectCount'
      | 'lapses'
      | 'status'
    >,
  ) => void;
  updateVocabulary: (id: string, patch: Partial<VocabularyRecord>) => void;
  deleteVocabulary: (id: string) => void;
  submitReviewOutcome: (
    vocabularyId: string,
    format: ReviewFormat,
    quality: 0 | 3 | 4 | 5,
  ) => void;
  addAiLesson: (lesson: Lesson) => void;
  deleteAiLesson: (lessonId: string) => void;
  deleteLesson: (lessonId: string) => void;
  resetDemoData: () => void;
  exportBackupJson: () => string;
  isOnline: boolean;
  swRegistered: boolean;
  swUpdateAvailable: boolean;
  applySwUpdate: () => Promise<void>;
  offlineLessons: OfflineLessonRecord[];
  offlineLessonIds: Set<string>;
  downloadLessonOffline: (
    lesson: Lesson,
    options?: {
      includeAudio?: boolean;
      topicEn?: string;
      signal?: AbortSignal;
      onProgress?: (completed: number, total: number) => void;
    },
  ) => Promise<OfflineLessonRecord>;
  removeOfflineLessonById: (lessonId: string) => Promise<void>;
  clearOfflineDownloads: () => Promise<void>;
  refreshOfflineLessons: () => Promise<void>;
  // Auth & Cloud Sync
  authUser: User | null;
  authSession: Session | null;
  authLoading: boolean;
  passwordRecoveryPending: boolean;
  syncStatus: CloudSyncStatus;
  syncError: ClassifiedSyncError | null;
  lastSyncedAt: string | null;
  pendingSyncCount: number;
  signInWithCloud: (email: string, password: string) => Promise<void>;
  signInWithGoogleCloud: () => Promise<void>;
  signUpWithCloud: (
    email: string,
    password: string,
    displayName?: string,
  ) => Promise<{ needsEmailConfirmation: boolean }>;
  signOutCloud: () => Promise<void>;
  requestCloudPasswordReset: (email: string) => Promise<void>;
  completeCloudPasswordReset: (newPassword: string) => Promise<void>;
  dismissPasswordRecovery: () => void;
  syncNow: () => Promise<boolean>;
}

const STORAGE_KEYS = {
  profile: 'rd_profile_v1',
  profileUpdatedAt: 'rd_profile_updated_v1',
  attempts: 'rd_attempts_v1',
  vocabulary: 'rd_vocabulary_v1',
  reviews: 'rd_reviews_v1',
  aiLessons: 'rd_ai_lessons_v1',
  savedLessons: 'rd_saved_lessons_v1',
  activity: 'rd_activity_v1',
  drafts: 'rd_drafts_v1',
  syncQueue: 'rd_sync_queue_v1',
  tombstones: 'rd_tombstones_v1',
  lastSyncedAt: 'rd_last_synced_at_v1',
  cloudOwnerId: 'rd_cloud_owner_id_v1',
  deletedLessons: 'rd_deleted_lessons_v1',
};

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    // Ignore quota errors cleanly
  }
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

export const AppStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<LearnerProfile>(() =>
    readStorage(STORAGE_KEYS.profile, SEED_PROFILE),
  );
  const [profileUpdatedAt, setProfileUpdatedAt] = useState<string>(() =>
    readStorage(STORAGE_KEYS.profileUpdatedAt, ''),
  );
  const [attempts, setAttempts] = useState<DictationAttempt[]>(() =>
    readStorage(STORAGE_KEYS.attempts, SEED_ATTEMPTS),
  );
  const [vocabulary, setVocabulary] = useState<VocabularyRecord[]>(() =>
    readStorage(STORAGE_KEYS.vocabulary, SEED_VOCABULARY),
  );
  const [reviewLogs, setReviewLogs] = useState<VocabularyReviewLog[]>(() =>
    readStorage(STORAGE_KEYS.reviews, []),
  );
  const [aiLessons, setAiLessons] = useState<Lesson[]>(() =>
    readStorage(STORAGE_KEYS.aiLessons, []),
  );
  const [savedLessons, setSavedLessons] = useState<Record<string, SyncableSavedLesson>>(() =>
    readStorage(STORAGE_KEYS.savedLessons, {}),
  );
  const [dailyActivity, setDailyActivity] = useState<DailyActivityPoint[]>(() =>
    readStorage(STORAGE_KEYS.activity, SEED_DAILY_ACTIVITY),
  );
  const [drafts, setDrafts] = useState<Record<string, DictationDraft>>(() =>
    readStorage(STORAGE_KEYS.drafts, {}),
  );
  const [syncQueue, setSyncQueue] = useState<SyncQueueOp[]>(() =>
    readStorage(STORAGE_KEYS.syncQueue, []),
  );
  const [tombstones, setTombstones] = useState<SyncTombstones>(() =>
    readStorage(STORAGE_KEYS.tombstones, EMPTY_TOMBSTONES),
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() =>
    readStorage(STORAGE_KEYS.lastSyncedAt, null),
  );

  const [capabilities, setCapabilities] = useState<ServerCapabilities>({
    geminiConfigured: false,
    ttsAvailable: false,
    ttsProvider: 'gemini-3.8-flash-lite-tts',
    supabaseConfigured: false,
    mode: 'demo',
    loaded: false,
  });

  const { isOnline, swRegistered, swUpdateAvailable, applySwUpdate } = usePwaConnectivity();
  const [offlineLessons, setOfflineLessons] = useState<OfflineLessonRecord[]>([]);
  const [serverNewsLessons, setServerNewsLessons] = useState<Lesson[]>([]);
  const [deletedLessonIds, setDeletedLessonIds] = useState<string[]>(() =>
    readStorage(STORAGE_KEYS.deletedLessons, []),
  );
  const deletedLessonIdsSet = useMemo(() => new Set(deletedLessonIds), [deletedLessonIds]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.deletedLessons, deletedLessonIds);
  }, [deletedLessonIds]);

  // Auth & Cloud Sync State
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authSession, setAuthSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [passwordRecoveryPending, setPasswordRecoveryPending] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>('local_only');
  const [syncError, setSyncError] = useState<ClassifiedSyncError | null>(null);

  // Refs for synchronous access during async sync & debounced pushes
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const profileUpdatedAtRef = useRef(profileUpdatedAt);
  profileUpdatedAtRef.current = profileUpdatedAt;
  const attemptsRef = useRef(attempts);
  attemptsRef.current = attempts;
  const vocabularyRef = useRef(vocabulary);
  vocabularyRef.current = vocabulary;
  const reviewLogsRef = useRef(reviewLogs);
  reviewLogsRef.current = reviewLogs;
  const aiLessonsRef = useRef(aiLessons);
  aiLessonsRef.current = aiLessons;
  const savedLessonsRef = useRef(savedLessons);
  savedLessonsRef.current = savedLessons;
  const dailyActivityRef = useRef(dailyActivity);
  dailyActivityRef.current = dailyActivity;
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const syncQueueRef = useRef(syncQueue);
  syncQueueRef.current = syncQueue;
  const tombstonesRef = useRef(tombstones);
  tombstonesRef.current = tombstones;
  const authUserRef = useRef(authUser);
  authUserRef.current = authUser;
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;

  const syncInFlightRef = useRef<boolean>(false);
  const syncPendingRerunRef = useRef<boolean>(false);
  const debounceSyncTimerRef = useRef<number | null>(null);

  const refreshOfflineLessons = async () => {
    const records = await getAllOfflineLessons();
    setOfflineLessons(records);
  };

  useEffect(() => {
    void refreshOfflineLessons();
    return () => {
      if (debounceSyncTimerRef.current !== null) {
        window.clearTimeout(debounceSyncTimerRef.current);
      }
    };
  }, []);

  const refreshServerNewsLessons = useCallback(async () => {
    if (!isOnlineRef.current) return;
    try {
      const resp = await fetch('/api/news/lessons');
      if (!resp.ok) return;
      const data = (await resp.json()) as { lessons?: Lesson[] };
      if (Array.isArray(data.lessons)) {
        setServerNewsLessons(data.lessons);
      }
    } catch {
      // Non-fatal if server news endpoint is temporarily unreachable
    }
  }, []);

  useEffect(() => {
    if (!isOnline) {
      setCapabilities((prev) => ({ ...prev, loaded: true }));
      return;
    }

    void refreshServerNewsLessons();

    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setCapabilities({
            geminiConfigured: Boolean(data.geminiConfigured),
            ttsAvailable: Boolean(data.ttsAvailable),
            ttsProvider: String(data.ttsProvider ?? 'gemini-3.8-flash-lite-tts'),
            supabaseConfigured: Boolean(data.supabaseConfigured),
            mode: data.mode === 'hybrid' ? 'hybrid' : 'demo',
            loaded: true,
          });
        } else {
          setCapabilities((prev) => ({ ...prev, loaded: true }));
        }
      })
      .catch(() => {
        setCapabilities((prev) => ({ ...prev, loaded: true }));
      });
  }, [isOnline, refreshServerNewsLessons]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.profile, profile);
  }, [profile]);
  useEffect(() => {
    writeStorage(STORAGE_KEYS.profileUpdatedAt, profileUpdatedAt);
  }, [profileUpdatedAt]);
  useEffect(() => {
    writeStorage(STORAGE_KEYS.attempts, attempts);
  }, [attempts]);
  useEffect(() => {
    writeStorage(STORAGE_KEYS.vocabulary, vocabulary);
  }, [vocabulary]);
  useEffect(() => {
    writeStorage(STORAGE_KEYS.reviews, reviewLogs);
  }, [reviewLogs]);
  useEffect(() => {
    writeStorage(STORAGE_KEYS.aiLessons, aiLessons);
  }, [aiLessons]);
  useEffect(() => {
    writeStorage(STORAGE_KEYS.savedLessons, savedLessons);
  }, [savedLessons]);
  useEffect(() => {
    writeStorage(STORAGE_KEYS.activity, dailyActivity);
  }, [dailyActivity]);
  useEffect(() => {
    writeStorage(STORAGE_KEYS.drafts, drafts);
  }, [drafts]);
  useEffect(() => {
    writeStorage(STORAGE_KEYS.syncQueue, syncQueue);
  }, [syncQueue]);
  useEffect(() => {
    writeStorage(STORAGE_KEYS.tombstones, tombstones);
  }, [tombstones]);
  useEffect(() => {
    writeStorage(STORAGE_KEYS.lastSyncedAt, lastSyncedAt);
  }, [lastSyncedAt]);

  const resetLocalCacheForAccountSwitch = useCallback(() => {
    profileRef.current = SEED_PROFILE;
    profileUpdatedAtRef.current = '';
    attemptsRef.current = [];
    vocabularyRef.current = [];
    reviewLogsRef.current = [];
    aiLessonsRef.current = [];
    savedLessonsRef.current = {};
    dailyActivityRef.current = [];
    draftsRef.current = {};
    syncQueueRef.current = [];
    tombstonesRef.current = EMPTY_TOMBSTONES;

    setProfile(SEED_PROFILE);
    setProfileUpdatedAt('');
    setAttempts([]);
    setVocabulary([]);
    setReviewLogs([]);
    setAiLessons([]);
    setSavedLessons({});
    setDailyActivity([]);
    setDrafts({});
    setSyncQueue([]);
    setTombstones(EMPTY_TOMBSTONES);
    setLastSyncedAt(null);
  }, []);

  const syncNow = useCallback(async (): Promise<boolean> => {
    const user = authUserRef.current;
    if (!user) {
      setSyncStatus('local_only');
      setSyncError(null);
      return false;
    }
    if (!isOnlineRef.current) {
      setSyncStatus('local_only');
      setSyncError(null);
      return false;
    }

    const client = await getSupabaseClient();
    if (!client) {
      setSyncStatus('local_only');
      return false;
    }

    if (syncInFlightRef.current) {
      syncPendingRerunRef.current = true;
      return false;
    }

    syncInFlightRef.current = true;
    setSyncStatus('syncing');
    setSyncError(null);

    try {
      // 1. Flush any pending offline operations first
      if (syncQueueRef.current.length > 0) {
        const flushRes = await pushSyncOps(client, user.id, syncQueueRef.current);
        syncQueueRef.current = flushRes.remainingOps;
        writeStorage(STORAGE_KEYS.syncQueue, flushRes.remainingOps);
        setSyncQueue(flushRes.remainingOps);
        if (flushRes.error) {
          throw flushRes.error;
        }
      }

      // 2. Fetch authoritative cloud snapshot for this authenticated user (enforced by RLS)
      const cloudRes = await fetchCloudSnapshot(client, user.id);

      // 3. Build complete local snapshot including tombstones so deletions sync accurately
      const localVocabWithTombstones: SyncableVocabularyRecord[] = [
        ...vocabularyRef.current,
        ...Object.values(tombstonesRef.current.vocabulary),
      ];
      const localDraftsWithTombstones: Record<string, SyncableDraft> = {
        ...tombstonesRef.current.drafts,
        ...draftsRef.current,
      };
      const localAiLessonsWithTombstones: SyncableAiLesson[] = [
        ...aiLessonsRef.current,
        ...Object.values(tombstonesRef.current.aiLessons),
      ];
      const localSavedWithTombstones: Record<string, SyncableSavedLesson> = {
        ...tombstonesRef.current.savedLessons,
        ...savedLessonsRef.current,
      };

      const merged = mergeCloudAndLocalState(
        {
          profile: profileRef.current,
          profileUpdatedAt: profileUpdatedAtRef.current || undefined,
          vocabulary: localVocabWithTombstones,
          drafts: localDraftsWithTombstones,
          attempts: attemptsRef.current,
          reviewLogs: reviewLogsRef.current,
          dailyActivity: dailyActivityRef.current,
          aiLessons: localAiLessonsWithTombstones,
          savedLessons: localSavedWithTombstones,
        },
        {
          ...cloudRes.snapshot,
          hasAnyCloudRecords: cloudRes.hasAnyCloudRecords,
        },
        SEED_ATTEMPT_IDS,
        SEED_VOCAB_IDS,
        SEED_VOCAB_BASELINE,
      );

      // 4. Push any migrated local-only records or resolved local winners back to Supabase
      await pushMergedSnapshotToCloud(client, user.id, merged, cloudRes.snapshot);

      // 5. Commit active merged data locally without losing un-synced concurrent edits
      const activeVocab = filterActiveVocabulary(merged.vocabulary);
      const activeDrafts = filterActiveDrafts(merged.drafts);
      const activeAiLessons = filterActiveAiLessons(merged.aiLessons);
      const activeSaved = filterActiveSavedLessons(merged.savedLessons);

      const nextTombstones: SyncTombstones = {
        vocabulary: Object.fromEntries(
          merged.vocabulary.filter((v) => v.deletedAt).map((v) => [v.id, v]),
        ),
        drafts: Object.fromEntries(
          Object.entries(merged.drafts).filter(([, d]) => Boolean(d.deletedAt)),
        ),
        aiLessons: Object.fromEntries(
          merged.aiLessons.filter((l) => l.deletedAt).map((l) => [l.id, l]),
        ),
        savedLessons: Object.fromEntries(
          Object.entries(merged.savedLessons).filter(([, s]) => Boolean(s.deletedAt)),
        ),
      };

      profileRef.current = merged.profile;
      profileUpdatedAtRef.current = merged.profileUpdatedAt || new Date().toISOString();
      vocabularyRef.current = activeVocab;
      draftsRef.current = activeDrafts;
      attemptsRef.current = merged.attempts;
      reviewLogsRef.current = merged.reviewLogs;
      dailyActivityRef.current = merged.dailyActivity;
      aiLessonsRef.current = activeAiLessons;
      savedLessonsRef.current = activeSaved;
      tombstonesRef.current = nextTombstones;

      setProfile(merged.profile);
      setProfileUpdatedAt(profileUpdatedAtRef.current);
      setVocabulary(activeVocab);
      setDrafts(activeDrafts);
      setAttempts(merged.attempts);
      setReviewLogs(merged.reviewLogs);
      setDailyActivity(merged.dailyActivity);
      setAiLessons(activeAiLessons);
      setSavedLessons(activeSaved);
      setTombstones(nextTombstones);

      const nowIso = new Date().toISOString();
      setLastSyncedAt(nowIso);
      setSyncStatus('synced');
      setSyncError(null);
      return true;
    } catch (err) {
      const classified = classifySyncError(err);
      setSyncError(classified);
      if (classified.kind === 'NETWORK_OFFLINE' || !isOnlineRef.current) {
        setSyncStatus('local_only');
      } else {
        setSyncStatus('sync_failed');
      }
      return false;
    } finally {
      syncInFlightRef.current = false;
      if (syncPendingRerunRef.current) {
        syncPendingRerunRef.current = false;
        void syncNow();
      }
    }
  }, []);

  const scheduleCloudSync = useCallback(
    (delayMs = 800) => {
      if (!authUserRef.current || !isOnlineRef.current) {
        return;
      }
      if (debounceSyncTimerRef.current !== null) {
        window.clearTimeout(debounceSyncTimerRef.current);
      }
      debounceSyncTimerRef.current = window.setTimeout(() => {
        debounceSyncTimerRef.current = null;
        void syncNow();
      }, delayMs);
    },
    [syncNow],
  );

  const enqueueCloudOp = useCallback(
    (op: SyncQueueOp, delayMs = 800) => {
      const next = enqueueSyncOp(syncQueueRef.current, op);
      syncQueueRef.current = next;
      writeStorage(STORAGE_KEYS.syncQueue, next);
      setSyncQueue(next);
      if (authUserRef.current && isOnlineRef.current) {
        scheduleCloudSync(delayMs);
      } else if (!isOnlineRef.current) {
        setSyncStatus('local_only');
      }
    },
    [scheduleCloudSync],
  );

  // Initialize Supabase Auth listener & session persistence
  useEffect(() => {
    let active = true;
    let subscription: { unsubscribe: () => void } | null = null;

    const handleSessionChange = (session: Session | null, event?: string) => {
      if (!active) return;
      console.info('[Supabase Auth] Session change event:', event || 'INITIAL_SESSION', 'User:', session?.user?.id ?? 'null');
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecoveryPending(true);
      }

      const nextUser = session?.user ?? null;
      setAuthSession(session);
      setAuthUser(nextUser);
      authUserRef.current = nextUser;

      if (nextUser) {
        setCapabilities((prev) => ({
          ...prev,
          supabaseConfigured: true,
          mode: 'hybrid',
        }));

        const previousOwner = readStorage<string | null>(STORAGE_KEYS.cloudOwnerId, null);
        if (previousOwner && previousOwner !== nextUser.id) {
          console.info('[Supabase Auth] Account switch detected. Resetting local cache.');
          resetLocalCacheForAccountSwitch();
        }
        writeStorage(STORAGE_KEYS.cloudOwnerId, nextUser.id);

        if (isOnlineRef.current) {
          void syncNow();
        } else {
          setSyncStatus('local_only');
        }
      } else {
        setSyncStatus('local_only');
        setSyncError(null);
      }
    };

    void (async () => {
      const client = await getSupabaseClient();
      if (!active) return;

      if (!client) {
        setAuthLoading(false);
        return;
      }

      setCapabilities((prev) => ({
        ...prev,
        supabaseConfigured: true,
        mode: 'hybrid',
      }));

      try {
        const { data } = await client.auth.getSession();
        if (!active) return;
        handleSessionChange(data.session ?? null);
      } finally {
        if (active) setAuthLoading(false);
      }

      const { data: listenerData } = client.auth.onAuthStateChange((event, session) => {
        handleSessionChange(session ?? null, event);
      });
      subscription = listenerData.subscription;
    })();

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, [resetLocalCacheForAccountSwitch, syncNow]);

  // Automatically flush pending sync queue when connectivity returns
  const wasOnlineRef = useRef(isOnline);
  useEffect(() => {
    const prevOnline = wasOnlineRef.current;
    wasOnlineRef.current = isOnline;
    if (!isOnline) {
      if (authUserRef.current) {
        setSyncStatus('local_only');
      }
      return;
    }
    if (!prevOnline && isOnline && authUserRef.current) {
      void syncNow();
    }
  }, [isOnline, syncNow]);

  const allLessons = useMemo(() => {
    const baseIds = new Set<string>();
    const combined: Lesson[] = [];
    const filteredServerNews = serverNewsLessons.filter((l) => !deletedLessonIdsSet.has(l.id));
    for (const l of [...CURATED_LESSONS, ...filteredServerNews, ...aiLessons]) {
      if (!baseIds.has(l.id) && !deletedLessonIdsSet.has(l.id)) {
        baseIds.add(l.id);
        combined.push(l);
      }
    }
    for (const off of offlineLessons) {
      if (off.lessonSnapshot && !baseIds.has(off.lessonId)) {
        baseIds.add(off.lessonId);
        combined.push(off.lessonSnapshot);
      }
    }
    for (const saved of Object.values(savedLessons)) {
      if (!saved.deletedAt && saved.lessonSnapshot && !baseIds.has(saved.lessonId)) {
        baseIds.add(saved.lessonId);
        combined.push(saved.lessonSnapshot);
      }
    }
    return combined;
  }, [serverNewsLessons, aiLessons, offlineLessons, savedLessons]);

  const savedLessonIds = useMemo(() => {
    const set = new Set<string>();
    for (const rec of Object.values(savedLessons)) {
      if (!rec.deletedAt) set.add(rec.lessonId);
    }
    return set;
  }, [savedLessons]);

  const offlineLessonIds = useMemo(
    () => new Set(offlineLessons.map((o) => o.lessonId)),
    [offlineLessons],
  );

  const adaptiveAssessment = useMemo(
    () =>
      evaluateAdaptiveProgress(
        profile.estimatedLevel,
        profile.verifiedLevel,
        attempts,
        vocabulary,
      ),
    [profile.estimatedLevel, profile.verifiedLevel, attempts, vocabulary],
  );

  const recommendedLesson = useMemo(
    () => recommendNextLesson(allLessons, attempts, adaptiveAssessment),
    [allLessons, attempts, adaptiveAssessment],
  );

  const updateProfile = (patch: Partial<LearnerProfile>) => {
    const nowIso = new Date().toISOString();
    const next = { ...profileRef.current, ...patch };
    profileRef.current = next;
    profileUpdatedAtRef.current = nowIso;
    setProfile(next);
    setProfileUpdatedAt(nowIso);
    enqueueCloudOp({ type: 'upsert_profile', updatedAt: nowIso, profile: next }, 900);
  };

  const saveDraft = (draft: DictationDraft) => {
    const next = { ...draftsRef.current, [draft.lessonId]: draft };
    draftsRef.current = next;
    writeStorage(STORAGE_KEYS.drafts, next);
    setDrafts(next);

    if (tombstonesRef.current.drafts[draft.lessonId]) {
      const nextTombstones = {
        ...tombstonesRef.current,
        drafts: { ...tombstonesRef.current.drafts },
      };
      delete nextTombstones.drafts[draft.lessonId];
      tombstonesRef.current = nextTombstones;
      setTombstones(nextTombstones);
    }

    enqueueCloudOp(
      {
        type: 'upsert_draft',
        updatedAt: draft.updatedAt,
        draft: { ...draft, deletedAt: null },
      },
      1400,
    );
  };

  const getDraft = (lessonId: string): DictationDraft | null => {
    return draftsRef.current[lessonId] ?? null;
  };

  const clearDraft = (lessonId: string) => {
    const nowIso = new Date().toISOString();
    const prevDraft = draftsRef.current[lessonId];
    const next = { ...draftsRef.current };
    delete next[lessonId];
    draftsRef.current = next;
    writeStorage(STORAGE_KEYS.drafts, next);
    setDrafts(next);

    const deletedDraft: SyncableDraft = {
      lessonId,
      mode: prevDraft?.mode ?? 'sentence',
      sentenceInputs: {},
      wordSlotInputs: {},
      sentenceInputStyle: prevDraft?.sentenceInputStyle ?? 'slots',
      fullInput: '',
      updatedAt: nowIso,
      deletedAt: nowIso,
    };
    const nextTombstones = {
      ...tombstonesRef.current,
      drafts: { ...tombstonesRef.current.drafts, [lessonId]: deletedDraft },
    };
    tombstonesRef.current = nextTombstones;
    setTombstones(nextTombstones);

    enqueueCloudOp(
      {
        type: 'delete_draft',
        updatedAt: nowIso,
        lessonId,
        deletedAt: nowIso,
      },
      900,
    );
  };

  const recordAttempt = (
    lesson: Lesson,
    mode: DictationMode,
    report: DictationAnalysisReport,
    durationSec: number,
    sentenceInputs: Record<string, string>,
    fullInput?: string,
  ): DictationAttempt => {
    const nowIso = new Date().toISOString();
    const today = nowIso.slice(0, 10);
    const attempt: DictationAttempt = {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      lessonId: lesson.id,
      lessonTitleVi: lesson.titleVi,
      lessonTitleRu: lesson.titleRu,
      lessonLevel: lesson.level,
      lessonSource: lesson.source,
      mode,
      completedAt: nowIso,
      durationSec: Math.max(30, Math.round(durationSec)),
      listeningAccuracy: report.listeningAccuracy,
      lexicalAccuracy: report.lexicalAccuracy,
      spellingGrammarAccuracy: report.spellingGrammarAccuracy,
      punctuationAccuracy: report.punctuationAccuracy,
      errorCounts: report.errorCountsByCategory,
      sentenceInputs,
      fullInput,
    };

    const nextAttempts = [attempt, ...attemptsRef.current];
    attemptsRef.current = nextAttempts;
    setAttempts(nextAttempts);

    // Update daily activity synchronously
    const mins = Math.max(1, Math.round(durationSec / 60));
    const existingActivity = dailyActivityRef.current.find((p) => p.date === today);
    const updatedPoint: DailyActivityPoint = existingActivity
      ? {
          ...existingActivity,
          minutes: existingActivity.minutes + mins,
          sentencesCompleted: existingActivity.sentencesCompleted + lesson.sentences.length,
          dictationAccuracy: report.listeningAccuracy ?? existingActivity.dictationAccuracy,
        }
      : {
          date: today,
          minutes: mins,
          sentencesCompleted: lesson.sentences.length,
          dictationAccuracy: report.listeningAccuracy,
        };

    const nextDailyActivity = existingActivity
      ? dailyActivityRef.current.map((p) => (p.date === today ? updatedPoint : p))
      : [...dailyActivityRef.current.slice(-29), updatedPoint];
    dailyActivityRef.current = nextDailyActivity;
    setDailyActivity(nextDailyActivity);

    // Re-evaluate adaptive estimation after saving attempt
    const newAssessment = evaluateAdaptiveProgress(
      profileRef.current.estimatedLevel,
      profileRef.current.verifiedLevel,
      nextAttempts,
      vocabularyRef.current,
    );

    const prevProfile = profileRef.current;
    const isNewDay = prevProfile.lastPracticeDate !== today;
    const nextStreak = isNewDay ? prevProfile.streakDays + 1 : Math.max(1, prevProfile.streakDays);
    const nextHistory =
      newAssessment.estimatedLevel !== prevProfile.estimatedLevel ||
      prevProfile.cefrHistory.length === 0
        ? [
            ...prevProfile.cefrHistory,
            {
              date: today,
              estimatedLevel: newAssessment.estimatedLevel,
              compositeScore: newAssessment.compositeScore,
              noteVi: `Cập nhật sau bài «${lesson.titleVi}»`,
            },
          ]
        : prevProfile.cefrHistory;

    const nextProfile: LearnerProfile = {
      ...prevProfile,
      estimatedLevel: newAssessment.estimatedLevel,
      streakDays: nextStreak,
      lastPracticeDate: today,
      cefrHistory: nextHistory,
    };
    profileRef.current = nextProfile;
    profileUpdatedAtRef.current = nowIso;
    setProfile(nextProfile);
    setProfileUpdatedAt(nowIso);

    clearDraft(lesson.id);

    enqueueCloudOp({ type: 'upsert_attempt', updatedAt: nowIso, attempt }, 500);
    enqueueCloudOp({ type: 'upsert_daily_activity', updatedAt: nowIso, point: updatedPoint }, 500);
    enqueueCloudOp({ type: 'upsert_profile', updatedAt: nowIso, profile: nextProfile }, 500);

    return attempt;
  };

  const saveLessonVocabulary = (lesson: Lesson, item: LessonVocabulary): boolean => {
    const key = normalizeVocabWordKey(item.word);
    const exists = vocabularyRef.current.some((v) => normalizeVocabWordKey(v.word) === key);
    if (exists) return false;
    const nowIso = new Date().toISOString();
    const record: VocabularyRecord = {
      id: `voc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      word: item.word,
      stressedWord: item.stressedWord || item.word,
      partOfSpeech: item.partOfSpeech,
      forms: item.forms,
      meaningVi: item.meaningVi,
      definitionRu: item.definitionRu,
      exampleRu: item.exampleRu,
      exampleVi: item.exampleVi,
      sourceLessonId: lesson.id,
      sourceLessonTitle: lesson.titleVi,
      notes: '',
      status: 'new',
      createdAt: nowIso,
      lastReviewedAt: null,
      nextReviewAt: nowIso,
      intervalDays: 0,
      easeFactor: 2.5,
      repetitions: 0,
      correctCount: 0,
      incorrectCount: 0,
      lapses: 0,
    };
    const next = [record, ...vocabularyRef.current];
    vocabularyRef.current = next;
    setVocabulary(next);
    enqueueCloudOp(
      {
        type: 'upsert_vocabulary',
        updatedAt: nowIso,
        item: { ...record, updatedAt: nowIso, deletedAt: null },
      },
      500,
    );
    return true;
  };

  const addCustomVocabulary: AppStateContextValue['addCustomVocabulary'] = (entry) => {
    const key = normalizeVocabWordKey(entry.word);
    if (vocabularyRef.current.some((v) => normalizeVocabWordKey(v.word) === key)) {
      return;
    }
    const nowIso = new Date().toISOString();
    const record: VocabularyRecord = {
      ...entry,
      id: `voc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      status: 'new',
      createdAt: nowIso,
      lastReviewedAt: null,
      nextReviewAt: nowIso,
      intervalDays: 0,
      easeFactor: 2.5,
      repetitions: 0,
      correctCount: 0,
      incorrectCount: 0,
      lapses: 0,
    };
    const next = [record, ...vocabularyRef.current];
    vocabularyRef.current = next;
    setVocabulary(next);
    enqueueCloudOp(
      {
        type: 'upsert_vocabulary',
        updatedAt: nowIso,
        item: { ...record, updatedAt: nowIso, deletedAt: null },
      },
      500,
    );
  };

  const updateVocabulary = (id: string, patch: Partial<VocabularyRecord>) => {
    const nowIso = new Date().toISOString();
    let updatedItem: VocabularyRecord | null = null;
    const next = vocabularyRef.current.map((v) => {
      if (v.id === id) {
        updatedItem = { ...v, ...patch };
        return updatedItem;
      }
      return v;
    });
    vocabularyRef.current = next;
    setVocabulary(next);
    if (updatedItem) {
      enqueueCloudOp(
        {
          type: 'upsert_vocabulary',
          updatedAt: nowIso,
          item: { ...(updatedItem as VocabularyRecord), updatedAt: nowIso, deletedAt: null },
        },
        700,
      );
    }
  };

  const deleteVocabulary = (id: string) => {
    const nowIso = new Date().toISOString();
    const removed = vocabularyRef.current.find((v) => v.id === id);
    const next = vocabularyRef.current.filter((v) => v.id !== id);
    vocabularyRef.current = next;
    setVocabulary(next);

    if (removed) {
      const nextTombstones = {
        ...tombstonesRef.current,
        vocabulary: {
          ...tombstonesRef.current.vocabulary,
          [id]: { ...removed, updatedAt: nowIso, deletedAt: nowIso },
        },
      };
      tombstonesRef.current = nextTombstones;
      setTombstones(nextTombstones);
    }

    enqueueCloudOp(
      {
        type: 'delete_vocabulary',
        updatedAt: nowIso,
        id,
        deletedAt: nowIso,
      },
      500,
    );
  };

  const submitReviewOutcome = (
    vocabularyId: string,
    format: ReviewFormat,
    quality: 0 | 3 | 4 | 5,
  ) => {
    const nowIso = new Date().toISOString();
    let updatedItem: VocabularyRecord | null = null;
    const nextVocab = vocabularyRef.current.map((v) => {
      if (v.id === vocabularyId) {
        updatedItem = applyReviewOutcome(v, quality, nowIso);
        return updatedItem;
      }
      return v;
    });
    vocabularyRef.current = nextVocab;
    setVocabulary(nextVocab);

    const log: VocabularyReviewLog = {
      id: `rev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      vocabularyId,
      format,
      correct: quality >= 3,
      quality,
      reviewedAt: nowIso,
    };
    const nextLogs = [log, ...reviewLogsRef.current.slice(0, 299)];
    reviewLogsRef.current = nextLogs;
    setReviewLogs(nextLogs);

    if (updatedItem) {
      enqueueCloudOp(
        {
          type: 'upsert_vocabulary',
          updatedAt: nowIso,
          item: { ...(updatedItem as VocabularyRecord), updatedAt: nowIso, deletedAt: null },
        },
        500,
      );
    }
    enqueueCloudOp({ type: 'upsert_review_log', updatedAt: nowIso, log }, 500);
  };

  const addAiLesson = (lesson: Lesson) => {
    const nowIso = new Date().toISOString();
    const next = [lesson, ...aiLessonsRef.current];
    aiLessonsRef.current = next;
    setAiLessons(next);

    if (tombstonesRef.current.aiLessons[lesson.id]) {
      const nextTombstones = {
        ...tombstonesRef.current,
        aiLessons: { ...tombstonesRef.current.aiLessons },
      };
      delete nextTombstones.aiLessons[lesson.id];
      tombstonesRef.current = nextTombstones;
      setTombstones(nextTombstones);
    }

    enqueueCloudOp(
      {
        type: 'upsert_ai_lesson',
        updatedAt: nowIso,
        lesson: { ...lesson, updatedAt: nowIso, deletedAt: null },
      },
      500,
    );
  };

  const deleteAiLesson = (lessonId: string) => {
    const nowIso = new Date().toISOString();
    const removed = aiLessonsRef.current.find((l) => l.id === lessonId);
    const next = aiLessonsRef.current.filter((l) => l.id !== lessonId);
    aiLessonsRef.current = next;
    setAiLessons(next);

    if (removed) {
      const nextTombstones = {
        ...tombstonesRef.current,
        aiLessons: {
          ...tombstonesRef.current.aiLessons,
          [lessonId]: { ...removed, updatedAt: nowIso, deletedAt: nowIso },
        },
      };
      tombstonesRef.current = nextTombstones;
      setTombstones(nextTombstones);
    }

    enqueueCloudOp(
      {
        type: 'delete_ai_lesson',
        updatedAt: nowIso,
        id: lessonId,
        deletedAt: nowIso,
      },
      500,
    );
  };

  const deleteLesson = (lessonId: string) => {
    if (!deletedLessonIdsSet.has(lessonId)) {
      const nextDeleted = [...deletedLessonIds, lessonId];
      setDeletedLessonIds(nextDeleted);
    }
    deleteAiLesson(lessonId);
    setServerNewsLessons((prev) => prev.filter((l) => l.id !== lessonId));
  };

  const isLessonSaved = (lessonId: string) => savedLessonIds.has(lessonId);

  const toggleSaveLesson = (lesson: Lesson): boolean => {
    const nowIso = new Date().toISOString();
    const existing = savedLessonsRef.current[lesson.id];
    const currentlySaved = Boolean(existing && !existing.deletedAt);

    if (currentlySaved) {
      const nextSaved = { ...savedLessonsRef.current };
      delete nextSaved[lesson.id];
      savedLessonsRef.current = nextSaved;
      setSavedLessons(nextSaved);

      const deletedSaved: SyncableSavedLesson = {
        lessonId: lesson.id,
        lessonSnapshot: null,
        savedAt: existing?.savedAt ?? nowIso,
        updatedAt: nowIso,
        deletedAt: nowIso,
      };
      const nextTombstones = {
        ...tombstonesRef.current,
        savedLessons: { ...tombstonesRef.current.savedLessons, [lesson.id]: deletedSaved },
      };
      tombstonesRef.current = nextTombstones;
      setTombstones(nextTombstones);

      enqueueCloudOp(
        {
          type: 'delete_saved_lesson',
          updatedAt: nowIso,
          lessonId: lesson.id,
          deletedAt: nowIso,
        },
        500,
      );
      return false;
    }

    const savedRec: SyncableSavedLesson = {
      lessonId: lesson.id,
      lessonSnapshot: lesson.source === 'ai_generated' ? lesson : null,
      savedAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    };
    const nextSaved = { ...savedLessonsRef.current, [lesson.id]: savedRec };
    savedLessonsRef.current = nextSaved;
    setSavedLessons(nextSaved);

    if (tombstonesRef.current.savedLessons[lesson.id]) {
      const nextTombstones = {
        ...tombstonesRef.current,
        savedLessons: { ...tombstonesRef.current.savedLessons },
      };
      delete nextTombstones.savedLessons[lesson.id];
      tombstonesRef.current = nextTombstones;
      setTombstones(nextTombstones);
    }

    enqueueCloudOp(
      {
        type: 'upsert_saved_lesson',
        updatedAt: nowIso,
        saved: savedRec,
      },
      500,
    );
    return true;
  };

  const resetDemoData = () => {
    const nowIso = new Date().toISOString();
    profileRef.current = SEED_PROFILE;
    profileUpdatedAtRef.current = nowIso;
    attemptsRef.current = SEED_ATTEMPTS;
    vocabularyRef.current = SEED_VOCABULARY;
    reviewLogsRef.current = [];
    aiLessonsRef.current = [];
    savedLessonsRef.current = {};
    dailyActivityRef.current = SEED_DAILY_ACTIVITY;
    draftsRef.current = {};
    syncQueueRef.current = [];
    tombstonesRef.current = EMPTY_TOMBSTONES;

    setProfile(SEED_PROFILE);
    setProfileUpdatedAt(nowIso);
    setAttempts(SEED_ATTEMPTS);
    setVocabulary(SEED_VOCABULARY);
    setReviewLogs([]);
    setAiLessons([]);
    setSavedLessons({});
    setDailyActivity(SEED_DAILY_ACTIVITY);
    setDrafts({});
    setSyncQueue([]);
    setTombstones(EMPTY_TOMBSTONES);
  };

  const exportBackupJson = () => {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        profile,
        attempts,
        vocabulary,
        reviewLogs,
        aiLessons,
        savedLessons,
        dailyActivity,
      },
      null,
      2,
    );
  };

  const downloadLessonOffline: AppStateContextValue['downloadLessonOffline'] = async (
    lesson,
    options,
  ) => {
    const rec = await downloadLessonForOffline(lesson, {
      includeAudio:
        options?.includeAudio ?? (capabilities.ttsAvailable && isOnline),
      topicEn: options?.topicEn,
      signal: options?.signal,
      onProgress: options?.onProgress,
    });
    await refreshOfflineLessons();
    return rec;
  };

  const removeOfflineLessonById = async (lessonId: string) => {
    await removeOfflineLesson(lessonId);
    await refreshOfflineLessons();
  };

  const clearOfflineDownloads = async () => {
    await clearAllOfflineData();
    await refreshOfflineLessons();
  };

  // Auth Actions
  const signInWithCloud = async (email: string, password: string) => {
    const client = await getSupabaseClient();
    if (!client) {
      throw new Error('Chưa cấu hình kết nối Supabase trên máy chủ.');
    }
    const { user, session } = await signInWithEmail(client, email, password);
    setAuthUser(user);
    setAuthSession(session);
    authUserRef.current = user;
  };

  const signUpWithCloud = async (
    email: string,
    password: string,
    displayName?: string,
  ): Promise<{ needsEmailConfirmation: boolean }> => {
    const client = await getSupabaseClient();
    if (!client) {
      throw new Error('Chưa cấu hình kết nối Supabase trên máy chủ.');
    }
    const res = await signUpWithEmail(client, email, password, displayName);
    if (res.session && res.user) {
      setAuthUser(res.user);
      setAuthSession(res.session);
      authUserRef.current = res.user;
    }
    return { needsEmailConfirmation: res.needsEmailConfirmation };
  };

  const signInWithGoogleCloud = async () => {
    const client = await getSupabaseClient();
    if (!client) {
      throw new Error('Chưa cấu hình kết nối Supabase trên máy chủ.');
    }
    await signInWithGoogle(client);
  };

  const signOutCloud = async () => {
    const client = await getSupabaseClient();
    if (client) {
      await signOutFromSupabase(client);
    }
    setAuthUser(null);
    setAuthSession(null);
    authUserRef.current = null;
    setPasswordRecoveryPending(false);
    setSyncStatus('local_only');
    setSyncError(null);
  };

  const requestCloudPasswordReset = async (email: string) => {
    const client = await getSupabaseClient();
    if (!client) {
      throw new Error('Chưa cấu hình kết nối Supabase trên máy chủ.');
    }
    await requestPasswordResetEmail(client, email);
  };

  const completeCloudPasswordReset = async (newPassword: string) => {
    const client = await getSupabaseClient();
    if (!client) {
      throw new Error('Chưa cấu hình kết nối Supabase trên máy chủ.');
    }
    const user = await updateAuthenticatedPassword(client, newPassword);
    if (user) {
      setAuthUser(user);
      authUserRef.current = user;
    }
    setPasswordRecoveryPending(false);
  };

  const dismissPasswordRecovery = () => {
    setPasswordRecoveryPending(false);
  };

  return (
    <AppStateContext.Provider
      value={{
        profile,
        attempts,
        vocabulary,
        reviewLogs,
        aiLessons,
        serverNewsLessons,
        refreshServerNewsLessons,
        allLessons,
        dailyActivity,
        savedLessons,
        savedLessonIds,
        isLessonSaved,
        toggleSaveLesson,
        capabilities,
        adaptiveAssessment,
        recommendedLesson,
        updateProfile,
        saveDraft,
        getDraft,
        clearDraft,
        recordAttempt,
        saveLessonVocabulary,
        addCustomVocabulary,
        updateVocabulary,
        deleteVocabulary,
        submitReviewOutcome,
        addAiLesson,
        deleteAiLesson,
        deleteLesson,
        resetDemoData,
        exportBackupJson,
        isOnline,
        swRegistered,
        swUpdateAvailable,
        applySwUpdate,
        offlineLessons,
        offlineLessonIds,
        downloadLessonOffline,
        removeOfflineLessonById,
        clearOfflineDownloads,
        refreshOfflineLessons,
        authUser,
        authSession,
        authLoading,
        passwordRecoveryPending,
        syncStatus,
        syncError,
        lastSyncedAt,
        pendingSyncCount: syncQueue.length,
        signInWithCloud,
        signInWithGoogleCloud,
        signUpWithCloud,
        signOutCloud,
        requestCloudPasswordReset,
        completeCloudPasswordReset,
        dismissPasswordRecovery,
        syncNow,
      }}
    >
      {children}
    </AppStateContext.Provider>
  );
};

export function useAppState(): AppStateContextValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider');
  return ctx;
}
