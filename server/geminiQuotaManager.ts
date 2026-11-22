import crypto from 'node:crypto';
import type { CefrLevel } from '../src/types/domain.ts';

export type GeminiErrorCategory =
  | 'none'
  | 'rate_limit_temporary'
  | 'daily_quota_exhausted'
  | 'server_overloaded'
  | 'timeout'
  | 'model_not_found'
  | 'auth_error'
  | 'invalid_request'
  | 'network_error'
  | 'unknown';

export type TtsJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface ClassifiedGeminiError {
  httpStatus: number | null;
  category: GeminiErrorCategory;
  retryable: boolean;
  retryAfterMs: number | null;
  quotaId: string | null;
  quotaMetric: string | null;
  safeMessage: string;
  userMessageVi: string;
}

export interface GeminiMonitoringEvent {
  id: string;
  requestType: 'text' | 'tts_single' | 'tts_dialogue';
  model: string;
  timestamp: string;
  lessonId: string | null;
  cefrLevel: CefrLevel | null;
  httpStatus: number | null;
  errorCategory: GeminiErrorCategory;
  retryCount: number;
  queueWaitMs: number;
  processingDurationMs: number;
  reusedFromCache: boolean;
  outcome: 'completed' | 'failed';
  retryAfterMs: number | null;
  quotaId: string | null;
}

export interface TtsQueueJobRecord {
  jobId: string;
  idempotencyKey: string;
  lessonId: string | null;
  cefrLevel: CefrLevel | null;
  model: string;
  requestType: 'tts_single' | 'tts_dialogue';
  status: TtsJobStatus;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  queueWaitMs: number;
  processingDurationMs: number;
  retryCount: number;
  reusedFromCache: boolean;
  errorCategory: GeminiErrorCategory;
  errorMessage: string | null;
}

export interface TtsQueueSnapshot {
  maxConcurrency: number;
  activeCount: number;
  queuedCount: number;
  cooldownUntil: string | null;
  dailyQuotaExhausted: boolean;
  dailyQuotaExhaustedModel: string | null;
  dailyQuotaResetHint: string | null;
  activeJobs: TtsQueueJobRecord[];
  queuedJobs: TtsQueueJobRecord[];
  recentJobs: TtsQueueJobRecord[];
}

const MAX_MONITORING_EVENTS = 120;
const MAX_RECENT_JOBS = 40;
const monitoringEvents: GeminiMonitoringEvent[] = [];

export function sanitizeLogString(input: string): string {
  return input
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED_API_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(api[_-]?key|token|secret)\s*[:=]\s*["']?[^\s"',}]+/gi, '$1=[REDACTED]')
    .slice(0, 500);
}

function parseDurationToMs(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return Math.round(raw * 1000);
  }
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Format: "34s" or "12.5s" or "1500ms"
  const msMatch = /^(\d+(?:\.\d+)?)ms$/i.exec(trimmed);
  if (msMatch) {
    return Math.round(Number(msMatch[1]));
  }
  const secMatch = /^(\d+(?:\.\d+)?)s$/i.exec(trimmed);
  if (secMatch) {
    return Math.round(Number(secMatch[1]) * 1000);
  }
  // Plain numeric Retry-After header (seconds)
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return Math.round(Number(trimmed) * 1000);
  }
  // HTTP-date Retry-After header
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

