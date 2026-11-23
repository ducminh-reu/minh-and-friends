import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookmarkCheck,
  BookmarkPlus,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  ExternalLink,
  HelpCircle,
  Loader2,
  Newspaper,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { useAppState, type SentenceInputStyle } from '../context/AppStateContext';
import { ERROR_CATEGORY_LABELS, NEWS_TOPIC_LABELS, TOPIC_LABELS, t } from '../i18n/translations';
import {
  russianAudioEngine,
  type AudioEngineSource,
  type AudioSourceMetadata,
} from '../services/audioPlayer';
import type {
  DictationAnalysisReport,
  DictationErrorCategory,
  DictationMode,
  PlaybackSpeed,
} from '../types/domain';
import {
  distributePastedText,
  joinWordSlots,
  parseSentenceToWordSlots,
  resizeWordSlotValues,
  type ParsedSentenceSlots,
} from '../utils/sentenceSlots';
import { findSpeakerProfile, getVoicePersonaLabelVi } from '../utils/speakerUtils';
import { analyzeDictationSubmission } from '../utils/transcriptDiff';
import { getDefaultRussianNarratorSpeaker } from '../utils/voiceRegistry';

const SPEEDS: PlaybackSpeed[] = [0.75, 0.85, 1, 1.15];
const CYRILLIC_HELPER_KEYS = ['ё', 'й', 'щ', 'ъ', 'ы', 'ь', 'э', 'ю', 'я', '—', '«', '»'];

type WorkspaceStage = 'dictation' | 'analysis';
type StudyTab = 'errors' | 'vocabulary' | 'grammar' | 'comprehension';

