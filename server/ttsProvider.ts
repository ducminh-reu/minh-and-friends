import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  CefrLevel,
  GeminiVoiceId,
  TtsModelId,
  TtsProviderId,
  VoiceAgeStyle,
  VoiceConfigProfile,
  VoiceSpeakingStyle,
} from '../src/types/domain.ts';
import { findSpeakerProfile } from '../src/utils/speakerUtils.ts';
import {
  DEFAULT_TTS_LOCALE,
  DEFAULT_TTS_PROVIDER,
  FEMALE_VOICE_IDS,
  MALE_VOICE_IDS,
  VOICE_CACHE_SCHEMA_VERSION,
  assignDistinctSpeakerVoices,
  buildRussianStylePrompt,
  buildVoiceCacheSignature,
  resolveVoiceProfile,
} from '../src/utils/voiceRegistry.ts';
import {
  analyzeWavAcoustics,
  concatenateWavSegmentsWithTurnPauses,
  ensureWavBuffer,
  type WavAcousticDiagnostics,
} from '../src/utils/wavAudioUtils.ts';
import {
  classifyGeminiError,
  computeBackoffDelayMs,
  globalTtsQueue,
  recordGeminiMonitoringEvent,
  type ClassifiedGeminiError,
  type TtsRequestQueue,
} from './geminiQuotaManager.ts';
import { createGeminiTtsClient, isGeminiConfigured } from './geminiService.ts';

export type GeminiVoiceName = GeminiVoiceId;
export const FEMALE_VOICES: readonly GeminiVoiceId[] = FEMALE_VOICE_IDS;
export const MALE_VOICES: readonly GeminiVoiceId[] = MALE_VOICE_IDS;

/**
 * Default to Free-Tier-optimized `gemini-3.8-flash-lite-tts` for lowest cost ($0 Free Tier),
 * lowest latency, and highest quota headroom. Can be overridden to `gemini-3.8-flash-tts`
 * via GEMINI_TTS_MODEL env var. Never uses paid-only models.
 */
export const CONFIGURED_TTS_MODEL: TtsModelId =
  process.env.GEMINI_TTS_MODEL?.trim() === 'gemini-3.8-flash-tts'
    ? 'gemini-3.8-flash-tts'
    : 'gemini-3.8-flash-lite-tts';

export const SECONDARY_FREE_TTS_MODEL: TtsModelId =
  CONFIGURED_TTS_MODEL === 'gemini-3.8-flash-lite-tts'
    ? 'gemini-3.8-flash-tts'
    : 'gemini-3.8-flash-lite-tts';

export const TTS_REQUEST_TIMEOUT_MS = 60_000;
export const TTS_MAX_ATTEMPTS = 3;

const DISK_CACHE_DIR = path.resolve(process.cwd(), '.data', 'tts-cache');
const DISK_CACHE_STATS_FILE = path.join(DISK_CACHE_DIR, 'stats.json');

export function resolveVoiceForGender(
  requestedVoice: string | undefined,
  gender: 'male' | 'female' | undefined,
): GeminiVoiceId {
  return resolveVoiceProfile(requestedVoice, gender).voiceId;
}

export function buildConversationalStyle(input: {
  voiceName: GeminiVoiceId;
  gender?: 'male' | 'female';
  ageStyle?: VoiceAgeStyle;
  speakingStyle?: VoiceSpeakingStyle;
  speakingRate?: number;
  emotion?: string;
  speakerRole?: string;
  topic?: string;
  customStyle?: string;
}): string {
  const profile = resolveVoiceProfile(input.voiceName, input.gender, {
    ageStyle: input.ageStyle,
    speakingStyle: input.speakingStyle,
    speakingRate: input.speakingRate,
    emotion: input.emotion,
  });
  return buildRussianStylePrompt(profile, {
    speakerRole: input.speakerRole,
    topic: input.topic,
    customStyle: input.customStyle,
  });
}

export interface TtsSynthesisRequest {
  text: string;
  voiceName?: GeminiVoiceId;
  gender?: 'male' | 'female';
  ageStyle?: VoiceAgeStyle;
  speakingStyle?: VoiceSpeakingStyle;
  speakingRate?: number;
  emotion?: string;
  speakerRole?: string;
  topic?: string;
  previousSpeaker?: string;
  previousText?: string;
  style?: string;
  modelOverride?: TtsModelId;
  lessonId?: string;
  cefrLevel?: CefrLevel;
  forceRegenerate?: boolean;
  bypassDailyCooldown?: boolean;
}

