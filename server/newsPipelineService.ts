import type {
  CefrLevel,
  Lesson,
  NewsArticle,
  NewsFormat,
  NewsPipelineRunSummary,
  NewsPipelineStatusResponse,
} from '../src/types/domain.ts';
import { canonicalizeNewsUrl, selectDailyPipelineStories } from '../src/utils/newsFeedUtils.ts';
import {
  concatenateWavSegments,
  ensureWavBuffer,
  parseWavBuffer,
  splitWavIntoSentenceSegments,
} from '../src/utils/wavAudioUtils.ts';
import { stripStressMarks } from '../src/utils/transcriptDiff.ts';
import {
  classifyGeminiError,
  getRecentGeminiMonitoringEvents,
  globalTtsQueue,
  recordGeminiMonitoringEvent,
  type GeminiErrorCategory,
} from './geminiQuotaManager.ts';
import { generateNewsDictationLesson, isGeminiConfigured } from './geminiService.ts';
import {
  computeLessonAudioConfigHash,
  finishPipelineRun,
  getExistingNewsLessonForArticleLevel,
  getFullyProcessedStoryIdentifiers,
  getNewsLessonByIdFromDb,
  getPipelineDbStatusSnapshot,
  hasAnyNewsLessonsForDate,
  hasCompletedPipelineRunForDate,
  hasValidLessonAudioOnDisk,
  logPipelineError,
  markStaleRunningPipelineRunsFailed,
  recordPipelineRunStart,
  saveLessonAudioFilesToDisk,
  saveNewsLessonWithSegments,
  upsertNewsArticles,
} from './newsPipelineDb.ts';
import { fetchDailyNewsArticles } from './newsRssService.ts';
import {
  CONFIGURED_TTS_MODEL,
  TtsQuotaError,
  ttsProvider,
  type TtsProvider,
} from './ttsProvider.ts';

const ALL_CEFR_LEVELS: readonly CefrLevel[] = ['B1', 'B2', 'C1', 'C2'];
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let pipelineRunning = false;
let nextScheduledRunAt = new Date(Date.now() + DAILY_INTERVAL_MS).toISOString();

export interface SynthesizeLessonAudioResult {
  lesson: Lesson;
  segmentsSaved: number;
  error: string | null;
  errorCategory: GeminiErrorCategory;
  reusedFromCache: boolean;
  queueState: 'completed' | 'failed';
}

export interface GenerateSingleNewsLessonResult {
  lesson: Lesson;
  audioError: string | null;
  audioErrorCategory: GeminiErrorCategory;
  reusedFromCache: boolean;
  queueState: 'completed' | 'failed';
}

const inFlightAudioJobs = new Map<string, Promise<SynthesizeLessonAudioResult>>();
const inFlightLessonGenerations = new Map<string, Promise<GenerateSingleNewsLessonResult>>();

function buildArticleStubFromLesson(lesson: Lesson): NewsArticle {
  const meta = lesson.newsMetadata!;
  return {
    id: meta.articleId,
    title: meta.originalTitle,
    summarySnippet: meta.verifiedFactsSummaryVi,
    sourceName: meta.sourceName,
    sourceLanguage: 'ru',
    articleUrl: meta.articleUrl,
    publishedAt: meta.publishedAt,
    publishedDateKey: meta.publishedAt.slice(0, 10),
    topic: meta.newsTopic,
  };
}

