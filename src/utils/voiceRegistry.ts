import type {
  GeminiVoiceId,
  SpeakerProfile,
  TtsModelId,
  TtsProviderId,
  VoiceAgeStyle,
  VoiceConfigProfile,
  VoiceSpeakingStyle,
} from '../types/domain.ts';
import { stripStressMarks } from './transcriptDiff.ts';

export const DEFAULT_TTS_PROVIDER: TtsProviderId = 'gemini-tts';
export const DEFAULT_TTS_LOCALE = 'ru-RU' as const;
export const DEFAULT_TTS_LANGUAGE = 'Russian' as const;
export const VOICE_CACHE_SCHEMA_VERSION = 'v4-ru-free-tier';

/**
 * Official verified Gemini TTS prebuilt voices curated for authentic Russian speech.
 * Genders are strictly verified against official Google Gemini TTS voice documentation:
 * Female: Sulafat, Despina, Leda, Gacrux, Kore, Zephyr
 * Male:   Achird, Charon, Algieba, Sadaltager, Puck, Fenrir
 */
export const RUSSIAN_VOICE_REGISTRY: Record<GeminiVoiceId, VoiceConfigProfile> = {
  // --- FEMALE VOICES (6 distinct personas) ---
  Sulafat: {
    voiceId: 'Sulafat',
    provider: 'gemini-tts',
    model: 'gemini-3.8-flash-lite-tts',
    language: 'Russian',
    locale: 'ru-RU',
    gender: 'female',
    ageStyle: 'mature',
    speakingStyle: 'conversational',
    speakingRate: 1.0,
    pitch: null,
    emotion: 'warm',
    labelVi: 'Giọng nữ · Ấm áp, trò chuyện tự nhiên (Sulafat)',
    labelEn: 'Female · Warm conversational (Sulafat)',
    styleDirective: 'Warm, natural Moscow Russian woman in relaxed everyday conversation',
  },
  Despina: {
    voiceId: 'Despina',
    provider: 'gemini-tts',
    model: 'gemini-3.8-flash-lite-tts',
    language: 'Russian',
    locale: 'ru-RU',
    gender: 'female',
    ageStyle: 'mature',
    speakingStyle: 'narration',
    speakingRate: 1.0,
    pitch: null,
    emotion: 'calm',
    labelVi: 'Giọng nữ · Mượt mà, truyền cảm (Despina)',
    labelEn: 'Female · Smooth narrator (Despina)',
    styleDirective: 'Smooth, articulate native Russian woman with calm, fluid intonation',
  },
  Leda: {
    voiceId: 'Leda',
    provider: 'gemini-tts',
    model: 'gemini-3.8-flash-lite-tts',
    language: 'Russian',
    locale: 'ru-RU',
    gender: 'female',
    ageStyle: 'young',
    speakingStyle: 'conversational',
    speakingRate: 1.0,
    pitch: null,
    emotion: 'friendly',
    labelVi: 'Giọng nữ trẻ · Tự nhiên, sinh động (Leda)',
    labelEn: 'Young female · Youthful conversational (Leda)',
    styleDirective: 'Natural young Russian woman speaking casually with authentic lively rhythm',
  },
  Gacrux: {
    voiceId: 'Gacrux',
    provider: 'gemini-tts',
    model: 'gemini-3.8-flash-lite-tts',
    language: 'Russian',
    locale: 'ru-RU',
    gender: 'female',
    ageStyle: 'mature',
    speakingStyle: 'educational',
    speakingRate: 1.0,
    pitch: null,
    emotion: 'authoritative',
    labelVi: 'Giọng nữ trưởng thành · Chững chạc, rõ nét (Gacrux)',
    labelEn: 'Mature female · Authoritative educational (Gacrux)',
    styleDirective: 'Composed mature Russian woman speaking clearly with educated broadcast poise',
  },
  Kore: {
    voiceId: 'Kore',
    provider: 'gemini-tts',
    model: 'gemini-3.8-flash-lite-tts',
    language: 'Russian',
    locale: 'ru-RU',
    gender: 'female',
    ageStyle: 'mature',
    speakingStyle: 'educational',
    speakingRate: 1.0,
    pitch: null,
    emotion: 'warm',
    labelVi: 'Giọng nữ · Ấm áp, rõ ràng (Kore)',
    labelEn: 'Female · Firm clear Russian (Kore)',
    styleDirective: 'Clear, poised adult Russian woman speaking natural fluent standard Russian',
  },
  Zephyr: {
    voiceId: 'Zephyr',
    provider: 'gemini-tts',
    model: 'gemini-3.8-flash-lite-tts',
    language: 'Russian',
    locale: 'ru-RU',
    gender: 'female',
    ageStyle: 'young',
    speakingStyle: 'conversational',
    speakingRate: 1.0,
    pitch: null,
    emotion: 'lively',
    labelVi: 'Giọng nữ trẻ · Tươi sáng, tự nhiên (Zephyr)',
    labelEn: 'Young female · Bright conversational (Zephyr)',
    styleDirective: 'Bright, natural young Russian woman speaking lively everyday Russian',
  },

  // --- MALE VOICES (6 distinct personas) ---
  Achird: {
    voiceId: 'Achird',
    provider: 'gemini-tts',
    model: 'gemini-3.8-flash-lite-tts',
    language: 'Russian',
    locale: 'ru-RU',
    gender: 'male',
    ageStyle: 'young',
    speakingStyle: 'conversational',
    speakingRate: 1.0,
    pitch: null,
    emotion: 'friendly',
    labelVi: 'Giọng nam trẻ · Thân thiện, tự nhiên (Achird)',
    labelEn: 'Young male · Friendly conversational (Achird)',
    styleDirective: 'Friendly young adult Russian man speaking naturally in everyday Russian',
  },
  Charon: {
    voiceId: 'Charon',
    provider: 'gemini-tts',
    model: 'gemini-3.8-flash-lite-tts',
    language: 'Russian',
    locale: 'ru-RU',
    gender: 'male',
    ageStyle: 'mature',
    speakingStyle: 'educational',
    speakingRate: 1.0,
    pitch: null,
    emotion: 'calm',
    labelVi: 'Giọng nam trưởng thành · Trầm ấm, điềm đạm (Charon)',
    labelEn: 'Mature male · Calm informative baritone (Charon)',
    styleDirective: 'Calm, confident mature Russian man with deep natural baritone cadence',
  },
  Algieba: {
    voiceId: 'Algieba',
    provider: 'gemini-tts',
    model: 'gemini-3.8-flash-lite-tts',
    language: 'Russian',
    locale: 'ru-RU',
    gender: 'male',
    ageStyle: 'mature',
    speakingStyle: 'narration',
    speakingRate: 1.0,
    pitch: null,
    emotion: 'warm',
    labelVi: 'Giọng nam · Mượt mà, chững chạc (Algieba)',
    labelEn: 'Male · Smooth grounded Russian (Algieba)',
    styleDirective: 'Smooth, grounded adult Russian man speaking fluid natural Russian',
  },
  Sadaltager: {
    voiceId: 'Sadaltager',
    provider: 'gemini-tts',
    model: 'gemini-3.8-flash-lite-tts',
    language: 'Russian',
    locale: 'ru-RU',
    gender: 'male',
    ageStyle: 'mature',
    speakingStyle: 'narration',
    speakingRate: 1.0,
    pitch: null,
    emotion: 'authoritative',
    labelVi: 'Giọng nam · Chuyên gia, phát thanh chuẩn (Sadaltager)',
    labelEn: 'Male · Knowledgeable analyst (Sadaltager)',
    styleDirective: 'Knowledgeable adult Russian male analyst speaking clear natural Russian',
  },
  Puck: {
    voiceId: 'Puck',
    provider: 'gemini-tts',
    model: 'gemini-3.8-flash-lite-tts',
    language: 'Russian',
    locale: 'ru-RU',
    gender: 'male',
    ageStyle: 'young',
    speakingStyle: 'conversational',
    speakingRate: 1.0,
    pitch: null,
    emotion: 'lively',
    labelVi: 'Giọng nam trẻ · Hoạt bát, thân thiện (Puck)',
    labelEn: 'Young male · Upbeat conversational (Puck)',
    styleDirective: 'Natural, lively young Russian man speaking casually with warm phrasing',
  },
  Fenrir: {
    voiceId: 'Fenrir',
    provider: 'gemini-tts',
    model: 'gemini-3.8-flash-lite-tts',
    language: 'Russian',
    locale: 'ru-RU',
    gender: 'male',
    ageStyle: 'mature',
    speakingStyle: 'conversational',
    speakingRate: 1.0,
    pitch: null,
    emotion: 'engaged',
    labelVi: 'Giọng nam · Chững chạc, truyền cảm (Fenrir)',
    labelEn: 'Male · Articulate engaged Russian (Fenrir)',
    styleDirective: 'Articulate adult Russian man speaking expressive, clear everyday Russian',
  },
};

