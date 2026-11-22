import crypto from 'node:crypto';
import type { CefrLevel } from '../src/types/domain.ts';
import {
  classifyGeminiError,
  computeBackoffDelayMs,
  globalTtsQueue,
  recordGeminiMonitoringEvent,
  type ClassifiedGeminiError,
  type TtsRequestQueue,
} from './geminiQuotaManager.ts';
import { createGeminiTtsClient, isGeminiConfigured } from './geminiService.ts';

export type GeminiVoiceName = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export const FEMALE_VOICES: readonly GeminiVoiceName[] = ['Kore', 'Zephyr'];
export const MALE_VOICES: readonly GeminiVoiceName[] = ['Puck', 'Charon', 'Fenrir'];

export const CONFIGURED_TTS_MODEL: 'gemini-3.8-flash-tts' | 'gemini-3.8-flash-lite-tts' =
  process.env.GEMINI_TTS_MODEL?.trim() === 'gemini-3.8-flash-lite-tts'
    ? 'gemini-3.8-flash-lite-tts'
    : 'gemini-3.8-flash-tts';

export const TTS_REQUEST_TIMEOUT_MS = 60_000;
export const TTS_MAX_ATTEMPTS = 3;

const VOICE_PERSONA_STYLE: Record<GeminiVoiceName, string> = {
  Kore: 'Warm, expressive adult Russian woman speaking naturally in fluent standard Russian with authentic Moscow intonation, gentle conversational rhythm, and natural phrasing',
  Zephyr:
    'Bright, lively young Russian woman speaking in natural everyday Russian with authentic emotional inflection, smooth connected speech, and clear pronunciation',
  Puck: 'Natural, friendly young adult Russian man speaking casually and expressively in everyday Russian with warm conversational pacing and relaxed intonation',
  Charon:
    'Calm, confident mature Russian man with a deeper baritone voice, speaking naturally and thoughtfully with authentic Russian cadence and subtle conversational pauses',
  Fenrir:
    'Grounded, articulate adult Russian man speaking in clear, natural conversational Russian with authentic stress rhythm and steady tone',
};

export function resolveVoiceForGender(
  requestedVoice: string | undefined,
  gender: 'male' | 'female' | undefined,
): GeminiVoiceName {
  const validVoices: readonly GeminiVoiceName[] = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];
  const isKnown = validVoices.includes(requestedVoice as GeminiVoiceName);

  if (gender === 'female') {
    if (isKnown && FEMALE_VOICES.includes(requestedVoice as GeminiVoiceName)) {
      return requestedVoice as GeminiVoiceName;
    }
    return 'Kore';
  }

  if (gender === 'male') {
    if (isKnown && MALE_VOICES.includes(requestedVoice as GeminiVoiceName)) {
      return requestedVoice as GeminiVoiceName;
    }
    return 'Puck';
  }

  return isKnown ? (requestedVoice as GeminiVoiceName) : 'Kore';
}

export function buildConversationalStyle(input: {
  voiceName: GeminiVoiceName;
  gender?: 'male' | 'female';
  speakerRole?: string;
  topic?: string;
  previousSpeaker?: string;
  previousText?: string;
  customStyle?: string;
}): string {
  const basePersona = VOICE_PERSONA_STYLE[input.voiceName];
  const parts: string[] = [basePersona];

  if (input.speakerRole) {
    parts.push(`Character role: ${input.speakerRole}.`);
  }
  if (input.topic) {
    parts.push(`Conversation setting/topic: ${input.topic}.`);
  }
  if (input.previousText && input.previousSpeaker) {
    parts.push(
      `Replying naturally in an ongoing dialogue right after ${input.previousSpeaker} said: "${input.previousText.slice(0, 120)}".`,
    );
  } else {
    parts.push('Speak like a real person in a live conversation, never like a robotic announcer.');
  }
  if (input.customStyle) {
    parts.push(input.customStyle);
  }

  return parts.join(' ').slice(0, 480);
}

export interface TtsSynthesisRequest {
  text: string;
  voiceName?: GeminiVoiceName;
  gender?: 'male' | 'female';
  speakerRole?: string;
  topic?: string;
  previousSpeaker?: string;
  previousText?: string;
  style?: string;
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
  voiceName?: GeminiVoiceName;
  gender: 'male' | 'female';
  role?: string;
}

export interface TtsDialogueRequest {
  speakers: TtsDialogueSpeaker[];
  turns: TtsDialogueTurn[];
  topic?: string;
  lessonId?: string;
  cefrLevel?: CefrLevel;
  forceRegenerate?: boolean;
  bypassDailyCooldown?: boolean;
}