export async function synthesizeAndSplitLessonAudio(
  lesson: Lesson,
  runId: string | null,
  options: {
    forceRegenerate?: boolean;
    bypassDailyCooldown?: boolean;
    providerOverride?: TtsProvider;
    skipDbPersistence?: boolean;
  } = {},
): Promise<SynthesizeLessonAudioResult> {
  const activeProvider = options.providerOverride ?? ttsProvider;
  const activeModel = activeProvider.name || CONFIGURED_TTS_MODEL;
  const audioConfigHash = computeLessonAudioConfigHash(lesson, activeModel);
  const hasValidDiskAudio = hasValidLessonAudioOnDisk(lesson);
  const configMatches =
    !lesson.newsMetadata?.audioConfigHash || lesson.newsMetadata.audioConfigHash === audioConfigHash;

  // Reuse existing valid audio for the same lesson + audio config unless forceRegenerate is explicitly requested
  if (
    !options.forceRegenerate &&
    hasValidDiskAudio &&
    lesson.newsMetadata?.audioStatus === 'ready' &&
    configMatches
  ) {
    recordGeminiMonitoringEvent({
      requestType: lesson.speakers.length === 2 ? 'tts_dialogue' : 'tts_single',
      model: activeModel,
      lessonId: lesson.id,
      cefrLevel: lesson.level,
      httpStatus: 200,
      errorCategory: 'none',
      retryCount: 0,
      queueWaitMs: 0,
      processingDurationMs: 0,
      reusedFromCache: true,
      outcome: 'completed',
      retryAfterMs: null,
      quotaId: null,
    });
    return {
      lesson: {
        ...lesson,
        newsMetadata: lesson.newsMetadata
          ? {
              ...lesson.newsMetadata,
              audioConfigHash,
              audioError: null,
              audioErrorCategory: 'none',
              audioQueueState: 'completed',
            }
          : undefined,
      },
      segmentsSaved: lesson.sentences.length,
      error: null,
      errorCategory: 'none',
      reusedFromCache: true,
      queueState: 'completed',
    };
  }

  // Prevent multiple workers or repeated clicks from generating audio for the SAME lesson simultaneously
  const inFlightKey = `${lesson.id}::${options.forceRegenerate ? 'force' : 'normal'}`;
  const existingJob = inFlightAudioJobs.get(inFlightKey);
  if (existingJob) {
    return existingJob;
  }

  const jobPromise = (async (): Promise<SynthesizeLessonAudioResult> => {
    if (!activeProvider.isAvailable()) {
      const errMsg = 'Chưa cấu hình GEMINI_API_KEY trên máy chủ để tạo audio TTS.';
      if (hasValidDiskAudio) {
        return {
          lesson,
          segmentsSaved: 0,
          error: errMsg,
          errorCategory: 'auth_error',
          reusedFromCache: false,
          queueState: 'failed',
        };
      }
      return {
        lesson: {
          ...lesson,
          newsMetadata: lesson.newsMetadata
            ? {
                ...lesson.newsMetadata,
                fullAudioUrl: null,
                audioStatus: 'failed',
                audioError: errMsg,
                audioErrorCategory: 'auth_error',
                audioQueueState: 'failed',
                audioSegmentsCount: 0,
              }
            : undefined,
        },
        segmentsSaved: 0,
        error: errMsg,
        errorCategory: 'auth_error',
        reusedFromCache: false,
        queueState: 'failed',
      };
    }

    try {
      const topicLabel = lesson.newsMetadata?.newsTopic ?? lesson.topic;

      if (lesson.speakers.length === 2 && lesson.sentences.length > 0) {
        // Synthesize whole 2-speaker news dialogue in 1 queued Gemini TTS call, then split into per-sentence WAV segments
        const ttsResult = await activeProvider.synthesizeDialogue({
          lessonId: lesson.id,
          cefrLevel: lesson.level,
          topic: topicLabel,
          forceRegenerate: options.forceRegenerate,
          bypassDailyCooldown: options.bypassDailyCooldown,
          speakers: lesson.speakers.map((sp) => ({
            speaker: sp.name,
            voiceName: sp.voiceName,
            gender: sp.gender,
            role: sp.roleEn || sp.roleVi,
          })),
          turns: lesson.sentences.map((s) => ({
            speaker: s.speaker,
            text: s.text,
          })),
        });

        const rawBytes = Buffer.from(ttsResult.audioBase64, 'base64');
        const fullWav = ensureWavBuffer(rawBytes, 24000);
        if (fullWav.length <= 44) {
          throw new Error('Synthesized dialogue WAV buffer is empty.');
        }

        const parsedFull = parseWavBuffer(fullWav);
        const weights = lesson.sentences.map((s) =>
          Math.max(2, stripStressMarks(s.text).trim().split(/\s+/).length),
        );
        const segments = splitWavIntoSentenceSegments(fullWav, weights);
        if (segments.length !== lesson.sentences.length) {
          throw new Error(
            `Expected ${lesson.sentences.length} WAV segments but produced ${segments.length}.`,
          );
        }

        const saved = saveLessonAudioFilesToDisk(
          lesson.id,
          fullWav,
          segments.map((seg, idx) => ({
            order: lesson.sentences[idx].order,
            wav: seg.segmentWav,
          })),
        );

        const updatedSentences = lesson.sentences.map((s, idx) => {
          const segTiming = segments[idx];
          const segMeta = saved.segmentUrls.get(s.order);
          return {
            ...s,
            startSec: segTiming?.startSec ?? s.startSec,
            endSec: segTiming?.endSec ?? s.endSec,
            audioUrl: segMeta?.audioUrl ?? null,
          };
        });

        const segmentFilePaths = new Map<number, string>();
        saved.segmentUrls.forEach((v, order) => segmentFilePaths.set(order, v.filePath));

        const updatedLesson: Lesson = {
          ...lesson,
          durationSec: Math.max(20, Math.round(parsedFull.durationSec)),
          sentences: updatedSentences,
          newsMetadata: lesson.newsMetadata
            ? {
                ...lesson.newsMetadata,
                fullAudioUrl: saved.fullAudioUrl,
                audioStatus: 'ready',
                audioError: null,
                audioErrorCategory: 'none',
                audioConfigHash,
                audioQueueState: 'completed',
                audioSegmentsCount: segments.length,
              }
            : undefined,
        };

        const persisted =
          !options.skipDbPersistence && lesson.newsMetadata
            ? saveNewsLessonWithSegments(
                buildArticleStubFromLesson(lesson),
                updatedLesson,
                segmentFilePaths,
              )
            : updatedLesson;

        return {
          lesson: persisted,
          segmentsSaved: segments.length,
          error: null,
          errorCategory: 'none',
          reusedFromCache: Boolean(ttsResult.cached),
          queueState: 'completed',
        };
      }

      // 1-speaker summary format: synthesize each sentence sequentially through the 1-concurrency TTS queue and stitch full.wav
      const primarySpeaker = lesson.speakers[0];
      const segWavs: { order: number; wav: Buffer }[] = [];
      let allReused = lesson.sentences.length > 0;

      for (let i = 0; i < lesson.sentences.length; i += 1) {
        const s = lesson.sentences[i];
        const prev = i > 0 ? lesson.sentences[i - 1] : undefined;
        const singleRes = await activeProvider.synthesize({
          lessonId: `${lesson.id}-s${s.order}`,
          cefrLevel: lesson.level,
          text: s.text,
          voiceName: primarySpeaker?.voiceName,
          gender: primarySpeaker?.gender,
          speakerRole: primarySpeaker?.roleEn || primarySpeaker?.roleVi,
          topic: topicLabel,
          previousSpeaker: prev?.speaker,
          previousText: prev?.text,
          forceRegenerate: options.forceRegenerate,
          bypassDailyCooldown: options.bypassDailyCooldown,
        });
        if (!singleRes.cached) allReused = false;
        const wavBuf = ensureWavBuffer(Buffer.from(singleRes.audioBase64, 'base64'), 24000);
        if (wavBuf.length <= 44) {
          throw new Error(`Synthesized sentence ${s.order} WAV buffer is empty.`);
        }
        segWavs.push({ order: s.order, wav: wavBuf });
      }

      const stitched = concatenateWavSegments(
        segWavs.map((x) => x.wav),
        280,
      );
      const saved = saveLessonAudioFilesToDisk(lesson.id, stitched.fullWav, segWavs);
      const segmentFilePaths = new Map<number, string>();
      saved.segmentUrls.forEach((v, order) => segmentFilePaths.set(order, v.filePath));

      const updatedSentences = lesson.sentences.map((s, idx) => ({
        ...s,
        startSec: stitched.timings[idx]?.startSec ?? s.startSec,
        endSec: stitched.timings[idx]?.endSec ?? s.endSec,
        audioUrl: saved.segmentUrls.get(s.order)?.audioUrl ?? null,
      }));

      const updatedLesson: Lesson = {
        ...lesson,
        durationSec: Math.max(20, Math.round(stitched.totalDurationSec)),
        sentences: updatedSentences,
        newsMetadata: lesson.newsMetadata
          ? {
              ...lesson.newsMetadata,
              fullAudioUrl: saved.fullAudioUrl,
              audioStatus: 'ready',
              audioError: null,
              audioErrorCategory: 'none',
              audioConfigHash,
              audioQueueState: 'completed',
              audioSegmentsCount: segWavs.length,
            }
          : undefined,
      };

      const persisted =
        !options.skipDbPersistence && lesson.newsMetadata
          ? saveNewsLessonWithSegments(
              buildArticleStubFromLesson(lesson),
              updatedLesson,
              segmentFilePaths,
            )
          : updatedLesson;

      return {
        lesson: persisted,
        segmentsSaved: segWavs.length,
        error: null,
        errorCategory: 'none',
        reusedFromCache: allReused,
        queueState: 'completed',
      };
    } catch (err) {
      const classified = err instanceof TtsQuotaError ? err.classified : classifyGeminiError(err);
      const retryCount = err instanceof TtsQuotaError ? err.retryCount : 0;
      const errMsg = classified.userMessageVi;

      if (!options.skipDbPersistence) {
        logPipelineError({
          runId,
          stage: 'audio_tts',
          targetRef: lesson.id,
          errorMessage: `[${classified.category}] ${errMsg}`,
          retryCount,
        });
      }

      // CRITICAL: Never overwrite existing valid audio on disk with failed or empty audio!
      if (hasValidDiskAudio) {
        return {
          lesson,
          segmentsSaved: 0,
          error: errMsg,
          errorCategory: classified.category,
          reusedFromCache: false,
          queueState: 'failed',
        };
      }

      // Preserve all lesson text, vocabulary, grammar, and comprehension questions intact
      const failedLesson: Lesson = {
        ...lesson,
        sentences: lesson.sentences.map((s) => ({ ...s, audioUrl: null })),
        newsMetadata: lesson.newsMetadata
          ? {
              ...lesson.newsMetadata,
              fullAudioUrl: null,
              audioStatus: 'failed',
              audioError: errMsg,
              audioErrorCategory: classified.category,
              audioQueueState: 'failed',
              audioSegmentsCount: 0,
            }
          : undefined,
      };

      if (!options.skipDbPersistence && lesson.newsMetadata) {
        const persistedFailed = saveNewsLessonWithSegments(
          buildArticleStubFromLesson(lesson),
          failedLesson,
        );
        return {
          lesson: persistedFailed,
          segmentsSaved: 0,
          error: errMsg,
          errorCategory: classified.category,
          reusedFromCache: false,
          queueState: 'failed',
        };
      }
      return {
        lesson: failedLesson,
        segmentsSaved: 0,
        error: errMsg,
        errorCategory: classified.category,
        reusedFromCache: false,
        queueState: 'failed',
      };
    }
  })();

  inFlightAudioJobs.set(inFlightKey, jobPromise);
  jobPromise.finally(() => {
    if (inFlightAudioJobs.get(inFlightKey) === jobPromise) {
      inFlightAudioJobs.delete(inFlightKey);
    }
  });

  return jobPromise;
}