export const DictationWorkspacePage: React.FC = () => {
  const { lessonId } = useParams<{ lessonId: string }>();
  const {
    allLessons,
    profile,
    vocabulary,
    capabilities,
    isOnline,
    offlineLessons,
    offlineLessonIds,
    downloadLessonOffline,
    getDraft,
    saveDraft,
    clearDraft,
    recordAttempt,
    saveLessonVocabulary,
    addCustomVocabulary,
    updateProfile,
  } = useAppState();

  const lang = profile.interfaceLanguage;
  const lesson = useMemo(
    () => (lessonId ? allLessons.find((l) => l.id === lessonId) : allLessons[0]),
    [allLessons, lessonId],
  );

  const savedWordsSet = useMemo(
    () => new Set(vocabulary.map((v) => v.word.toLowerCase())),
    [vocabulary],
  );

  const [mode, setMode] = useState<DictationMode>(profile.preferredMode);
  const [sentenceInputStyle, setSentenceInputStyle] = useState<SentenceInputStyle>('slots');
  const [speed, setSpeed] = useState<PlaybackSpeed>(profile.preferredSpeed);
  const [stage, setStage] = useState<WorkspaceStage>('dictation');
  const [studyTab, setStudyTab] = useState<StudyTab>('errors');
  const [activeSentenceIdx, setActiveSentenceIdx] = useState(0);
  const [sentenceInputs, setSentenceInputs] = useState<Record<string, string>>({});
  const [wordSlotInputs, setWordSlotInputs] = useState<Record<string, string[]>>({});
  const [fullInput, setFullInput] = useState('');
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [interruptedNotice, setInterruptedNotice] = useState(false);
  const [isPlayerDeckVisible, setIsPlayerDeckVisible] = useState(true);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioSource, setAudioSource] = useState<AudioEngineSource | null>(null);
  const [audioSourceMeta, setAudioSourceMeta] = useState<AudioSourceMetadata | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  const [analysisReport, setAnalysisReport] = useState<DictationAnalysisReport | null>(null);
  const [aiExplanations, setAiExplanations] = useState<
    Record<string, { summaryVi: string; grammarTipRu: string; correctedText: string }>
  >({});
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null);
  const [aiErrorMsg, setAiErrorMsg] = useState<string | null>(null);
  const [addedMistakesNotice, setAddedMistakesNotice] = useState<string | null>(null);

  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [savedNoticeId, setSavedNoticeId] = useState<string | null>(null);
  const [downloadingOffline, setDownloadingOffline] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [showNewsFacts, setShowNewsFacts] = useState(false);

  const sessionStartRef = useRef<number>(Date.now());
  const fullPlaybackActiveRef = useRef<boolean>(false);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const audioDeckRef = useRef<HTMLElement | null>(null);
  const slotInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const activeSlotIndexRef = useRef<number>(0);
  const scrollTimerRef = useRef<number | null>(null);
  const suppressAutoScrollRef = useRef<boolean>(false);
  const draftDirtyRef = useRef<boolean>(false);
  const latestDraftRef = useRef<{
    lessonId: string;
    mode: DictationMode;
    sentenceInputs: Record<string, string>;
    wordSlotInputs: Record<string, string[]>;
    sentenceInputStyle: SentenceInputStyle;
    fullInput: string;
    stage: WorkspaceStage;
  } | null>(null);

  const scrollFieldIntoMobileView = (el: HTMLElement | null) => {
    if (
      !el ||
      suppressAutoScrollRef.current ||
      typeof window === 'undefined' ||
      window.innerWidth >= 1024
    ) {
      return;
    }
    if (scrollTimerRef.current !== null) {
      window.clearTimeout(scrollTimerRef.current);
    }
    scrollTimerRef.current = window.setTimeout(() => {
      scrollTimerRef.current = null;
      const rect = el.getBoundingClientRect();
      const vvHeight = window.visualViewport?.height ?? window.innerHeight;
      const topSafe = 120;
      const bottomSafe = vvHeight - 24;
      if (rect.top < topSafe || rect.bottom > bottomSafe) {
        el.scrollIntoView({ behavior: 'auto', block: 'center' });
      }
    }, 180);
  };

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current !== null) {
        window.clearTimeout(scrollTimerRef.current);
      }
    };
  }, []);

  const activeSentenceForHooks = lesson
    ? lesson.sentences[activeSentenceIdx] ?? lesson.sentences[0]
    : undefined;

  const currentParsedSlots: ParsedSentenceSlots = useMemo(
    () => parseSentenceToWordSlots(activeSentenceForHooks?.text ?? ''),
    [activeSentenceForHooks?.text],
  );

  const currentSlotValues = useMemo(
    () =>
      activeSentenceForHooks
        ? resizeWordSlotValues(
            wordSlotInputs[activeSentenceForHooks.id],
            currentParsedSlots.wordCount,
          )
        : [],
    [wordSlotInputs, activeSentenceForHooks, currentParsedSlots.wordCount],
  );

  const slotRenderItems = useMemo(() => {
    type RenderItem =
      | {
          kind: 'word_group';
          wordIndex: number;
          charLength: number;
          leadingPuncts: string[];
          trailingPuncts: string[];
        }
      | {
          kind: 'inline_punct';
          text: string;
          key: string;
        };

    const items: RenderItem[] = [];
    let pendingRightPuncts: string[] = [];

    currentParsedSlots.segments.forEach((seg, idx) => {
      if (seg.type === 'punct') {
        if (seg.attach === 'right') {
          pendingRightPuncts.push(seg.text);
        } else if (seg.attach === 'left') {
          const prev = items[items.length - 1];
          if (prev && prev.kind === 'word_group') {
            prev.trailingPuncts.push(seg.text);
          } else {
            items.push({ kind: 'inline_punct', text: seg.text, key: `p-${idx}` });
          }
        } else {
          items.push({ kind: 'inline_punct', text: seg.text, key: `p-${idx}` });
        }
      } else {
        items.push({
          kind: 'word_group',
          wordIndex: seg.wordIndex,
          charLength: seg.charLength,
          leadingPuncts: pendingRightPuncts,
          trailingPuncts: [],
        });
        pendingRightPuncts = [];
      }
    });

    if (pendingRightPuncts.length > 0) {
      pendingRightPuncts.forEach((p, idx) => {
        items.push({ kind: 'inline_punct', text: p, key: `tail-${idx}` });
      });
    }

    return items;
  }, [currentParsedSlots.segments]);

  useEffect(() => {
    activeSlotIndexRef.current = 0;
    slotInputRefs.current = [];
  }, [activeSentenceIdx, lesson?.id]);

  // Observe main audio deck visibility so mobile sticky mini-player appears when scrolled down
  useEffect(() => {
    const deck = audioDeckRef.current;
    if (!deck || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        setIsPlayerDeckVisible(entry.isIntersecting);
      },
      { rootMargin: '-60px 0px 0px 0px', threshold: 0.05 },
    );
    obs.observe(deck);
    return () => obs.disconnect();
  }, [lesson?.id, stage]);

  // Keep audio state synchronized if user switches apps or background-pauses on mobile
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (isPlaying) {
          const pausedOrStopped = russianAudioEngine.handleVisibilityHidden();
          if (pausedOrStopped) {
            setIsPlaying(false);
            setIsPaused(russianAudioEngine.canResume());
            setInterruptedNotice(true);
          }
        }
        if (draftDirtyRef.current && latestDraftRef.current) {
          const snap = latestDraftRef.current;
          if (snap.stage === 'dictation') {
            const hasContent =
              snap.fullInput.trim().length > 0 ||
              Object.values(snap.sentenceInputs).some((v) => v.trim().length > 0) ||
              Object.values(snap.wordSlotInputs).some((arr) => arr.some((v) => v.trim().length > 0));
            if (hasContent) {
              saveDraft({ ...snap, updatedAt: new Date().toISOString() });
            } else {
              clearDraft(snap.lessonId);
            }
            draftDirtyRef.current = false;
          }
        }
      }
    };
    const onPageHide = () => {
      if (draftDirtyRef.current && latestDraftRef.current) {
        const snap = latestDraftRef.current;
        if (snap.stage === 'dictation') {
          const hasContent =
            snap.fullInput.trim().length > 0 ||
            Object.values(snap.sentenceInputs).some((v) => v.trim().length > 0) ||
            Object.values(snap.wordSlotInputs).some((arr) => arr.some((v) => v.trim().length > 0));
          if (hasContent) {
            saveDraft({ ...snap, updatedAt: new Date().toISOString() });
          } else {
            clearDraft(snap.lessonId);
          }
          draftDirtyRef.current = false;
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [isPlaying, saveDraft, clearDraft]);

  // Load saved draft when lesson changes
  useEffect(() => {
    russianAudioEngine.stop();
    fullPlaybackActiveRef.current = false;
    draftDirtyRef.current = false;
    setIsPlaying(false);
    setIsPaused(false);
    setInterruptedNotice(false);
    setAudioProgress(0);
    setStage('dictation');
    setStudyTab('errors');
    setAnalysisReport(null);
    setAiExplanations({});
    setAiErrorMsg(null);
    setActiveSentenceIdx(0);
    activeSlotIndexRef.current = 0;
    sessionStartRef.current = Date.now();

    if (lesson) {
      const existing = getDraft(lesson.id);
      if (existing) {
        setMode(existing.mode);
        setSentenceInputStyle(existing.sentenceInputStyle ?? 'slots');
        setSentenceInputs(existing.sentenceInputs);

        if (existing.wordSlotInputs) {
          setWordSlotInputs(existing.wordSlotInputs);
        } else {
          const hydratedSlots: Record<string, string[]> = {};
          lesson.sentences.forEach((s) => {
            const raw = existing.sentenceInputs[s.id] ?? '';
            if (raw.trim()) {
              const parsed = parseSentenceToWordSlots(s.text);
              const empty = Array.from({ length: parsed.wordCount }, () => '');
              hydratedSlots[s.id] = distributePastedText(empty, 0, raw).nextValues;
            }
          });
          setWordSlotInputs(hydratedSlots);
        }

        setFullInput(existing.fullInput);
        setDraftSavedAt(existing.updatedAt);
      } else {
        setSentenceInputStyle('slots');
        setSentenceInputs({});
        setWordSlotInputs({});
        setFullInput('');
        setDraftSavedAt(null);
      }
    }

    return () => {
      fullPlaybackActiveRef.current = false;
      russianAudioEngine.stop();
    };
  }, [lesson?.id]);

  // Keep latest draft snapshot & autosave/clear with unmount flush
  useEffect(() => {
    if (!lesson) {
      latestDraftRef.current = null;
      return;
    }
    latestDraftRef.current = {
      lessonId: lesson.id,
      mode,
      sentenceInputs,
      wordSlotInputs,
      sentenceInputStyle,
      fullInput,
      stage,
    };
  }, [lesson?.id, mode, sentenceInputs, wordSlotInputs, sentenceInputStyle, fullInput, stage]);

  useEffect(() => {
    if (!lesson || stage !== 'dictation' || !draftDirtyRef.current) return;

    const persistNow = (updateUiTimestamp: boolean) => {
      const snap = latestDraftRef.current;
      if (!snap || snap.lessonId !== lesson.id || snap.stage !== 'dictation') return;
      const hasContent =
        snap.fullInput.trim().length > 0 ||
        Object.values(snap.sentenceInputs).some((v) => v.trim().length > 0) ||
        Object.values(snap.wordSlotInputs).some((arr) => arr.some((v) => v.trim().length > 0));

      if (!hasContent) {
        clearDraft(lesson.id);
        if (updateUiTimestamp) setDraftSavedAt(null);
      } else {
        const now = new Date().toISOString();
        saveDraft({
          lessonId: lesson.id,
          mode: snap.mode,
          sentenceInputs: snap.sentenceInputs,
          wordSlotInputs: snap.wordSlotInputs,
          sentenceInputStyle: snap.sentenceInputStyle,
          fullInput: snap.fullInput,
          updatedAt: now,
        });
        if (updateUiTimestamp) setDraftSavedAt(now);
      }
      draftDirtyRef.current = false;
    };

    const timer = window.setTimeout(() => {
      persistNow(true);
    }, 350);

    return () => {
      window.clearTimeout(timer);
      if (draftDirtyRef.current) {
        persistNow(false);
      }
    };
  }, [lesson?.id, mode, sentenceInputStyle, sentenceInputs, wordSlotInputs, fullInput, stage]);

  if (!lesson) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
        <p className="text-sm text-slate-600">Không tìm thấy bài học này.</p>
        <Link
          to="/library"
          className="mt-3 inline-flex items-center justify-center min-h-[44px] px-4 text-sm font-medium text-[#0F2342] underline"
        >
          Quay lại Thư viện
        </Link>
      </div>
    );
  }

  const currentSentence = lesson.sentences[activeSentenceIdx] ?? lesson.sentences[0];
  const offlineRecord = offlineLessons.find((o) => o.lessonId === lesson.id);
  const isDownloadedOffline = offlineLessonIds.has(lesson.id);

  const handleDownloadThisLesson = async () => {
    if (downloadingOffline) return;
    setDownloadingOffline(true);
    setDownloadProgress({ done: 0, total: lesson.sentences.length });
    try {
      const topicEn = TOPIC_LABELS[lesson.topic]?.en ?? lesson.topic;
      await downloadLessonOffline(lesson, {
        includeAudio: capabilities.ttsAvailable && isOnline,
        topicEn,
        onProgress: (done, total) => setDownloadProgress({ done, total }),
      });
    } catch (err) {
      setAudioError(
        err instanceof Error ? err.message : 'Không thể tải bài học ngoại tuyến.',
      );
    } finally {
      setDownloadingOffline(false);
      setDownloadProgress(null);
    }
  };

  const playSingleSentence = async (
    index: number,
    chainNext: boolean,
    preferServerOverride?: boolean,
  ) => {
    const target = lesson.sentences[index];
    if (!target) {
      fullPlaybackActiveRef.current = false;
      setIsPlaying(false);
      setIsPaused(false);
      return;
    }

    setActiveSentenceIdx(index);
    setAudioError(null);
    setInterruptedNotice(false);
    setIsPaused(false);
    setIsPlaying(true);
    setAudioProgress(0);

    const speakerProfile = findSpeakerProfile(lesson.speakers, target.speaker);
    const prevSentence = index > 0 ? lesson.sentences[index - 1] : undefined;
    const topicEn = TOPIC_LABELS[lesson.topic]?.en ?? lesson.topic;
    const preferServer =
      preferServerOverride !== undefined
        ? preferServerOverride
        : profile.ttsPreference === 'auto' && capabilities.ttsAvailable && isOnline;

    try {
      await russianAudioEngine.playSentence({
        lessonId: lesson.id,
        sentenceId: target.id,
        audioUrl: target.audioUrl,
        text: target.text,
        speaker: speakerProfile,
        topic: topicEn,
        previousSpeaker: prevSentence?.speaker,
        previousText: prevSentence?.text,
        speed,
        preferServerTts: preferServer,
        fallbackDurationSec: Math.max(3, target.endSec - target.startSec),
        onSourceResolved: (src, meta) => {
          setAudioSource(src);
          setAudioSourceMeta(meta ?? { source: src });
        },
        onProgress: (r) => setAudioProgress(r),
        onInterrupted: () => {
          setIsPlaying(false);
          setIsPaused(russianAudioEngine.canResume());
          setInterruptedNotice(true);
        },
        onComplete: () => {
          if (chainNext && fullPlaybackActiveRef.current && index + 1 < lesson.sentences.length) {
            void playSingleSentence(index + 1, true);
          } else {
            fullPlaybackActiveRef.current = false;
            setIsPlaying(false);
            setIsPaused(false);
          }
        },
        onError: (msg) => {
          setAudioError(msg);
          fullPlaybackActiveRef.current = false;
          setIsPlaying(false);
          setIsPaused(false);
        },
      });
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : 'Không thể phát âm thanh.');
      fullPlaybackActiveRef.current = false;
      setIsPlaying(false);
      setIsPaused(false);
    }
  };

  const playPersistedFullNewsAudio = async () => {
    const fullUrl = lesson.newsMetadata?.fullAudioUrl;
    if (!fullUrl) return;
    const topicEn = TOPIC_LABELS[lesson.topic]?.en ?? lesson.topic;
    setActiveSentenceIdx(0);
    setAudioError(null);
    setInterruptedNotice(false);
    setIsPaused(false);
    setIsPlaying(true);
    setAudioProgress(0);

    try {
      await russianAudioEngine.playDialogueBlock({
        speakers: lesson.speakers,
        sentences: lesson.sentences,
        fullAudioUrl: fullUrl,
        topic: topicEn,
        speed,
        onSourceResolved: (src, meta) => {
          setAudioSource(src);
          setAudioSourceMeta(meta ?? { source: src });
        },
        onSentenceProgress: (idxInLesson, localRatio) => {
          setActiveSentenceIdx(idxInLesson);
          setAudioProgress(localRatio);
        },
        onInterrupted: () => {
          setIsPlaying(false);
          setIsPaused(russianAudioEngine.canResume());
          setInterruptedNotice(true);
        },
        onComplete: () => {
          fullPlaybackActiveRef.current = false;
          setIsPlaying(false);
          setIsPaused(false);
        },
        onFallbackToSequential: () => {
          if (fullPlaybackActiveRef.current) {
            void playSingleSentence(0, true);
          }
        },
        onError: (msg) => {
          setAudioError(msg);
          fullPlaybackActiveRef.current = false;
          setIsPlaying(false);
          setIsPaused(false);
        },
      });
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : 'Không thể phát âm thanh.');
      fullPlaybackActiveRef.current = false;
      setIsPlaying(false);
      setIsPaused(false);
    }
  };

  const handleTogglePlay = async () => {
    if (isPlaying) {
      const didPause = russianAudioEngine.pause();
      if (didPause) {
        setIsPlaying(false);
        setIsPaused(true);
        setInterruptedNotice(false);
        return;
      }
      fullPlaybackActiveRef.current = false;
      russianAudioEngine.stop();
      setIsPlaying(false);
      setIsPaused(false);
      return;
    }

    if (isPaused && russianAudioEngine.canResume()) {
      setInterruptedNotice(false);
      setAudioError(null);
      setIsPlaying(true);
      setIsPaused(false);
      const resumed = await russianAudioEngine.resume();
      if (resumed) return;
    }

    setInterruptedNotice(false);
    setIsPaused(false);
    if (mode === 'full') {
      fullPlaybackActiveRef.current = true;
      if (
        activeSentenceIdx === 0 &&
        lesson.newsMetadata?.fullAudioUrl &&
        !isDownloadedOffline &&
        isOnline
      ) {
        void playPersistedFullNewsAudio();
      } else {
        // Sequential per-sentence playback reuses persistent server disk & client cache across 1, 2, 3+ speakers
        void playSingleSentence(activeSentenceIdx, true);
      }
    } else {
      fullPlaybackActiveRef.current = false;
      void playSingleSentence(activeSentenceIdx, false);
    }
  };

  const handleReplay = () => {
    fullPlaybackActiveRef.current = mode === 'full';
    setIsPaused(false);
    setInterruptedNotice(false);
    const targetIdx = mode === 'full' ? 0 : activeSentenceIdx;
    if (mode === 'full' && lesson.newsMetadata?.fullAudioUrl && !isDownloadedOffline && isOnline) {
      void playPersistedFullNewsAudio();
    } else {
      void playSingleSentence(targetIdx, mode === 'full');
    }
  };

  const handleStepSentence = (delta: number) => {
    const next = Math.max(0, Math.min(lesson.sentences.length - 1, activeSentenceIdx + delta));
    fullPlaybackActiveRef.current = false;
    russianAudioEngine.stop();
    setIsPlaying(false);
    setIsPaused(false);
    setInterruptedNotice(false);
    setAudioProgress(0);
    setActiveSentenceIdx(next);
  };

  const handleSelectSentenceIndex = (idx: number) => {
    fullPlaybackActiveRef.current = false;
    russianAudioEngine.stop();
    setIsPlaying(false);
    setIsPaused(false);
    setInterruptedNotice(false);
    setAudioProgress(0);
    setActiveSentenceIdx(idx);
  };

  const handleSwitchMode = (nextMode: DictationMode) => {
    if (nextMode === mode) return;
    fullPlaybackActiveRef.current = false;
    russianAudioEngine.stop();
    setIsPlaying(false);
    setIsPaused(false);
    setInterruptedNotice(false);
    setAudioProgress(0);
    draftDirtyRef.current = true;
    setMode(nextMode);
  };

  const handleSelectSpeed = (spd: PlaybackSpeed) => {
    setSpeed(spd);
    russianAudioEngine.setPlaybackRate(spd);
  };

  const handleCycleSpeed = () => {
    const idx = SPEEDS.indexOf(speed);
    const nextSpd = SPEEDS[(idx + 1) % SPEEDS.length];
    handleSelectSpeed(nextSpd);
  };

  const updateSentenceSlots = (
    sentenceId: string,
    parsed: ParsedSentenceSlots,
    nextSlots: string[],
  ) => {
    draftDirtyRef.current = true;
    const normalized = resizeWordSlotValues(nextSlots, parsed.wordCount);
    setWordSlotInputs((prev) => ({
      ...prev,
      [sentenceId]: normalized,
    }));
    const joined = joinWordSlots(parsed.segments, normalized);
    setSentenceInputs((prev) => ({
      ...prev,
      [sentenceId]: joined,
    }));
  };

  const handleSelectInputStyle = (nextStyle: SentenceInputStyle) => {
    if (nextStyle === sentenceInputStyle) return;
    draftDirtyRef.current = true;
    if (nextStyle === 'slots') {
      const nextAllSlots: Record<string, string[]> = { ...wordSlotInputs };
      lesson.sentences.forEach((s) => {
        const freeText = sentenceInputs[s.id] ?? '';
        const parsed = parseSentenceToWordSlots(s.text);
        const existingJoined = joinWordSlots(
          parsed.segments,
          resizeWordSlotValues(nextAllSlots[s.id], parsed.wordCount),
        );
        if (freeText.trim() !== existingJoined.trim()) {
          const empty = Array.from({ length: parsed.wordCount }, () => '');
          nextAllSlots[s.id] = freeText.trim()
            ? distributePastedText(empty, 0, freeText).nextValues
            : empty;
        }
      });
      setWordSlotInputs(nextAllSlots);
    }
    setSentenceInputStyle(nextStyle);
  };

  const focusSlot = (slotIdx: number, caretAtEnd = false) => {
    window.requestAnimationFrame(() => {
      const target = slotInputRefs.current[slotIdx];
      if (!target) return;
      activeSlotIndexRef.current = slotIdx;
      target.focus();
      if (caretAtEnd) {
        const len = target.value.length;
        target.setSelectionRange(len, len);
      }
    });
  };

  const insertCyrillicChar = (ch: string) => {
    draftDirtyRef.current = true;
    if (mode === 'sentence' && sentenceInputStyle === 'slots') {
      const slotIdx = Math.max(
        0,
        Math.min(Math.max(0, currentParsedSlots.wordCount - 1), activeSlotIndexRef.current),
      );
      const slotEl = slotInputRefs.current[slotIdx];
      const currentSlotText = currentSlotValues[slotIdx] ?? '';
      const start = slotEl?.selectionStart ?? currentSlotText.length;
      const end = slotEl?.selectionEnd ?? currentSlotText.length;
      const updatedSlot =
        currentSlotText.slice(0, start) + ch + currentSlotText.slice(end);
      const nextSlots = [...currentSlotValues];
      nextSlots[slotIdx] = updatedSlot;
      updateSentenceSlots(currentSentence.id, currentParsedSlots, nextSlots);

      window.requestAnimationFrame(() => {
        const target = slotInputRefs.current[slotIdx];
        if (!target) return;
        suppressAutoScrollRef.current = true;
        if (document.activeElement !== target) {
          target.focus({ preventScroll: true });
        }
        target.setSelectionRange(start + ch.length, start + ch.length);
        suppressAutoScrollRef.current = false;
      });
      return;
    }

    const el = editorRef.current;
    const currentVal =
      mode === 'sentence' ? sentenceInputs[currentSentence.id] ?? '' : fullInput;

    if (!el) {
      if (mode === 'sentence') {
        setSentenceInputs((prev) => ({ ...prev, [currentSentence.id]: currentVal + ch }));
      } else {
        setFullInput(currentVal + ch);
      }
      return;
    }

    const start = el.selectionStart ?? currentVal.length;
    const end = el.selectionEnd ?? currentVal.length;
    const updated = currentVal.slice(0, start) + ch + currentVal.slice(end);
    if (mode === 'sentence') {
      setSentenceInputs((prev) => ({ ...prev, [currentSentence.id]: updated }));
    } else {
      setFullInput(updated);
    }
    window.requestAnimationFrame(() => {
      suppressAutoScrollRef.current = true;
      if (document.activeElement !== el) {
        el.focus({ preventScroll: true });
      }
      el.setSelectionRange(start + ch.length, start + ch.length);
      suppressAutoScrollRef.current = false;
    });
  };

  const handleSubmit = () => {
    fullPlaybackActiveRef.current = false;
    russianAudioEngine.stop();
    draftDirtyRef.current = false;
    setIsPlaying(false);
    setIsPaused(false);
    setInterruptedNotice(false);

    const report = analyzeDictationSubmission(
      lesson.id,
      lesson.sentences,
      mode,
      sentenceInputs,
      mode === 'full' ? fullInput : undefined,
    );
    const elapsedSec = Math.round((Date.now() - sessionStartRef.current) / 1000);
    recordAttempt(lesson, mode, report, elapsedSec, sentenceInputs, fullInput);
    setAnalysisReport(report);
    setStage('analysis');
    setStudyTab('errors');
  };

  const handleResetToDictation = () => {
    setStage('dictation');
    setAnalysisReport(null);
    setAddedMistakesNotice(null);
    sessionStartRef.current = Date.now();
  };

  const handleAddMistakesToVocabulary = () => {
    if (!lesson || !analysisReport) return;
    const errorWordsMap = new Map<string, { exampleRu: string; exampleVi: string; sentenceNum: number }>();

    for (const sent of analysisReport.sentences) {
      for (const tok of sent.tokens) {
        if (tok.type === 'missing' || tok.type === 'substitute' || tok.type === 'extra') {
          const cleanWord = tok.referenceWord?.trim();
          if (cleanWord && cleanWord.length > 1 && !errorWordsMap.has(cleanWord.toLowerCase())) {
            errorWordsMap.set(cleanWord.toLowerCase(), {
              exampleRu: sent.referenceText,
              exampleVi: lesson.titleVi,
              sentenceNum: sent.order,
            });
          }
        }
      }
      for (const err of sent.errors) {
        const cleanWord = err.referenceSnippet?.trim() || err.correctedSnippet?.trim();
        if (cleanWord && cleanWord.length > 1 && !errorWordsMap.has(cleanWord.toLowerCase())) {
          errorWordsMap.set(cleanWord.toLowerCase(), {
            exampleRu: sent.referenceText,
            exampleVi: lesson.titleVi,
            sentenceNum: sent.order,
          });
        }
      }
    }

    let addedCount = 0;
    for (const [wordKey, info] of errorWordsMap.entries()) {
      const vocabMatch = lesson.vocabulary.find(
        (v) => v.word.toLowerCase() === wordKey || v.word.toLowerCase().includes(wordKey),
      );

      addCustomVocabulary({
        word: vocabMatch?.word || wordKey,
        stressedWord: vocabMatch?.stressedWord || vocabMatch?.word || wordKey,
        partOfSpeech: vocabMatch?.partOfSpeech || 'существительное',
        forms: vocabMatch?.forms || '',
        meaningVi: vocabMatch?.meaningVi || `Từ vựng lỗi/chưa nghe được từ bài "${lesson.titleVi}"`,
        definitionRu: vocabMatch?.definitionRu || '',
        exampleRu: info.exampleRu,
        exampleVi: info.exampleVi,
        sourceLessonId: lesson.id,
        sourceLessonTitle: lesson.titleVi,
        notes: `Thêm tự động từ bài nghe chép (câu ${info.sentenceNum})`,
      });
      addedCount += 1;
    }

    if (addedCount > 0) {
      setAddedMistakesNotice(`Đã thêm ${addedCount} từ vựng nghe sai/thiếu vào Sổ tay từ vựng thành công!`);
    } else {
      setAddedMistakesNotice('Không phát hiện từ vựng lỗi mới nào để thêm.');
    }
  };

  const handleAiDeepExplain = async (sentenceId: string, referenceText: string, learnerText: string) => {
    if (!isOnline) {
      setAiErrorMsg('Đang ngoại tuyến — Tính năng giải thích sâu AI cần kết nối mạng.');
      return;
    }
    setAiLoadingId(sentenceId);
    setAiErrorMsg(null);
    try {
      const resp = await fetch('/api/analysis/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referenceText,
          learnerText: learnerText || '(Học viên bỏ trống câu này)',
          level: lesson.level,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setAiErrorMsg(data.message || 'Không thể lấy phân tích AI.');
        return;
      }
      setAiExplanations((prev) => ({ ...prev, [sentenceId]: data }));
    } catch {
      setAiErrorMsg('Lỗi kết nối tới máy chủ phân tích AI.');
    } finally {
      setAiLoadingId(null);
    }
  };

  const completedSentenceCount = lesson.sentences.filter(
    (s) => (sentenceInputs[s.id] ?? '').trim().length > 0,
  ).length;

  const filledSlotCount = currentSlotValues.filter((v) => v.trim().length > 0).length;

  const activeTextValue =
    mode === 'sentence' ? sentenceInputs[currentSentence.id] ?? '' : fullInput;

  const wordCount = activeTextValue.trim()
    ? activeTextValue.trim().split(/\s+/).length
    : 0;

  return (
    <div className="space-y-6">
      {/* Breadcrumb & Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <Link
            to={lesson.newsMetadata ? '/news' : '/library'}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-1 -ml-1 text-xs font-medium text-slate-600 hover:text-[#0F2342]"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{lesson.newsMetadata ? 'Quay lại Tin tức · Новости' : 'Quay lại thư viện'}</span>
          </Link>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-2">
            <span className="font-semibold text-[#0F2342]">CEFR {lesson.level}</span>
            <span aria-hidden="true">·</span>
            <span>
              {lesson.newsMetadata
                ? NEWS_TOPIC_LABELS[lesson.newsMetadata.newsTopic][lang]
                : TOPIC_LABELS[lesson.topic][lang]}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {lesson.source === 'curated' ? t(lang, 'curatedBadge') : t(lang, 'aiBadge')}
            </span>
            {lesson.newsMetadata && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  {lesson.newsMetadata.sourceName} ·{' '}
                  {new Date(lesson.newsMetadata.publishedAt).toLocaleDateString('vi-VN')}
                </span>
              </>
            )}
          </div>

          <h1 className="text-xl sm:text-2xl font-bold text-[#0F2342] mt-1 cyrillic-prose">
            {lesson.titleRu}
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">{lesson.titleVi}</p>
        </div>

        {/* Mode Switcher + Offline Download Action */}
        <div className="flex flex-wrap items-center gap-2 self-start shrink-0">
          {stage === 'dictation' && (
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                aria-pressed={mode === 'sentence'}
                onClick={() => handleSwitchMode('sentence')}
                className={`px-3 py-2 min-h-[44px] text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  mode === 'sentence'
                    ? 'bg-white text-[#0F2342] shadow-sm'
                    : 'text-slate-600 hover:text-[#0F2342]'
                }`}
              >
                {t(lang, 'sentenceMode')}
              </button>
              <button
                type="button"
                aria-pressed={mode === 'full'}
                onClick={() => handleSwitchMode('full')}
                className={`px-3 py-2 min-h-[44px] text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  mode === 'full'
                    ? 'bg-white text-[#0F2342] shadow-sm'
                    : 'text-slate-600 hover:text-[#0F2342]'
                }`}
              >
                {t(lang, 'fullMode')}
              </button>
            </div>
          )}

          {isDownloadedOffline ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg bg-[#F2F9F8] border border-[#1F7A6E]/30 text-xs font-semibold text-[#165B52] whitespace-nowrap">
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {offlineRecord && offlineRecord.cachedAudioCount === 0
                  ? 'Đã lưu văn bản (ngoại tuyến)'
                  : offlineRecord
                    ? `Đã lưu ngoại tuyến (${offlineRecord.cachedAudioCount}/${offlineRecord.sentenceCount} audio)`
                    : 'Đã lưu ngoại tuyến'}
              </span>
            </span>
          ) : (
            <button
              type="button"
              disabled={downloadingOffline}
              onClick={() => void handleDownloadThisLesson()}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#0F2342] hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
            >
              {downloadingOffline ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  <span>
                    Đang tải{' '}
                    {downloadProgress
                      ? `${downloadProgress.done}/${downloadProgress.total}`
                      : '...'}
                  </span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Tải ngoại tuyến</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* News Source Provenance vs AI Educational Content Banner */}
      {lesson.newsMetadata && (
        <section
          aria-label="Nguồn tin xác minh và phân định nội dung AI"
          className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-start gap-2.5 text-xs text-slate-700 min-w-0">
              <Newspaper className="w-4 h-4 text-[#1E4178] shrink-0 mt-0.5" aria-hidden="true" />
              <div className="min-w-0">
                <span className="font-semibold text-[#0F2342]">
                  Tin gốc: {lesson.newsMetadata.sourceName}
                </span>{' '}
                <span className="text-slate-500 tabular-nums">
                  ({new Date(lesson.newsMetadata.publishedAt).toLocaleString('vi-VN')})
                </span>
                <span aria-hidden="true"> · </span>
                <span className="text-slate-600">
                  Bài nghe chép là nội dung giáo dục do AI biên soạn dựa trên dữ kiện xác minh.
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <a
                href={lesson.newsMetadata.articleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-3 py-2 min-h-[44px] rounded-lg border border-slate-200 text-xs font-medium text-[#1E4178] hover:bg-slate-50 whitespace-nowrap"
              >
                <span>Đọc bài gốc</span>
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
              <button
                type="button"
                aria-expanded={showNewsFacts}
                onClick={() => setShowNewsFacts((v) => !v)}
                className="inline-flex items-center gap-1 px-3 py-2 min-h-[44px] rounded-lg border border-slate-200 text-xs font-medium text-[#0F2342] hover:bg-slate-50 whitespace-nowrap"
              >
                <span>{showNewsFacts ? 'Ẩn dữ kiện gốc' : 'Xem dữ kiện gốc'}</span>
                {showNewsFacts ? (
                  <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {showNewsFacts && (
            <div className="pt-3 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="bg-[#F7F9FC] border border-slate-200 rounded-lg p-3.5 space-y-2">
                <div className="font-semibold text-[#165B52]">
                  1. Sự kiện xác minh từ nguồn tin ({lesson.newsMetadata.sourceName})
                </div>
                <div className="text-slate-600">
                  Tiêu đề gốc: <span className="font-medium text-[#0F2342]">{lesson.newsMetadata.originalTitle}</span>
                </div>
                <p className="text-slate-700 leading-relaxed">
                  {lesson.newsMetadata.verifiedFactsSummaryVi}
                </p>
                {lesson.newsMetadata.verifiedFactsRu.length > 0 && (
                  <ul className="space-y-1 text-slate-700 cyrillic-prose list-disc list-inside">
                    {lesson.newsMetadata.verifiedFactsRu.map((fact, idx) => (
                      <li key={idx}>{fact}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="bg-[#F7F9FC] border border-slate-200 rounded-lg p-3.5 space-y-2">
                <div className="font-semibold text-[#1E4178]">
                  2. Tóm tắt & nội dung luyện nghe AI biên soạn (CEFR {lesson.level})
                </div>
                {lesson.newsMetadata.educationalSummaryRu && (
                  <p className="text-slate-800 cyrillic-prose leading-relaxed">
                    {lesson.newsMetadata.educationalSummaryRu}
                  </p>
                )}
                {lesson.newsMetadata.educationalSummaryVi && (
                  <p className="text-slate-700 leading-relaxed">
                    {lesson.newsMetadata.educationalSummaryVi}
                  </p>
                )}
                <p className="text-slate-600 leading-relaxed">{lesson.newsMetadata.aiDisclaimerVi}</p>
                {lesson.levelJustificationVi && (
                  <p className="text-slate-600 leading-relaxed">
                    <strong>Độ phù hợp CEFR:</strong> {lesson.levelJustificationVi}
                  </p>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Audio Player Deck (always visible in dictation, also accessible in analysis) */}
      <section
        ref={audioDeckRef}
        aria-label="Trình phát âm thanh tiếng Nga"
        className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Volume2 className="w-4 h-4 text-[#0F2342] shrink-0" aria-hidden="true" />
            <span>
              {(() => {
                const activeSpeaker = findSpeakerProfile(lesson.speakers, currentSentence.speaker);
                const genderTag = activeSpeaker
                  ? activeSpeaker.gender === 'female'
                    ? 'Giọng nữ'
                    : 'Giọng nam'
                  : '';
                return mode === 'sentence'
                  ? `Câu ${activeSentenceIdx + 1}/${lesson.sentences.length} · Người nói: ${currentSentence.speaker}${genderTag ? ` (${genderTag})` : ''}`
                  : `Phát toàn bộ hội thoại (${lesson.sentences.length} câu · câu ${activeSentenceIdx + 1}: ${currentSentence.speaker})`;
              })()}
            </span>
          </div>

          <div className="text-xs text-slate-500">
            {audioSource === 'offline_cache' &&
              'Nguồn âm thanh: Bản lưu ngoại tuyến trên thiết bị'}
            {audioSource === 'persisted_news_audio' &&
              'Nguồn âm thanh: Audio tiếng Nga đã lưu trên máy chủ (0 lượt gọi API)'}
            {audioSource === 'server_multi_tts' &&
              `Nguồn âm thanh: ${audioSourceMeta?.provider || capabilities.ttsProvider || 'gemini-3.8-flash-lite-tts'} · Hội thoại đa giọng${audioSourceMeta?.cached ? ' (từ bộ nhớ đệm)' : ''}`}
            {audioSource === 'server_tts' &&
              `Nguồn âm thanh: ${audioSourceMeta?.provider || capabilities.ttsProvider || 'gemini-3.8-flash-lite-tts'}${audioSourceMeta?.voiceId ? ` · Giọng ${audioSourceMeta.voiceId}` : ''}${audioSourceMeta?.cached ? ' (từ bộ nhớ đệm)' : ''}`}
            {audioSource === 'browser_speech' &&
              'Nguồn âm thanh: Giọng đọc trình duyệt cục bộ (ru-RU · Chế độ thủ công)'}
            {audioSource === 'timed_fallback' &&
              'Nguồn âm thanh: Mô phỏng thời lượng cục bộ (Trình duyệt chưa có giọng ru-RU)'}
            {!audioSource &&
              (isDownloadedOffline
                ? 'Sẵn sàng phát ngoại tuyến trên thiết bị'
                : currentSentence.audioUrl
                  ? 'Sẵn sàng phát file audio tách từng câu từ máy chủ'
                  : profile.ttsPreference === 'browser'
                    ? 'Chế độ thủ công: Giọng đọc trình duyệt (ru-RU)'
                    : capabilities.ttsAvailable && isOnline
                      ? `Sẵn sàng ${capabilities.ttsProvider || 'gemini-3.8-flash-lite-tts'} (Free Tier · Đa giọng nam/nữ)`
                      : 'Chế độ ngoại tuyến / Giọng đọc cục bộ')}
          </div>
        </div>

        {/* Speaker & Voice Roster */}
        <div className="flex flex-wrap gap-2" aria-label="Nhân vật và giọng đọc trong hội thoại">
          {lesson.speakers.map((sp) => {
            const activeSp = findSpeakerProfile(lesson.speakers, currentSentence.speaker);
            const isSpeaking = activeSp?.name === sp.name;
            return (
              <div
                key={sp.name}
                className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                  isSpeaking
                    ? 'border-[#0F2342]/40 bg-[#F2F6FC] text-[#0F2342]'
                    : 'border-slate-200 bg-slate-50/70 text-slate-600'
                }`}
              >
                <span className="font-semibold cyrillic-prose">{sp.name}</span>
                <span aria-hidden="true"> · </span>
                <span>{getVoicePersonaLabelVi(sp.voiceName)}</span>
              </div>
            );
          })}
        </div>

        {/* Progress Bar */}
        <div className="space-y-1.5">
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#0F2342] transition-all duration-150"
              style={{
                width: `${
                  mode === 'sentence'
                    ? Math.round(audioProgress * 100)
                    : Math.round(
                        ((activeSentenceIdx + audioProgress) /
                          Math.max(1, lesson.sentences.length)) *
                          100,
                      )
                }%`,
              }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-slate-500 tabular-nums">
            <span>
              {currentSentence.startSec}s – {currentSentence.endSec}s
            </span>
            <span>Tổng thời lượng ~{lesson.durationSec}s</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => handleStepSentence(-1)}
              disabled={activeSentenceIdx === 0}
              aria-label="Câu trước"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => void handleTogglePlay()}
              className="inline-flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 min-h-[44px] rounded-lg bg-[#0F2342] text-white text-xs sm:text-sm font-medium hover:bg-[#163059] transition-colors whitespace-nowrap"
            >
              {isPlaying ? (
                <>
                  <Pause className="w-4 h-4" aria-hidden="true" />
                  <span>Tạm dừng</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" aria-hidden="true" />
                  <span>
                    {isPaused
                      ? 'Tiếp tục'
                      : mode === 'sentence'
                        ? 'Nghe câu này'
                        : 'Nghe toàn bài'}
                  </span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleReplay}
              className="inline-flex items-center justify-center gap-1 px-2.5 sm:px-3 min-h-[44px] rounded-lg border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-50 whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Nghe lại</span>
            </button>

            <button
              type="button"
              onClick={() => handleStepSentence(1)}
              disabled={activeSentenceIdx >= lesson.sentences.length - 1}
              aria-label="Câu tiếp theo"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {/* Speed selector */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg" role="group" aria-label="Tốc độ phát">
            {SPEEDS.map((spd) => (
              <button
                key={spd}
                type="button"
                aria-pressed={speed === spd}
                onClick={() => handleSelectSpeed(spd)}
                className={`min-w-[44px] min-h-[44px] px-2.5 text-xs font-mono tabular-nums rounded-md transition-colors ${
                  speed === spd
                    ? 'bg-white text-[#0F2342] font-semibold shadow-sm'
                    : 'text-slate-600 hover:text-[#0F2342]'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>

        {interruptedNotice && (
          <p className="text-xs text-[#0F2342] bg-[#F2F6FC] border border-slate-200 rounded-lg px-3 py-2">
            Âm thanh đã tạm dừng khi chuyển ứng dụng — nhấn «{isPaused ? 'Tiếp tục' : 'Nghe lại'}» để tiếp tục.
          </p>
        )}

        {audioError && (
          <div
            role="alert"
            className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5"
          >
            <span className="leading-relaxed">{audioError}</span>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setAudioError(null);
                  void playSingleSentence(activeSentenceIdx, mode === 'full');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-md bg-white border border-amber-300 text-amber-900 font-semibold hover:bg-amber-100"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Thử tải lại giọng đọc</span>
              </button>
              {profile.ttsPreference === 'auto' && (
                <button
                  type="button"
                  onClick={() => {
                    updateProfile({ ttsPreference: 'browser' });
                    setAudioError(null);
                    void playSingleSentence(activeSentenceIdx, mode === 'full', false);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-md bg-amber-900/10 border border-amber-300 text-amber-950 font-medium hover:bg-amber-200/70"
                >
                  <span>Dùng tạm giọng trình duyệt (ru-RU)</span>
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Sticky Mobile Mini-Player Bar when scrolling down to the editor */}
      {!isPlayerDeckVisible && stage === 'dictation' && (
        <div
          data-testid="mobile-mini-player"
          aria-label="Điều khiển phát nhanh trên di động"
          className="lg:hidden sticky top-14 z-20 -mx-1 px-2.5 py-2 rounded-xl bg-white/95 backdrop-blur border border-slate-200 shadow-sm flex items-center justify-between gap-1.5"
        >
          <div className="flex items-center gap-1">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleStepSentence(-1)}
              disabled={activeSentenceIdx === 0}
              aria-label="Câu trước (thanh nhanh)"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-700 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void handleTogglePlay()}
              aria-label={isPlaying ? 'Tạm dừng' : isPaused ? 'Tiếp tục' : 'Phát âm thanh'}
              className="min-h-[44px] px-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0F2342] text-white text-xs font-semibold whitespace-nowrap"
            >
              {isPlaying ? (
                <>
                  <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Dừng</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isPaused ? 'Tiếp' : 'Phát'}</span>
                </>
              )}
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleReplay}
              aria-label="Nghe lại (thanh nhanh)"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-700"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleStepSentence(1)}
              disabled={activeSentenceIdx >= lesson.sentences.length - 1}
              aria-label="Câu tiếp theo (thanh nhanh)"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-700 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] font-medium text-slate-600 tabular-nums">
              {activeSentenceIdx + 1}/{lesson.sentences.length}
            </span>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCycleSpeed}
              aria-label={`Đổi tốc độ phát (hiện tại ${speed}x)`}
              className="min-w-[44px] min-h-[44px] px-2 rounded-lg border border-slate-200 bg-slate-50 text-xs font-mono tabular-nums font-semibold text-[#0F2342]"
            >
              {speed}x
            </button>
          </div>
        </div>
      )}

      {/* DICTATION STAGE */}
      {stage === 'dictation' && (
        <section className="space-y-5">
          {/* Transcript hidden reminder */}
          <div className="bg-[#F2F6FC] border border-slate-200 rounded-xl px-4 py-3 text-xs text-[#0F2342] flex items-center justify-between gap-3">
            <span>{t(lang, 'transcriptHiddenNotice')}</span>
            <span className="font-mono tabular-nums shrink-0 text-slate-600">
              Tiến độ: {completedSentenceCount}/{lesson.sentences.length} câu
            </span>
          </div>

          {/* Sentence Navigator Strip in Sentence Mode */}
          {mode === 'sentence' && (
            <div className="flex flex-wrap gap-1.5" aria-label="Danh sách câu trong bài">
              {lesson.sentences.map((s, idx) => {
                const filled = (sentenceInputs[s.id] ?? '').trim().length > 0;
                const active = idx === activeSentenceIdx;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleSelectSentenceIndex(idx)}
                    aria-label={`Chọn câu ${idx + 1}`}
                    className={`min-w-[44px] min-h-[44px] rounded-lg text-xs font-mono tabular-nums font-medium border transition-colors ${
                      active
                        ? 'bg-[#0F2342] text-white border-[#0F2342]'
                        : filled
                          ? 'bg-[#E6F3F1] text-[#165B52] border-[#1F7A6E]/30'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          )}

          {/* Editor Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <label
                  htmlFor={
                    mode === 'sentence' && sentenceInputStyle === 'slots'
                      ? 'word-slot-0'
                      : 'dictation-editor'
                  }
                  className="text-sm font-semibold text-[#0F2342]"
                >
                  {mode === 'sentence'
                    ? `Chép lại câu ${activeSentenceIdx + 1} (${currentSentence.speaker})`
                    : 'Chép lại toàn bộ hội thoại tiếng Nga'}
                </label>

                {mode === 'sentence' && (
                  <div
                    className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
                    role="group"
                    aria-label="Kiểu nhập câu"
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectInputStyle('slots')}
                      className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        sentenceInputStyle === 'slots'
                          ? 'bg-white text-[#0F2342] shadow-sm'
                          : 'text-slate-600 hover:text-[#0F2342]'
                      }`}
                    >
                      Ô trống theo từ ({currentParsedSlots.wordCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectInputStyle('free')}
                      className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        sentenceInputStyle === 'free'
                          ? 'bg-white text-[#0F2342] shadow-sm'
                          : 'text-slate-600 hover:text-[#0F2342]'
                      }`}
                    >
                      Gõ tự do
                    </button>
                  </div>
                )}
              </div>

              <div className="text-xs text-slate-500 tabular-nums">
                {mode === 'sentence' && sentenceInputStyle === 'slots'
                  ? `Đã điền ${filledSlotCount}/${currentParsedSlots.wordCount} từ`
                  : `${wordCount} từ`}
                {draftSavedAt &&
                  ` · Đã lưu nháp lúc ${new Date(draftSavedAt).toLocaleTimeString('vi-VN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`}
              </div>
            </div>

            {mode === 'sentence' && sentenceInputStyle === 'slots' ? (
              <div className="space-y-3">
                <div
                  className="p-4 sm:p-5 rounded-xl border border-slate-200 bg-[#FAFCFF] flex flex-wrap items-center gap-x-2.5 gap-y-3"
                  role="group"
                  aria-label={`Các ô trống theo từ của câu ${activeSentenceIdx + 1}`}
                >
                  {slotRenderItems.map((item) => {
                    if (item.kind === 'inline_punct') {
                      return (
                        <span
                          key={item.key}
                          aria-hidden="true"
                          className="text-lg font-medium text-slate-500 select-none px-0.5"
                        >
                          {item.text}
                        </span>
                      );
                    }

                    const slotVal = currentSlotValues[item.wordIndex] ?? '';
                    const isFilled = slotVal.trim().length > 0;
                    const chWidth = Math.max(5.5, Math.min(20, item.charLength + 2.5));

                    return (
                      <span
                        key={`slot-${item.wordIndex}`}
                        className="inline-flex items-center gap-1 max-w-full"
                      >
                        {item.leadingPuncts.map((p, pIdx) => (
                          <span
                            key={`lp-${item.wordIndex}-${pIdx}`}
                            aria-hidden="true"
                            className="text-lg font-medium text-slate-500 select-none"
                          >
                            {p}
                          </span>
                        ))}

                        <input
                          id={`word-slot-${item.wordIndex}`}
                          ref={(el) => {
                            slotInputRefs.current[item.wordIndex] = el;
                          }}
                          type="text"
                          lang="ru"
                          spellCheck={false}
                          autoComplete="off"
                          autoCapitalize="off"
                          value={slotVal}
                          placeholder={`${item.wordIndex + 1}`}
                          aria-label={`Ô từ số ${item.wordIndex + 1} trên ${currentParsedSlots.wordCount}`}
                          style={{ width: `${chWidth}ch` }}
                          onFocus={(e) => {
                            activeSlotIndexRef.current = item.wordIndex;
                            scrollFieldIntoMobileView(e.currentTarget);
                          }}
                          onChange={(e) => {
                            const rawVal = e.target.value;
                            if (/\s/.test(rawVal)) {
                              const trimmed = rawVal.trim();
                              if (rawVal.endsWith(' ') && !/\s/.test(trimmed)) {
                                const nextSlots = [...currentSlotValues];
                                nextSlots[item.wordIndex] = trimmed;
                                updateSentenceSlots(
                                  currentSentence.id,
                                  currentParsedSlots,
                                  nextSlots,
                                );
                                if (item.wordIndex + 1 < currentParsedSlots.wordCount) {
                                  focusSlot(item.wordIndex + 1);
                                }
                                return;
                              }

                              const { nextValues, lastFilledIndex } = distributePastedText(
                                currentSlotValues,
                                item.wordIndex,
                                rawVal,
                              );
                              updateSentenceSlots(
                                currentSentence.id,
                                currentParsedSlots,
                                nextValues,
                              );
                              const nextTarget =
                                lastFilledIndex + 1 < currentParsedSlots.wordCount
                                  ? lastFilledIndex + 1
                                  : lastFilledIndex;
                              focusSlot(nextTarget);
                              return;
                            }

                            const nextSlots = [...currentSlotValues];
                            nextSlots[item.wordIndex] = rawVal;
                            updateSentenceSlots(
                              currentSentence.id,
                              currentParsedSlots,
                              nextSlots,
                            );
                          }}
                          onKeyDown={(e) => {
                            if (e.key === ' ' || e.key === 'Enter') {
                              e.preventDefault();
                              if (item.wordIndex + 1 < currentParsedSlots.wordCount) {
                                focusSlot(item.wordIndex + 1);
                              }
                            } else if (
                              e.key === 'Backspace' &&
                              slotVal === '' &&
                              item.wordIndex > 0
                            ) {
                              e.preventDefault();
                              focusSlot(item.wordIndex - 1, true);
                            } else if (
                              e.key === 'ArrowRight' &&
                              e.currentTarget.selectionStart === slotVal.length &&
                              item.wordIndex + 1 < currentParsedSlots.wordCount
                            ) {
                              e.preventDefault();
                              focusSlot(item.wordIndex + 1);
                            } else if (
                              e.key === 'ArrowLeft' &&
                              e.currentTarget.selectionStart === 0 &&
                              item.wordIndex > 0
                            ) {
                              e.preventDefault();
                              focusSlot(item.wordIndex - 1, true);
                            }
                          }}
                          onPaste={(e) => {
                            const pasted = e.clipboardData.getData('text');
                            if (/\s/.test(pasted)) {
                              e.preventDefault();
                              const { nextValues, lastFilledIndex } = distributePastedText(
                                currentSlotValues,
                                item.wordIndex,
                                pasted,
                              );
                              updateSentenceSlots(
                                currentSentence.id,
                                currentParsedSlots,
                                nextValues,
                              );
                              focusSlot(lastFilledIndex, true);
                            }
                          }}
                          className={`h-11 min-w-[64px] max-w-full px-2.5 scroll-mb-36 rounded-lg border text-center text-base sm:text-lg cyrillic-prose font-medium placeholder:text-slate-300 placeholder:text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[#0F2342]/20 focus:border-[#0F2342] ${
                            isFilled
                              ? 'border-[#1F7A6E]/50 bg-[#F2F9F8] text-[#0F2342]'
                              : 'border-slate-300 bg-white text-[#0F1E36]'
                          }`}
                        />

                        {item.trailingPuncts.map((p, pIdx) => (
                          <span
                            key={`tp-${item.wordIndex}-${pIdx}`}
                            aria-hidden="true"
                            className="text-lg font-medium text-slate-500 select-none"
                          >
                            {p}
                          </span>
                        ))}
                      </span>
                    );
                  })}
                </div>

                <p className="text-xs text-slate-500">
                  Mỗi ô trống tương ứng 1 từ trong câu. Nhấn Space hoặc Enter để sang ô tiếp theo · Dán nhiều từ sẽ tự điền lần lượt.
                </p>
              </div>
            ) : (
              <textarea
                id="dictation-editor"
                ref={editorRef}
                lang="ru"
                spellCheck={false}
                autoComplete="off"
                rows={mode === 'sentence' ? 4 : 6}
                value={activeTextValue}
                onFocus={(e) => scrollFieldIntoMobileView(e.currentTarget)}
                onChange={(e) => {
                  draftDirtyRef.current = true;
                  const val = e.target.value;
                  if (mode === 'sentence') {
                    setSentenceInputs((prev) => ({
                      ...prev,
                      [currentSentence.id]: val,
                    }));
                  } else {
                    setFullInput(val);
                  }
                }}
                placeholder={
                  mode === 'sentence'
                    ? 'Nhập nội dung tiếng Nga (Кириллица) bạn nghe được cho câu này...'
                    : 'Nhập toàn bộ hội thoại theo từng dòng hoặc từng câu...'
                }
                className="w-full p-4 scroll-mt-32 scroll-mb-24 min-h-[140px] sm:min-h-[220px] rounded-xl border border-slate-200 bg-[#FAFCFF] text-base sm:text-lg leading-relaxed cyrillic-prose text-[#0F1E36] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0F2342]/20 focus:border-[#0F2342]"
              />
            )}

            {/* Cyrillic Quick Keys */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-slate-500 mr-1 w-full sm:w-auto">Phím nhanh Cyrillic:</span>
                {CYRILLIC_HELPER_KEYS.map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertCyrillicChar(ch)}
                    className="min-w-[44px] min-h-[44px] px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-sm font-serif text-[#0F2342]"
                  >
                    {ch}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                {mode === 'sentence' && activeSentenceIdx < lesson.sentences.length - 1 && (
                  <button
                    type="button"
                    onClick={() => handleStepSentence(1)}
                    className="px-3.5 min-h-[44px] rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    Câu tiếp theo
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleSubmit}
                  className="inline-flex items-center justify-center gap-2 px-5 min-h-[44px] rounded-lg bg-[#0F2342] text-white text-sm font-semibold hover:bg-[#163059] transition-colors whitespace-nowrap"
                >
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  <span>{t(lang, 'submitAndAnalyze')}</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* POST-SUBMISSION ANALYSIS & STUDY TABS */}
      {stage === 'analysis' && analysisReport && (
        <section className="space-y-6">
          {/* Score Summary Banner */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-[#0F2342]">
                  Kết quả đối chiếu & Phân tích lỗi
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Lỗi dấu câu được chấm tách biệt và không làm giảm điểm nghe hiểu từ vựng.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleAddMistakesToVocabulary}
                  className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-lg bg-[#1F7A6E] text-white text-xs font-semibold hover:bg-[#165B52] transition-colors whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>Thêm các từ nghe sai vào Sổ tay từ vựng</span>
                </button>

                <button
                  type="button"
                  onClick={handleResetToDictation}
                  className="px-4 py-2 min-h-[44px] rounded-lg border border-slate-200 text-xs font-semibold text-[#0F2342] hover:bg-slate-50 whitespace-nowrap"
                >
                  Làm lại bài nghe chép
                </button>
              </div>
            </div>

            {addedMistakesNotice && (
              <div
                role="status"
                className="mt-4 p-3 rounded-xl bg-[#F2F9F8] border border-[#1F7A6E]/30 text-xs text-[#165B52] flex items-center justify-between gap-3"
              >
                <span>{addedMistakesNotice}</span>
                <button
                  type="button"
                  onClick={() => setAddedMistakesNotice(null)}
                  className="font-semibold underline"
                >
                  Đóng
                </button>
              </div>
            )}

            {!analysisReport.referenceAvailable ? (
              <p className="mt-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                Không có bản chép mẫu tham chiếu để tính độ chính xác nghe.
              </p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-5">
                <div>
                  <div className="text-xs text-slate-500">Chính xác khi nghe</div>
                  <div className="text-2xl font-bold text-[#0F2342] tabular-nums mt-1">
                    {analysisReport.listeningAccuracy}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Khớp từ vựng chính xác</div>
                  <div className="text-2xl font-bold text-[#0F2342] tabular-nums mt-1">
                    {analysisReport.lexicalAccuracy}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Chính tả & Ngữ pháp</div>
                  <div className="text-2xl font-bold text-[#1F7A6E] tabular-nums mt-1">
                    {analysisReport.spellingGrammarAccuracy}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Dấu câu (tách riêng)</div>
                  <div className="text-2xl font-bold text-slate-700 tabular-nums mt-1">
                    {analysisReport.punctuationAccuracy}%
                  </div>
                </div>
              </div>
            )}

            {/* Recommendations */}
            <div className="mt-5 pt-4 border-t border-slate-100 space-y-1.5">
              <div className="text-xs font-semibold text-[#0F2342]">
                Khuyến nghị luyện tập cá nhân hóa:
              </div>
              {analysisReport.recommendationsVi.map((rec, idx) => (
                <p key={idx} className="text-xs text-slate-600 leading-relaxed">
                  · {rec}
                </p>
              ))}
            </div>
          </div>

          {/* Study Tabs */}
          <div className="flex flex-wrap gap-1 p-1 bg-slate-100 rounded-lg w-full sm:w-fit">
            {(
              [
                ['errors', `Phân tích lỗi (${analysisReport.errors.length})`],
                ['vocabulary', `Từ vựng bài học (${lesson.vocabulary.length})`],
                ['grammar', `Ngữ pháp (${lesson.grammarNotes.length})`],
                ['comprehension', `Đọc hiểu (${lesson.comprehensionQuestions.length})`],
              ] as [StudyTab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStudyTab(key)}
                className={`px-3.5 py-2 min-h-[44px] text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  studyTab === key
                    ? 'bg-white text-[#0F2342] shadow-sm'
                    : 'text-slate-600 hover:text-[#0F2342]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* TAB 1: Error Analysis */}
          {studyTab === 'errors' && (
            <div className="space-y-4">
              {/* Error Category Summary Grid */}
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-[#0F2342] mb-3">
                  Phân loại lỗi chi tiết
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {(Object.keys(ERROR_CATEGORY_LABELS) as DictationErrorCategory[]).map(
                    (cat) => {
                      const count = analysisReport.errorCountsByCategory[cat] ?? 0;
                      return (
                        <div
                          key={cat}
                          className={`p-3 rounded-lg border ${
                            count > 0
                              ? 'border-slate-300 bg-[#FAFCFF]'
                              : 'border-slate-100 bg-slate-50/50'
                          }`}
                        >
                          <div className="text-[11px] text-slate-600">
                            {ERROR_CATEGORY_LABELS[cat].vi}
                          </div>
                          <div className="text-lg font-bold text-[#0F2342] tabular-nums mt-0.5">
                            {count}
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
              </div>

              {aiErrorMsg && (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
                  {aiErrorMsg}
                </div>
              )}

              {/* Sentence-by-Sentence Diff Cards */}
              {analysisReport.sentences.map((sent, idx) => (
                <article
                  key={sent.sentenceId}
                  className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-slate-500">
                      <span className="font-semibold text-[#0F2342]">
                        Câu {sent.order} · {sent.speaker}
                      </span>{' '}
                      · Nghe: <span className="tabular-nums font-medium">{sent.listeningAccuracy ?? 0}%</span> · Chính tả/NP:{' '}
                      <span className="tabular-nums font-medium">{sent.spellingGrammarAccuracy ?? 0}%</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void playSingleSentence(idx, false)}
                        className="inline-flex items-center gap-1 px-3 py-2 min-h-[44px] rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Nghe lại</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void handleAiDeepExplain(
                            sent.sentenceId,
                            sent.referenceText,
                            sent.learnerText,
                          )
                        }
                        disabled={aiLoadingId === sent.sentenceId}
                        className="inline-flex items-center gap-1 px-3 py-2 min-h-[44px] rounded-lg border border-slate-200 text-xs font-medium text-[#1E4178] hover:bg-[#F2F6FC] disabled:opacity-50"
                      >
                        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>
                          {aiLoadingId === sent.sentenceId
                            ? 'Đang phân tích...'
                            : 'Giải thích sâu AI'}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Highlighted word diff */}
                  <div className="space-y-2 text-sm">
                    <div>
                      <div className="text-xs font-medium text-slate-500 mb-1">
                        So sánh từng từ:
                      </div>
                      <div className="p-3 rounded-lg bg-[#F7F9FC] border border-slate-200 flex flex-wrap gap-1.5 cyrillic-prose text-base leading-relaxed">
                        {sent.tokens.map((tok, tIdx) => {
                          if (tok.type === 'match') {
                            return (
                              <span key={tIdx} className="text-[#165B52]">
                                {tok.referenceWord}
                              </span>
                            );
                          }
                          if (tok.type === 'missing') {
                            return (
                              <span
                                key={tIdx}
                                className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 text-sm"
                              >
                                [thiếu: {tok.referenceWord}]
                              </span>
                            );
                          }
                          if (tok.type === 'extra') {
                            return (
                              <span
                                key={tIdx}
                                className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 line-through text-sm"
                              >
                                {tok.learnerWord}
                              </span>
                            );
                          }
                          return (
                            <span
                              key={tIdx}
                              className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200 text-sm"
                            >
                              <span className="line-through text-red-700 mr-1">
                                {tok.learnerWord}
                              </span>
                              → <strong>{tok.referenceWord}</strong>
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                      <div>
                        <div className="text-xs font-medium text-slate-500">
                          Bài viết của bạn:
                        </div>
                        <p className="mt-1 text-sm text-slate-800 cyrillic-prose">
                          {sent.learnerText || '(Bỏ trống)'}
                        </p>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-[#165B52]">
                          Bản gốc chuẩn & sửa lỗi:
                        </div>
                        <p className="mt-1 text-sm font-medium text-[#0F2342] cyrillic-prose">
                          {sent.correctedText}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {lesson.sentences[idx]?.translationVi}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Error explanations in Vietnamese & Russian */}
                  {sent.errors.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      {sent.errors.map((err) => (
                        <div
                          key={err.id}
                          className="p-3 rounded-lg bg-[#FAFCFF] border border-slate-200 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-[#0F2342]">
                              {ERROR_CATEGORY_LABELS[err.category].vi} ({ERROR_CATEGORY_LABELS[err.category].ru})
                            </span>
                            <span className="text-slate-500">
                              Mức độ:{' '}
                              {err.severity === 'major'
                                ? 'Trọng tâm'
                                : err.severity === 'moderate'
                                  ? 'Trung bình'
                                  : 'Nhẹ'}
                            </span>
                          </div>
                          <p className="text-slate-700">{err.explanationVi}</p>
                          <p className="text-slate-600 cyrillic-prose italic">
                            {err.explanationRu}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Optional AI Deep Explanation */}
                  {aiExplanations[sent.sentenceId] && (
                    <div className="p-3.5 rounded-lg bg-[#F2F6FC] border border-slate-200 text-xs space-y-1.5">
                      <div className="font-semibold text-[#0F2342]">
                        Phân tích chuyên sâu từ AI
                      </div>
                      <p className="text-slate-700">
                        {aiExplanations[sent.sentenceId].summaryVi}
                      </p>
                      <p className="text-slate-600 cyrillic-prose italic">
                        {aiExplanations[sent.sentenceId].grammarTipRu}
                      </p>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}

          {/* TAB 2: Lesson Vocabulary */}
          {studyTab === 'vocabulary' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {lesson.vocabulary.map((item) => {
                const alreadySaved = savedWordsSet.has(item.word.toLowerCase());
                return (
                  <div
                    key={item.id}
                    className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-lg font-bold text-[#0F2342] cyrillic-prose">
                            {item.stressedWord}
                          </div>
                          <div className="text-xs text-slate-500">
                            {item.partOfSpeech} · {item.forms}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            void russianAudioEngine.playSentence({
                              text: item.word,
                              speaker: getDefaultRussianNarratorSpeaker('female'),
                              speed: 1,
                              preferServerTts:
                                profile.ttsPreference === 'auto' && capabilities.ttsAvailable && isOnline,
                              onError: (msg) => setAudioError(msg),
                            })
                          }
                          aria-label={`Nghe phát âm ${item.word}`}
                          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                        >
                          <Volume2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>

                      <div className="text-sm font-semibold text-[#1F7A6E]">
                        {item.meaningVi}
                      </div>
                      <p className="text-xs text-slate-700 cyrillic-prose">
                        {item.definitionRu}
                      </p>

                      <div className="pt-2 border-t border-slate-100 text-xs space-y-1">
                        <p className="text-[#0F2342] cyrillic-prose">{item.exampleRu}</p>
                        <p className="text-slate-600">{item.exampleVi}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={alreadySaved}
                      onClick={() => {
                        const added = saveLessonVocabulary(lesson, item);
                        if (added) setSavedNoticeId(item.id);
                      }}
                      className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-lg text-xs font-semibold transition-colors ${
                        alreadySaved
                          ? 'bg-[#E6F3F1] text-[#165B52] cursor-default'
                          : 'bg-[#0F2342] text-white hover:bg-[#163059]'
                      }`}
                    >
                      {alreadySaved ? (
                        <>
                          <BookmarkCheck className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>
                            {savedNoticeId === item.id ? 'Đã thêm vào sổ tay' : 'Đã lưu trong sổ tay'}
                          </span>
                        </>
                      ) : (
                        <>
                          <BookmarkPlus className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Lưu vào Sổ tay từ vựng</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 3: Grammar Notes */}
          {studyTab === 'grammar' && (
            <div className="space-y-4">
              {lesson.grammarNotes.map((note) => (
                <article
                  key={note.id}
                  className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
                >
                  <div>
                    <h3 className="text-base font-bold text-[#0F2342]">{note.titleVi}</h3>
                    <div className="text-xs text-slate-500 cyrillic-prose mt-0.5">
                      {note.titleRu}
                    </div>
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed">{note.explanationVi}</p>
                  <p className="text-xs text-slate-600 cyrillic-prose italic leading-relaxed">
                    {note.explanationRu}
                  </p>
                  <div className="pt-2 border-t border-slate-100 space-y-2">
                    {note.examples.map((ex, eIdx) => (
                      <div key={eIdx} className="text-xs">
                        <div className="font-medium text-[#0F2342] cyrillic-prose">{ex.ru}</div>
                        <div className="text-slate-600">{ex.vi}</div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}

          {/* TAB 4: Comprehension Quiz */}
          {studyTab === 'comprehension' && (
            <div className="space-y-4">
              {lesson.comprehensionQuestions.map((q, qIdx) => {
                const picked = quizAnswers[q.id];
                return (
                  <article
                    key={q.id}
                    className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
                  >
                    <div className="flex items-start gap-2">
                      <HelpCircle className="w-4 h-4 text-[#0F2342] mt-0.5 shrink-0" aria-hidden="true" />
                      <div>
                        <div className="text-sm font-semibold text-[#0F2342] cyrillic-prose">
                          {qIdx + 1}. {q.questionRu}
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5">{q.questionVi}</div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {q.options.map((opt, oIdx) => {
                        const isPicked = picked === oIdx;
                        const isCorrect = oIdx === q.correctIndex;
                        return (
                          <button
                            key={oIdx}
                            type="button"
                            onClick={() =>
                              setQuizAnswers((prev) => ({ ...prev, [q.id]: oIdx }))
                            }
                            className={`w-full min-h-[44px] text-left px-3.5 py-2.5 rounded-lg border text-sm cyrillic-prose transition-colors ${
                              picked === undefined
                                ? 'border-slate-200 hover:bg-slate-50'
                                : isCorrect
                                  ? 'border-[#1F7A6E] bg-[#E6F3F1] text-[#165B52] font-medium'
                                  : isPicked
                                    ? 'border-red-300 bg-red-50 text-red-800'
                                    : 'border-slate-200 text-slate-500'
                            }`}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>

                    {picked !== undefined && (
                      <p className="text-xs text-slate-700 bg-[#F7F9FC] rounded-lg px-3 py-2 border border-slate-200">
                        {picked === q.correctIndex ? 'Chính xác! ' : 'Chưa đúng. '}
                        {q.explanationVi}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