export const FEMALE_VOICE_IDS: readonly GeminiVoiceId[] = [
  'Sulafat',
  'Leda',
  'Despina',
  'Gacrux',
  'Kore',
  'Zephyr',
];

export const MALE_VOICE_IDS: readonly GeminiVoiceId[] = [
  'Achird',
  'Charon',
  'Algieba',
  'Sadaltager',
  'Puck',
  'Fenrir',
];

export const ALL_VOICE_IDS: readonly GeminiVoiceId[] = [
  ...FEMALE_VOICE_IDS,
  ...MALE_VOICE_IDS,
];

export function isValidGeminiVoiceId(raw: unknown): raw is GeminiVoiceId {
  return typeof raw === 'string' && raw in RUSSIAN_VOICE_REGISTRY;
}

export function getVoiceGender(voiceId: GeminiVoiceId): 'male' | 'female' {
  return RUSSIAN_VOICE_REGISTRY[voiceId].gender;
}

export interface ResolveVoiceOverrides {
  model?: TtsModelId;
  ageStyle?: VoiceAgeStyle;
  speakingStyle?: VoiceSpeakingStyle;
  speakingRate?: number;
  emotion?: string;
}

/**
 * Strictly resolves a VoiceConfigProfile that NEVER violates speaker gender.
 * If requestedVoice belongs to the opposite gender or is unknown, selects the
 * best matching voice from the requested gender pool.
 */