export interface TtsDialogueTurn {
  speaker: string;
  text: string;
}

export interface TtsDialogueSpeaker {
  speaker: string;
  voiceName?: GeminiVoiceId;
  gender: 'male' | 'female';
  ageStyle?: VoiceAgeStyle;
  speakingStyle?: VoiceSpeakingStyle;
  speakingRate?: number;
  emotion?: string;
  role?: string;
}

export interface TtsDialogueRequest {
  speakers: TtsDialogueSpeaker[];
  turns: TtsDialogueTurn[];
  topic?: string;
  modelOverride?: TtsModelId;
  lessonId?: string;
  cefrLevel?: CefrLevel;
  forceRegenerate?: boolean;
  bypassDailyCooldown?: boolean;
}

export interface TtsSynthesisResult {
  audioBase64: string;
  mimeType: 'audio/wav';
  cached: boolean;
  cacheLayer?: 'memory' | 'disk' | 'upstream';
  provider: TtsModelId;
  providerId?: TtsProviderId;
  locale?: 'ru-RU';
  voiceName?: GeminiVoiceId;
  gender?: 'male' | 'female';
  cacheKey?: string;
  acoustics?: WavAcousticDiagnostics;
  retryCount?: number;
  queueWaitMs?: number;
  turnTimings?: { startSec: number; endSec: number; durationSec: number }[];
  turnWavsBase64?: string[];
  turnCacheHits?: number;
  turnUpstreamCalls?: number;
}

export interface TtsCacheStats {
  provider: TtsProviderId;
  primaryModel: TtsModelId;
  secondaryModel: TtsModelId;
  cacheSchemaVersion: string;
  memoryEntries: number;
  diskEntries: number;
  diskBytes: number;
  cacheHitsSaved: number;
  memoryHits: number;
  diskHits: number;
  upstreamCallsSucceeded: number;
  upstreamCallsFailed: number;
}

export interface TtsProvider {
  readonly name: string;
  isAvailable(): boolean;
  synthesize(req: TtsSynthesisRequest): Promise<TtsSynthesisResult>;
  synthesizeDialogue(req: TtsDialogueRequest): Promise<TtsSynthesisResult>;
}

export class TtsQuotaError extends Error {
  readonly classified: ClassifiedGeminiError;
  readonly retryCount: number;
  readonly status: number | null;

  constructor(classified: ClassifiedGeminiError, retryCount: number) {
    super(classified.safeMessage);
    this.name = 'TtsQuotaError';
    this.classified = classified;
    this.retryCount = retryCount;
    this.status = classified.httpStatus;
  }
}

interface CacheEntry {
  audioBase64: string;
  provider: TtsModelId;
  voiceName: GeminiVoiceId;
  gender: 'male' | 'female';
  acoustics?: WavAcousticDiagnostics;
}

interface PersistentCacheStatsFile {
  cacheHitsSaved: number;
  memoryHits: number;
  diskHits: number;
  upstreamCallsSucceeded: number;
  upstreamCallsFailed: number;
}

const MAX_MEMORY_CACHE_ENTRIES = 220;
const audioMemoryCache = new Map<string, CacheEntry>();

let cacheStatsState: PersistentCacheStatsFile = {
  cacheHitsSaved: 0,
  memoryHits: 0,
  diskHits: 0,
  upstreamCallsSucceeded: 0,
  upstreamCallsFailed: 0,
};
let statsLoaded = false;

function ensureDiskCacheDir(): void {
  try {
    fs.mkdirSync(DISK_CACHE_DIR, { recursive: true });
  } catch {
    // Ignore if filesystem is read-only
  }
}

function loadPersistentStatsOnce(): void {
  if (statsLoaded) return;
  statsLoaded = true;
  try {
    if (fs.existsSync(DISK_CACHE_STATS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DISK_CACHE_STATS_FILE, 'utf8')) as Partial<PersistentCacheStatsFile>;
      cacheStatsState = {
        cacheHitsSaved: Number(parsed.cacheHitsSaved) || 0,
        memoryHits: Number(parsed.memoryHits) || 0,
        diskHits: Number(parsed.diskHits) || 0,
        upstreamCallsSucceeded: Number(parsed.upstreamCallsSucceeded) || 0,
        upstreamCallsFailed: Number(parsed.upstreamCallsFailed) || 0,
      };
    }
  } catch {
    // Start fresh if corrupted
  }
}