export interface TtsSynthesisResult {
  audioBase64: string;
  mimeType: 'audio/wav';
  cached: boolean;
  provider: 'gemini-3.8-flash-tts' | 'gemini-3.8-flash-lite-tts';
  voiceName?: GeminiVoiceName;
  retryCount?: number;
  queueWaitMs?: number;
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

const MAX_CACHE_ENTRIES = 160;
const audioCache = new Map<
  string,
  { audioBase64: string; provider: 'gemini-3.8-flash-tts' | 'gemini-3.8-flash-lite-tts' }
>();

function stripCombiningAcute(str: string): string {
  return str.normalize('NFC').replace(/\u0301/g, '').trim();
}

function makeCacheKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function setBoundedCache(
  key: string,
  value: { audioBase64: string; provider: 'gemini-3.8-flash-tts' | 'gemini-3.8-flash-lite-tts' },
): void {
  if (!value.audioBase64 || value.audioBase64.length < 64) {
    return;
  }
  if (audioCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = audioCache.keys().next().value;
    if (oldestKey) audioCache.delete(oldestKey);
  }
  audioCache.set(key, value);
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
        controller.signal.aborted && !(err instanceof Error && err.message.toLowerCase().includes('timed out'))
          ? new Error(`TTS audio synthesis timed out after ${Math.round(timeoutMs / 1000)}s (model: ${options.model}).`)
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

  throw new TtsQuotaError(classifyGeminiError(new Error('TTS failed after max attempts.')), retriesPerformed);
}

export class GeminiRussianTtsProvider implements TtsProvider {
  readonly name: 'gemini-3.8-flash-tts' | 'gemini-3.8-flash-lite-tts' = CONFIGURED_TTS_MODEL;
  private readonly queue: TtsRequestQueue;

  constructor(queue: TtsRequestQueue = globalTtsQueue) {
    this.queue = queue;
  }

  isAvailable(): boolean {
    return isGeminiConfigured();
  }