export async function runDailyNewsPipeline(options: {
  triggerType: 'scheduled' | 'manual' | 'startup';
  maxStories?: number;
  forceRefresh?: boolean;
  levels?: CefrLevel[];
  format?: NewsFormat;
}): Promise<{
  alreadyRunning?: boolean;
  runSummary: NewsPipelineRunSummary | null;
  lessons: Lesson[];
}> {
  if (pipelineRunning) {
    const status = getNewsPipelineStatus();
    return {
      alreadyRunning: true,
      runSummary: status.lastRun,
      lessons: [],
    };
  }

  pipelineRunning = true;
  const runDateKey = new Date().toISOString().slice(0, 10);
  const runId = recordPipelineRunStart(options.triggerType, runDateKey);
  const maxStories = Math.min(3, Math.max(1, options.maxStories ?? 1));
  const targetLevels = options.levels && options.levels.length > 0 ? options.levels : ALL_CEFR_LEVELS;
  const format: NewsFormat = options.format === 'summary' ? 'summary' : 'dialogue';

  let storiesFetched = 0;
  let duplicatesRemoved = 0;
  let storiesSelected = 0;
  let lessonsGenerated = 0;
  let audioSegmentsSaved = 0;
  const errors: string[] = [];
  const producedLessons: Lesson[] = [];
  let ttsDailyQuotaExhaustedInRun = globalTtsQueue.isDailyQuotaBlocked();
  let textDailyQuotaExhaustedInRun = false;

  try {
    const feed = await fetchDailyNewsArticles(Boolean(options.forceRefresh));
    storiesFetched = feed.articles.length;
    duplicatesRemoved = feed.duplicatesRemoved;

    for (const failedFeed of feed.failedDetails) {
      logPipelineError({
        runId,
        stage: 'rss_fetch',
        targetRef: failedFeed.sourceName,
        errorMessage: failedFeed.error,
        retryCount: 1,
      });
    }

    if (feed.articles.length === 0) {
      const msg = 'Không lấy được bản tin hợp lệ nào từ các nguồn RSS.';
      errors.push(msg);
      logPipelineError({ runId, stage: 'rss_fetch', errorMessage: msg });
      const summary = finishPipelineRun(runId, {
        status: 'failed',
        storiesFetched: 0,
        duplicatesRemoved,
        storiesSelected: 0,
        lessonsGenerated: 0,
        audioSegmentsSaved: 0,
        errorSummary: msg,
      });
      return { runSummary: summary, lessons: [] };
    }

    const storedArticles = upsertNewsArticles(feed.articles);
    const processedSet = getFullyProcessedStoryIdentifiers();
    const selectedStories = selectDailyPipelineStories(storedArticles, processedSet, maxStories);
    storiesSelected = selectedStories.length;

    if (selectedStories.length === 0) {
      const summary = finishPipelineRun(runId, {
        status: 'completed',
        storiesFetched,
        duplicatesRemoved,
        storiesSelected: 0,
        lessonsGenerated: 0,
        audioSegmentsSaved: 0,
        errorSummary: null,
      });
      return { runSummary: summary, lessons: [] };
    }

    if (!isGeminiConfigured()) {
      const msg = 'Chưa cấu hình GEMINI_API_KEY để tạo nội dung bài học từ tin tức.';
      errors.push(msg);
      logPipelineError({ runId, stage: 'lesson_generation', errorMessage: msg });
      const summary = finishPipelineRun(runId, {
        status: 'failed',
        storiesFetched,
        duplicatesRemoved,
        storiesSelected,
        lessonsGenerated: 0,
        audioSegmentsSaved: 0,
        errorSummary: msg,
      });
      return { runSummary: summary, lessons: [] };
    }

    for (const story of selectedStories) {
      for (const level of targetLevels) {
        try {
          const existing = getExistingNewsLessonForArticleLevel(story.id, level, format);
          if (
            existing &&
            existing.newsMetadata?.audioStatus === 'ready' &&
            hasValidLessonAudioOnDisk(existing)
          ) {
            producedLessons.push(existing);
            continue;
          }

          let baseLesson: Lesson;
          if (existing) {
            // Reuse existing generated text; never regenerate text unnecessarily when only audio needs retry
            baseLesson = existing;
          } else {
            if (textDailyQuotaExhaustedInRun) {
              errors.push(`${level}: Đã tạm dừng tạo văn bản vì chạm hạn mức ngày của Gemini API.`);
              continue;
            }
            baseLesson = await generateNewsDictationLesson({
              article: story,
              level,
              format,
              pipelineDateKey: runDateKey,
            });
            baseLesson = saveNewsLessonWithSegments(story, {
              ...baseLesson,
              newsMetadata: baseLesson.newsMetadata
                ? {
                    ...baseLesson.newsMetadata,
                    audioStatus: 'pending',
                    audioError: null,
                    audioErrorCategory: 'none',
                    audioQueueState: 'queued',
                    audioSegmentsCount: 0,
                    pipelineDateKey: runDateKey,
                  }
                : undefined,
            });
            lessonsGenerated += 1;
          }

          if (ttsDailyQuotaExhaustedInRun) {
            const quotaMsg =
              'Hạn mức ngày (Daily Quota) của Gemini TTS đã hết. Văn bản bài học đã được lưu nguyên vẹn; hãy nhấn Thử tạo lại audio sau khi hạn mức được làm mới.';
            const persistedTextOnly = saveNewsLessonWithSegments(story, {
              ...baseLesson,
              newsMetadata: baseLesson.newsMetadata
                ? {
                    ...baseLesson.newsMetadata,
                    audioStatus: 'failed',
                    audioError: quotaMsg,
                    audioErrorCategory: 'daily_quota_exhausted',
                    audioQueueState: 'failed',
                    audioSegmentsCount: 0,
                  }
                : undefined,
            });
            producedLessons.push(persistedTextOnly);
            errors.push(`${level}: [daily_quota_exhausted] ${quotaMsg}`);
            continue;
          }

          const audioRes = await synthesizeAndSplitLessonAudio(baseLesson, runId);
          producedLessons.push(audioRes.lesson);
          audioSegmentsSaved += audioRes.segmentsSaved;
          if (audioRes.error) {
            errors.push(`${level}: ${audioRes.error}`);
            if (audioRes.errorCategory === 'daily_quota_exhausted') {
              ttsDailyQuotaExhaustedInRun = true;
            }
          }
        } catch (err) {
          const classified = classifyGeminiError(err);
          const errMsg = `${story.title.slice(0, 40)} (${level}): [${classified.category}] ${classified.userMessageVi}`;
          errors.push(errMsg);
          logPipelineError({
            runId,
            stage: 'lesson_generation',
            targetRef: `${story.id}:${level}`,
            errorMessage: errMsg,
            retryCount: 0,
          });
          if (classified.category === 'daily_quota_exhausted') {
            textDailyQuotaExhaustedInRun = true;
          }
        }
      }
    }

    const finalStatus =
      lessonsGenerated === 0 && producedLessons.length === 0
        ? 'failed'
        : errors.length > 0
          ? 'partial'
          : 'completed';

    const summary = finishPipelineRun(runId, {
      status: finalStatus,
      storiesFetched,
      duplicatesRemoved,
      storiesSelected,
      lessonsGenerated,
      audioSegmentsSaved,
      errorSummary: errors.length > 0 ? errors.slice(0, 3).join(' | ') : null,
    });

    return { runSummary: summary, lessons: producedLessons };
  } catch (err) {
    const classified = classifyGeminiError(err);
    const errMsg = `[${classified.category}] ${classified.userMessageVi}`;
    logPipelineError({ runId, stage: 'pipeline', errorMessage: errMsg });
    const summary = finishPipelineRun(runId, {
      status: 'failed',
      storiesFetched,
      duplicatesRemoved,
      storiesSelected,
      lessonsGenerated,
      audioSegmentsSaved,
      errorSummary: errMsg,
    });
    return { runSummary: summary, lessons: producedLessons };
  } finally {
    pipelineRunning = false;
  }
}

