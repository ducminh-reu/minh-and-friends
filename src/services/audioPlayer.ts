import { getOfflineSentenceAudioBlob } from './offlineLessonStore';
import type { DialogueSentence, PlaybackSpeed, SpeakerProfile } from '../types/domain';
import { findSpeakerProfile } from '../utils/speakerUtils';
import { stripStressMarks } from '../utils/transcriptDiff';

export type AudioEngineSource =
  | 'offline_cache'
  | 'persisted_news_audio'
  | 'server_tts'
  | 'server_multi_tts'
  | 'browser_speech'
  | 'timed_fallback';

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
  onSourceResolved?: (source: AudioEngineSource) => void;
  onProgress?: (ratio: number) => void;
  onComplete?: () => void;
  onInterrupted?: () => void;
  onError?: (message: string) => void;
}

export interface PlayDialogueBlockOptions {
  speakers: SpeakerProfile[];
  sentences: DialogueSentence[];
  fullAudioUrl?: string | null;
  topic?: string;
  speed: PlaybackSpeed;
  onSourceResolved?: (source: AudioEngineSource) => void;
  onSentenceProgress?: (indexInBlock: number, sentenceRatio: number) => void;
  onComplete?: () => void;
  onInterrupted?: () => void;
  onFallbackToSequential?: () => void;
  onError?: (message: string) => void;
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
  private clientWavCache = new Map<string, string>();
  private offlineBlobUrlCache = new Map<string, string>();
  private inFlightFetches = new Map<string, Promise<string | null>>();
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
  ): Promise<string | null> {
    if (!lessonId || !sentenceId) return null;
    const key = `${lessonId}::${sentenceId}`;
    const existingUrl = this.offlineBlobUrlCache.get(key);
    if (existingUrl) return existingUrl;

    const blob = await getOfflineSentenceAudioBlob(lessonId, sentenceId);
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

  private setCache(key: string, dataUrl: string): void {
    if (this.clientWavCache.size > 100) {
      const firstKey = this.clientWavCache.keys().next().value;
      if (firstKey) this.clientWavCache.delete(firstKey);
    }
    this.clientWavCache.set(key, dataUrl);
  }

  private buildSentenceCacheKey(opts: {
    text: string;
    speaker?: SpeakerProfile;
    topic?: string;
    previousText?: string;
  }): string {
    const cleanText = stripStressMarks(opts.text).trim();
    const prevShort = opts.previousText
      ? stripStressMarks(opts.previousText).trim().slice(0, 60)
      : '';
    return `s::${opts.speaker?.voiceName ?? 'Kore'}::${opts.speaker?.gender ?? 'female'}::${opts.topic ?? ''}::${prevShort}::${cleanText}`;
  }

  private async fetchSentenceWav(opts: {
    text: string;
    speaker?: SpeakerProfile;
    topic?: string;
    previousSpeaker?: string;
    previousText?: string;
  }): Promise<string | null> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return null;

    const cleanText = stripStressMarks(opts.text).trim();
    if (!cleanText) return null;

    const cacheKey = this.buildSentenceCacheKey(opts);
    const cached = this.clientWavCache.get(cacheKey);
    if (cached) return cached;

    const pending = this.inFlightFetches.get(cacheKey);
    if (pending) return pending;

    const reqPromise = (async () => {
      try {
        const resp = await fetch('/api/tts/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: cleanText,
            voiceName: opts.speaker?.voiceName,
            gender: opts.speaker?.gender,
            speakerRole: opts.speaker?.roleEn || opts.speaker?.roleVi,
            topic: opts.topic,
            previousSpeaker: opts.previousSpeaker
              ? stripStressMarks(opts.previousSpeaker).trim()
              : undefined,
            previousText: opts.previousText
              ? stripStressMarks(opts.previousText).trim()
              : undefined,
          }),
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        if (data.audioBase64) {
          const dataUrl = `data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`;
          this.setCache(cacheKey, dataUrl);
          return dataUrl;
        }
        return null;
      } catch {
        return null;
      } finally {
        this.inFlightFetches.delete(cacheKey);
      }
    })();

    this.inFlightFetches.set(cacheKey, reqPromise);
    return reqPromise;
  }

  prefetchSentence(opts: {
    text: string;
    speaker?: SpeakerProfile;
    topic?: string;
    previousSpeaker?: string;
    previousText?: string;
  }): void {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    void this.fetchSentenceWav(opts);
  }

  private buildDialogueCacheKey(
    speakers: SpeakerProfile[],
    sentences: DialogueSentence[],
    topic?: string,
  ): string {
    const spSig = speakers.map((s) => `${stripStressMarks(s.name)}:${s.voiceName}:${s.gender}`).join('|');
    const turnSig = sentences.map((s) => `${stripStressMarks(s.speaker)}:${stripStressMarks(s.text)}`).join('|');
    return `d::${topic ?? ''}::${spSig}::${turnSig}`;
  }

  private async fetchDialogueWav(
    speakers: SpeakerProfile[],
    sentences: DialogueSentence[],
    topic?: string,
  ): Promise<string | null> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
    if (speakers.length !== 2 || sentences.length === 0) return null;

    const cacheKey = this.buildDialogueCacheKey(speakers, sentences, topic);
    const cached = this.clientWavCache.get(cacheKey);
    if (cached) return cached;

    const pending = this.inFlightFetches.get(cacheKey);
    if (pending) return pending;

    const reqPromise = (async () => {
      try {
        const resp = await fetch('/api/tts/synthesize-dialogue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic,
            speakers: speakers.map((sp) => ({
              speaker: stripStressMarks(sp.name).trim(),
              voiceName: sp.voiceName,
              gender: sp.gender,
              role: sp.roleEn || sp.roleVi,
            })),
            turns: sentences.map((s) => {
              const matched = findSpeakerProfile(speakers, s.speaker);
              return {
                speaker: stripStressMarks(matched?.name ?? s.speaker).trim(),
                text: stripStressMarks(s.text).trim(),
              };
            }),
          }),
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        if (data.audioBase64) {
          const dataUrl = `data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`;
          this.setCache(cacheKey, dataUrl);
          return dataUrl;
        }
        return null;
      } catch {
        return null;
      } finally {
        this.inFlightFetches.delete(cacheKey);
      }
    })();

    this.inFlightFetches.set(cacheKey, reqPromise);
    return reqPromise;
  }

  prefetchDialogueBlock(
    speakers: SpeakerProfile[],
    sentences: DialogueSentence[],
    topic?: string,
  ): void {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    void this.fetchDialogueWav(speakers, sentences, topic);
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

    // Prefer persisted pre-generated WAV audio URL when available
    if (opts.fullAudioUrl) {
      try {
        const canContinue = await this.waitIfPausedBeforeStart();
        if (!canContinue) return;
        opts.onSourceResolved?.('persisted_news_audio');
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
        // Fall through to live synthesis if persisted file couldn't play
      }
    }

    this.pendingPreparation = true;
    const dataUrl = await this.fetchDialogueWav(opts.speakers, opts.sentences, opts.topic);
    this.pendingPreparation = false;
    if (this.aborted) return;

    if (!dataUrl) {
      const canContinue = await this.waitIfPausedBeforeStart();
      if (!canContinue) return;
      opts.onFallbackToSequential?.();
      return;
    }

    const canContinue = await this.waitIfPausedBeforeStart();
    if (!canContinue) return;

    opts.onSourceResolved?.('server_multi_tts');

    try {
      await this.playHtmlAudio(
        dataUrl,
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

    // 0. Prefer explicitly downloaded offline audio stored in IndexedDB
    try {
      this.pendingPreparation = true;
      const offlineUrl = await this.getOfflineObjectUrl(opts.lessonId, opts.sentenceId);
      this.pendingPreparation = false;
      if (this.aborted) return;
      if (offlineUrl) {
        const canContinue = await this.waitIfPausedBeforeStart();
        if (!canContinue) return;
        opts.onSourceResolved?.('offline_cache');
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

    // 0b. Prefer pre-generated persisted WAV segment URL if available & online
    if (opts.audioUrl && (typeof navigator === 'undefined' || navigator.onLine)) {
      try {
        const canContinue = await this.waitIfPausedBeforeStart();
        if (!canContinue) return;
        opts.onSourceResolved?.('persisted_news_audio');
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
        // Fall through if persisted WAV URL fails to play
      }
    }

    // 1. Try cached or server Gemini 3.8 Flash Russian TTS when enabled & online
    if (opts.preferServerTts) {
      try {
        this.pendingPreparation = true;
        const dataUrl = await this.fetchSentenceWav({
          text: cleanText,
          speaker: opts.speaker,
          topic: opts.topic,
          previousSpeaker: opts.previousSpeaker,
          previousText: opts.previousText,
        });
        this.pendingPreparation = false;

        if (this.aborted) return;

        if (dataUrl) {
          const canContinue = await this.waitIfPausedBeforeStart();
          if (!canContinue) return;
          opts.onSourceResolved?.('server_tts');
          await this.playHtmlAudio(
            dataUrl,
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
        // Fall through gracefully to browser speech or timed simulation
      }
    }

    if (this.aborted) return;
    const canContinueFallback = await this.waitIfPausedBeforeStart();
    if (!canContinueFallback) return;

    // 2. Try Web Speech API with gender-matched ru-RU voice
    const { voice: ruVoice, genderMatched } = this.getRussianVoice(opts.speaker?.gender);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window && ruVoice) {
      opts.onSourceResolved?.('browser_speech');
      await this.playWebSpeech(
        cleanText,
        ruVoice,
        opts.speaker?.gender,
        genderMatched,
        this.activeSpeed,
        opts.onProgress,
        opts.onComplete,
        opts.onInterrupted,
      );
      return;
    }

    // 3. Timed cadence fallback
    opts.onSourceResolved?.('timed_fallback');
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
            // OS/browser interrupted playback (incoming call, screen lock, app switch)
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
