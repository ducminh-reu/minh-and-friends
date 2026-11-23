import {
  computeOfflineVoiceSignature,
  getOfflineSentenceAudioBlob,
} from './offlineLessonStore';
import type { DialogueSentence, PlaybackSpeed, SpeakerProfile } from '../types/domain';
import { findSpeakerProfile } from '../utils/speakerUtils';
import { stripStressMarks } from '../utils/transcriptDiff';
import {
  buildRussianStylePrompt,
  buildVoiceCacheSignature,
  getDefaultRussianNarratorSpeaker,
  resolveVoiceProfile,
} from '../utils/voiceRegistry';

export type AudioEngineSource =
  | 'offline_cache'
  | 'persisted_news_audio'
  | 'server_tts'
  | 'server_multi_tts'
  | 'browser_speech'
  | 'timed_fallback';

export interface AudioSourceMetadata {
  source: AudioEngineSource;
  provider?: string;
  voiceId?: string;
  gender?: 'male' | 'female';
  cached?: boolean;
}

export interface AudioErrorMetadata {
  errorCategory?: string;
  retryAfterMs?: number | null;
  status?: number;
}

export interface PlaySentenceOptions {
  lessonId?: string;
  sentenceId?: string;
  audioUrl?: string | null;
  text: string;
  speaker?: SpeakerProfile;
  topic?: string;
  previousSpeaker?: string;
  previousText?: string;
  speed: PlaybackSpeed;
  preferServerTts: boolean;
  fallbackDurationSec?: number;
  onSourceResolved?: (source: AudioEngineSource, meta?: AudioSourceMetadata) => void;
  onProgress?: (ratio: number) => void;
  onComplete?: () => void;
  onInterrupted?: () => void;
  onError?: (message: string, meta?: AudioErrorMetadata) => void;
}

export interface PlayDialogueBlockOptions {
  speakers: SpeakerProfile[];
  sentences: DialogueSentence[];
  fullAudioUrl?: string | null;
  topic?: string;
  speed: PlaybackSpeed;
  onSourceResolved?: (source: AudioEngineSource, meta?: AudioSourceMetadata) => void;
  onSentenceProgress?: (indexInBlock: number, sentenceRatio: number) => void;
  onComplete?: () => void;
  onInterrupted?: () => void;
  onFallbackToSequential?: () => void;
  onError?: (message: string, meta?: AudioErrorMetadata) => void;
}

interface TimedFallbackState {
  durationMs: number;
  elapsedMs: number;
  startedAt: number;
  speed: PlaybackSpeed;
  onProgress?: (ratio: number) => void;
  onComplete?: () => void;
  onInterrupted?: () => void;
  resolve: () => void;
}

interface TtsFetchSuccess {
  ok: true;
  dataUrl: string;
  provider: string;
  voiceId?: string;
  gender?: 'male' | 'female';
  cached: boolean;
}

interface TtsFetchFailure {
  ok: false;
  message: string;
  errorCategory?: string;
  retryAfterMs?: number | null;
  status?: number;
}

type TtsFetchResult = TtsFetchSuccess | TtsFetchFailure;

const FEMALE_VOICE_HINTS = [
  'milena',
  'katya',
  'irina',
  'svetlana',
  'elena',
  'tatyana',
  'alena',
  'anna',
  'olga',
  'natalia',
  'female',
  'woman',
  'dariya',
];

const MALE_VOICE_HINTS = [
  'yuri',
  'yuriy',
  'dmitry',
  'pavel',
  'aleksandr',
  'alexander',
  'maxim',
  'nikolai',
  'ivan',
  'male',
  'man',
];

interface SpeechSessionState {
  utterText: string;
  voice: SpeechSynthesisVoice;
  gender: 'male' | 'female' | undefined;
  genderMatched: boolean;
  onProgress?: (ratio: number) => void;
  onComplete?: () => void;
  onInterrupted?: () => void;
  resolve: () => void;
  suppressCancelEnd: boolean;
}

class RussianAudioEngine {
  private currentAudio: HTMLAudioElement | null = null;
  private currentAudioResolve: (() => void) | null = null;
  private currentSpeechSession: SpeechSessionState | null = null;
  private timedState: TimedFallbackState | null = null;
  private pendingPreparation = false;
  private waitForResumeResolve: (() => void) | null = null;
  private timerId: number | null = null;
  private rafId: number | null = null;
  private clientWavCache = new Map<string, TtsFetchSuccess>();
  private offlineBlobUrlCache = new Map<string, string>();
  private inFlightFetches = new Map<string, Promise<TtsFetchResult>>();
  private aborted = false;
  private paused = false;
  private activeSpeed: PlaybackSpeed = 1;