export function resolveVoiceProfile(
  requestedVoice: string | undefined,
  gender: 'male' | 'female' | undefined,
  overrides: ResolveVoiceOverrides = {},
): VoiceConfigProfile {
  const knownVoice = isValidGeminiVoiceId(requestedVoice)
    ? RUSSIAN_VOICE_REGISTRY[requestedVoice]
    : null;

  let base: VoiceConfigProfile;
  if (gender === 'female') {
    if (knownVoice && knownVoice.gender === 'female') {
      base = knownVoice;
    } else {
      const targetAge = overrides.ageStyle;
      base =
        targetAge === 'young'
          ? RUSSIAN_VOICE_REGISTRY.Leda
          : RUSSIAN_VOICE_REGISTRY.Sulafat;
    }
  } else if (gender === 'male') {
    if (knownVoice && knownVoice.gender === 'male') {
      base = knownVoice;
    } else {
      const targetAge = overrides.ageStyle;
      base =
        targetAge === 'young'
          ? RUSSIAN_VOICE_REGISTRY.Achird
          : RUSSIAN_VOICE_REGISTRY.Charon;
    }
  } else {
    base = knownVoice ?? RUSSIAN_VOICE_REGISTRY.Sulafat;
  }

  const speakingRate =
    typeof overrides.speakingRate === 'number' &&
    Number.isFinite(overrides.speakingRate) &&
    overrides.speakingRate >= 0.7 &&
    overrides.speakingRate <= 1.3
      ? Number(overrides.speakingRate.toFixed(2))
      : base.speakingRate;

  return {
    ...base,
    model: overrides.model ?? base.model,
    ageStyle: overrides.ageStyle ?? base.ageStyle,
    speakingStyle: overrides.speakingStyle ?? base.speakingStyle,
    speakingRate,
    emotion: overrides.emotion?.trim() || base.emotion,
  };
}

/**
 * Guarantees every speaker in a lesson (1, 2, 3, or more) receives a FIXED,
 * gender-accurate, and distinct voiceId so two characters never share a voice
 * unless the entire 6-voice pool for that gender is exhausted.
 */
export function assignDistinctSpeakerVoices<
  T extends {
    name: string;
    gender: 'male' | 'female';
    voiceName?: string;
    ageStyle?: VoiceAgeStyle;
    speakingStyle?: VoiceSpeakingStyle;
    speakingRate?: number;
    emotion?: string;
  },
