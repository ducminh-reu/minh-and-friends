import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  CefrLevel,
  Lesson,
  NewsArticle,
  NewsFormat,
  NewsPipelineErrorItem,
  NewsPipelineRunSummary,
  NewsPipelineStatusResponse,
  NewsTopicCategory,
} from '../src/types/domain.ts';
import {
  canonicalizeNewsUrl,
  normalizeHeadlineFingerprint,
} from '../src/utils/newsFeedUtils.ts';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const DB_PATH = path.join(DATA_DIR, 'news_pipeline.db');
const AUDIO_ROOT = path.join(DATA_DIR, 'news-audio');

let dbInstance: DatabaseSync | null = null;

function ensureDirectories(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(AUDIO_ROOT, { recursive: true });
}

export function getNewsPipelineDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  ensureDirectories();
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS news_articles (
      id TEXT PRIMARY KEY,
      canonical_url TEXT NOT NULL UNIQUE,
      headline_fingerprint TEXT NOT NULL,
      title TEXT NOT NULL,
      summary_snippet TEXT NOT NULL DEFAULT '',
      source_name TEXT NOT NULL,
      source_language TEXT NOT NULL,
      article_url TEXT NOT NULL,
      published_at TEXT NOT NULL,
      published_date_key TEXT NOT NULL,
      topic TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_news_articles_date
      ON news_articles(published_date_key DESC);
    CREATE INDEX IF NOT EXISTS idx_news_articles_fp
      ON news_articles(headline_fingerprint);

    CREATE TABLE IF NOT EXISTS news_lessons (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      cefr_level TEXT NOT NULL CHECK (cefr_level IN ('B1', 'B2', 'C1', 'C2')),
      format TEXT NOT NULL CHECK (format IN ('summary', 'dialogue')),
      title_ru TEXT NOT NULL,
      title_vi TEXT NOT NULL,
      educational_summary_ru TEXT NOT NULL DEFAULT '',
      educational_summary_vi TEXT NOT NULL DEFAULT '',
      published_at TEXT NOT NULL,
      published_date_key TEXT NOT NULL,
      pipeline_date_key TEXT NOT NULL,
      source_name TEXT NOT NULL,
      article_url TEXT NOT NULL,
      news_topic TEXT NOT NULL,
      full_audio_url TEXT,
      audio_status TEXT NOT NULL DEFAULT 'pending',
      audio_error TEXT,
      audio_segments_count INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (article_id, cefr_level, format),
      FOREIGN KEY (article_id) REFERENCES news_articles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_news_lessons_level
      ON news_lessons(cefr_level, published_date_key DESC);
    CREATE INDEX IF NOT EXISTS idx_news_lessons_created
      ON news_lessons(created_at DESC);

    CREATE TABLE IF NOT EXISTS news_audio_segments (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL,
      sentence_id TEXT NOT NULL,
      sentence_order INTEGER NOT NULL,
      speaker TEXT NOT NULL,
      transcript_ru TEXT NOT NULL,
      translation_vi TEXT NOT NULL,
      start_sec REAL NOT NULL,
      end_sec REAL NOT NULL,
      audio_url TEXT,
      file_path TEXT,
      duration_sec REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (lesson_id, sentence_order),
      FOREIGN KEY (lesson_id) REFERENCES news_lessons(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS news_pipeline_runs (
      id TEXT PRIMARY KEY,
      trigger_type TEXT NOT NULL,
      run_date_key TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      stories_fetched INTEGER NOT NULL DEFAULT 0,
      duplicates_removed INTEGER NOT NULL DEFAULT 0,
      stories_selected INTEGER NOT NULL DEFAULT 0,
      lessons_generated INTEGER NOT NULL DEFAULT 0,
      audio_segments_saved INTEGER NOT NULL DEFAULT 0,
      error_summary TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_news_runs_started
      ON news_pipeline_runs(started_at DESC);

    CREATE TABLE IF NOT EXISTS news_pipeline_errors (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      stage TEXT NOT NULL,
      target_ref TEXT,
      error_message TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_news_errors_created
      ON news_pipeline_errors(created_at DESC);
  `);

  dbInstance = db;
  return db;
}

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{4,96}$/;
const SAFE_AUDIO_FILENAME_RE = /^(full|s-\d{1,3})\.wav$/;

export function resolveSafeAudioFilePath(lessonId: string, filename: string): string | null {
  if (!SAFE_ID_RE.test(lessonId) || !SAFE_AUDIO_FILENAME_RE.test(filename)) {
    return null;
  }
  const lessonDir = path.resolve(AUDIO_ROOT, lessonId);
  if (!lessonDir.startsWith(AUDIO_ROOT + path.sep)) {
    return null;
  }
  const fullPath = path.resolve(lessonDir, filename);
  if (!fullPath.startsWith(lessonDir + path.sep)) {
    return null;
  }
  return fullPath;
}

const MIN_VALID_WAV_BYTES = 45;

export function isValidWavBuffer(buf: Buffer | null | undefined): boolean {
  if (!buf || buf.length < MIN_VALID_WAV_BYTES) return false;
  return buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WAVE';
}

function writeFileAtomically(targetPath: string, data: Buffer): void {
  const tempPath = `${targetPath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(tempPath, data);
    fs.renameSync(tempPath, targetPath);
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // Ignore cleanup failure
    }
    throw err;
  }
}

export function computeLessonAudioConfigHash(lesson: Lesson, ttsModel: string): string {
  const payload = JSON.stringify({
    v: 1,
    lessonId: lesson.id,
    ttsModel,
    speakers: lesson.speakers.map((s) => ({
      name: s.name.normalize('NFC').replace(/\u0301/g, '').trim(),
      voiceName: s.voiceName,
      gender: s.gender,
    })),
    sentences: lesson.sentences.map((s) => ({
      order: s.order,
      speaker: s.speaker.normalize('NFC').replace(/\u0301/g, '').trim(),
      text: s.text.normalize('NFC').replace(/\u0301/g, '').trim(),
    })),
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
}

export function hasValidLessonAudioOnDisk(lesson: Lesson): boolean {
  if (!SAFE_ID_RE.test(lesson.id) || lesson.sentences.length === 0) return false;
  if (!lesson.newsMetadata?.fullAudioUrl) return false;

  const fullPath = resolveSafeAudioFilePath(lesson.id, 'full.wav');
  if (!fullPath || !fs.existsSync(fullPath)) return false;
  try {
    const fullStat = fs.statSync(fullPath);
    if (fullStat.size < MIN_VALID_WAV_BYTES) return false;
  } catch {
    return false;
  }

  for (const s of lesson.sentences) {
    const segPath = resolveSafeAudioFilePath(lesson.id, `s-${s.order}.wav`);
    if (!segPath || !fs.existsSync(segPath)) return false;
    try {
      const segStat = fs.statSync(segPath);
      if (segStat.size < MIN_VALID_WAV_BYTES) return false;
    } catch {
      return false;
    }
  }

  return true;
}

export function saveLessonAudioFilesToDisk(
  lessonId: string,
  fullWav: Buffer,
  segmentWavs: { order: number; wav: Buffer }[],
): {
  fullAudioUrl: string;
  segmentUrls: Map<number, { audioUrl: string; filePath: string }>;
} {
  if (!SAFE_ID_RE.test(lessonId)) {
    throw new Error('Invalid lessonId for audio storage.');
  }
  if (!isValidWavBuffer(fullWav)) {
    throw new Error('Refusing to save invalid or empty full WAV buffer.');
  }
  if (segmentWavs.length === 0) {
    throw new Error('Refusing to save empty sentence audio segment list.');
  }
  for (const seg of segmentWavs) {
    if (!isValidWavBuffer(seg.wav)) {
      throw new Error(`Refusing to save invalid or empty WAV buffer for segment ${seg.order}.`);
    }
  }

  const lessonDir = path.resolve(AUDIO_ROOT, lessonId);
  if (!lessonDir.startsWith(AUDIO_ROOT + path.sep)) {
    throw new Error('Unsafe audio directory path.');
  }
  fs.mkdirSync(lessonDir, { recursive: true });

  const fullPath = resolveSafeAudioFilePath(lessonId, 'full.wav');
  if (!fullPath) throw new Error('Invalid full.wav path.');
  writeFileAtomically(fullPath, fullWav);

  const segmentUrls = new Map<number, { audioUrl: string; filePath: string }>();
  for (const seg of segmentWavs) {
    const filename = `s-${seg.order}.wav`;
    const segPath = resolveSafeAudioFilePath(lessonId, filename);
    if (!segPath) throw new Error(`Invalid segment path: ${filename}`);
    writeFileAtomically(segPath, seg.wav);
    segmentUrls.set(seg.order, {
      audioUrl: `/api/news/audio/${encodeURIComponent(lessonId)}/${filename}`,
      filePath: segPath,
    });
  }

  return {
    fullAudioUrl: `/api/news/audio/${encodeURIComponent(lessonId)}/full.wav`,
    segmentUrls,
  };
}

function getSupabaseAdminConfig(): { url: string; serviceKey: string } | null {
  const rawUrl = process.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!rawUrl || !serviceKey) return null;
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  return { url, serviceKey };
}

async function mirrorToSupabaseBestEffort(
  table: string,
  onConflict: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;
  const cfg = getSupabaseAdminConfig();
  if (!cfg) return;
  try {
    await fetch(
      `${cfg.url}/rest/v1/${encodeURIComponent(table)}?on_conflict=${encodeURIComponent(onConflict)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: cfg.serviceKey,
          Authorization: `Bearer ${cfg.serviceKey}`,
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(rows),
        signal: AbortSignal.timeout(4500),
      },
    );
  } catch {
    // Non-blocking mirror: SQLite remains authoritative even if remote Supabase tables aren't migrated yet.
  }
}

export function upsertNewsArticles(articles: NewsArticle[]): NewsArticle[] {
  const db = getNewsPipelineDb();
  const nowIso = new Date().toISOString();
  const selectByCanonical = db.prepare(
    'SELECT id FROM news_articles WHERE canonical_url = ? LIMIT 1',
  );
  const insertStmt = db.prepare(`
    INSERT INTO news_articles (
      id, canonical_url, headline_fingerprint, title, summary_snippet,
      source_name, source_language, article_url, published_at, published_date_key,
      topic, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_url) DO UPDATE SET
      title = excluded.title,
      summary_snippet = CASE
        WHEN length(excluded.summary_snippet) > length(news_articles.summary_snippet)
        THEN excluded.summary_snippet
        ELSE news_articles.summary_snippet
      END,
      fetched_at = excluded.fetched_at
  `);

  const normalizedArticles: NewsArticle[] = [];
  const mirrorRows: Record<string, unknown>[] = [];

  for (const art of articles) {
    const canonical = canonicalizeNewsUrl(art.articleUrl);
    const fingerprint = normalizeHeadlineFingerprint(art.title);
    const existing = selectByCanonical.get(canonical) as { id: string } | undefined;
    const stableId = existing?.id ?? art.id;

    insertStmt.run(
      stableId,
      canonical,
      fingerprint,
      art.title,
      art.summarySnippet,
      art.sourceName,
      art.sourceLanguage,
      art.articleUrl,
      art.publishedAt,
      art.publishedDateKey,
      art.topic,
      nowIso,
    );

    normalizedArticles.push({ ...art, id: stableId });
    mirrorRows.push({
      id: stableId,
      canonical_url: canonical,
      headline_fingerprint: fingerprint,
      title: art.title,
      summary_snippet: art.summarySnippet,
      source_name: art.sourceName,
      source_language: art.sourceLanguage,
      article_url: art.articleUrl,
      published_at: art.publishedAt,
      published_date_key: art.publishedDateKey,
      topic: art.topic,
      fetched_at: nowIso,
    });
  }

  void mirrorToSupabaseBestEffort('news_articles', 'canonical_url', mirrorRows.slice(0, 40));
  return normalizedArticles;
}

export function getFullyProcessedStoryIdentifiers(): Set<string> {
  const db = getNewsPipelineDb();
  const rows = db
    .prepare(`
      SELECT a.id, a.canonical_url, a.headline_fingerprint, COUNT(DISTINCT l.cefr_level) AS level_count
      FROM news_articles a
      INNER JOIN news_lessons l ON l.article_id = a.id
      GROUP BY a.id
      HAVING level_count >= 4
    `)
    .all() as { id: string; canonical_url: string; headline_fingerprint: string }[];

  const set = new Set<string>();
  for (const r of rows) {
    set.add(r.id);
    set.add(r.canonical_url);
    set.add(r.headline_fingerprint);
  }
  return set;
}

export function getExistingNewsLessonForArticleLevel(
  articleId: string,
  level: CefrLevel,
  format: NewsFormat,
): Lesson | null {
  const db = getNewsPipelineDb();
  const row = db
    .prepare(`
      SELECT payload_json
      FROM news_lessons
      WHERE article_id = ? AND cefr_level = ? AND format = ?
      LIMIT 1
    `)
    .get(articleId, level, format) as { payload_json: string } | undefined;

  if (!row) return null;
  try {
    return JSON.parse(row.payload_json) as Lesson;
  } catch {
    return null;
  }
}

export function saveNewsLessonWithSegments(
  article: NewsArticle,
  lesson: Lesson,
  segmentFilePaths?: Map<number, string>,
): Lesson {
  const db = getNewsPipelineDb();
  upsertNewsArticles([article]);

  const nowIso = new Date().toISOString();
  const meta = lesson.newsMetadata;
  if (!meta) {
    throw new Error('saveNewsLessonWithSegments requires lesson.newsMetadata.');
  }

  const upsertLesson = db.prepare(`
    INSERT INTO news_lessons (
      id, article_id, cefr_level, format, title_ru, title_vi,
      educational_summary_ru, educational_summary_vi,
      published_at, published_date_key, pipeline_date_key,
      source_name, article_url, news_topic,
      full_audio_url, audio_status, audio_error, audio_segments_count,
      payload_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(article_id, cefr_level, format) DO UPDATE SET
      title_ru = excluded.title_ru,
      title_vi = excluded.title_vi,
      educational_summary_ru = excluded.educational_summary_ru,
      educational_summary_vi = excluded.educational_summary_vi,
      full_audio_url = excluded.full_audio_url,
      audio_status = excluded.audio_status,
      audio_error = excluded.audio_error,
      audio_segments_count = excluded.audio_segments_count,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `);

  const existingByConflict = db
    .prepare(
      'SELECT id FROM news_lessons WHERE article_id = ? AND cefr_level = ? AND format = ? LIMIT 1',
    )
    .get(article.id, lesson.level, meta.format) as { id: string } | undefined;

  const finalLessonId = existingByConflict?.id ?? lesson.id;
  const normalizedLesson: Lesson = {
    ...lesson,
    id: finalLessonId,
    sentences: lesson.sentences.map((s, idx) => ({
      ...s,
      id: s.id.startsWith(finalLessonId) ? s.id : `${finalLessonId}-s${idx + 1}`,
    })),
    newsMetadata: {
      ...meta,
      articleId: article.id,
      pipelineDateKey: meta.pipelineDateKey ?? article.publishedDateKey,
    },
  };

  upsertLesson.run(
    finalLessonId,
    article.id,
    normalizedLesson.level,
    meta.format,
    normalizedLesson.titleRu,
    normalizedLesson.titleVi,
    meta.educationalSummaryRu ?? '',
    meta.educationalSummaryVi ?? '',
    meta.publishedAt,
    meta.publishedAt.slice(0, 10),
    meta.pipelineDateKey ?? article.publishedDateKey,
    meta.sourceName,
    meta.articleUrl,
    meta.newsTopic,
    meta.fullAudioUrl ?? null,
    meta.audioStatus ?? 'pending',
    meta.audioError ?? null,
    meta.audioSegmentsCount ?? 0,
    JSON.stringify(normalizedLesson),
    normalizedLesson.createdAt,
    nowIso,
  );

  db.prepare('DELETE FROM news_audio_segments WHERE lesson_id = ?').run(finalLessonId);
  const insertSeg = db.prepare(`
    INSERT INTO news_audio_segments (
      id, lesson_id, sentence_id, sentence_order, speaker,
      transcript_ru, translation_vi, start_sec, end_sec,
      audio_url, file_path, duration_sec, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const mirrorSegments: Record<string, unknown>[] = [];
  for (const s of normalizedLesson.sentences) {
    const segId = `${finalLessonId}-seg-${s.order}`;
    const dur = Number(Math.max(0, s.endSec - s.startSec).toFixed(2));
    insertSeg.run(
      segId,
      finalLessonId,
      s.id,
      s.order,
      s.speaker,
      s.text,
      s.translationVi,
      s.startSec,
      s.endSec,
      s.audioUrl ?? null,
      segmentFilePaths?.get(s.order) ?? null,
      dur,
      nowIso,
    );
    mirrorSegments.push({
      id: segId,
      lesson_id: finalLessonId,
      sentence_id: s.id,
      sentence_order: s.order,
      speaker: s.speaker,
      transcript_ru: s.text,
      translation_vi: s.translationVi,
      start_sec: s.startSec,
      end_sec: s.endSec,
      audio_url: s.audioUrl ?? null,
      created_at: nowIso,
    });
  }

  void mirrorToSupabaseBestEffort('news_lessons', 'article_id,cefr_level,format', [
    {
      id: finalLessonId,
      article_id: article.id,
      cefr_level: normalizedLesson.level,
      format: meta.format,
      title_ru: normalizedLesson.titleRu,
      title_vi: normalizedLesson.titleVi,
      educational_summary_ru: meta.educationalSummaryRu ?? '',
      educational_summary_vi: meta.educationalSummaryVi ?? '',
      published_at: meta.publishedAt,
      source_name: meta.sourceName,
      article_url: meta.articleUrl,
      full_audio_url: meta.fullAudioUrl ?? null,
      audio_status: meta.audioStatus ?? 'pending',
      audio_error: meta.audioError ?? null,
      payload: normalizedLesson,
      created_at: normalizedLesson.createdAt,
    },
  ]);
  void mirrorToSupabaseBestEffort(
    'news_audio_segments',
    'lesson_id,sentence_order',
    mirrorSegments,
  );

  return normalizedLesson;
}

export function listNewsLessonsFromDb(filters?: {
  level?: 'ALL' | CefrLevel;
  topic?: 'ALL' | NewsTopicCategory;
  date?: string;
  search?: string;
  limit?: number;
}): Lesson[] {
  const db = getNewsPipelineDb();
  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  if (filters?.level && filters.level !== 'ALL') {
    whereClauses.push('cefr_level = ?');
    params.push(filters.level);
  }
  if (filters?.topic && filters.topic !== 'ALL') {
    whereClauses.push('news_topic = ?');
    params.push(filters.topic);
  }
  if (filters?.date && /^\d{4}-\d{2}-\d{2}$/.test(filters.date)) {
    whereClauses.push('published_date_key = ?');
    params.push(filters.date);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const limit = Math.min(200, Math.max(1, filters?.limit ?? 80));

  const rows = db
    .prepare(`
      SELECT payload_json
      FROM news_lessons
      ${whereSql}
      ORDER BY published_at DESC, created_at DESC,
        CASE cefr_level WHEN 'B1' THEN 1 WHEN 'B2' THEN 2 WHEN 'C1' THEN 3 ELSE 4 END ASC
      LIMIT ?
    `)
    .all(...params, limit) as { payload_json: string }[];

  const lessons: Lesson[] = [];
  const q = (filters?.search ?? '').trim().toLowerCase();

  for (const row of rows) {
    try {
      const lesson = JSON.parse(row.payload_json) as Lesson;
      if (q) {
        const meta = lesson.newsMetadata;
        const hay =
          `${lesson.titleRu} ${lesson.titleVi} ${meta?.originalTitle ?? ''} ${meta?.sourceName ?? ''} ${meta?.verifiedFactsSummaryVi ?? ''} ${meta?.educationalSummaryRu ?? ''}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      lessons.push(lesson);
    } catch {
      // Skip malformed row safely
    }
  }

  return lessons;
}

export function getNewsLessonByIdFromDb(lessonId: string): Lesson | null {
  if (!SAFE_ID_RE.test(lessonId)) return null;
  const db = getNewsPipelineDb();
  const row = db
    .prepare('SELECT payload_json FROM news_lessons WHERE id = ? LIMIT 1')
    .get(lessonId) as { payload_json: string } | undefined;

  if (!row) return null;
  try {
    return JSON.parse(row.payload_json) as Lesson;
  } catch {
    return null;
  }
}

export function markStaleRunningPipelineRunsFailed(): void {
  const db = getNewsPipelineDb();
  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE news_pipeline_runs
    SET status = 'failed', finished_at = ?, error_summary = COALESCE(error_summary, 'Interrupted by server restart')
    WHERE status = 'running'
  `).run(nowIso);
}

export function hasCompletedPipelineRunForDate(dateKey: string): boolean {
  const db = getNewsPipelineDb();
  const row = db
    .prepare(`
      SELECT id FROM news_pipeline_runs
      WHERE run_date_key = ? AND status IN ('completed', 'partial') AND lessons_generated > 0
      LIMIT 1
    `)
    .get(dateKey) as { id: string } | undefined;
  return Boolean(row);
}

export function hasAnyNewsLessonsForDate(dateKey: string): boolean {
  const db = getNewsPipelineDb();
  const row = db
    .prepare(`
      SELECT id FROM news_lessons
      WHERE pipeline_date_key = ? OR created_at LIKE ?
      LIMIT 1
    `)
    .get(dateKey, `${dateKey}%`) as { id: string } | undefined;
  return Boolean(row);
}

export function recordPipelineRunStart(
  triggerType: 'scheduled' | 'manual' | 'startup',
  runDateKey: string,
): string {
  const db = getNewsPipelineDb();
  const id = `run-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const nowIso = new Date().toISOString();
  db.prepare(`
    INSERT INTO news_pipeline_runs (
      id, trigger_type, run_date_key, started_at, status
    ) VALUES (?, ?, ?, ?, 'running')
  `).run(id, triggerType, runDateKey, nowIso);
  return id;
}

export function finishPipelineRun(
  runId: string,
  patch: {
    status: 'completed' | 'partial' | 'failed';
    storiesFetched: number;
    duplicatesRemoved: number;
    storiesSelected: number;
    lessonsGenerated: number;
    audioSegmentsSaved: number;
    errorSummary: string | null;
  },
): NewsPipelineRunSummary {
  const db = getNewsPipelineDb();
  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE news_pipeline_runs
    SET finished_at = ?, status = ?, stories_fetched = ?, duplicates_removed = ?,
        stories_selected = ?, lessons_generated = ?, audio_segments_saved = ?,
        error_summary = ?
    WHERE id = ?
  `).run(
    nowIso,
    patch.status,
    patch.storiesFetched,
    patch.duplicatesRemoved,
    patch.storiesSelected,
    patch.lessonsGenerated,
    patch.audioSegmentsSaved,
    patch.errorSummary,
    runId,
  );

  const row = db
    .prepare('SELECT * FROM news_pipeline_runs WHERE id = ? LIMIT 1')
    .get(runId) as Record<string, unknown>;

  const summary = mapRunRow(row);
  void mirrorToSupabaseBestEffort('news_pipeline_runs', 'id', [
    {
      id: summary.id,
      trigger_type: summary.triggerType,
      run_date_key: summary.runDateKey,
      started_at: summary.startedAt,
      finished_at: summary.finishedAt,
      status: summary.status,
      stories_fetched: summary.storiesFetched,
      duplicates_removed: summary.duplicatesRemoved,
      stories_selected: summary.storiesSelected,
      lessons_generated: summary.lessonsGenerated,
      audio_segments_saved: summary.audioSegmentsSaved,
      error_summary: summary.errorSummary,
    },
  ]);

  return summary;
}

export function logPipelineError(input: {
  runId: string | null;
  stage: string;
  targetRef?: string | null;
  errorMessage: string;
  retryCount?: number;
}): void {
  const db = getNewsPipelineDb();
  const id = `err-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  db.prepare(`
    INSERT INTO news_pipeline_errors (
      id, run_id, stage, target_ref, error_message, retry_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.runId,
    input.stage,
    input.targetRef ?? null,
    input.errorMessage.slice(0, 600),
    input.retryCount ?? 0,
    new Date().toISOString(),
  );
}

function mapRunRow(r: Record<string, unknown>): NewsPipelineRunSummary {
  return {
    id: String(r.id),
    triggerType: (r.trigger_type as NewsPipelineRunSummary['triggerType']) ?? 'manual',
    runDateKey: String(r.run_date_key),
    startedAt: String(r.started_at),
    finishedAt: r.finished_at ? String(r.finished_at) : null,
    status: (r.status as NewsPipelineRunSummary['status']) ?? 'failed',
    storiesFetched: Number(r.stories_fetched ?? 0),
    duplicatesRemoved: Number(r.duplicates_removed ?? 0),
    storiesSelected: Number(r.stories_selected ?? 0),
    lessonsGenerated: Number(r.lessons_generated ?? 0),
    audioSegmentsSaved: Number(r.audio_segments_saved ?? 0),
    errorSummary: r.error_summary ? String(r.error_summary) : null,
  };
}

export function getPipelineDbStatusSnapshot(meta: {
  schedulerActive: boolean;
  running: boolean;
  intervalHours: number;
  nextScheduledRunAt: string;
}): NewsPipelineStatusResponse {
  const db = getNewsPipelineDb();
  const counts = db
    .prepare(`
      SELECT
        (SELECT COUNT(*) FROM news_articles) AS total_articles,
        (SELECT COUNT(*) FROM news_lessons) AS total_lessons,
        (SELECT COUNT(*) FROM news_audio_segments WHERE audio_url IS NOT NULL) AS total_segments
    `)
    .get() as {
    total_articles: number;
    total_lessons: number;
    total_segments: number;
  };

  const runRows = db
    .prepare('SELECT * FROM news_pipeline_runs ORDER BY started_at DESC LIMIT 8')
    .all() as Record<string, unknown>[];
  const recentRuns = runRows.map(mapRunRow);

  const errRows = db
    .prepare('SELECT * FROM news_pipeline_errors ORDER BY created_at DESC LIMIT 12')
    .all() as Record<string, unknown>[];

  const recentErrors: NewsPipelineErrorItem[] = errRows.map((e) => ({
    id: String(e.id),
    runId: e.run_id ? String(e.run_id) : null,
    stage: String(e.stage),
    targetRef: e.target_ref ? String(e.target_ref) : null,
    errorMessage: String(e.error_message),
    retryCount: Number(e.retry_count ?? 0),
    createdAt: String(e.created_at),
  }));

  return {
    schedulerActive: meta.schedulerActive,
    running: meta.running,
    intervalHours: meta.intervalHours,
    lastRun: recentRuns[0] ?? null,
    nextScheduledRunAt: meta.nextScheduledRunAt,
    totalDbArticles: Number(counts?.total_articles ?? 0),
    totalDbLessons: Number(counts?.total_lessons ?? 0),
    totalAudioSegments: Number(counts?.total_segments ?? 0),
    recentRuns,
    recentErrors,
  };
}