function persistStatsSafe(): void {
  try {
    ensureDiskCacheDir();
    const tmp = `${DISK_CACHE_STATS_FILE}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(cacheStatsState, null, 2), 'utf8');
    fs.renameSync(tmp, DISK_CACHE_STATS_FILE);
  } catch {
    // Non-fatal
  }
}

function recordCacheHit(layer: 'memory' | 'disk'): void {
  loadPersistentStatsOnce();
  cacheStatsState.cacheHitsSaved += 1;
  if (layer === 'memory') cacheStatsState.memoryHits += 1;
  else cacheStatsState.diskHits += 1;
  persistStatsSafe();
}

function recordUpstreamCall(ok: boolean): void {
  loadPersistentStatsOnce();
  if (ok) cacheStatsState.upstreamCallsSucceeded += 1;
  else cacheStatsState.upstreamCallsFailed += 1;
  persistStatsSafe();
}

function stripCombiningAcute(str: string): string {
  return str.normalize('NFC').replace(/\u0301/g, '').trim();
}

function hashCacheKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function setMemoryCache(key: string, entry: CacheEntry): void {
  if (!entry.audioBase64 || entry.audioBase64.length < 64) return;
  if (audioMemoryCache.size >= MAX_MEMORY_CACHE_ENTRIES) {
    const oldestKey = audioMemoryCache.keys().next().value;
    if (oldestKey) audioMemoryCache.delete(oldestKey);
  }
  audioMemoryCache.set(key, entry);
}

function getDiskCachePaths(hashKey: string): { wavPath: string; metaPath: string } {
  const safe = /^[a-f0-9]{64}$/.test(hashKey) ? hashKey : hashCacheKey(hashKey);
  return {
    wavPath: path.join(DISK_CACHE_DIR, `${safe}.wav`),
    metaPath: path.join(DISK_CACHE_DIR, `${safe}.json`),
  };
}

function readDiskCacheEntry(hashKey: string): CacheEntry | null {
  try {
    const { wavPath, metaPath } = getDiskCachePaths(hashKey);
    if (!fs.existsSync(wavPath)) return null;
    const wavBuf = fs.readFileSync(wavPath);
    const acoustics = analyzeWavAcoustics(wavBuf);
    if (!acoustics.valid) {
      return null;
    }
    let meta: Partial<CacheEntry> = {};
    if (fs.existsSync(metaPath)) {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Partial<CacheEntry>;
    }
    const entry: CacheEntry = {
      audioBase64: wavBuf.toString('base64'),
      provider: (meta.provider as TtsModelId) ?? CONFIGURED_TTS_MODEL,
      voiceName: (meta.voiceName as GeminiVoiceId) ?? 'Sulafat',
      gender: meta.gender === 'male' ? 'male' : 'female',
      acoustics,
    };
    setMemoryCache(hashKey, entry);
    return entry;
  } catch {
    return null;
  }
}

function writeDiskCacheEntry(hashKey: string, wavBuf: Buffer, entry: CacheEntry): void {
  const acoustics = analyzeWavAcoustics(wavBuf);
  if (!acoustics.valid) {
    // NEVER write empty, silent, or invalid audio to disk cache
    return;
  }
  try {
    ensureDiskCacheDir();
    const { wavPath, metaPath } = getDiskCachePaths(hashKey);
    const tmpWav = `${wavPath}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
    const tmpMeta = `${metaPath}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
    fs.writeFileSync(tmpWav, wavBuf);
    fs.renameSync(tmpWav, wavPath);
    fs.writeFileSync(
      tmpMeta,
      JSON.stringify({
        provider: entry.provider,
        voiceName: entry.voiceName,
        gender: entry.gender,
        acoustics,
        cachedAt: new Date().toISOString(),
      }),
      'utf8',
    );
    fs.renameSync(tmpMeta, metaPath);
  } catch {
    // Non-fatal if disk write fails
  }
}

export function getTtsCacheStats(): TtsCacheStats {
  loadPersistentStatsOnce();
  let diskEntries = 0;
  let diskBytes = 0;
  try {
    if (fs.existsSync(DISK_CACHE_DIR)) {
      for (const file of fs.readdirSync(DISK_CACHE_DIR)) {
        if (file.endsWith('.wav')) {
          diskEntries += 1;
          diskBytes += fs.statSync(path.join(DISK_CACHE_DIR, file)).size;
        }
      }
    }
  } catch {
    // Ignore
  }

  return {
    provider: DEFAULT_TTS_PROVIDER,
    primaryModel: CONFIGURED_TTS_MODEL,
    secondaryModel: SECONDARY_FREE_TTS_MODEL,
    cacheSchemaVersion: VOICE_CACHE_SCHEMA_VERSION,
    memoryEntries: audioMemoryCache.size,
    diskEntries,
    diskBytes,
    cacheHitsSaved: cacheStatsState.cacheHitsSaved,
    memoryHits: cacheStatsState.memoryHits,
    diskHits: cacheStatsState.diskHits,
    upstreamCallsSucceeded: cacheStatsState.upstreamCallsSucceeded,
    upstreamCallsFailed: cacheStatsState.upstreamCallsFailed,
  };
}

export function clearMemoryTtsCacheForTest(): void {
  audioMemoryCache.clear();
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function executeTtsWithSmartRetry<T>(options: {
  model: string;
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  randomFn?: () => number;
  onRateLimit?: (delayMs: number) => void;
  invoke: (signal: AbortSignal, attempt: number) => Promise<T>;
}): Promise<{ value: T; retryCount: number }> {
  const maxAttempts = Math.min(3, Math.max(1, options.maxAttempts ?? TTS_MAX_ATTEMPTS));
  const timeoutMs = options.timeoutMs ?? TTS_REQUEST_TIMEOUT_MS;
  const sleep = options.sleepFn ?? defaultSleep;
  let retriesPerformed = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const value = await options.invoke(controller.signal, attempt);
      clearTimeout(timer);
      return { value, retryCount: retriesPerformed };
    } catch (err) {
      clearTimeout(timer);
      const effectiveErr =
        controller.signal.aborted &&
        !(err instanceof Error && err.message.toLowerCase().includes('timed out'))
          ? new Error(
              `TTS audio synthesis timed out after ${Math.round(timeoutMs / 1000)}s (model: ${options.model}).`,
            )
          : err;

      const classified = classifyGeminiError(effectiveErr);

      // Stop immediately on daily quota exhaustion, auth errors, invalid args, or model_not_found
      if (!classified.retryable || attempt >= maxAttempts) {
        throw new TtsQuotaError(classified, retriesPerformed);
      }

      retriesPerformed += 1;
      const delayMs = computeBackoffDelayMs({
        attempt,
        retryAfterMs: classified.retryAfterMs,
        baseDelayMs: options.baseDelayMs ?? 2500,
        maxDelayMs: options.maxDelayMs ?? 35_000,
        randomFn: options.randomFn,
      });

      if (classified.category === 'rate_limit_temporary') {
        options.onRateLimit?.(delayMs);
      }

      await sleep(delayMs);
    }
  }

  throw new TtsQuotaError(
    classifyGeminiError(new Error('TTS failed after max attempts.')),
    retriesPerformed,
  );
}

/**
 * Invokes Gemini TTS with `languageCode: 'ru-RU'` and exact gender-locked voiceId.
 * If the API specifically rejects `languageCode` with HTTP 400 INVALID_ARGUMENT,
 * retries once without `languageCode` while keeping the EXACT same voiceId and gender.
 */
async function callGeminiSingleTts(options: {
  model: TtsModelId;
  text: string;
  style: string;
  voiceProfile: VoiceConfigProfile;
  signal: AbortSignal;
}): Promise<Buffer> {
  const ai = createGeminiTtsClient(TTS_REQUEST_TIMEOUT_MS);

  const invokeWithLanguageCode = async (includeLangCode: boolean): Promise<Buffer> => {
    const response = await ai.models.generateContent({
      model: options.model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: options.text,
              speechMetadata: { style: options.style },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        abortSignal: options.signal,
        httpOptions: { timeout: TTS_REQUEST_TIMEOUT_MS },
        speechConfig: {
          ...(includeLangCode ? { languageCode: options.voiceProfile.locale } : {}),
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: options.voiceProfile.voiceId },
          },
        },
      },
    });

    const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!data || data.length < 64) {
      throw new Error('TTS provider returned empty audio data.');
    }
    const wavBuf = ensureWavBuffer(Buffer.from(data, 'base64'), 24000);
    const acoustics = analyzeWavAcoustics(wavBuf);
    if (!acoustics.valid) {
      throw new Error(
        `TTS provider returned invalid or silent audio (bytes=${acoustics.bytes}, duration=${acoustics.durationSec}s, rms=${acoustics.rms}).`,
      );
    }
    return wavBuf;
  };

  try {
    return await invokeWithLanguageCode(true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const classified = classifyGeminiError(err);
    if (
      classified.category === 'invalid_request' &&
      /language_?code|speech_?config/i.test(msg)
    ) {
      return await invokeWithLanguageCode(false);
    }
    throw err;
  }
}

export class GeminiRussianTtsProvider implements TtsProvider {
  readonly name: TtsModelId = CONFIGURED_TTS_MODEL;
  private readonly queue: TtsRequestQueue;

  constructor(queue: TtsRequestQueue = globalTtsQueue) {
    this.queue = queue;
  }

  isAvailable(): boolean {
    return isGeminiConfigured();
  }

  private resolveActiveModel(requestedModel?: TtsModelId): TtsModelId {
    const primary: TtsModelId = requestedModel ?? this.name;
    // If primary model is currently blocked by daily quota, automatically check if the other
    // Free-Tier Gemini TTS model is NOT blocked — strictly $0 Free Tier, never paid models.
    if (
      !requestedModel &&
      this.queue.isDailyQuotaBlocked(primary) &&
      !this.queue.isDailyQuotaBlocked(SECONDARY_FREE_TTS_MODEL)
    ) {
      return SECONDARY_FREE_TTS_MODEL;
    }
    return primary;
  }

  async synthesize(req: TtsSynthesisRequest): Promise<TtsSynthesisResult> {
    const cleanText = stripCombiningAcute(req.text);
    if (!cleanText) {
      throw new Error('Empty text cannot be synthesized.');
    }

    const activeModel = this.resolveActiveModel(req.modelOverride);
    const voiceProfile = resolveVoiceProfile(req.voiceName, req.gender, {
      model: activeModel,
      ageStyle: req.ageStyle,
      speakingStyle: req.speakingStyle,
      speakingRate: req.speakingRate,
      emotion: req.emotion,
    });

    const style = buildRussianStylePrompt(voiceProfile, {
      speakerRole: req.speakerRole,
      topic: req.topic,
      customStyle: req.style,
    });

    const buildKeyForModel = (modelId: TtsModelId): string =>
      hashCacheKey(
        buildVoiceCacheSignature({
          text: cleanText,
          provider: DEFAULT_TTS_PROVIDER,
          model: modelId,
          voiceId: voiceProfile.voiceId,
          locale: DEFAULT_TTS_LOCALE,
          gender: voiceProfile.gender,
          ageStyle: voiceProfile.ageStyle,
          speakingStyle: voiceProfile.speakingStyle,
          speakingRate: voiceProfile.speakingRate,
          pitch: voiceProfile.pitch,
          emotion: voiceProfile.emotion,
          stylePrompt: style,
        }),
      );

    const cacheKey = buildKeyForModel(activeModel);

    // 1. Check in-memory cache first, then persistent disk cache (0 API calls!)
    // When no explicit modelOverride is specified, check both Free-Tier models so quota rollover
    // never misses a valid cached WAV already generated by the other Free-Tier model.
    if (!req.forceRegenerate) {
      const candidateModels: TtsModelId[] = req.modelOverride
        ? [activeModel]
        : Array.from(new Set<TtsModelId>([activeModel, this.name, SECONDARY_FREE_TTS_MODEL]));

      for (const candidateModel of candidateModels) {
        const candidateKey = buildKeyForModel(candidateModel);
        const memHit = audioMemoryCache.get(candidateKey);
        if (memHit) {
          recordCacheHit('memory');
          recordGeminiMonitoringEvent({
            requestType: 'tts_single',
            model: memHit.provider,
            lessonId: req.lessonId ?? null,
            cefrLevel: req.cefrLevel ?? null,
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
            audioBase64: memHit.audioBase64,
            mimeType: 'audio/wav',
            cached: true,
            cacheLayer: 'memory',
            provider: memHit.provider,
            providerId: DEFAULT_TTS_PROVIDER,
            locale: DEFAULT_TTS_LOCALE,
            voiceName: memHit.voiceName,
            gender: memHit.gender,
            cacheKey: candidateKey,
            acoustics: memHit.acoustics,
            retryCount: 0,
            queueWaitMs: 0,
          };
        }
      }

      for (const candidateModel of candidateModels) {
        const candidateKey = buildKeyForModel(candidateModel);
        const diskHit = readDiskCacheEntry(candidateKey);
        if (diskHit) {
          recordCacheHit('disk');
          recordGeminiMonitoringEvent({
            requestType: 'tts_single',
            model: diskHit.provider,
            lessonId: req.lessonId ?? null,
            cefrLevel: req.cefrLevel ?? null,
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
            audioBase64: diskHit.audioBase64,
            mimeType: 'audio/wav',
            cached: true,
            cacheLayer: 'disk',
            provider: diskHit.provider,
            providerId: DEFAULT_TTS_PROVIDER,
            locale: DEFAULT_TTS_LOCALE,
            voiceName: diskHit.voiceName,
            gender: diskHit.gender,
            cacheKey: candidateKey,
            acoustics: diskHit.acoustics,
            retryCount: 0,
            queueWaitMs: 0,
          };
        }
      }
    }

    // 2. Fail fast if daily quota is exhausted for this model (0 wasted API calls!)
    if (this.queue.isDailyQuotaBlocked(activeModel) && !req.bypassDailyCooldown) {
      const classified = classifyGeminiError(
        new Error(
          `429 RESOURCE_EXHAUSTED: Daily quota previously exhausted for Free Tier Gemini TTS (${activeModel}).`,
        ),
      );
      throw new TtsQuotaError(classified, 0);
    }

    const idempotencyKey = `tts_single::${cacheKey}`;

    return this.queue.enqueue<TtsSynthesisResult>({
      idempotencyKey,
      lessonId: req.lessonId ?? null,
      cefrLevel: req.cefrLevel ?? null,
      model: activeModel,
      requestType: 'tts_single',
      task: async ({ queueWaitMs }) => {
        // Double-check cache after queue wait in case an earlier queued job already generated it
        if (!req.forceRegenerate) {
          const cachedAfterWait = audioMemoryCache.get(cacheKey) ?? readDiskCacheEntry(cacheKey);
          if (cachedAfterWait) {
            recordCacheHit('memory');
            return {
              result: {
                audioBase64: cachedAfterWait.audioBase64,
                mimeType: 'audio/wav',
                cached: true,
                cacheLayer: 'memory',
                provider: cachedAfterWait.provider,
                providerId: DEFAULT_TTS_PROVIDER,
                locale: DEFAULT_TTS_LOCALE,
                voiceName: cachedAfterWait.voiceName,
                gender: cachedAfterWait.gender,
                cacheKey,
                acoustics: cachedAfterWait.acoustics,
                retryCount: 0,
                queueWaitMs,
              },
              reusedFromCache: true,
              retryCount: 0,
              httpStatus: 200,
              model: cachedAfterWait.provider,
            };
          }
        }

        let usedModel: TtsModelId = activeModel;
        let wavBuf: Buffer;
        let retryCount = 0;

        try {
          const res = await executeTtsWithSmartRetry({
            model: usedModel,
            timeoutMs: TTS_REQUEST_TIMEOUT_MS,
            maxAttempts: TTS_MAX_ATTEMPTS,
            onRateLimit: (delayMs) => this.queue.noteRateLimitCooldown(delayMs),
            invoke: async (signal) =>
              callGeminiSingleTts({
                model: usedModel,
                text: cleanText,
                style,
                voiceProfile,
                signal,
              }),
          });
          wavBuf = res.value;
          retryCount = res.retryCount;
        } catch (err) {
          const classified = err instanceof TtsQuotaError ? err.classified : classifyGeminiError(err);

          // If primary Free-Tier model hit daily quota or 404 AND secondary Free-Tier model is available
          // and not blocked, try the secondary Free-Tier model ONCE with the EXACT SAME gender-locked voiceId!
          const canTrySecondaryFreeModel =
            !req.modelOverride &&
            (classified.category === 'daily_quota_exhausted' ||
              classified.category === 'model_not_found') &&
            usedModel !== SECONDARY_FREE_TTS_MODEL &&
            !this.queue.isDailyQuotaBlocked(SECONDARY_FREE_TTS_MODEL);

          if (classified.category === 'daily_quota_exhausted') {
            this.queue.noteDailyQuotaExhausted(usedModel, classified.retryAfterMs);
          }

          if (!canTrySecondaryFreeModel) {
            recordUpstreamCall(false);
            throw err;
          }

          usedModel = SECONDARY_FREE_TTS_MODEL;
          try {
            const fallbackProfile = resolveVoiceProfile(voiceProfile.voiceId, voiceProfile.gender, {
              model: usedModel,
              ageStyle: voiceProfile.ageStyle,
              speakingStyle: voiceProfile.speakingStyle,
              speakingRate: voiceProfile.speakingRate,
              emotion: voiceProfile.emotion,
            });
            const res2 = await executeTtsWithSmartRetry({
              model: usedModel,
              timeoutMs: TTS_REQUEST_TIMEOUT_MS,
              maxAttempts: 2,
              onRateLimit: (delayMs) => this.queue.noteRateLimitCooldown(delayMs),
              invoke: async (signal) =>
                callGeminiSingleTts({
                  model: usedModel,
                  text: cleanText,
                  style,
                  voiceProfile: fallbackProfile,
                  signal,
                }),
            });
            wavBuf = res2.value;
            retryCount += res2.retryCount;
          } catch (err2) {
            recordUpstreamCall(false);
            throw err2;
          }
        }

        recordUpstreamCall(true);
        const acoustics = analyzeWavAcoustics(wavBuf);
        const audioBase64 = wavBuf.toString('base64');

        // Compute cache key for the ACTUAL model that produced the audio (prevent cross-model cache pollution)
        const actualSignature = buildVoiceCacheSignature({
          text: cleanText,
          provider: DEFAULT_TTS_PROVIDER,
          model: usedModel,
          voiceId: voiceProfile.voiceId,
          locale: DEFAULT_TTS_LOCALE,
          gender: voiceProfile.gender,
          ageStyle: voiceProfile.ageStyle,
          speakingStyle: voiceProfile.speakingStyle,
          speakingRate: voiceProfile.speakingRate,
          pitch: voiceProfile.pitch,
          emotion: voiceProfile.emotion,
          stylePrompt: style,
        });
        const actualCacheKey = hashCacheKey(actualSignature);
        const entry: CacheEntry = {
          audioBase64,
          provider: usedModel,
          voiceName: voiceProfile.voiceId,
          gender: voiceProfile.gender,
          acoustics,
        };
        setMemoryCache(actualCacheKey, entry);
        writeDiskCacheEntry(actualCacheKey, wavBuf, entry);

        return {
          result: {
            audioBase64,
            mimeType: 'audio/wav',
            cached: false,
            cacheLayer: 'upstream',
            provider: usedModel,
            providerId: DEFAULT_TTS_PROVIDER,
            locale: DEFAULT_TTS_LOCALE,
            voiceName: voiceProfile.voiceId,
            gender: voiceProfile.gender,
            cacheKey: actualCacheKey,
            acoustics,
            retryCount,
            queueWaitMs,
          },
          reusedFromCache: false,
          retryCount,
          httpStatus: 200,
          model: usedModel,
        };
      },
    });
  }

  /**
   * Multi-speaker dialogue synthesis supporting 1, 2, 3, or N speakers!
   * Uses strict per-turn synthesis with distinct gender-locked VoiceConfigProfiles +
   * sample-accurate WAV stitching with natural speaker-switch pauses (360ms / 210ms).
   *
   * Benefits for Free Tier & Audio Quality:
   * - Supports 2, 3, or more speakers with zero voice collision and zero gender drift.
   * - Reuses persistent per-sentence disk cache for EVERY turn (playing full dialogue
   *   then replaying individual sentences costs 0 extra TTS calls!).
   * - Produces exact sample-accurate timings and individual turn WAVs (never chops mid-word!).
   */
  async synthesizeDialogue(req: TtsDialogueRequest): Promise<TtsSynthesisResult> {
    if (!Array.isArray(req.speakers) || req.speakers.length === 0) {
      throw new Error('Dialogue synthesis requires at least 1 speaker.');
    }

    const cleanTurns = req.turns
      .map((t) => ({
        speaker: stripCombiningAcute(t.speaker),
        text: stripCombiningAcute(t.text),
      }))
      .filter((t) => t.speaker && t.text);

    if (cleanTurns.length === 0) {
      throw new Error('Dialogue turns cannot be empty.');
    }

    const assignedSpeakers = assignDistinctSpeakerVoices(
      req.speakers.map((sp) => ({
        name: stripCombiningAcute(sp.speaker),
        roleVi: sp.role ?? '',
        roleEn: sp.role ?? '',
        voiceName: sp.voiceName,
        gender: sp.gender,
        ageStyle: sp.ageStyle,
        speakingStyle: sp.speakingStyle ?? 'conversational',
        speakingRate: sp.speakingRate,
        emotion: sp.emotion,
      })),
    );

    const turnWavs: { speaker: string; wav: Buffer }[] = [];
    const turnWavsBase64: string[] = [];
    let turnCacheHits = 0;
    let turnUpstreamCalls = 0;
    let totalRetries = 0;
    let totalQueueWaitMs = 0;
    let lastProvider: TtsModelId = req.modelOverride ?? this.name;

    for (let i = 0; i < cleanTurns.length; i += 1) {
      const turn = cleanTurns[i];
      const matchedSpeaker =
        findSpeakerProfile(assignedSpeakers, turn.speaker) ?? assignedSpeakers[0];

      const singleRes = await this.synthesize({
        text: turn.text,
        voiceName: matchedSpeaker.voiceName,
        gender: matchedSpeaker.gender,
        ageStyle: matchedSpeaker.ageStyle,
        speakingStyle: matchedSpeaker.speakingStyle ?? 'conversational',
        speakingRate: matchedSpeaker.speakingRate,
        emotion: matchedSpeaker.emotion,
        speakerRole: matchedSpeaker.roleEn || matchedSpeaker.roleVi || undefined,
        topic: req.topic,
        modelOverride: req.modelOverride,
        lessonId: req.lessonId ? `${req.lessonId}-t${i + 1}` : undefined,
        cefrLevel: req.cefrLevel,
        forceRegenerate: req.forceRegenerate,
        bypassDailyCooldown: req.bypassDailyCooldown,
      });

      if (singleRes.cached) turnCacheHits += 1;
      else turnUpstreamCalls += 1;
      totalRetries += singleRes.retryCount ?? 0;
      totalQueueWaitMs += singleRes.queueWaitMs ?? 0;
      lastProvider = singleRes.provider;

      const wavBuf = ensureWavBuffer(Buffer.from(singleRes.audioBase64, 'base64'), 24000);
      turnWavs.push({ speaker: matchedSpeaker.name, wav: wavBuf });
      turnWavsBase64.push(wavBuf.toString('base64'));
    }

    const stitched = concatenateWavSegmentsWithTurnPauses(turnWavs, {
      sameSpeakerPauseMs: 210,
      speakerSwitchPauseMs: 360,
    });
    const acoustics = analyzeWavAcoustics(stitched.fullWav);

    return {
      audioBase64: stitched.fullWav.toString('base64'),
      mimeType: 'audio/wav',
      cached: turnUpstreamCalls === 0 && turnCacheHits > 0,
      cacheLayer: turnUpstreamCalls === 0 ? 'disk' : 'upstream',
      provider: lastProvider,
      providerId: DEFAULT_TTS_PROVIDER,
      locale: DEFAULT_TTS_LOCALE,
      acoustics,
      retryCount: totalRetries,
      queueWaitMs: totalQueueWaitMs,
      turnTimings: stitched.timings,
      turnWavsBase64,
      turnCacheHits,
      turnUpstreamCalls,
    };
  }
}

export const ttsProvider: TtsProvider = new GeminiRussianTtsProvider();
