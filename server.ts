import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyGeminiError,
  getRecentGeminiMonitoringEvents,
  globalTtsQueue,
} from './server/geminiQuotaManager.ts';
import {
  CONFIGURED_TEXT_MODEL,
  explainDictationMistakesWithAi,
  generateRussianLesson,
  isGeminiConfigured,
  verifyGeminiModelMetadata,
} from './server/geminiService.ts';
import {
  listNewsLessonsFromDb,
  resolveSafeAudioFilePath,
} from './server/newsPipelineDb.ts';
import {
  generateAndPersistSingleNewsLesson,
  getNewsPipelineStatus,
  retryLessonAudioGeneration,
  runDailyNewsPipeline,
  startDailyNewsScheduler,
} from './server/newsPipelineService.ts';
import { fetchDailyNewsArticles } from './server/newsRssService.ts';
import {
  CONFIGURED_TTS_MODEL,
  SECONDARY_FREE_TTS_MODEL,
  TtsQuotaError,
  getTtsCacheStats,
  ttsProvider,
} from './server/ttsProvider.ts';
import {
  generateTtsQaSamples,
  listTtsQaSamples,
  resolveSafeQaAudioPath,
} from './server/ttsQaSuite.ts';
import type {
  CefrLevel,
  GeminiVoiceId,
  NewsTopicCategory,
  TopicCategory,
  TtsModelId,
  VoiceAgeStyle,
  VoiceSpeakingStyle,
} from './src/types/domain.ts';
import {
  RUSSIAN_VOICE_REGISTRY,
  isValidGeminiVoiceId,
} from './src/utils/voiceRegistry.ts';
import {
  filterNewsArticles,
  parseVerifiedRssDate,
  sanitizeExternalUrl,
  truncateCopyrightSafeSnippet,
} from './src/utils/newsFeedUtils.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_LEVELS = new Set<CefrLevel>(['B1', 'B2', 'C1', 'C2']);
const ALLOWED_TOPICS = new Set<TopicCategory>([
  'everyday',
  'work',
  'education',
  'psychology',
  'economics',
  'society',
  'politics',
  'science',
  'environment',
  'relationships',
]);