function tryExtractJsonPayload(rawMessage: string): Record<string, unknown> | null {
  const start = rawMessage.indexOf('{');
  const end = rawMessage.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(rawMessage.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractHttpStatus(err: unknown, rawMessage: string, parsed: Record<string, unknown> | null): number | null {
  if (err && typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    if (typeof rec.status === 'number' && rec.status >= 100 && rec.status < 600) {
      return rec.status;
    }
    if (typeof rec.statusCode === 'number' && rec.statusCode >= 100 && rec.statusCode < 600) {
      return rec.statusCode;
    }
    if (typeof rec.code === 'number' && rec.code >= 100 && rec.code < 600) {
      return rec.code;
    }
  }
  const nestedError = parsed?.error as Record<string, unknown> | undefined;
  if (typeof nestedError?.code === 'number') {
    return nestedError.code;
  }
  const codeMatch = /\b(400|401|403|404|408|429|500|502|503|504)\b/.exec(rawMessage);
  if (codeMatch) {
    return Number(codeMatch[1]);
  }
  return null;
}

function extractRetryAfterAndQuota(
  err: unknown,
  rawMessage: string,
  parsed: Record<string, unknown> | null,
): {
  retryAfterMs: number | null;
  quotaId: string | null;
  quotaMetric: string | null;
  quotaValueZero: boolean;
  detailsText: string;
} {
  let retryAfterMs: number | null = null;
  let quotaId: string | null = null;
  let quotaMetric: string | null = null;
  let quotaValueZero = false;
  const detailFragments: string[] = [];

  // 1. Check HTTP response headers if present on error object
  if (err && typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    const headers = rec.headers as Record<string, unknown> | Headers | undefined;
    if (headers) {
      let retryHeader: string | null = null;
      if (typeof (headers as Headers).get === 'function') {
        retryHeader = (headers as Headers).get('retry-after');
      } else {
        const hdrObj = headers as Record<string, unknown>;
        const val = hdrObj['retry-after'] ?? hdrObj['Retry-After'];
        if (typeof val === 'string' || typeof val === 'number') {
          retryHeader = String(val);
        }
      }
      if (retryHeader) {
        retryAfterMs = parseDurationToMs(retryHeader);
      }
    }
    if (typeof rec.retryAfterMs === 'number' && rec.retryAfterMs >= 0) {
      retryAfterMs = rec.retryAfterMs;
    }
  }

  // 2. Inspect Google RPC error.details array (RetryInfo, QuotaFailure, ErrorInfo)
  const nestedError = (parsed?.error ?? parsed) as Record<string, unknown> | null;
  const details = Array.isArray(nestedError?.details)
    ? (nestedError.details as Record<string, unknown>[])
    : [];

  for (const detail of details) {
    if (!detail || typeof detail !== 'object') continue;
    const typeStr = String(detail['@type'] ?? '');
    if (typeStr.includes('RetryInfo') || 'retryDelay' in detail) {
      const parsedDelay = parseDurationToMs(detail.retryDelay);
      if (parsedDelay !== null) {
        retryAfterMs = parsedDelay;
      }
    }
    if (typeStr.includes('QuotaFailure') || Array.isArray(detail.violations)) {
      const violations = Array.isArray(detail.violations)
        ? (detail.violations as Record<string, unknown>[])
        : [];
      for (const v of violations) {
        if (typeof v.quotaId === 'string' && !quotaId) quotaId = v.quotaId;
        if (typeof v.quotaMetric === 'string' && !quotaMetric) quotaMetric = v.quotaMetric;
        if (typeof v.description === 'string') detailFragments.push(v.description);
        if (String(v.quotaValue ?? '').trim() === '0') {
          quotaValueZero = true;
        }
      }
    }
    if (typeof detail.reason === 'string') {
      detailFragments.push(detail.reason);
    }
  }

  // 3. Parse inline retry hints in raw message ("Please retry in 34.5s", "retryDelay": "20s")
  if (retryAfterMs === null) {
    const inlineRetry =
      /retry(?:\s+again)?\s+in\s+(\d+(?:\.\d+)?)\s*(ms|s|sec|seconds?)/i.exec(rawMessage) ??
      /"retryDelay"\s*:\s*"([^"]+)"/i.exec(rawMessage) ??
      /retry-after[:=\s]+(\d+(?:\.\d+)?)/i.exec(rawMessage);
    if (inlineRetry) {
      const unit = inlineRetry[2]?.toLowerCase() ?? 's';
      const val = Number(inlineRetry[1]);
      if (Number.isFinite(val)) {
        retryAfterMs = unit === 'ms' ? Math.round(val) : Math.round(val * 1000);
      } else {
        retryAfterMs = parseDurationToMs(inlineRetry[1]);
      }
    }
  }

  // 4. Parse inline quotaId if not found in details
  if (!quotaId) {
    const qMatch = /quotaId["']?\s*[:=]\s*["']?([A-Za-z0-9_\-.]+)/i.exec(rawMessage);
    if (qMatch) quotaId = qMatch[1];
  }
  if (!quotaMetric) {
    const mMatch = /quotaMetric["']?\s*[:=]\s*["']?([A-Za-z0-9_\-./]+)/i.exec(rawMessage);
    if (mMatch) quotaMetric = mMatch[1];
  }

  return {
    retryAfterMs,
    quotaId,
    quotaMetric,
    quotaValueZero,
    detailsText: detailFragments.join(' '),
  };
}

export function classifyGeminiError(err: unknown): ClassifiedGeminiError {
  const rawMessage = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  const safeMessage = sanitizeLogString(rawMessage);
  const parsed = tryExtractJsonPayload(rawMessage);
  const httpStatus = extractHttpStatus(err, rawMessage, parsed);
  const { retryAfterMs, quotaId, quotaMetric, quotaValueZero, detailsText } =
    extractRetryAfterAndQuota(err, rawMessage, parsed);

  const combined = `${rawMessage} ${quotaId ?? ''} ${quotaMetric ?? ''} ${detailsText}`.toLowerCase();

  // Timeout / Abort
  if (
    combined.includes('timed out') ||
    combined.includes('timeout') ||
    (err instanceof Error && err.name === 'AbortError') ||
    httpStatus === 408 ||
    httpStatus === 504
  ) {
    return {
      httpStatus: httpStatus ?? 504,
      category: 'timeout',
      retryable: true,
      retryAfterMs,
      quotaId,
      quotaMetric,
      safeMessage,
      userMessageVi: 'Yêu cầu tới Gemini API vượt quá thời gian chờ. Vui lòng thử lại sau giây lát.',
    };
  }

  // 429 RESOURCE_EXHAUSTED: distinguish daily/project exhaustion vs temporary per-minute rate limit
  if (
    httpStatus === 429 ||
    combined.includes('resource_exhausted') ||
    combined.includes('quota') ||
    combined.includes('rate limit') ||
    combined.includes('too many requests')
  ) {
    const isDailyOrHardQuota =
      combined.includes('perday') ||
      combined.includes('per_day') ||
      combined.includes('per day') ||
      combined.includes('daily') ||
      combined.includes('rpd') ||
      combined.includes('limit: 0') ||
      combined.includes('limit=0') ||
      combined.includes('billing') ||
      combined.includes('plan and billing') ||
      quotaValueZero ||
      (retryAfterMs !== null && retryAfterMs > 180_000);

    if (isDailyOrHardQuota) {
      return {
        httpStatus: 429,
        category: 'daily_quota_exhausted',
        retryable: false,
        retryAfterMs,
        quotaId,
        quotaMetric,
        safeMessage,
        userMessageVi:
          'Hạn mức ngày (Daily Quota) hoặc gói cước của Gemini API đã hết (429 RESOURCE_EXHAUSTED). Văn bản bài học vẫn được lưu nguyên vẹn; bạn có thể tạo lại audio sau khi hạn mức được làm mới hoặc nâng cấp gói API.',
      };
    }

    const waitHintSec = retryAfterMs ? Math.max(1, Math.ceil(retryAfterMs / 1000)) : null;
    return {
      httpStatus: 429,
      category: 'rate_limit_temporary',
      retryable: true,
      retryAfterMs,
      quotaId,
      quotaMetric,
      safeMessage,
      userMessageVi: waitHintSec
        ? `Gemini API đang giới hạn tốc độ tạm thời (429). Vui lòng thử lại sau khoảng ${waitHintSec} giây.`
        : 'Gemini API đang giới hạn tốc độ tạm thời (429 RPM). Hệ thống đã xếp hàng chờ và bạn có thể nhấn Thử tạo lại audio sau ít phút.',
    };
  }

  // 500 / 502 / 503 transient upstream overload
  if (
    httpStatus === 500 ||
    httpStatus === 502 ||
    httpStatus === 503 ||
    combined.includes('unavailable') ||
    combined.includes('overloaded') ||
    combined.includes('internal error')
  ) {
    return {
      httpStatus: httpStatus ?? 503,
      category: 'server_overloaded',
      retryable: true,
      retryAfterMs,
      quotaId,
      quotaMetric,
      safeMessage,
      userMessageVi: `Dịch vụ Gemini tạm thời quá tải (HTTP ${httpStatus ?? 503}). Vui lòng thử lại sau giây lát.`,
    };
  }

  // 404 model not found
  if (httpStatus === 404 || combined.includes('not_found') || combined.includes('not found')) {
    return {
      httpStatus: 404,
      category: 'model_not_found',
      retryable: false,
      retryAfterMs: null,
      quotaId,
      quotaMetric,
      safeMessage,
      userMessageVi: 'Mô hình Gemini được cấu hình không khả dụng trên dự án hiện tại (404 NOT_FOUND).',
    };
  }

  // 401 / 403 auth / permission denied
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    combined.includes('permission_denied') ||
    combined.includes('api_key_invalid') ||
    combined.includes('api key not valid')
  ) {
    return {
      httpStatus: httpStatus ?? 403,
      category: 'auth_error',
      retryable: false,
      retryAfterMs: null,
      quotaId,
      quotaMetric,
      safeMessage,
      userMessageVi: 'Khóa GEMINI_API_KEY trên máy chủ không hợp lệ hoặc không có quyền truy cập mô hình này.',
    };
  }

  // 400 invalid argument
  if (httpStatus === 400 || combined.includes('invalid_argument')) {
    return {
      httpStatus: 400,
      category: 'invalid_request',
      retryable: false,
      retryAfterMs: null,
      quotaId,
      quotaMetric,
      safeMessage,
      userMessageVi: 'Yêu cầu gửi tới Gemini API không hợp lệ (400 INVALID_ARGUMENT).',
    };
  }

  // Network transport errors
  if (
    combined.includes('econnreset') ||
    combined.includes('etimedout') ||
    combined.includes('enotfound') ||
    combined.includes('fetch failed') ||
    combined.includes('socket hang up')
  ) {
    return {
      httpStatus: null,
      category: 'network_error',
      retryable: true,
      retryAfterMs,
      quotaId,
      quotaMetric,
      safeMessage,
      userMessageVi: 'Lỗi kết nối mạng tới Gemini API. Vui lòng thử lại sau giây lát.',
    };
  }

  return {
    httpStatus,
    category: 'unknown',
    retryable: false,
    retryAfterMs,
    quotaId,
    quotaMetric,
    safeMessage,
    userMessageVi: safeMessage.slice(0, 220),
  };
}

export function computeBackoffDelayMs(options: {
  attempt: number; // 1-based failed attempt number (1 => delay before attempt 2)
  retryAfterMs?: number | null;
  baseDelayMs?: number;
  maxDelayMs?: number;
  randomFn?: () => number;
}): number {
  const baseDelayMs = options.baseDelayMs ?? 2000;
  const maxDelayMs = options.maxDelayMs ?? 30000;
  const rand = options.randomFn ?? Math.random;

  if (options.retryAfterMs !== null && options.retryAfterMs !== undefined && options.retryAfterMs >= 0) {
    const jitter = Math.round(250 + rand() * 750);
    return Math.min(maxDelayMs, options.retryAfterMs + jitter);
  }

  const expDelay = baseDelayMs * Math.pow(2, Math.max(0, options.attempt - 1));
  const jitter = Math.round(rand() * Math.min(1500, expDelay * 0.35));
  return Math.min(maxDelayMs, Math.round(expDelay + jitter));
}

export function recordGeminiMonitoringEvent(
  event: Omit<GeminiMonitoringEvent, 'id' | 'timestamp'> & { timestamp?: string },
): GeminiMonitoringEvent {
  const fullEvent: GeminiMonitoringEvent = {
    id: `mon-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    timestamp: event.timestamp ?? new Date().toISOString(),
    requestType: event.requestType,
    model: event.model,
    lessonId: event.lessonId,
    cefrLevel: event.cefrLevel,
    httpStatus: event.httpStatus,
    errorCategory: event.errorCategory,
    retryCount: event.retryCount,
    queueWaitMs: Math.max(0, Math.round(event.queueWaitMs)),
    processingDurationMs: Math.max(0, Math.round(event.processingDurationMs)),
    reusedFromCache: event.reusedFromCache,
    outcome: event.outcome,
    retryAfterMs: event.retryAfterMs,
    quotaId: event.quotaId ? sanitizeLogString(event.quotaId) : null,
  };

  monitoringEvents.unshift(fullEvent);
  if (monitoringEvents.length > MAX_MONITORING_EVENTS) {
    monitoringEvents.length = MAX_MONITORING_EVENTS;
  }

  const logPayload = JSON.stringify({
    event: 'gemini_api_call',
    ...fullEvent,
  });
  if (fullEvent.outcome === 'failed') {
    console.warn(logPayload);
  } else {
    console.log(logPayload);
  }

  return fullEvent;
}

export function getRecentGeminiMonitoringEvents(limit = 30): GeminiMonitoringEvent[] {
  return monitoringEvents.slice(0, Math.max(1, Math.min(MAX_MONITORING_EVENTS, limit)));
}

export function clearGeminiMonitoringEventsForTest(): void {
  monitoringEvents.length = 0;
}

interface InternalQueueItem<T> {
  record: TtsQueueJobRecord;
  enqueuedAtMs: number;
  task: (meta: { jobId: string; queueWaitMs: number }) => Promise<{
    result: T;
    reusedFromCache?: boolean;
    retryCount?: number;
    httpStatus?: number | null;
    model?: string;
  }>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

export interface TtsQueueOptions {
  maxConcurrency?: number;
  minGapMs?: number;
  dailyQuotaCooldownMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class TtsRequestQueue {
  private readonly maxConcurrency: number;
  private readonly minGapMs: number;
  private readonly dailyQuotaCooldownMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  private activeCount = 0;
  private lastCallFinishedAtMs = 0;
  private cooldownUntilMs = 0;
  private dailyQuotaExhaustedUntilMs = 0;
  private dailyQuotaExhaustedModel: string | null = null;

  private readonly pendingQueue: InternalQueueItem<unknown>[] = [];
  private readonly activeJobs = new Map<string, TtsQueueJobRecord>();
  private readonly inFlightByKey = new Map<string, Promise<unknown>>();
  private readonly inFlightByLessonId = new Map<string, Promise<unknown>>();
  private readonly recentJobs: TtsQueueJobRecord[] = [];
  private drainScheduled = false;

  constructor(options: TtsQueueOptions = {}) {
    const envConcurrency = Number(process.env.TTS_MAX_CONCURRENCY);
    const configured =
      options.maxConcurrency ??
      (Number.isFinite(envConcurrency) && envConcurrency >= 1
        ? Math.min(2, Math.floor(envConcurrency))
        : 1);
    this.maxConcurrency = Math.max(1, configured);
    this.minGapMs = options.minGapMs ?? 1200;
    this.dailyQuotaCooldownMs = options.dailyQuotaCooldownMs ?? 10 * 60 * 1000;
    this.sleepFn = options.sleepFn ?? defaultSleep;
  }

  getMaxConcurrency(): number {
    return this.maxConcurrency;
  }

  isDailyQuotaBlocked(): boolean {
    if (this.dailyQuotaExhaustedUntilMs > Date.now()) {
      return true;
    }
    if (this.dailyQuotaExhaustedUntilMs > 0) {
      this.dailyQuotaExhaustedUntilMs = 0;
      this.dailyQuotaExhaustedModel = null;
    }
    return false;
  }

  clearQuotaCooldown(): void {
    this.cooldownUntilMs = 0;
    this.dailyQuotaExhaustedUntilMs = 0;
    this.dailyQuotaExhaustedModel = null;
  }

  noteRateLimitCooldown(delayMs: number): void {
    const safeDelay = Math.min(65_000, Math.max(500, delayMs));
    this.cooldownUntilMs = Math.max(this.cooldownUntilMs, Date.now() + safeDelay);
  }

  noteDailyQuotaExhausted(model: string): void {
    this.dailyQuotaExhaustedUntilMs = Date.now() + this.dailyQuotaCooldownMs;
    this.dailyQuotaExhaustedModel = model;
  }

  getLessonJobState(lessonId: string): TtsQueueJobRecord | null {
    for (const job of this.activeJobs.values()) {
      if (job.lessonId === lessonId) return { ...job };
    }
    for (const item of this.pendingQueue) {
      if (item.record.lessonId === lessonId) return { ...item.record };
    }
    const recent = this.recentJobs.find((j) => j.lessonId === lessonId);
    return recent ? { ...recent } : null;
  }

  getSnapshot(): TtsQueueSnapshot {
    const now = Date.now();
    const dailyBlocked = this.isDailyQuotaBlocked();
    return {
      maxConcurrency: this.maxConcurrency,
      activeCount: this.activeCount,
      queuedCount: this.pendingQueue.length,
      cooldownUntil: this.cooldownUntilMs > now ? new Date(this.cooldownUntilMs).toISOString() : null,
      dailyQuotaExhausted: dailyBlocked,
      dailyQuotaExhaustedModel: dailyBlocked ? this.dailyQuotaExhaustedModel : null,
      dailyQuotaResetHint: dailyBlocked
        ? new Date(this.dailyQuotaExhaustedUntilMs).toISOString()
        : null,
      activeJobs: Array.from(this.activeJobs.values()).map((j) => ({ ...j })),
      queuedJobs: this.pendingQueue.map((item) => ({
        ...item.record,
        queueWaitMs: Math.max(0, now - item.enqueuedAtMs),
      })),
      recentJobs: this.recentJobs.slice(0, 20).map((j) => ({ ...j })),
    };
  }

  enqueue<T>(options: {
    idempotencyKey: string;
    lessonId?: string | null;
    cefrLevel?: CefrLevel | null;
    model: string;
    requestType: 'tts_single' | 'tts_dialogue';
    task: (meta: { jobId: string; queueWaitMs: number }) => Promise<{
      result: T;
      reusedFromCache?: boolean;
      retryCount?: number;
      httpStatus?: number | null;
      model?: string;
    }>;
  }): Promise<T> {
    // 1. Coalesce exact duplicate idempotency key in flight
    const existingByKey = this.inFlightByKey.get(options.idempotencyKey);
    if (existingByKey) {
      return existingByKey as Promise<T>;
    }

    // 2. Prevent multiple workers generating audio for the SAME lesson simultaneously
    if (options.lessonId) {
      const existingByLesson = this.inFlightByLessonId.get(options.lessonId);
      if (existingByLesson) {
        return existingByLesson as Promise<T>;
      }
    }

    const jobId = `tts-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const enqueuedAtMs = Date.now();
    const record: TtsQueueJobRecord = {
      jobId,
      idempotencyKey: options.idempotencyKey,
      lessonId: options.lessonId ?? null,
      cefrLevel: options.cefrLevel ?? null,
      model: options.model,
      requestType: options.requestType,
      status: 'queued',
      queuedAt: new Date(enqueuedAtMs).toISOString(),
      startedAt: null,
      finishedAt: null,
      queueWaitMs: 0,
      processingDurationMs: 0,
      retryCount: 0,
      reusedFromCache: false,
      errorCategory: 'none',
      errorMessage: null,
    };

    const promise = new Promise<T>((resolve, reject) => {
      const item: InternalQueueItem<T> = {
        record,
        enqueuedAtMs,
        task: options.task,
        resolve,
        reject,
      };
      this.pendingQueue.push(item as InternalQueueItem<unknown>);
      this.scheduleDrain();
    });

    this.inFlightByKey.set(options.idempotencyKey, promise);
    if (options.lessonId) {
      this.inFlightByLessonId.set(options.lessonId, promise);
    }

    const cleanup = () => {
      if (this.inFlightByKey.get(options.idempotencyKey) === promise) {
        this.inFlightByKey.delete(options.idempotencyKey);
      }
      if (options.lessonId && this.inFlightByLessonId.get(options.lessonId) === promise) {
        this.inFlightByLessonId.delete(options.lessonId);
      }
    };
    promise.then(cleanup, cleanup);

    return promise;
  }

  private scheduleDrain(): void {
    if (this.drainScheduled) return;
    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      this.drain();
    });
  }

  private recordFinishedJob(record: TtsQueueJobRecord): void {
    this.recentJobs.unshift({ ...record });
    if (this.recentJobs.length > MAX_RECENT_JOBS) {
      this.recentJobs.length = MAX_RECENT_JOBS;
    }
  }

  private drain(): void {
    while (this.activeCount < this.maxConcurrency && this.pendingQueue.length > 0) {
      const item = this.pendingQueue.shift()!;
      this.activeCount += 1;
      void this.executeItem(item);
    }
  }

  private async executeItem(item: InternalQueueItem<unknown>): Promise<void> {
    const { record } = item;
    this.activeJobs.set(record.jobId, record);

    try {
      // Respect pacing gap and temporary 429 cooldown before hitting upstream TTS
      const nowBeforePace = Date.now();
      const gapWait =
        this.lastCallFinishedAtMs > 0
          ? Math.max(0, this.lastCallFinishedAtMs + this.minGapMs - nowBeforePace)
          : 0;
      const cooldownWait = Math.max(0, this.cooldownUntilMs - nowBeforePace);
      const totalPreWait = Math.max(gapWait, cooldownWait);
      if (totalPreWait > 0) {
        await this.sleepFn(totalPreWait);
      }

      const startedAtMs = Date.now();
      record.status = 'processing';
      record.startedAt = new Date(startedAtMs).toISOString();
      record.queueWaitMs = Math.max(0, startedAtMs - item.enqueuedAtMs);

      const outcome = await item.task({
        jobId: record.jobId,
        queueWaitMs: record.queueWaitMs,
      });

      const finishedAtMs = Date.now();
      record.status = 'completed';
      record.finishedAt = new Date(finishedAtMs).toISOString();
      record.processingDurationMs = Math.max(0, finishedAtMs - startedAtMs);
      record.reusedFromCache = Boolean(outcome.reusedFromCache);
      record.retryCount = outcome.retryCount ?? 0;
      if (outcome.model) record.model = outcome.model;
      record.errorCategory = 'none';
      record.errorMessage = null;

      if (!record.reusedFromCache) {
        this.lastCallFinishedAtMs = finishedAtMs;
      }

      recordGeminiMonitoringEvent({
        requestType: record.requestType,
        model: record.model,
        lessonId: record.lessonId,
        cefrLevel: record.cefrLevel,
        httpStatus: outcome.httpStatus ?? 200,
        errorCategory: 'none',
        retryCount: record.retryCount,
        queueWaitMs: record.queueWaitMs,
        processingDurationMs: record.processingDurationMs,
        reusedFromCache: record.reusedFromCache,
        outcome: 'completed',
        retryAfterMs: null,
        quotaId: null,
      });

      this.recordFinishedJob(record);
      item.resolve(outcome.result);
    } catch (err) {
      const finishedAtMs = Date.now();
      const startedAtMs = record.startedAt ? Date.parse(record.startedAt) : finishedAtMs;
      const classified = classifyGeminiError(err);
      const retryCount =
        err && typeof err === 'object' && typeof (err as { retryCount?: unknown }).retryCount === 'number'
          ? (err as { retryCount: number }).retryCount
          : 0;

      record.status = 'failed';
      record.finishedAt = new Date(finishedAtMs).toISOString();
      record.processingDurationMs = Math.max(0, finishedAtMs - startedAtMs);
      record.retryCount = retryCount;
      record.errorCategory = classified.category;
      record.errorMessage = classified.userMessageVi;
      this.lastCallFinishedAtMs = finishedAtMs;

      if (classified.category === 'daily_quota_exhausted') {
        this.noteDailyQuotaExhausted(record.model);
      } else if (classified.category === 'rate_limit_temporary') {
        this.noteRateLimitCooldown(classified.retryAfterMs ?? 5000);
      }

      recordGeminiMonitoringEvent({
        requestType: record.requestType,
        model: record.model,
        lessonId: record.lessonId,
        cefrLevel: record.cefrLevel,
        httpStatus: classified.httpStatus,
        errorCategory: classified.category,
        retryCount: record.retryCount,
        queueWaitMs: record.queueWaitMs,
        processingDurationMs: record.processingDurationMs,
        reusedFromCache: false,
        outcome: 'failed',
        retryAfterMs: classified.retryAfterMs,
        quotaId: classified.quotaId,
      });

      this.recordFinishedJob(record);
      item.reject(err);
    } finally {
      this.activeJobs.delete(record.jobId);
      this.activeCount = Math.max(0, this.activeCount - 1);
      this.drain();
    }
  }
}

export const globalTtsQueue = new TtsRequestQueue();