>(speakers: T[]): (T & { voiceName: GeminiVoiceId })[] {
  const used = new Set<GeminiVoiceId>();

  return speakers.map((sp) => {
    const pool = sp.gender === 'female' ? FEMALE_VOICE_IDS : MALE_VOICE_IDS;
    const requested = resolveVoiceProfile(sp.voiceName, sp.gender, {
      ageStyle: sp.ageStyle,
      speakingStyle: sp.speakingStyle,
      speakingRate: sp.speakingRate,
      emotion: sp.emotion,
    });

    let chosenId: GeminiVoiceId = requested.voiceId;
    if (used.has(chosenId)) {
      const unusedInPool = pool.find((id) => !used.has(id));
      if (unusedInPool) {
        chosenId = unusedInPool;
      }
    }
    used.add(chosenId);

    const finalProfile = RUSSIAN_VOICE_REGISTRY[chosenId];
    return {
      ...sp,
      voiceName: chosenId,
      ageStyle: sp.ageStyle ?? finalProfile.ageStyle,
      speakingStyle: sp.speakingStyle ?? finalProfile.speakingStyle,
      speakingRate: sp.speakingRate ?? finalProfile.speakingRate,
      emotion: sp.emotion ?? finalProfile.emotion,
    };
  });
}

/**
 * Compact, token-efficient phonetic direction for native Russian TTS.
 * Avoids verbose English context dumps that waste tokens or distort Russian prosody.
 */
export function buildRussianStylePrompt(
  profile: VoiceConfigProfile,
  context: {
    speakerRole?: string;
    topic?: string;
    customStyle?: string;
  } = {},
): string {
  const styleTag =
    profile.speakingStyle === 'narration'
      ? 'natural Russian radio narration'
      : profile.speakingStyle === 'educational'
        ? 'clear, natural Russian speech'
        : 'authentic everyday Russian conversation';

  const paceNote =
    profile.speakingRate <= 0.85
      ? 'Slightly measured pace.'
      : profile.speakingRate >= 1.1
        ? 'Brisk conversational pace.'
        : 'Natural conversational tempo.';

  const parts: string[] = [
    `${profile.styleDirective}.`,
    `Native ru-RU ${styleTag} (${profile.emotion}).`,
    `${paceNote} Accurate Russian stress, vowel reduction, hard/soft consonants, natural pauses; read exact text.`,
  ];

  if (context.speakerRole) {
    parts.push(`Role: ${context.speakerRole.slice(0, 50)}.`);
  }
  if (context.customStyle) {
    parts.push(context.customStyle.slice(0, 80));
  }

  return parts.join(' ').slice(0, 360);
}

/**
 * Canonical deterministic key payload containing EVERY parameter that affects
 * synthesized audio output so voice config changes automatically invalidate old cache.
 */
export function buildVoiceCacheSignature(input: {
  text: string;
  provider: TtsProviderId;
  model: TtsModelId;
  voiceId: GeminiVoiceId;
  locale: 'ru-RU';
  gender: 'male' | 'female';
  ageStyle: VoiceAgeStyle;
  speakingStyle: VoiceSpeakingStyle;
  speakingRate: number;
  pitch: number | null;
  emotion: string;
  stylePrompt?: string;
}): string {
  const normalizedText = stripStressMarks(input.text).replace(/\s+/g, ' ').trim();
  return JSON.stringify({
    v: VOICE_CACHE_SCHEMA_VERSION,
    text: normalizedText,
    provider: input.provider,
    model: input.model,
    voiceId: input.voiceId,
    locale: input.locale,
    gender: input.gender,
    ageStyle: input.ageStyle,
    speakingStyle: input.speakingStyle,
    speakingRate: Number(input.speakingRate.toFixed(2)),
    pitch: input.pitch,
    emotion: input.emotion,
    style: (input.stylePrompt ?? '').trim(),
  });
}

export function getDefaultRussianNarratorSpeaker(
  gender: 'female' | 'male' = 'female',
): SpeakerProfile {
  const voice = gender === 'female' ? RUSSIAN_VOICE_REGISTRY.Sulafat : RUSSIAN_VOICE_REGISTRY.Charon;
  return {
    name: gender === 'female' ? 'Анна' : 'Дмитрий',
    roleVi: 'Giọng đọc tiếng Nga chuẩn',
    roleEn: 'Native Russian speaker',
    voiceName: voice.voiceId,
    gender: voice.gender,
    ageStyle: voice.ageStyle,
    speakingStyle: 'educational',
    speakingRate: voice.speakingRate,
    emotion: voice.emotion,
  };
}