export async function generateAndPersistSingleNewsLesson(input: {
  article: NewsArticle;
  level: CefrLevel;
  format: NewsFormat;
}): Promise<GenerateSingleNewsLessonResult> {
  const stored = upsertNewsArticles([input.article])[0] ?? input.article;
  const dedupeKey = `${canonicalizeNewsUrl(stored.articleUrl)}::${input.level}::${input.format}`;

  // Coalesce repeated clicks or concurrent requests for the same article + level + format
  const existingInFlight = inFlightLessonGenerations.get(dedupeKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const work = (async (): Promise<GenerateSingleNewsLessonResult> => {
    const existing = getExistingNewsLessonForArticleLevel(stored.id, input.level, input.format);
    if (
      existing &&
      existing.newsMetadata?.audioStatus === 'ready' &&
      hasValidLessonAudioOnDisk(existing)
    ) {
      return {
        lesson: existing,
        audioError: null,
        audioErrorCategory: 'none',
        reusedFromCache: true,
        queueState: 'completed',
      };
    }

    // Separate text generation from TTS: if text already exists, skip regenerating text!
    let baseLesson = existing;
    if (!baseLesson) {
      baseLesson = await generateNewsDictationLesson({
        article: stored,
        level: input.level,
        format: input.format,
        pipelineDateKey: new Date().toISOString().slice(0, 10),
      });
      baseLesson = saveNewsLessonWithSegments(stored, {
        ...baseLesson,
        newsMetadata: baseLesson.newsMetadata
          ? {
              ...baseLesson.newsMetadata,
              audioStatus: 'pending',
              audioError: null,
              audioErrorCategory: 'none',
              audioQueueState: 'queued',
              audioSegmentsCount: 0,
            }
          : undefined,
      });
    }

    const audioRes = await synthesizeAndSplitLessonAudio(baseLesson, null);
    return {
      lesson: audioRes.lesson,
      audioError: audioRes.error,
      audioErrorCategory: audioRes.errorCategory,
      reusedFromCache: audioRes.reusedFromCache,
      queueState: audioRes.queueState,
    };
  })();

  inFlightLessonGenerations.set(dedupeKey, work);
  work.finally(() => {
    if (inFlightLessonGenerations.get(dedupeKey) === work) {
      inFlightLessonGenerations.delete(dedupeKey);
    }
  });

  return work;
}

export async function retryLessonAudioGeneration(
  lessonId: string,
  options: { force?: boolean } = {},
): Promise<{
  lesson: Lesson | null;
  error: string | null;
  errorCategory: GeminiErrorCategory;
  reusedFromCache: boolean;
  queueState: 'completed' | 'failed';
}> {
  const existing = getNewsLessonByIdFromDb(lessonId);
  if (!existing) {
    return {
      lesson: null,
      error: 'Không tìm thấy bài học tin tức trong cơ sở dữ liệu.',
      errorCategory: 'invalid_request',
      reusedFromCache: false,
      queueState: 'failed',
    };
  }
  const res = await synthesizeAndSplitLessonAudio(existing, null, {
    forceRegenerate: Boolean(options.force),
    // Explicit user retry is allowed to test whether daily quota has reset
    bypassDailyCooldown: true,
  });
  return {
    lesson: res.lesson,
    error: res.error,
    errorCategory: res.errorCategory,
    reusedFromCache: res.reusedFromCache,
    queueState: res.queueState,
  };
}

export function getNewsPipelineStatus(): NewsPipelineStatusResponse {
  const snapshot = getPipelineDbStatusSnapshot({
    schedulerActive: schedulerTimer !== null,
    running: pipelineRunning,
    intervalHours: 24,
    nextScheduledRunAt,
  });
  return {
    ...snapshot,
    ttsQueue: globalTtsQueue.getSnapshot(),
    recentMonitoring: getRecentGeminiMonitoringEvents(20),
  };
}

export function startDailyNewsScheduler(): void {
  markStaleRunningPipelineRunsFailed();

  if (schedulerTimer !== null) return;

  nextScheduledRunAt = new Date(Date.now() + DAILY_INTERVAL_MS).toISOString();
  schedulerTimer = setInterval(() => {
    nextScheduledRunAt = new Date(Date.now() + DAILY_INTERVAL_MS).toISOString();
    void runDailyNewsPipeline({
      triggerType: 'scheduled',
      maxStories: 1,
      forceRefresh: true,
    });
  }, DAILY_INTERVAL_MS);

  if (typeof schedulerTimer.unref === 'function') {
    schedulerTimer.unref();
  }

  if (process.env.DISABLE_AUTO_NEWS_STARTUP !== '1' && !startupTimer) {
    startupTimer = setTimeout(() => {
      startupTimer = null;
      const todayKey = new Date().toISOString().slice(0, 10);
      if (
        isGeminiConfigured() &&
        !hasCompletedPipelineRunForDate(todayKey) &&
        !hasAnyNewsLessonsForDate(todayKey)
      ) {
        void runDailyNewsPipeline({
          triggerType: 'startup',
          maxStories: 1,
          forceRefresh: true,
        });
      }
    }, 6000);
    if (typeof startupTimer.unref === 'function') {
      startupTimer.unref();
    }
  }
}