  canResume(): boolean {
    if (this.aborted || !this.paused) return false;
    if (this.pendingPreparation || this.waitForResumeResolve) return true;
    if (this.currentAudio && !this.currentAudio.ended) return true;
    if (this.currentSpeechSession) return true;
    if (this.timedState) return true;
    return false;
  }

  setPlaybackRate(speed: PlaybackSpeed): void {
    this.activeSpeed = speed;
    if (this.currentAudio) {
      this.currentAudio.playbackRate = speed;
    }
    if (this.timedState) {
      const state = this.timedState;
      const now = performance.now();
      if (!this.paused) {
        state.elapsedMs += now - state.startedAt;
        state.startedAt = now;
      }
      const prevSpeed = state.speed || 1;
      const ratio = Math.min(1, Math.max(0, state.elapsedMs / Math.max(1, state.durationMs)));
      const baseMs = state.durationMs * prevSpeed;
      const nextDurationMs = Math.max(300, baseMs / speed);
      state.durationMs = nextDurationMs;
      state.elapsedMs = ratio * nextDurationMs;
      state.speed = speed;
    }
  }

  pause(): boolean {
    if (this.aborted || this.paused) return false;

    if (this.currentAudio && !this.currentAudio.ended) {
      this.paused = true;
      this.currentAudio.pause();
      return true;
    }

    if (this.timedState) {
      this.paused = true;
      this.timedState.elapsedMs += performance.now() - this.timedState.startedAt;
      if (this.rafId !== null) {
        window.cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      return true;
    }

    if (this.currentSpeechSession) {
      this.paused = true;
      this.currentSpeechSession.suppressCancelEnd = true;
      if (this.rafId !== null) {
        window.cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      return true;
    }

    if (this.pendingPreparation) {
      this.paused = true;
      return true;
    }

    return false;
  }

  async resume(): Promise<boolean> {
    if (this.aborted || !this.paused) return false;

    if (this.waitForResumeResolve) {
      this.paused = false;
      const res = this.waitForResumeResolve;
      this.waitForResumeResolve = null;
      res();
      return true;
    }

    if (this.currentAudio && !this.currentAudio.ended) {
      this.paused = false;
      this.currentAudio.playbackRate = this.activeSpeed;
      try {
        await this.currentAudio.play();
        return true;
      } catch {
        return false;
      }
    }

    if (this.timedState) {
      this.paused = false;
      this.timedState.startedAt = performance.now();
      this.scheduleTimedTick();
      return true;
    }

    if (this.currentSpeechSession) {
      this.paused = false;
      this.startSpeechUtterance(this.currentSpeechSession);
      return true;
    }

    if (this.pendingPreparation) {
      this.paused = false;
      return true;
    }

    return false;
  }

  private async waitIfPausedBeforeStart(): Promise<boolean> {
    if (this.aborted) return false;
    if (!this.paused) return true;
    await new Promise<void>((resolve) => {
      this.waitForResumeResolve = resolve;
    });
    return !this.aborted;
  }

  handleVisibilityHidden(): boolean {
    if (this.aborted || this.paused) return false;

    if (this.currentAudio && !this.currentAudio.paused && !this.currentAudio.ended) {
      this.paused = true;
      this.currentAudio.pause();
      return true;
    }

    if (this.timedState) {
      this.paused = true;
      this.timedState.elapsedMs += performance.now() - this.timedState.startedAt;
      if (this.rafId !== null) {
        window.cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      this.timedState.onInterrupted?.();
      return true;
    }

    if (this.currentSpeechSession) {
      this.paused = true;
      this.currentSpeechSession.suppressCancelEnd = true;
      if (this.rafId !== null) {
        window.cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      this.currentSpeechSession.onInterrupted?.();
      return true;
    }

    if (this.pendingPreparation) {
      this.paused = true;
      return true;
    }

    return false;
  }

  stop(): void {
    this.aborted = true;
    this.paused = false;
    this.pendingPreparation = false;

    if (this.waitForResumeResolve) {
      const res = this.waitForResumeResolve;
      this.waitForResumeResolve = null;
      res();
    }

    if (this.currentSpeechSession) {
      this.currentSpeechSession.suppressCancelEnd = true;
      const res = this.currentSpeechSession.resolve;
      this.currentSpeechSession = null;
      res();
    }

    if (this.currentAudio) {
      this.currentAudio.onpause = null;
      this.currentAudio.onended = null;
      this.currentAudio.onerror = null;
      this.currentAudio.ontimeupdate = null;
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    if (this.currentAudioResolve) {
      const res = this.currentAudioResolve;
      this.currentAudioResolve = null;
      res();
    }
    if (this.timedState) {
      const res = this.timedState.resolve;
      this.timedState = null;
      res();
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (this.timerId !== null) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private async getOfflineObjectUrl(
    lessonId?: string,
    sentenceId?: string,
    expectedSignature?: string,
  ): Promise<string | null> {
    if (!lessonId || !sentenceId) return null;
    const key = `${lessonId}::${sentenceId}::${expectedSignature ?? 'any'}`;
    const existingUrl = this.offlineBlobUrlCache.get(key);
    if (existingUrl) return existingUrl;

    const blob = await getOfflineSentenceAudioBlob(lessonId, sentenceId, expectedSignature);
    if (!blob) return null;

    if (this.offlineBlobUrlCache.size > 120) {
      const oldest = this.offlineBlobUrlCache.entries().next().value as
        | [string, string]
        | undefined;
      if (oldest) {
        URL.revokeObjectURL(oldest[1]);
        this.offlineBlobUrlCache.delete(oldest[0]);
      }
    }

    const url = URL.createObjectURL(blob);
    this.offlineBlobUrlCache.set(key, url);
    return url;
  }

  private getRussianVoice(gender?: 'male' | 'female'): {
    voice: SpeechSynthesisVoice | null;
    genderMatched: boolean;
  } {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return { voice: null, genderMatched: false };
    }
    const ruVoices = window.speechSynthesis
      .getVoices()
      .filter((v) => v.lang.toLowerCase().startsWith('ru'));

    if (ruVoices.length === 0) return { voice: null, genderMatched: false };

    if (gender === 'female') {
      const matched = ruVoices.find((v) =>
        FEMALE_VOICE_HINTS.some((hint) => v.name.toLowerCase().includes(hint)),
      );
      if (matched) return { voice: matched, genderMatched: true };
    } else if (gender === 'male') {
      const matched = ruVoices.find((v) =>
        MALE_VOICE_HINTS.some((hint) => v.name.toLowerCase().includes(hint)),
      );
      if (matched) return { voice: matched, genderMatched: true };
    }

    return { voice: ruVoices[0], genderMatched: false };
  }

  private setCache(key: string, value: TtsFetchSuccess): void {
    if (this.clientWavCache.size > 160) {
      const firstKey = this.clientWavCache.keys().next().value;
      if (firstKey) this.clientWavCache.delete(firstKey);
    }
    this.clientWavCache.set(key, value);
  }

  private resolveEffectiveVoice(speaker?: SpeakerProfile) {
    const effective = speaker ?? getDefaultRussianNarratorSpeaker('female');
    const resolved = resolveVoiceProfile(effective.voiceName, effective.gender, {
      ageStyle: effective.ageStyle,
      speakingStyle: effective.speakingStyle,
      speakingRate: effective.speakingRate,
      emotion: effective.emotion,
    });
    return { effective, resolved };
  }

  private buildSentenceCacheKey(opts: {
    text: string;
    speaker?: SpeakerProfile;
    topic?: string;
  }): string {
    const { effective, resolved } = this.resolveEffectiveVoice(opts.speaker);
    const stylePrompt = buildRussianStylePrompt(resolved, {
      speakerRole: effective.roleEn || effective.roleVi,
      topic: opts.topic,
    });
    return buildVoiceCacheSignature({
      text: opts.text,
      provider: resolved.provider,
      model: resolved.model,
      voiceId: resolved.voiceId,
      locale: resolved.locale,
      gender: resolved.gender,
      ageStyle: resolved.ageStyle,
      speakingStyle: resolved.speakingStyle,
      speakingRate: resolved.speakingRate,
      pitch: resolved.pitch,
      emotion: resolved.emotion,
      stylePrompt,
    });
  }

  private async fetchSentenceWav(opts: {
    text: string;
    speaker?: SpeakerProfile;
    topic?: string;
    lessonId?: string;
  }): Promise<TtsFetchResult> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return {
        ok: false,
        message: 'Thiết bị đang ngoại tuyến. Hãy tải bài học ngoại tuyến hoặc kết nối lại mạng để phát giọng Gemini TTS.',
        errorCategory: 'network_error',
      };
    }

    const cleanText = stripStressMarks(opts.text).trim();
    if (!cleanText) {
      return { ok: false, message: 'Không có nội dung văn bản để đọc.' };
    }

    const { effective, resolved } = this.resolveEffectiveVoice(opts.speaker);
    const cacheKey = this.buildSentenceCacheKey({
      text: cleanText,
      speaker: effective,
      topic: opts.topic,
    });

    const cached = this.clientWavCache.get(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    const pending = this.inFlightFetches.get(cacheKey);
    if (pending) return pending;

    const reqPromise: Promise<TtsFetchResult> = (async () => {
      try {
        const resp = await fetch('/api/tts/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: cleanText,
            voiceName: resolved.voiceId,
            gender: resolved.gender,
            ageStyle: resolved.ageStyle,
            speakingStyle: resolved.speakingStyle,
            speakingRate: resolved.speakingRate,
            emotion: resolved.emotion,
            speakerRole: effective.roleEn || effective.roleVi,
            topic: opts.topic,
            lessonId: opts.lessonId,
          }),
        });

        const payload = await resp.json().catch(() => ({}));

        if (resp.ok && payload.audioBase64) {
          const dataUrl = `data:${payload.mimeType || 'audio/wav'};base64,${payload.audioBase64}`;
          const success: TtsFetchSuccess = {
            ok: true,
            dataUrl,
            provider: String(payload.provider || resolved.model),
            voiceId: String(payload.voiceId || payload.voiceName || resolved.voiceId),
            gender: (payload.gender === 'male' || payload.gender === 'female'
              ? payload.gender
              : resolved.gender),
            cached: Boolean(payload.cached),
          };
          this.setCache(cacheKey, success);
          return success;
        }

        // NEVER retry with an alternate voice or flip gender — return honest server error
        const fallbackMsg =
          resp.status === 429
            ? 'Đã hết hạn mức miễn phí (Free Tier) của Gemini TTS. Văn bản bài học vẫn được giữ nguyên — bạn có thể thử tải lại giọng đọc sau.'
            : 'Không thể tạo giọng đọc Gemini TTS lúc này. Văn bản bài học vẫn được giữ nguyên — hãy thử lại sau.';

        return {
          ok: false,
          message: typeof payload.message === 'string' && payload.message.trim()
            ? payload.message
            : fallbackMsg,
          errorCategory:
            typeof payload.errorCategory === 'string' ? payload.errorCategory : undefined,
          retryAfterMs:
            typeof payload.retryAfterMs === 'number' ? payload.retryAfterMs : null,
          status: resp.status,
        };
      } catch {
        return {
          ok: false,
          message:
            'Không kết nối được tới máy chủ giọng đọc Gemini TTS. Văn bản bài học vẫn được giữ nguyên — vui lòng thử lại sau.',
          errorCategory: 'network_error',
        };
      } finally {
        this.inFlightFetches.delete(cacheKey);
      }
    })();

    this.inFlightFetches.set(cacheKey, reqPromise);
    return reqPromise;
  }

  private buildDialogueCacheKey(
    speakers: SpeakerProfile[],
    sentences: DialogueSentence[],
    topic?: string,
  ): string {
    const spSig = speakers
      .map((s) => {
        const { resolved } = this.resolveEffectiveVoice(s);
        return `${stripStressMarks(s.name)}:${resolved.voiceId}:${resolved.gender}:${resolved.ageStyle}:${resolved.speakingStyle}:${resolved.speakingRate}:${resolved.emotion}:${resolved.model}`;
      })
      .join('|');
    const turnSig = sentences
      .map((s) => `${stripStressMarks(s.speaker)}:${stripStressMarks(s.text)}`)
      .join('|');
    return `d-v4::${topic ?? ''}::${spSig}::${turnSig}`;
  }

  private async fetchDialogueWav(
    speakers: SpeakerProfile[],
    sentences: DialogueSentence[],
    topic?: string,
  ): Promise<TtsFetchResult> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return {
        ok: false,
        message: 'Thiết bị đang ngoại tuyến.',
        errorCategory: 'network_error',
      };
    }
    if (speakers.length === 0 || speakers.length > 6 || sentences.length === 0) {
      return {
        ok: false,
        message: 'Hội thoại không hợp lệ để tổng hợp.',
      };
    }

    const cacheKey = this.buildDialogueCacheKey(speakers, sentences, topic);
    const cached = this.clientWavCache.get(cacheKey);
    if (cached) return { ...cached, cached: true };

    const pending = this.inFlightFetches.get(cacheKey);
    if (pending) return pending;

    const reqPromise: Promise<TtsFetchResult> = (async () => {
      try {
        const resp = await fetch('/api/tts/synthesize-dialogue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic,
            speakers: speakers.map((sp) => {
              const { resolved } = this.resolveEffectiveVoice(sp);
              return {
                speaker: stripStressMarks(sp.name).trim(),
                voiceName: resolved.voiceId,
                gender: resolved.gender,
                ageStyle: resolved.ageStyle,
                speakingStyle: resolved.speakingStyle,
                speakingRate: resolved.speakingRate,
                emotion: resolved.emotion,
                role: sp.roleEn || sp.roleVi,
              };
            }),
            turns: sentences.map((s) => {
              const matched = findSpeakerProfile(speakers, s.speaker);
              return {
                speaker: stripStressMarks(matched?.name ?? s.speaker).trim(),
                text: stripStressMarks(s.text).trim(),
              };
            }),
          }),
        });

        const payload = await resp.json().catch(() => ({}));
        if (resp.ok && payload.audioBase64) {
          const dataUrl = `data:${payload.mimeType || 'audio/wav'};base64,${payload.audioBase64}`;
          const success: TtsFetchSuccess = {
            ok: true,
            dataUrl,
            provider: String(payload.provider || 'gemini-3.8-flash-lite-tts'),
            cached: Boolean(payload.cached),
          };
          this.setCache(cacheKey, success);
          return success;
        }

        return {
          ok: false,
          message:
            typeof payload.message === 'string' && payload.message.trim()
              ? payload.message
              : 'Không thể tạo hội thoại Gemini TTS lúc này. Văn bản bài học vẫn được giữ nguyên.',
          errorCategory:
            typeof payload.errorCategory === 'string' ? payload.errorCategory : undefined,
          retryAfterMs:
            typeof payload.retryAfterMs === 'number' ? payload.retryAfterMs : null,
          status: resp.status,
        };
      } catch {
        return {
          ok: false,
          message: 'Không kết nối được tới máy chủ giọng đọc Gemini TTS.',
          errorCategory: 'network_error',
        };
      } finally {
        this.inFlightFetches.delete(cacheKey);
      }
    })();

    this.inFlightFetches.set(cacheKey, reqPromise);
    return reqPromise;
  }

  async playDialogueBlock(opts: PlayDialogueBlockOptions): Promise<void> {
    this.stop();
    this.aborted = false;
    this.paused = false;
    this.activeSpeed = opts.speed;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      opts.onFallbackToSequential?.();
      return;
    }

    const totalEndSec = opts.sentences[opts.sentences.length - 1]?.endSec ?? 0;
    const hasExactTimings =
      totalEndSec > 0 &&
      opts.sentences.every((s) => Number.isFinite(s.startSec) && s.endSec > s.startSec);

    const computeProgressHandler = () => {
      if (hasExactTimings) {
        return (overallRatio: number) => {
          const currentSec = overallRatio * totalEndSec;
          let idx = opts.sentences.findIndex((s) => currentSec <= s.endSec);
          if (idx === -1) idx = opts.sentences.length - 1;
          const seg = opts.sentences[idx];
          const span = Math.max(0.05, seg.endSec - seg.startSec);
          const localRatio = Math.min(1, Math.max(0, (currentSec - seg.startSec) / span));
          opts.onSentenceProgress?.(idx, localRatio);
        };
      }
      const weights = opts.sentences.map((s) =>
        Math.max(1, stripStressMarks(s.text).trim().split(/\s+/).length),
      );
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      const cumulativeEnd: number[] = [];
      let acc = 0;
      for (const w of weights) {
        acc += w / totalWeight;
        cumulativeEnd.push(acc);
      }
      return (overallRatio: number) => {
        let idx = cumulativeEnd.findIndex((endRatio) => overallRatio <= endRatio);
        if (idx === -1) idx = opts.sentences.length - 1;
        const prevEnd = idx === 0 ? 0 : cumulativeEnd[idx - 1];
        const span = Math.max(0.01, cumulativeEnd[idx] - prevEnd);
        const localRatio = Math.min(1, Math.max(0, (overallRatio - prevEnd) / span));
        opts.onSentenceProgress?.(idx, localRatio);
      };
    };

    // Prefer persisted pre-generated WAV audio URL when available (0 API calls!)
    if (opts.fullAudioUrl) {
      try {
        const canContinue = await this.waitIfPausedBeforeStart();
        if (!canContinue) return;
        opts.onSourceResolved?.('persisted_news_audio', {
          source: 'persisted_news_audio',
          cached: true,
        });
        await this.playHtmlAudio(
          opts.fullAudioUrl,
          this.activeSpeed,
          computeProgressHandler(),
          opts.onComplete,
          opts.onInterrupted,
        );
        return;
      } catch (err) {
        if (this.isAutoplayError(err)) {
          opts.onError?.(this.formatPlaybackError(err));
          return;
        }
        // Fall through to sequential playback if persisted URL failed
        opts.onFallbackToSequential?.();
        return;
      }
    }

    this.pendingPreparation = true;
    const fetched = await this.fetchDialogueWav(opts.speakers, opts.sentences, opts.topic);
    this.pendingPreparation = false;
    if (this.aborted) return;

    if (!fetched.ok) {
      opts.onError?.(fetched.message, {
        errorCategory: fetched.errorCategory,
        retryAfterMs: fetched.retryAfterMs,
        status: fetched.status,
      });
      return;
    }

    const canContinue = await this.waitIfPausedBeforeStart();
    if (!canContinue) return;

    opts.onSourceResolved?.('server_multi_tts', {
      source: 'server_multi_tts',
      provider: fetched.provider,
      cached: fetched.cached,
    });

    try {
      await this.playHtmlAudio(
        fetched.dataUrl,
        this.activeSpeed,
        computeProgressHandler(),
        opts.onComplete,
        opts.onInterrupted,
      );
    } catch (err) {
      opts.onError?.(this.formatPlaybackError(err));
    }
  }

  async playSentence(opts: PlaySentenceOptions): Promise<void> {
    this.stop();
    this.aborted = false;
    this.paused = false;
    this.activeSpeed = opts.speed;

    const cleanText = stripStressMarks(opts.text).trim();
    if (!cleanText) {
      opts.onComplete?.();
      return;
    }

    const effectiveSpeaker = opts.speaker ?? getDefaultRussianNarratorSpeaker('female');
    const expectedOfflineSig = computeOfflineVoiceSignature(
      cleanText,
      effectiveSpeaker,
      opts.topic,
    );

    // 0. Prefer explicitly downloaded offline audio stored in IndexedDB (0 API calls)
    try {
      this.pendingPreparation = true;
      const offlineUrl = await this.getOfflineObjectUrl(
        opts.lessonId,
        opts.sentenceId,
        expectedOfflineSig,
      );
      this.pendingPreparation = false;
      if (this.aborted) return;
      if (offlineUrl) {
        const canContinue = await this.waitIfPausedBeforeStart();
        if (!canContinue) return;
        opts.onSourceResolved?.('offline_cache', {
          source: 'offline_cache',
          voiceId: effectiveSpeaker.voiceName,
          gender: effectiveSpeaker.gender,
          cached: true,
        });
        await this.playHtmlAudio(
          offlineUrl,
          this.activeSpeed,
          opts.onProgress,
          opts.onComplete,
          opts.onInterrupted,
        );
        return;
      }
    } catch (err) {
      this.pendingPreparation = false;
      if (this.isAutoplayError(err)) {
        opts.onError?.(this.formatPlaybackError(err));
        return;
      }
      // Fall through if local blob failed to decode
    }

    // 0b. Prefer pre-generated persisted WAV segment URL on disk if available & online (0 API calls)
    if (opts.audioUrl && (typeof navigator === 'undefined' || navigator.onLine)) {
      try {
        const canContinue = await this.waitIfPausedBeforeStart();
        if (!canContinue) return;
        opts.onSourceResolved?.('persisted_news_audio', {
          source: 'persisted_news_audio',
          voiceId: effectiveSpeaker.voiceName,
          gender: effectiveSpeaker.gender,
          cached: true,
        });
        await this.playHtmlAudio(
          opts.audioUrl,
          this.activeSpeed,
          opts.onProgress,
          opts.onComplete,
          opts.onInterrupted,
        );
        return;
      } catch (err) {
        if (this.isAutoplayError(err)) {
          opts.onError?.(this.formatPlaybackError(err));
          return;
        }
        // Fall through to Gemini TTS server cache if persisted URL failed
      }
    }

    // 1. Server Gemini TTS (Free Tier + Persistent Disk Cache).
    // CRITICAL RULE: When preferServerTts is true, NEVER silently fall back to browser Web Speech API!
    // Show an honest Free-Tier quota / error message and keep the lesson text intact for retry.
    if (opts.preferServerTts) {
      this.pendingPreparation = true;
      const fetched = await this.fetchSentenceWav({
        text: cleanText,
        speaker: effectiveSpeaker,
        topic: opts.topic,
        lessonId: opts.lessonId,
      });
      this.pendingPreparation = false;

      if (this.aborted) return;

      if (!fetched.ok) {
        opts.onError?.(fetched.message, {
          errorCategory: fetched.errorCategory,
          retryAfterMs: fetched.retryAfterMs,
          status: fetched.status,
        });
        return;
      }

      const canContinue = await this.waitIfPausedBeforeStart();
      if (!canContinue) return;

      opts.onSourceResolved?.('server_tts', {
        source: 'server_tts',
        provider: fetched.provider,
        voiceId: fetched.voiceId,
        gender: fetched.gender,
        cached: fetched.cached,
      });

      try {
        await this.playHtmlAudio(
          fetched.dataUrl,
          this.activeSpeed,
          opts.onProgress,
          opts.onComplete,
          opts.onInterrupted,
        );
      } catch (err) {
        opts.onError?.(this.formatPlaybackError(err));
      }
      return;
    }

    // 2. Explicit local browser Web Speech API mode (ONLY when user chose 'browser' or server TTS is unconfigured)
    if (this.aborted) return;
    const canContinueLocal = await this.waitIfPausedBeforeStart();
    if (!canContinueLocal) return;

    const { voice: ruVoice, genderMatched } = this.getRussianVoice(effectiveSpeaker.gender);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window && ruVoice) {
      opts.onSourceResolved?.('browser_speech', {
        source: 'browser_speech',
        provider: 'browser-speech-ru',
        voiceId: ruVoice.name,
        gender: effectiveSpeaker.gender,
        cached: false,
      });
      await this.playWebSpeech(
        cleanText,
        ruVoice,
        effectiveSpeaker.gender,
        genderMatched,
        this.activeSpeed,
        opts.onProgress,
        opts.onComplete,
        opts.onInterrupted,
      );
      return;
    }

    // 3. Timed cadence fallback (only when browser speech is explicitly requested & no ru-RU voice exists)
    opts.onSourceResolved?.('timed_fallback', {
      source: 'timed_fallback',
      provider: 'timed-simulation',
    });
    const estimatedSec = Math.max(
      2.5,
      Math.min(14, opts.fallbackDurationSec ?? cleanText.split(/\s+/).length * 0.55),
    );
    await this.playTimedFallback(
      estimatedSec / this.activeSpeed,
      this.activeSpeed,
      opts.onProgress,
      opts.onComplete,
      opts.onInterrupted,
    );
  }

  private isAutoplayError(err: unknown): boolean {
    return err instanceof Error && err.name === 'NotAllowedError';
  }

  private formatPlaybackError(err: unknown): string {
    if (this.isAutoplayError(err)) {
      return 'Trình duyệt di động yêu cầu chạm vào nút Phát để bắt đầu âm thanh.';
    }
    return err instanceof Error && err.message
      ? err.message
      : 'Không thể phát âm thanh trên thiết bị này.';
  }

  private playHtmlAudio(
    src: string,
    speed: PlaybackSpeed,
    onProgress?: (ratio: number) => void,
    onComplete?: () => void,
    onInterrupted?: () => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio(src);
      audio.setAttribute('playsinline', 'true');
      audio.preload = 'auto';
      audio.playbackRate = speed;
      this.currentAudio = audio;

      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          if (this.currentAudioResolve === finish) {
            this.currentAudioResolve = null;
          }
          resolve();
        }
      };
      this.currentAudioResolve = finish;

      audio.ontimeupdate = () => {
        if (audio.duration > 0) {
          onProgress?.(Math.min(1, audio.currentTime / audio.duration));
        }
      };
      audio.onpause = () => {
        if (!this.aborted && !audio.ended) {
          if (!this.paused) {
            this.paused = true;
            onInterrupted?.();
          }
        }
      };
      audio.onended = () => {
        onProgress?.(1);
        this.paused = false;
        this.currentAudio = null;
        if (!this.aborted) onComplete?.();
        finish();
      };
      audio.onerror = () => {
        this.paused = false;
        this.currentAudio = null;
        if (!settled) {
          settled = true;
          if (this.currentAudioResolve === finish) {
            this.currentAudioResolve = null;
          }
          reject(new Error('Audio element playback failed'));
        }
      };
      audio.play().catch((err) => {
        this.paused = false;
        this.currentAudio = null;
        if (!settled) {
          settled = true;
          if (this.currentAudioResolve === finish) {
            this.currentAudioResolve = null;
          }
          reject(err);
        }
      });
    });
  }

  private startSpeechUtterance(session: SpeechSessionState): void {
    const speed = this.activeSpeed;
    session.suppressCancelEnd = false;

    const utter = new SpeechSynthesisUtterance(session.utterText);
    utter.voice = session.voice;
    utter.lang = 'ru-RU';
    utter.rate = speed;
    if (!session.genderMatched && session.gender) {
      utter.pitch = session.gender === 'female' ? 1.08 : 0.88;
    }

    const estimatedMs = Math.max(1800, (session.utterText.split(/\s+/).length * 520) / speed);
    const start = performance.now();

    const tick = () => {
      if (this.aborted || this.paused || this.currentSpeechSession !== session) return;
      const elapsed = performance.now() - start;
      session.onProgress?.(Math.min(0.95, elapsed / estimatedMs));
      if (elapsed < estimatedMs) {
        this.rafId = window.requestAnimationFrame(tick);
      }
    };
    this.rafId = window.requestAnimationFrame(tick);

    const handleFinish = () => {
      if (session.suppressCancelEnd || this.paused || this.currentSpeechSession !== session) {
        return;
      }
      if (this.rafId !== null) window.cancelAnimationFrame(this.rafId);
      this.currentSpeechSession = null;
      session.onProgress?.(1);
      if (!this.aborted) session.onComplete?.();
      session.resolve();
    };

    utter.onend = handleFinish;
    utter.onerror = handleFinish;

    window.speechSynthesis.speak(utter);
  }

  private playWebSpeech(
    text: string,
    voice: SpeechSynthesisVoice,
    gender: 'male' | 'female' | undefined,
    genderMatched: boolean,
    _speed: PlaybackSpeed,
    onProgress?: (ratio: number) => void,
    onComplete?: () => void,
    onInterrupted?: () => void,
  ): Promise<void> {
    return new Promise((resolve) => {
      const session: SpeechSessionState = {
        utterText: text,
        voice,
        gender,
        genderMatched,
        onProgress,
        onComplete,
        onInterrupted,
        resolve,
        suppressCancelEnd: false,
      };
      this.currentSpeechSession = session;
      this.startSpeechUtterance(session);
    });
  }

  private scheduleTimedTick(): void {
    const tick = () => {
      const state = this.timedState;
      if (!state || this.aborted || this.paused) {
        return;
      }
      const totalElapsed = state.elapsedMs + (performance.now() - state.startedAt);
      const ratio = Math.min(1, totalElapsed / Math.max(1, state.durationMs));
      state.onProgress?.(ratio);
      if (ratio < 1) {
        this.rafId = window.requestAnimationFrame(tick);
      } else {
        this.timedState = null;
        this.paused = false;
        state.onComplete?.();
        state.resolve();
      }
    };
    this.rafId = window.requestAnimationFrame(tick);
  }

  private playTimedFallback(
    durationSec: number,
    speed: PlaybackSpeed,
    onProgress?: (ratio: number) => void,
    onComplete?: () => void,
    onInterrupted?: () => void,
  ): Promise<void> {
    return new Promise((resolve) => {
      this.timedState = {
        durationMs: Math.max(300, durationSec * 1000),
        elapsedMs: 0,
        startedAt: performance.now(),
        speed,
        onProgress,
        onComplete,
        onInterrupted,
        resolve,
      };
      this.scheduleTimedTick();
    });
  }
}

export const russianAudioEngine = new RussianAudioEngine();