  async synthesize(req: TtsSynthesisRequest): Promise<TtsSynthesisResult> {
    const cleanText = stripCombiningAcute(req.text);
    if (!cleanText) {
      throw new Error('Empty text cannot be synthesized.');
    }

    const voiceName = resolveVoiceForGender(req.voiceName, req.gender);
    const style = buildConversationalStyle({
      voiceName,
      gender: req.gender,
      speakerRole: req.speakerRole,
      topic: req.topic,
      previousSpeaker: req.previousSpeaker ? stripCombiningAcute(req.previousSpeaker) : undefined,
      previousText: req.previousText ? stripCombiningAcute(req.previousText) : undefined,
      customStyle: req.style,
    });

    const cacheKey = makeCacheKey(`single::v3::${this.name}::${voiceName}::${style}::${cleanText}`);
    if (!req.forceRegenerate) {
      const hit = audioCache.get(cacheKey);
      if (hit) {
        recordGeminiMonitoringEvent({
          requestType: 'tts_single',
          model: hit.provider,
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
          audioBase64: hit.audioBase64,
          mimeType: 'audio/wav',
          cached: true,
          provider: hit.provider,
          voiceName,
          retryCount: 0,
          queueWaitMs: 0,
        };
      }
    }

    if (this.queue.isDailyQuotaBlocked() && !req.bypassDailyCooldown) {
      const classified = classifyGeminiError(
        new Error('429 RESOURCE_EXHAUSTED: Daily quota previously exhausted for Gemini TTS.'),
      );
      throw new TtsQuotaError(classified, 0);
    }

    const idempotencyKey = req.lessonId
      ? `tts_single::${req.lessonId}::${cacheKey}`
      : `tts_single::${cacheKey}`;

    return this.queue.enqueue<TtsSynthesisResult>({
      idempotencyKey,
      lessonId: req.lessonId ?? null,
      cefrLevel: req.cefrLevel ?? null,
      model: this.name,
      requestType: 'tts_single',
      task: async ({ queueWaitMs }) => {
        if (!req.forceRegenerate) {
          const cachedAfterWait = audioCache.get(cacheKey);
          if (cachedAfterWait) {
            return {
              result: {
                audioBase64: cachedAfterWait.audioBase64,
                mimeType: 'audio/wav',
                cached: true,
                provider: cachedAfterWait.provider,
                voiceName,
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

        const { value: base64Audio, retryCount } = await executeTtsWithSmartRetry({
          model: this.name,
          timeoutMs: TTS_REQUEST_TIMEOUT_MS,
          maxAttempts: TTS_MAX_ATTEMPTS,
          onRateLimit: (delayMs) => this.queue.noteRateLimitCooldown(delayMs),
          invoke: async (signal) => {
            const ai = createGeminiTtsClient(TTS_REQUEST_TIMEOUT_MS);
            const response = await ai.models.generateContent({
              model: this.name,
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      text: cleanText,
                      speechMetadata: { style },
                    },
                  ],
                },
              ],
              config: {
                responseModalities: ['AUDIO'],
                abortSignal: signal,
                httpOptions: { timeout: TTS_REQUEST_TIMEOUT_MS },
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName },
                  },
                },
              },
            });

            const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (!data || data.length < 64) {
              throw new Error('TTS provider returned empty audio data.');
            }
            return data;
          },
        });

        setBoundedCache(cacheKey, { audioBase64: base64Audio, provider: this.name });
        return {
          result: {
            audioBase64: base64Audio,
            mimeType: 'audio/wav',
            cached: false,
            provider: this.name,
            voiceName,
            retryCount,
            queueWaitMs,
          },
          reusedFromCache: false,
          retryCount,
          httpStatus: 200,
          model: this.name,
        };
      },
    });
  }

  async synthesizeDialogue(req: TtsDialogueRequest): Promise<TtsSynthesisResult> {
    if (req.speakers.length !== 2) {
      throw new Error('Multi-speaker dialogue synthesis requires exactly 2 speakers.');
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

    const usedVoices = new Set<GeminiVoiceName>();
    const speakerConfigs = req.speakers.map((sp) => {
      const cleanName = stripCombiningAcute(sp.speaker);
      let voiceName = resolveVoiceForGender(sp.voiceName, sp.gender);
      if (usedVoices.has(voiceName)) {
        const pool = sp.gender === 'female' ? FEMALE_VOICES : MALE_VOICES;
        const alt = pool.find((v) => !usedVoices.has(v));
        if (alt) voiceName = alt;
      }
      usedVoices.add(voiceName);

      return {
        speaker: cleanName,
        gender: sp.gender,
        role: sp.role,
        voiceName,
      };
    });

    const speakerMap = new Map(speakerConfigs.map((s) => [s.speaker, s]));

    const serializedKey = JSON.stringify({
      v: 3,
      model: this.name,
      topic: req.topic,
      speakers: speakerConfigs,
      turns: cleanTurns,
    });
    const cacheKey = makeCacheKey(`dialogue::${serializedKey}`);

    if (!req.forceRegenerate) {
      const hit = audioCache.get(cacheKey);
      if (hit) {
        recordGeminiMonitoringEvent({
          requestType: 'tts_dialogue',
          model: hit.provider,
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
          audioBase64: hit.audioBase64,
          mimeType: 'audio/wav',
          cached: true,
          provider: hit.provider,
          retryCount: 0,
          queueWaitMs: 0,
        };
      }
    }

    if (this.queue.isDailyQuotaBlocked() && !req.bypassDailyCooldown) {
      const classified = classifyGeminiError(
        new Error('429 RESOURCE_EXHAUSTED: Daily quota previously exhausted for Gemini TTS.'),
      );
      throw new TtsQuotaError(classified, 0);
    }

    const parts = cleanTurns.map((turn) => {
      const sp = speakerMap.get(turn.speaker) ?? speakerConfigs[0];
      const style = buildConversationalStyle({
        voiceName: sp.voiceName,
        gender: sp.gender,
        speakerRole: sp.role,
        topic: req.topic,
      });
      return {
        text: `${sp.speaker}: ${turn.text}`,
        speechMetadata: {
          speaker: sp.speaker,
          style,
        },
      };
    });

    const idempotencyKey = req.lessonId
      ? `tts_dialogue::${req.lessonId}::${cacheKey}`
      : `tts_dialogue::${cacheKey}`;

    return this.queue.enqueue<TtsSynthesisResult>({
      idempotencyKey,
      lessonId: req.lessonId ?? null,
      cefrLevel: req.cefrLevel ?? null,
      model: this.name,
      requestType: 'tts_dialogue',
      task: async ({ queueWaitMs }) => {
        if (!req.forceRegenerate) {
          const cachedAfterWait = audioCache.get(cacheKey);
          if (cachedAfterWait) {
            return {
              result: {
                audioBase64: cachedAfterWait.audioBase64,
                mimeType: 'audio/wav',
                cached: true,
                provider: cachedAfterWait.provider,
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

        const { value: base64Audio, retryCount } = await executeTtsWithSmartRetry({
          model: this.name,
          timeoutMs: TTS_REQUEST_TIMEOUT_MS,
          maxAttempts: TTS_MAX_ATTEMPTS,
          onRateLimit: (delayMs) => this.queue.noteRateLimitCooldown(delayMs),
          invoke: async (signal) => {
            const ai = createGeminiTtsClient(TTS_REQUEST_TIMEOUT_MS);
            const response = await ai.models.generateContent({
              model: this.name,
              contents: [
                {
                  role: 'user',
                  parts,
                },
              ],
              config: {
                responseModalities: ['AUDIO'],
                abortSignal: signal,
                httpOptions: { timeout: TTS_REQUEST_TIMEOUT_MS },
                speechConfig: {
                  multiSpeakerVoiceConfig: {
                    speakerVoiceConfigs: speakerConfigs.map((sp) => ({
                      speaker: sp.speaker,
                      voiceConfig: {
                        prebuiltVoiceConfig: {
                          voiceName: sp.voiceName,
                        },
                      },
                    })),
                  },
                },
              },
            });

            const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (!data || data.length < 64) {
              throw new Error('Multi-speaker TTS returned empty audio data.');
            }
            return data;
          },
        });

        setBoundedCache(cacheKey, {
          audioBase64: base64Audio,
          provider: this.name,
        });

        return {
          result: {
            audioBase64: base64Audio,
            mimeType: 'audio/wav',
            cached: false,
            provider: this.name,
            retryCount,
            queueWaitMs,
          },
          reusedFromCache: false,
          retryCount,
          httpStatus: 200,
          model: this.name,
        };
      },
    });
  }
}

export const ttsProvider: TtsProvider = new GeminiRussianTtsProvider();