function sendClassifiedUpstreamError(
  res: express.Response,
  err: unknown,
  errorCode: string,
  fallbackMessage: string,
): void {
  const classified = err instanceof TtsQuotaError ? err.classified : classifyGeminiError(err);
  let status = 502;
  if (classified.category === 'rate_limit_temporary' || classified.category === 'daily_quota_exhausted') {
    status = 429;
  } else if (classified.category === 'timeout') {
    status = 504;
  } else if (classified.category === 'server_overloaded' || classified.category === 'auth_error') {
    status = 503;
  } else if (classified.category === 'invalid_request') {
    status = 400;
  }

  if (status === 429 && classified.retryAfterMs && classified.retryAfterMs > 0) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil(classified.retryAfterMs / 1000))));
  }

  res.status(status).json({
    error: errorCode,
    errorCategory: classified.category,
    retryAfterMs: classified.retryAfterMs,
    message: classified.category === 'unknown' ? fallbackMessage : classified.userMessageVi,
  });
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  startDailyNewsScheduler();

  app.get('/api/health', (_req, res) => {
    const geminiConfigured = isGeminiConfigured();
    const supabaseConfigured = Boolean(
      process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY,
    );
    const cacheStats = getTtsCacheStats();
    res.json({
      status: 'ok',
      geminiConfigured,
      textModel: CONFIGURED_TEXT_MODEL,
      ttsAvailable: ttsProvider.isAvailable(),
      ttsProvider: CONFIGURED_TTS_MODEL,
      secondaryTtsModel: SECONDARY_FREE_TTS_MODEL,
      freeTierOnly: true,
      ttsCacheStats: cacheStats,
      supabaseConfigured,
      mode: geminiConfigured || supabaseConfigured ? 'hybrid' : 'demo',
    });
  });

  app.get('/api/gemini/quota-status', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const verifyModels = req.query.verifyModels === '1';
    const base = {
      configured: isGeminiConfigured(),
      freeTierOnly: true,
      textModel: CONFIGURED_TEXT_MODEL,
      ttsModel: CONFIGURED_TTS_MODEL,
      secondaryTtsModel: SECONDARY_FREE_TTS_MODEL,
      ttsCacheStats: getTtsCacheStats(),
      ttsQueue: globalTtsQueue.getSnapshot(),
      recentMonitoring: getRecentGeminiMonitoringEvents(30),
    };

    if (!verifyModels) {
      res.json(base);
      return;
    }

    const [textVerification, primaryTtsVerification, secondaryTtsVerification] = await Promise.all([
      verifyGeminiModelMetadata(CONFIGURED_TEXT_MODEL),
      verifyGeminiModelMetadata(CONFIGURED_TTS_MODEL),
      verifyGeminiModelMetadata(SECONDARY_FREE_TTS_MODEL),
    ]);

    res.json({
      ...base,
      modelVerification: {
        text: textVerification,
        tts: primaryTtsVerification,
        ttsSecondary: secondaryTtsVerification,
      },
    });
  });

  app.get('/api/tts/voices', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      provider: 'gemini-tts',
      primaryModel: CONFIGURED_TTS_MODEL,
      secondaryModel: SECONDARY_FREE_TTS_MODEL,
      freeTierOnly: true,
      locale: 'ru-RU',
      voices: Object.values(RUSSIAN_VOICE_REGISTRY),
      cacheStats: getTtsCacheStats(),
    });
  });

  app.get('/api/tts/qa/samples', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const payload = listTtsQaSamples();
    res.json({
      ...payload,
      primaryModel: CONFIGURED_TTS_MODEL,
      secondaryModel: SECONDARY_FREE_TTS_MODEL,
      cacheStats: getTtsCacheStats(),
      ttsQueue: globalTtsQueue.getSnapshot(),
    });
  });

  app.post('/api/tts/qa/generate', async (req, res) => {
    if (!ttsProvider.isAvailable()) {
      res.status(503).json({
        error: 'TTS_NOT_CONFIGURED',
        message: 'Chưa cấu hình GEMINI_API_KEY trên máy chủ.',
      });
      return;
    }
    const { sampleIds, force, maxCount } = req.body ?? {};
    const validIds = Array.isArray(sampleIds)
      ? sampleIds.filter((x: unknown): x is string => typeof x === 'string').slice(0, 35)
      : undefined;
    try {
      const outcome = await generateTtsQaSamples({
        sampleIds: validIds,
        force: Boolean(force),
        maxCount:
          typeof maxCount === 'number' && Number.isFinite(maxCount)
            ? Math.min(35, Math.max(1, Math.floor(maxCount)))
            : undefined,
      });
      res.json({
        ...outcome,
        cacheStats: getTtsCacheStats(),
        qa: listTtsQaSamples(),
      });
    } catch (err) {
      sendClassifiedUpstreamError(
        res,
        err,
        'QA_GENERATION_FAILED',
        'Không thể tạo mẫu kiểm thử âm thanh lúc này.',
      );
    }
  });

  app.get('/api/tts/qa/audio/:sampleId', (req, res) => {
    const filePath = resolveSafeQaAudioPath(req.params.sampleId);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'QA_AUDIO_NOT_FOUND', message: 'Mẫu âm thanh chưa được tạo.' });
      return;
    }
    const stat = fs.statSync(filePath);
    const total = stat.size;
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
        return;
      }
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(total - 1, Number(match[2])) : total - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', String(end - start + 1));
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.setHeader('Content-Length', String(total));
    fs.createReadStream(filePath).pipe(res);
  });

  function normalizeSupabaseUrl(raw: string | undefined): string | null {
    const trimmed = raw?.trim().replace(/\/+$/, '');
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^[a-z0-9-]+$/i.test(trimmed)) {
      return `https://${trimmed}.supabase.co`;
    }
    return `https://${trimmed}`;
  }

  // Public Supabase runtime config for browser client (returns ONLY public URL and anon key, never service_role key)
  app.get('/api/supabase/public-config', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const url = normalizeSupabaseUrl(process.env.VITE_SUPABASE_URL);
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim() || null;
    const configured = Boolean(url && anonKey);
    res.json({
      configured,
      url: configured ? url : null,
      anonKey: configured ? anonKey : null,
    });
  });

  // Server-side schema check using service role key when available (never exposes keys or user rows)
  app.get('/api/supabase/schema-status', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const url = normalizeSupabaseUrl(process.env.VITE_SUPABASE_URL);
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

    if (!url || !anonKey) {
      res.json({
        configured: false,
        reachable: false,
        schemaReady: false,
        missingTables: [],
        error: 'SUPABASE_NOT_CONFIGURED',
      });
      return;
    }

    const expectedTables = [
      'learner_profiles',
      'lessons',
      'saved_lessons',
      'dictation_drafts',
      'dictation_attempts',
      'vocabulary',
      'vocabulary_review_logs',
      'daily_activity',
    ];

    const checkKey = serviceRoleKey || anonKey;
    const missingTables: string[] = [];
    let reachable = false;
    let firstError: string | null = null;

    try {
      const checks = await Promise.all(
        expectedTables.map(async (table) => {
          const response = await fetch(`${url}/rest/v1/${table}?limit=0`, {
            method: 'GET',
            headers: {
              apikey: checkKey,
              Authorization: `Bearer ${checkKey}`,
            },
          });
          reachable = true;
          // 200 (service role / accessible) or 401/403 (table exists but anon RLS blocks) means table exists
          if (response.status === 404) {
            return { table, exists: false };
          }
          if (!response.ok) {
            const body = await response.text().catch(() => '');
            if (body.includes('PGRST205') || body.includes('Could not find the table')) {
              return { table, exists: false };
            }
            if (response.status !== 401 && response.status !== 403 && !firstError) {
              firstError = `HTTP ${response.status}`;
            }
          }
          return { table, exists: true };
        }),
      );

      for (const item of checks) {
        if (!item.exists) missingTables.push(item.table);
      }

      res.json({
        configured: true,
        reachable,
        schemaReady: reachable && missingTables.length === 0 && !firstError,
        missingTables,
        error: firstError,
      });
    } catch (err) {
      res.json({
        configured: true,
        reachable: false,
        schemaReady: false,
        missingTables: expectedTables,
        error: err instanceof Error ? err.message : 'NETWORK_ERROR',
      });
    }
  });

  app.post('/api/lessons/generate', async (req, res) => {
    if (!isGeminiConfigured()) {
      res.status(503).json({
        error: 'GEMINI_NOT_CONFIGURED',
        message:
          'Chưa cấu hình GEMINI_API_KEY trên máy chủ. Bạn vẫn có thể sử dụng toàn bộ kho bài chuẩn và chế độ Demo cục bộ.',
      });
      return;
    }

    const { level, topic, length, speakersCount, difficulty, vocabFocus, grammarFocus } =
      req.body ?? {};

    if (!ALLOWED_LEVELS.has(level)) {
      res.status(400).json({ error: 'INVALID_LEVEL', message: 'Invalid CEFR level.' });
      return;
    }
    if (!ALLOWED_TOPICS.has(topic)) {
      res.status(400).json({ error: 'INVALID_TOPIC', message: 'Invalid topic.' });
      return;
    }

    try {
      const lesson = await generateRussianLesson({
        level,
        topic,
        length: length === 'short' || length === 'extended' ? length : 'standard',
        speakersCount: speakersCount === 3 ? 3 : 2,
        difficulty:
          difficulty === 'accessible' || difficulty === 'challenging'
            ? difficulty
            : 'standard',
        vocabFocus: typeof vocabFocus === 'string' ? vocabFocus.slice(0, 120) : undefined,
        grammarFocus:
          typeof grammarFocus === 'string' ? grammarFocus.slice(0, 120) : undefined,
      });
      res.json({ lesson });
    } catch (err) {
      sendClassifiedUpstreamError(
        res,
        err,
        'GENERATION_FAILED',
        'Không thể tạo bài học AI vào lúc này.',
      );
    }
  });

  const ALLOWED_NEWS_TOPICS = new Set<NewsTopicCategory>([
    'world_economy',
    'international_politics',
    'european_economy_politics',
    'business_finance',
    'technology',
    'geopolitics',
    'energy_environment',
  ]);

  app.get('/api/news', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const forceRefresh = req.query.refresh === '1';
      const feed = await fetchDailyNewsArticles(forceRefresh);

      const topicParam = typeof req.query.topic === 'string' ? req.query.topic : 'ALL';
      const dateParam = typeof req.query.date === 'string' ? req.query.date : 'ALL';
      const searchParam = typeof req.query.q === 'string' ? req.query.q : '';

      const validTopic: 'ALL' | NewsTopicCategory =
        topicParam !== 'ALL' && ALLOWED_NEWS_TOPICS.has(topicParam as NewsTopicCategory)
          ? (topicParam as NewsTopicCategory)
          : 'ALL';

      const availableDates = Array.from(
        new Set(feed.articles.map((a) => a.publishedDateKey)),
      ).sort((a, b) => b.localeCompare(a));

      const filtered = filterNewsArticles(feed.articles, {
        topic: validTopic,
        dateFilter: dateParam,
        search: searchParam,
      });

      res.json({
        articles: filtered,
        totalFetched: feed.articles.length,
        duplicatesRemoved: feed.duplicatesRemoved,
        availableDates,
        fetchedAt: feed.fetchedAt,
        sourcesUsed: feed.sourcesUsed,
        failedSources: feed.failedSources,
        fromCache: feed.fromCache,
      });
    } catch (err) {
      res.status(502).json({
        error: 'NEWS_FETCH_FAILED',
        message:
          err instanceof Error
            ? err.message
            : 'Không thể tải nguồn tin RSS vào lúc này.',
      });
    }
  });

  app.get('/api/news/lessons', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const levelParam = typeof req.query.level === 'string' ? req.query.level : 'ALL';
    const topicParam = typeof req.query.topic === 'string' ? req.query.topic : 'ALL';
    const dateParam = typeof req.query.date === 'string' ? req.query.date : '';
    const qParam = typeof req.query.q === 'string' ? req.query.q : '';

    const validLevel: 'ALL' | CefrLevel =
      levelParam !== 'ALL' && ALLOWED_LEVELS.has(levelParam as CefrLevel)
        ? (levelParam as CefrLevel)
        : 'ALL';
    const validTopic: 'ALL' | NewsTopicCategory =
      topicParam !== 'ALL' && ALLOWED_NEWS_TOPICS.has(topicParam as NewsTopicCategory)
        ? (topicParam as NewsTopicCategory)
        : 'ALL';

    const lessons = listNewsLessonsFromDb({
      level: validLevel,
      topic: validTopic,
      date: dateParam,
      search: qParam,
      limit: 120,
    });
    res.json({ lessons });
  });

  app.get('/api/news/pipeline/status', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(getNewsPipelineStatus());
  });

  app.post('/api/news/pipeline/run', async (req, res) => {
    const { maxStories, levels, format } = req.body ?? {};
    const validLevels = Array.isArray(levels)
      ? levels.filter((lvl): lvl is CefrLevel => ALLOWED_LEVELS.has(lvl))
      : undefined;

    try {
      const result = await runDailyNewsPipeline({
        triggerType: 'manual',
        maxStories: typeof maxStories === 'number' ? maxStories : 1,
        forceRefresh: true,
        levels: validLevels && validLevels.length > 0 ? validLevels : undefined,
        format: format === 'summary' ? 'summary' : 'dialogue',
      });
      res.json({
        ...result,
        status: getNewsPipelineStatus(),
      });
    } catch (err) {
      res.status(500).json({
        error: 'PIPELINE_RUN_FAILED',
        message: err instanceof Error ? err.message : 'Không thể chạy quy trình cập nhật tin tức.',
        status: getNewsPipelineStatus(),
      });
    }
  });

  app.post('/api/news/pipeline/retry-audio/:lessonId', async (req, res) => {
    const { lessonId } = req.params;
    const force = Boolean(req.body?.force);
    const result = await retryLessonAudioGeneration(lessonId, { force });
    if (!result.lesson) {
      res.status(404).json({
        error: 'LESSON_NOT_FOUND',
        message: result.error ?? 'Không tìm thấy bài học.',
      });
      return;
    }
    res.json({
      ...result,
      ttsQueue: globalTtsQueue.getSnapshot(),
    });
  });

  app.get('/api/news/audio/:lessonId/:filename', (req, res) => {
    const filePath = resolveSafeAudioFilePath(req.params.lessonId, req.params.filename);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'AUDIO_NOT_FOUND', message: 'Không tìm thấy tệp âm thanh.' });
      return;
    }

    const stat = fs.statSync(filePath);
    const total = stat.size;
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
        return;
      }
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(total - 1, Number(match[2])) : total - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', String(end - start + 1));
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.setHeader('Content-Length', String(total));
    fs.createReadStream(filePath).pipe(res);
  });

  app.post('/api/news/generate-lesson', async (req, res) => {
    if (!isGeminiConfigured()) {
      res.status(503).json({
        error: 'GEMINI_NOT_CONFIGURED',
        message:
          'Chưa cấu hình GEMINI_API_KEY trên máy chủ. Vui lòng thêm GEMINI_API_KEY để chuyển tin tức thành bài học nghe chép AI.',
      });
      return;
    }

    const { article, level, format } = req.body ?? {};
    if (!ALLOWED_LEVELS.has(level)) {
      res.status(400).json({ error: 'INVALID_LEVEL', message: 'Invalid CEFR level.' });
      return;
    }

    const cleanUrl = sanitizeExternalUrl(article?.articleUrl);
    const verifiedDate = parseVerifiedRssDate(article?.publishedAt);
    const title = typeof article?.title === 'string' ? article.title.trim().slice(0, 300) : '';
    const sourceName =
      typeof article?.sourceName === 'string' ? article.sourceName.trim().slice(0, 120) : '';
    const topic: NewsTopicCategory = ALLOWED_NEWS_TOPICS.has(article?.topic)
      ? article.topic
      : 'world_economy';

    if (!cleanUrl || !verifiedDate || !title || !sourceName) {
      res.status(400).json({
        error: 'INVALID_ARTICLE',
        message:
          'Bài báo thiếu tiêu đề, nguồn gốc, đường dẫn hợp lệ hoặc ngày xuất bản xác thực.',
      });
      return;
    }

    try {
      const result = await generateAndPersistSingleNewsLesson({
        article: {
          id: typeof article.id === 'string' ? article.id.slice(0, 80) : `news-${Date.now()}`,
          title,
          summarySnippet: truncateCopyrightSafeSnippet(
            typeof article.summarySnippet === 'string' ? article.summarySnippet : '',
            420,
          ),
          sourceName,
          sourceLanguage: article.sourceLanguage === 'ru' ? 'ru' : 'en',
          articleUrl: cleanUrl,
          publishedAt: verifiedDate.iso,
          publishedDateKey: verifiedDate.dateKey,
          topic,
        },
        level,
        format: format === 'summary' ? 'summary' : 'dialogue',
      });
      res.json({
        lesson: result.lesson,
        audioError: result.audioError,
        audioErrorCategory: result.audioErrorCategory,
        reusedFromCache: result.reusedFromCache,
        queueState: result.queueState,
        ttsQueue: globalTtsQueue.getSnapshot(),
      });
    } catch (err) {
      sendClassifiedUpstreamError(
        res,
        err,
        'NEWS_GENERATION_FAILED',
        'Không thể chuyển tin tức thành bài học nghe chép vào lúc này.',
      );
    }
  });

  app.post('/api/analysis/explain', async (req, res) => {
    if (!isGeminiConfigured()) {
      res.status(503).json({
        error: 'GEMINI_NOT_CONFIGURED',
        message: 'Chưa cấu hình GEMINI_API_KEY trên máy chủ.',
      });
      return;
    }

    const { referenceText, learnerText, level } = req.body ?? {};
    if (
      typeof referenceText !== 'string' ||
      typeof learnerText !== 'string' ||
      !referenceText.trim()
    ) {
      res.status(400).json({ error: 'INVALID_INPUT', message: 'Missing sentence texts.' });
      return;
    }

    try {
      const explanation = await explainDictationMistakesWithAi({
        referenceText: referenceText.slice(0, 800),
        learnerText: learnerText.slice(0, 800),
        level: ALLOWED_LEVELS.has(level) ? level : 'B1',
      });
      res.json(explanation);
    } catch (err) {
      sendClassifiedUpstreamError(
        res,
        err,
        'EXPLANATION_FAILED',
        'Không thể lấy phân tích AI vào lúc này.',
      );
    }
  });

  app.post('/api/tts/synthesize', async (req, res) => {
    if (!ttsProvider.isAvailable()) {
      res.status(503).json({
        error: 'TTS_NOT_CONFIGURED',
        errorCategory: 'auth_error',
        message: 'Server Gemini TTS chưa được cấu hình GEMINI_API_KEY.',
      });
      return;
    }

    const {
      text,
      voiceName,
      gender,
      ageStyle,
      speakingStyle,
      speakingRate,
      emotion,
      speakerRole,
      topic,
      previousSpeaker,
      previousText,
      style,
      modelOverride,
      lessonId,
      cefrLevel,
    } = req.body ?? {};
    if (typeof text !== 'string' || !text.trim() || text.length > 1200) {
      res.status(400).json({ error: 'INVALID_TEXT', message: 'Invalid TTS text length.' });
      return;
    }

    const safeAgeStyle: VoiceAgeStyle | undefined =
      ageStyle === 'young' || ageStyle === 'mature' ? ageStyle : undefined;
    const safeSpeakingStyle: VoiceSpeakingStyle | undefined =
      speakingStyle === 'conversational' ||
      speakingStyle === 'narration' ||
      speakingStyle === 'educational'
        ? speakingStyle
        : undefined;
    const safeModelOverride: TtsModelId | undefined =
      modelOverride === 'gemini-3.8-flash-lite-tts' || modelOverride === 'gemini-3.8-flash-tts'
        ? modelOverride
        : undefined;

    try {
      const result = await ttsProvider.synthesize({
        text,
        voiceName: isValidGeminiVoiceId(voiceName) ? voiceName : undefined,
        gender: gender === 'female' || gender === 'male' ? gender : undefined,
        ageStyle: safeAgeStyle,
        speakingStyle: safeSpeakingStyle,
        speakingRate:
          typeof speakingRate === 'number' && Number.isFinite(speakingRate)
            ? speakingRate
            : undefined,
        emotion: typeof emotion === 'string' ? emotion.slice(0, 40) : undefined,
        speakerRole: typeof speakerRole === 'string' ? speakerRole.slice(0, 100) : undefined,
        topic: typeof topic === 'string' ? topic.slice(0, 80) : undefined,
        previousSpeaker:
          typeof previousSpeaker === 'string' ? previousSpeaker.slice(0, 60) : undefined,
        previousText:
          typeof previousText === 'string' ? previousText.slice(0, 200) : undefined,
        style: typeof style === 'string' ? style.slice(0, 160) : undefined,
        modelOverride: safeModelOverride,
        lessonId: typeof lessonId === 'string' ? lessonId.slice(0, 96) : undefined,
        cefrLevel: ALLOWED_LEVELS.has(cefrLevel) ? cefrLevel : undefined,
      });
      res.json(result);
    } catch (err) {
      sendClassifiedUpstreamError(res, err, 'TTS_FAILED', 'TTS synthesis failed.');
    }
  });

  app.post('/api/tts/synthesize-dialogue', async (req, res) => {
    if (!ttsProvider.isAvailable()) {
      res.status(503).json({
        error: 'TTS_NOT_CONFIGURED',
        errorCategory: 'auth_error',
        message: 'Server Gemini TTS chưa được cấu hình GEMINI_API_KEY.',
      });
      return;
    }

    const { speakers, turns, topic, lessonId, cefrLevel, modelOverride } = req.body ?? {};
    if (
      !Array.isArray(speakers) ||
      speakers.length < 1 ||
      speakers.length > 6 ||
      !Array.isArray(turns) ||
      turns.length === 0 ||
      turns.length > 24
    ) {
      res.status(400).json({
        error: 'INVALID_DIALOGUE',
        message: 'Dialogue TTS requires 1–6 speakers and 1–24 turns.',
      });
      return;
    }

    const safeModelOverride: TtsModelId | undefined =
      modelOverride === 'gemini-3.8-flash-lite-tts' || modelOverride === 'gemini-3.8-flash-tts'
        ? modelOverride
        : undefined;

    try {
      const result = await ttsProvider.synthesizeDialogue({
        speakers: speakers.map((sp: Record<string, unknown>) => ({
          speaker: String(sp.speaker ?? '').slice(0, 60),
          voiceName: isValidGeminiVoiceId(sp.voiceName) ? (sp.voiceName as GeminiVoiceId) : undefined,
          gender: sp.gender === 'female' ? 'female' : 'male',
          ageStyle:
            sp.ageStyle === 'young' || sp.ageStyle === 'mature' ? sp.ageStyle : undefined,
          speakingStyle:
            sp.speakingStyle === 'conversational' ||
            sp.speakingStyle === 'narration' ||
            sp.speakingStyle === 'educational'
              ? sp.speakingStyle
              : undefined,
          speakingRate:
            typeof sp.speakingRate === 'number' && Number.isFinite(sp.speakingRate)
              ? sp.speakingRate
              : undefined,
          emotion: typeof sp.emotion === 'string' ? sp.emotion.slice(0, 40) : undefined,
          role: typeof sp.role === 'string' ? sp.role.slice(0, 100) : undefined,
        })),
        turns: turns.map((t: Record<string, unknown>) => ({
          speaker: String(t.speaker ?? '').slice(0, 60),
          text: String(t.text ?? '').slice(0, 600),
        })),
        topic: typeof topic === 'string' ? topic.slice(0, 80) : undefined,
        modelOverride: safeModelOverride,
        lessonId: typeof lessonId === 'string' ? lessonId.slice(0, 96) : undefined,
        cefrLevel: ALLOWED_LEVELS.has(cefrLevel) ? cefrLevel : undefined,
      });
      res.json(result);
    } catch (err) {
      sendClassifiedUpstreamError(
        res,
        err,
        'DIALOGUE_TTS_FAILED',
        'Dialogue TTS synthesis failed.',
      );
    }
  });

  app.use(
    (
      err: Error & { status?: number; type?: string },
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (res.headersSent) {
        next(err);
        return;
      }
      if (err instanceof SyntaxError && (err.status === 400 || err.type === 'entity.parse.failed')) {
        res.status(400).json({ error: 'INVALID_JSON', message: 'Malformed JSON request body.' });
        return;
      }
      if (err.type === 'entity.too.large' || err.status === 413) {
        res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', message: 'Request payload exceeds limit.' });
        return;
      }
      res.status(err.status ?? 500).json({ error: 'INTERNAL_ERROR', message: 'Unexpected server error.' });
    },
  );

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });
    app.get('/@vite/client', async (_req, res, next) => {
      try {
        const result = await vite.transformRequest('/@vite/client');
        if (!result?.code) {
          next();
          return;
        }
        const patched = result.code.replace(
          /const transport = normalizeModuleRunnerTransport\(\(\(\) => \{[\s\S]*?\}\)\(\)\);/,
          'const transport = normalizeModuleRunnerTransport({ async connect() {}, async disconnect() {}, send() {} });',
        );
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.send(patched);
      } catch (err) {
        next(err);
      }
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`RUSSIAN DICTATION server running on http://0.0.0.0:${port}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
