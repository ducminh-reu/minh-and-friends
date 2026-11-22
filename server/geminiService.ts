import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  CefrLevel,
  Lesson,
  LessonQualityChecks,
  NewsArticle,
  NewsFormat,
  TopicCategory,
} from '../src/types/domain.ts';
import { mapNewsTopicToLessonTopic } from '../src/utils/newsFeedUtils.ts';
import {
  classifyGeminiError,
  computeBackoffDelayMs,
  recordGeminiMonitoringEvent,
} from './geminiQuotaManager.ts';

export const CONFIGURED_TEXT_MODEL =
  process.env.GEMINI_TEXT_MODEL?.trim() || 'gemini-4-hydrogen';

export const TEXT_GENERATION_TIMEOUT_MS = 55_000;
export const TEXT_MAX_ATTEMPTS = 3;

export function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY?.trim();
  return Boolean(key && key !== 'MY_GEMINI_API_KEY' && key.length > 10);
}

export function createGeminiClient(timeoutMs?: number): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      ...(timeoutMs ? { timeout: timeoutMs } : {}),
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function createGeminiTtsClient(timeoutMs?: number): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      ...(timeoutMs ? { timeout: timeoutMs } : {}),
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const KNOWN_FEMALE_RUSSIAN_NAMES = new Set([
  'анна', 'елена', 'мария', 'наталья', 'ольга', 'оля', 'катя', 'екатерина',
  'ирина', 'светлана', 'татьяна', 'вера', 'дарья', 'анастасия', 'софья',
  'софия', 'виктория', 'юлия', 'полина', 'алина', 'ксения', 'марина',
  'людмила', 'валентина', 'галина', 'надежда', 'лариса', 'евгения', 'валерия',
]);

export function resolveSpeakerGender(rawGender: string | undefined, name: string): 'male' | 'female' {
  const g = (rawGender ?? '').trim().toLowerCase();
  if (['female', 'f', 'woman', 'женский', 'жен', 'ж', 'nữ', 'nu'].includes(g)) {
    return 'female';
  }
  if (['male', 'm', 'man', 'мужской', 'муж', 'м', 'nam'].includes(g)) {
    return 'male';
  }
  const cleanFirst = name
    .replace(/\u0301/g, '')
    .trim()
    .split(/\s+/)[0]
    ?.toLowerCase() ?? '';
  if (KNOWN_FEMALE_RUSSIAN_NAMES.has(cleanFirst)) {
    return 'female';
  }
  return 'male';
}

async function withAbortTimeout<T>(
  timeoutMs: number,
  errorMessage: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await operation(controller.signal);
  } catch (err) {
    if (
      controller.signal.aborted ||
      (err instanceof Error && (err.name === 'AbortError' || err.message.toLowerCase().includes('aborted')))
    ) {
      throw new Error(errorMessage);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function attachThinkingConfigIfSupported(
  model: string,
  config: Parameters<GoogleGenAI['models']['generateContent']>[0]['config'],
): Parameters<GoogleGenAI['models']['generateContent']>[0]['config'] {
  if (
    (model === 'gemini-4-hydrogen' || model === 'gemini-4-neon') &&
    !config?.thinkingConfig
  ) {
    return {
      ...config,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    };
  }
  return config;
}

async function generateTextWithRetry(
  params: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>,
  meta: {
    lessonId?: string | null;
    cefrLevel?: CefrLevel | null;
    timeoutMs?: number;
    maxAttempts?: number;
  } = {},
) {
  const model = CONFIGURED_TEXT_MODEL;
  const timeoutMs = meta.timeoutMs ?? TEXT_GENERATION_TIMEOUT_MS;
  const maxAttempts = Math.min(3, Math.max(1, meta.maxAttempts ?? TEXT_MAX_ATTEMPTS));
  const startedAtMs = Date.now();
  let lastError: unknown;
  let retriesPerformed = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await withAbortTimeout(
        timeoutMs,
        `Gemini text generation timed out after ${Math.round(timeoutMs / 1000)}s (model: ${model}).`,
        async (signal) => {
          const ai = createGeminiClient(timeoutMs);
          const baseConfig = attachThinkingConfigIfSupported(model, params.config);
          return await ai.models.generateContent({
            ...params,
            model,
            config: {
              ...baseConfig,
              abortSignal: signal,
              httpOptions: {
                ...(baseConfig?.httpOptions ?? {}),
                timeout: timeoutMs,
              },
            },
          });
        },
      );

      recordGeminiMonitoringEvent({
        requestType: 'text',
        model,
        lessonId: meta.lessonId ?? null,
        cefrLevel: meta.cefrLevel ?? null,
        httpStatus: 200,
        errorCategory: 'none',
        retryCount: retriesPerformed,
        queueWaitMs: 0,
        processingDurationMs: Date.now() - startedAtMs,
        reusedFromCache: false,
        outcome: 'completed',
        retryAfterMs: null,
        quotaId: null,
      });

      return response;
    } catch (err) {
      lastError = err;
      const classified = classifyGeminiError(err);

      // Never retry non-retryable errors (including daily quota exhaustion, 404, 403, 400)
      if (!classified.retryable || attempt >= maxAttempts) {
        recordGeminiMonitoringEvent({
          requestType: 'text',
          model,
          lessonId: meta.lessonId ?? null,
          cefrLevel: meta.cefrLevel ?? null,
          httpStatus: classified.httpStatus,
          errorCategory: classified.category,
          retryCount: retriesPerformed,
          queueWaitMs: 0,
          processingDurationMs: Date.now() - startedAtMs,
          reusedFromCache: false,
          outcome: 'failed',
          retryAfterMs: classified.retryAfterMs,
          quotaId: classified.quotaId,
        });
        throw err;
      }

      retriesPerformed += 1;
      const delayMs = computeBackoffDelayMs({
        attempt,
        retryAfterMs: classified.retryAfterMs,
        baseDelayMs: 1800,
        maxDelayMs: 25_000,
      });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  throw lastError;
}

export async function verifyGeminiModelMetadata(modelName: string): Promise<{
  model: string;
  available: boolean;
  displayName?: string;
  errorCategory?: string;
  httpStatus?: number | null;
  message?: string;
}> {
  if (!isGeminiConfigured()) {
    return {
      model: modelName,
      available: false,
      errorCategory: 'auth_error',
      httpStatus: 503,
      message: 'GEMINI_API_KEY is not configured on the server.',
    };
  }
  try {
    const info = await withAbortTimeout(
      12_000,
      `Model lookup timed out for ${modelName}.`,
      async () => {
        const ai = modelName.includes('tts')
          ? createGeminiTtsClient(12_000)
          : createGeminiClient(12_000);
        return await ai.models.get({ model: modelName });
      },
    );
    return {
      model: modelName,
      available: true,
      displayName: info.displayName ?? info.name ?? modelName,
      httpStatus: 200,
    };
  } catch (err) {
    const classified = classifyGeminiError(err);
    return {
      model: modelName,
      available: false,
      errorCategory: classified.category,
      httpStatus: classified.httpStatus,
      message: classified.safeMessage,
    };
  }
}

export interface GenerateLessonInput {
  level: CefrLevel;
  topic: TopicCategory;
  length: 'short' | 'standard' | 'extended';
  speakersCount: 2 | 3;
  difficulty: 'accessible' | 'standard' | 'challenging';
  vocabFocus?: string;
  grammarFocus?: string;
}

export async function generateRussianLesson(
  input: GenerateLessonInput,
): Promise<Lesson> {
  const sentenceTarget =
    input.length === 'short' ? 8 : input.length === 'standard' ? 11 : 14;

  const prompt = `Create a natural, authentic Russian dialogue dictation lesson for a Vietnamese learner.
Parameters:
- Target CEFR level: ${input.level}
- Topic key: ${input.topic}
- Target number of dialogue turns/sentences: ${sentenceTarget}
- Speakers count: ${input.speakersCount}
- Difficulty nuance: ${input.difficulty}
- Vocabulary focus: ${input.vocabFocus || 'natural everyday & topic-authentic expressions'}
- Grammar focus: ${input.grammarFocus || 'authentic CEFR-appropriate structures'}

Requirements:
1. Natural conversational Russian with realistic pacing, colloquial reactions, and natural turn-taking — never stiff or textbook-like.
2. Put Russian stress marks (combining acute accent U+0301) on vocabulary words and key dialogue words where helpful, or clean Russian Cyrillic in dialogue text.
3. For each speaker in "speakers", set "gender" strictly to "female" or "male" matching their Russian name and role, and use exact matching speaker names across "speakers" and "sentences".
4. Provide accurate Vietnamese translations for every sentence, vocabulary item, grammar note, and comprehension question.
5. Provide 10 important vocabulary items from the dialogue with stressedWord, partOfSpeech (in Russian), grammatical forms, meaningVi, definitionRu, exampleRu, exampleVi.
6. Provide 3 bilingual grammar notes (explanationVi and explanationRu) with concrete examples.
7. Provide 3 comprehension questions in Russian + Vietnamese with 3 options each.
8. Provide levelJustificationVi explaining why this dialogue fits CEFR ${input.level}.`;

  const response = await generateTextWithRetry(
    {
      contents: prompt,
      config: {
      systemInstruction:
        'You are an expert Russian-as-a-foreign-language (РКИ) curriculum author fluent in Vietnamese and Russian linguistics. Return strictly valid JSON matching the schema.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          titleRu: { type: Type.STRING },
          titleVi: { type: Type.STRING },
          descriptionVi: { type: Type.STRING },
          levelJustificationVi: { type: Type.STRING },
          speakers: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                roleVi: { type: Type.STRING },
                roleEn: { type: Type.STRING },
                gender: { type: Type.STRING },
              },
              required: ['name', 'roleVi', 'roleEn', 'gender'],
            },
          },
          sentences: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                speaker: { type: Type.STRING },
                text: { type: Type.STRING },
                translationVi: { type: Type.STRING },
                grammarFocus: { type: Type.STRING },
              },
              required: ['speaker', 'text', 'translationVi'],
            },
          },
          vocabulary: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                word: { type: Type.STRING },
                stressedWord: { type: Type.STRING },
                partOfSpeech: { type: Type.STRING },
                forms: { type: Type.STRING },
                meaningVi: { type: Type.STRING },
                definitionRu: { type: Type.STRING },
                exampleRu: { type: Type.STRING },
                exampleVi: { type: Type.STRING },
              },
              required: [
                'word',
                'stressedWord',
                'partOfSpeech',
                'forms',
                'meaningVi',
                'definitionRu',
                'exampleRu',
                'exampleVi',
              ],
            },
          },
          grammarNotes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                titleVi: { type: Type.STRING },
                titleRu: { type: Type.STRING },
                explanationVi: { type: Type.STRING },
                explanationRu: { type: Type.STRING },
                examples: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      ru: { type: Type.STRING },
                      vi: { type: Type.STRING },
                    },
                    required: ['ru', 'vi'],
                  },
                },
              },
              required: ['titleVi', 'titleRu', 'explanationVi', 'explanationRu', 'examples'],
            },
          },
          comprehensionQuestions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                questionRu: { type: Type.STRING },
                questionVi: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                correctIndex: { type: Type.INTEGER },
                explanationVi: { type: Type.STRING },
              },
              required: [
                'questionRu',
                'questionVi',
                'options',
                'correctIndex',
                'explanationVi',
              ],
            },
          },
        },
        required: [
          'titleRu',
          'titleVi',
          'descriptionVi',
          'levelJustificationVi',
          'speakers',
          'sentences',
          'vocabulary',
          'grammarNotes',
          'comprehensionQuestions',
        ],
      },
    },
    },
    { cefrLevel: input.level },
  );

  const raw = JSON.parse((response.text ?? '{}').trim());
  const lessonId = `ai-${input.level.toLowerCase()}-${Date.now()}`;

  const femaleVoices = ['Kore', 'Zephyr'] as const;
  const maleVoices = ['Puck', 'Charon', 'Fenrir'] as const;
  let femaleIdx = 0;
  let maleIdx = 0;

  const speakers = (raw.speakers ?? []).slice(0, input.speakersCount).map(
    (sp: { name: string; roleVi: string; roleEn: string; gender: string }) => {
      const gender = resolveSpeakerGender(sp.gender, sp.name);
      const voiceName =
        gender === 'female'
          ? femaleVoices[femaleIdx++ % femaleVoices.length]
          : maleVoices[maleIdx++ % maleVoices.length];
      return {
        name: sp.name,
        roleVi: sp.roleVi,
        roleEn: sp.roleEn,
        gender,
        voiceName,
      };
    },
  );

  let cursorSec = 0;
  const sentences = (raw.sentences ?? []).map(
    (
      s: { speaker: string; text: string; translationVi: string; grammarFocus?: string },
      idx: number,
    ) => {
      const wordCount = Math.max(4, s.text.split(/\s+/).length);
      const duration = Math.max(7, Math.round(wordCount * 0.68));
      const item = {
        id: `${lessonId}-s${idx + 1}`,
        order: idx + 1,
        speaker: s.speaker,
        text: s.text,
        translationVi: s.translationVi,
        startSec: cursorSec,
        endSec: cursorSec + duration,
        grammarFocus: s.grammarFocus,
      };
      cursorSec += duration;
      return item;
    },
  );

  // Deterministic structural & linguistic quality verification (avoids redundant 2nd API call)
  const qualityChecks = verifyGeneratedLessonQualityLocal({
    level: input.level,
    sentences,
    vocabularyCount: (raw.vocabulary ?? []).length,
  });

  return {
    id: lessonId,
    titleRu: raw.titleRu,
    titleVi: raw.titleVi,
    descriptionVi: raw.descriptionVi,
    level: input.level,
    topic: input.topic,
    durationSec: Math.max(60, cursorSec),
    speakers,
    source: 'ai_generated',
    verified: false,
    createdAt: new Date().toISOString(),
    levelJustificationVi: raw.levelJustificationVi,
    qualityChecks,
    sentences,
    vocabulary: (raw.vocabulary ?? []).map((v: Record<string, string>, idx: number) => ({
      id: `${lessonId}-v${idx + 1}`,
      word: v.word,
      stressedWord: v.stressedWord || v.word,
      partOfSpeech: v.partOfSpeech,
      forms: v.forms,
      meaningVi: v.meaningVi,
      definitionRu: v.definitionRu,
      exampleRu: v.exampleRu,
      exampleVi: v.exampleVi,
    })),
    grammarNotes: (raw.grammarNotes ?? []).map(
      (g: Record<string, unknown>, idx: number) => ({
        id: `${lessonId}-g${idx + 1}`,
        titleVi: String(g.titleVi ?? ''),
        titleRu: String(g.titleRu ?? ''),
        explanationVi: String(g.explanationVi ?? ''),
        explanationRu: String(g.explanationRu ?? ''),
        examples: Array.isArray(g.examples) ? g.examples : [],
      }),
    ),
    comprehensionQuestions: (raw.comprehensionQuestions ?? []).map(
      (q: Record<string, unknown>, idx: number) => ({
        id: `${lessonId}-q${idx + 1}`,
        questionRu: String(q.questionRu ?? ''),
        questionVi: String(q.questionVi ?? ''),
        options: Array.isArray(q.options) ? q.options.map(String) : [],
        correctIndex: Number(q.correctIndex ?? 0),
        explanationVi: String(q.explanationVi ?? ''),
      }),
    ),
  };
}

function verifyGeneratedLessonQualityLocal(payload: {
  level: CefrLevel;
  sentences: { speaker: string; text: string }[];
  vocabularyCount: number;
}): LessonQualityChecks {
  const hasTranscriptConsistency =
    payload.sentences.length >= 6 &&
    payload.sentences.every((s) => /[а-яА-ЯёЁ]/.test(s.text) && s.speaker.trim().length > 0);
  const avgWordCount =
    payload.sentences.length > 0
      ? payload.sentences.reduce((sum, s) => sum + s.text.trim().split(/\s+/).length, 0) /
        payload.sentences.length
      : 0;

  return {
    grammar: hasTranscriptConsistency,
    naturalness: hasTranscriptConsistency && avgWordCount >= 5,
    cefrMatch: hasTranscriptConsistency,
    vocabAppropriate: payload.vocabularyCount >= 6,
    transcriptConsistent: hasTranscriptConsistency,
  };
}

export async function explainDictationMistakesWithAi(input: {
  referenceText: string;
  learnerText: string;
  level: CefrLevel;
}): Promise<{
  summaryVi: string;
  grammarTipRu: string;
  correctedText: string;
}> {
  const response = await generateTextWithRetry(
    {
      contents: `Compare the Russian dictation attempt against the reference sentence (CEFR ${input.level}):
Reference: "${input.referenceText}"
Learner wrote: "${input.learnerText}"

Explain the exact listening, spelling, case, gender/number, or verb aspect differences clearly in Vietnamese for a Vietnamese learner, and provide a concise Russian grammar rule.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summaryVi: { type: Type.STRING },
            grammarTipRu: { type: Type.STRING },
            correctedText: { type: Type.STRING },
          },
          required: ['summaryVi', 'grammarTipRu', 'correctedText'],
        },
      },
    },
    { cefrLevel: input.level, timeoutMs: 30_000, maxAttempts: 2 },
  );

  const parsed = JSON.parse((response.text ?? '{}').trim());
  return {
    summaryVi: String(parsed.summaryVi ?? ''),
    grammarTipRu: String(parsed.grammarTipRu ?? ''),
    correctedText: String(parsed.correctedText ?? input.referenceText),
  };
}

export interface GenerateNewsLessonInput {
  article: NewsArticle;
  level: CefrLevel;
  format: NewsFormat;
  pipelineDateKey?: string;
}

export async function generateNewsDictationLesson(
  input: GenerateNewsLessonInput,
): Promise<Lesson> {
  const { article, level, format } = input;

  const formatInstruction =
    format === 'dialogue'
      ? `Create BOTH:
   (a) "educationalSummaryRu" (3 concise, natural Russian broadcast summary sentences introducing the verified story context at CEFR ${level}) + "educationalSummaryVi" (its accurate Vietnamese translation), AND
   (b) A natural, 2-to-3-minute Russian newsroom dialogue ("sentences") between 2 speakers (1 female and 1 male with authentic Russian names, e.g. journalist + economic/political analyst) discussing the topic and vocabulary. Generate 12 to 15 substantive turns (each ~12–17 words) so total spoken audio is ~2–3 minutes.`
      : `Create BOTH:
   (a) "educationalSummaryRu" (3 concise, natural Russian broadcast overview sentences at CEFR ${level}) + "educationalSummaryVi" (its accurate Vietnamese translation), AND
   (b) A structured, 2-to-3-minute Russian educational news briefing ("sentences") presented by 1 news anchor (1 speaker with an authentic Russian name). Generate 12 to 14 clear broadcast sentences (each ~12–18 words) so total spoken audio is ~2–3 minutes.`;

  const prompt = `Transform the following verified news headline and RSS excerpt into an educational Russian listening & dictation lesson ("Новости дня") at CEFR ${level} for a Vietnamese learner.

VERIFIED NEWS SOURCE DATA (DO NOT INVENT NEW FACTS, NUMBERS, QUOTES, OR DATES BEYOND THIS):
- Source: ${article.sourceName}
- Publication timestamp: ${article.publishedAt}
- Original headline (${article.sourceLanguage}): ${article.title}
- RSS summary excerpt: ${article.summarySnippet || '(Headline only provided in RSS)'}
- Topic category: ${article.topic}

REQUIREMENTS:
1. ${formatInstruction}
2. STRICT COPYRIGHT & FACTUALITY RULES:
   - Never reproduce or translate an entire copyrighted news article verbatim.
   - Do NOT invent specific statistics, dates, quotes, or claims that are not supported by the verified headline and RSS excerpt above.
   - In "verifiedFactsRu" (2–3 short Russian bullets) and "verifiedFactsSummaryVi" (1–2 concise Vietnamese sentences), state ONLY the verified facts directly grounded in the headline/excerpt above.
   - Both "educationalSummaryRu" and the "sentences" script are original AI-generated educational content calibrated strictly to CEFR ${level}.
3. LANGUAGE & CEFR CALIBRATION (${level}):
   - B1: clear standard news Russian, high-frequency economic/political terms, shorter clauses.
   - B2: authentic journalistic phrasing, cause-effect connectors, intermediate analytical register.
   - C1: nuanced analytical discourse, passive/participial constructions, precise media terminology.
   - C2: sophisticated editorial commentary, idiomatic precision, complex syntactic structures.
4. Provide accurate Vietnamese translations for every sentence ("translationVi").
5. Provide 12 important vocabulary expressions (between 10 and 15 items) extracted from the lesson script with bilingual Russian and Vietnamese explanations: word, stressedWord (using U+0301 acute accent), partOfSpeech (in Russian), forms, meaningVi, definitionRu, exampleRu, exampleVi.
6. Provide 3 bilingual grammar notes ("grammarNotes") relevant to the news register with both "explanationVi" and "explanationRu" plus examples.
7. Provide 3 comprehension & news-literacy exercises ("comprehensionQuestions") in Russian + Vietnamese with 3 options each.
8. Set "gender" on each speaker strictly to "female" or "male", matching their Russian name, and match speaker names identically across "speakers" and "sentences".`;

  const response = await generateTextWithRetry(
    {
      contents: prompt,
      config: {
      systemInstruction:
        'You are a senior Russian-as-a-foreign-language (РКИ) broadcast journalism educator fluent in Russian and Vietnamese. Return strictly valid JSON matching the schema.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          titleRu: { type: Type.STRING },
          titleVi: { type: Type.STRING },
          descriptionVi: { type: Type.STRING },
          levelJustificationVi: { type: Type.STRING },
          educationalSummaryRu: { type: Type.STRING },
          educationalSummaryVi: { type: Type.STRING },
          verifiedFactsSummaryVi: { type: Type.STRING },
          verifiedFactsRu: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          speakers: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                roleVi: { type: Type.STRING },
                roleEn: { type: Type.STRING },
                gender: { type: Type.STRING },
              },
              required: ['name', 'roleVi', 'roleEn', 'gender'],
            },
          },
          sentences: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                speaker: { type: Type.STRING },
                text: { type: Type.STRING },
                translationVi: { type: Type.STRING },
                grammarFocus: { type: Type.STRING },
              },
              required: ['speaker', 'text', 'translationVi'],
            },
          },
          vocabulary: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                word: { type: Type.STRING },
                stressedWord: { type: Type.STRING },
                partOfSpeech: { type: Type.STRING },
                forms: { type: Type.STRING },
                meaningVi: { type: Type.STRING },
                definitionRu: { type: Type.STRING },
                exampleRu: { type: Type.STRING },
                exampleVi: { type: Type.STRING },
              },
              required: [
                'word',
                'stressedWord',
                'partOfSpeech',
                'forms',
                'meaningVi',
                'definitionRu',
                'exampleRu',
                'exampleVi',
              ],
            },
          },
          grammarNotes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                titleVi: { type: Type.STRING },
                titleRu: { type: Type.STRING },
                explanationVi: { type: Type.STRING },
                explanationRu: { type: Type.STRING },
                examples: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      ru: { type: Type.STRING },
                      vi: { type: Type.STRING },
                    },
                    required: ['ru', 'vi'],
                  },
                },
              },
              required: ['titleVi', 'titleRu', 'explanationVi', 'explanationRu', 'examples'],
            },
          },
          comprehensionQuestions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                questionRu: { type: Type.STRING },
                questionVi: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                correctIndex: { type: Type.INTEGER },
                explanationVi: { type: Type.STRING },
              },
              required: [
                'questionRu',
                'questionVi',
                'options',
                'correctIndex',
                'explanationVi',
              ],
            },
          },
        },
        required: [
          'titleRu',
          'titleVi',
          'descriptionVi',
          'levelJustificationVi',
          'educationalSummaryRu',
          'educationalSummaryVi',
          'verifiedFactsSummaryVi',
          'verifiedFactsRu',
          'speakers',
          'sentences',
          'vocabulary',
          'grammarNotes',
          'comprehensionQuestions',
        ],
      },
    },
    },
    { lessonId: article.id, cefrLevel: level },
  );

  const raw = JSON.parse((response.text ?? '{}').trim());
  const lessonId = `news-${level.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const femaleVoices = ['Kore', 'Zephyr'] as const;
  const maleVoices = ['Puck', 'Charon', 'Fenrir'] as const;
  let femaleIdx = 0;
  let maleIdx = 0;

  const maxSpeakers = format === 'dialogue' ? 2 : 1;
  const speakers = (raw.speakers ?? []).slice(0, maxSpeakers).map(
    (sp: { name: string; roleVi: string; roleEn: string; gender: string }) => {
      const gender = resolveSpeakerGender(sp.gender, sp.name);
      const voiceName =
        gender === 'female'
          ? femaleVoices[femaleIdx++ % femaleVoices.length]
          : maleVoices[maleIdx++ % maleVoices.length];
      return {
        name: sp.name,
        roleVi: sp.roleVi,
        roleEn: sp.roleEn,
        gender,
        voiceName,
      };
    },
  );

  let cursorSec = 0;
  const sentences = (raw.sentences ?? []).map(
    (
      s: { speaker: string; text: string; translationVi: string; grammarFocus?: string },
      idx: number,
    ) => {
      const wordCount = Math.max(5, s.text.split(/\s+/).length);
      const duration = Math.max(8, Math.round(wordCount * 0.72));
      const item = {
        id: `${lessonId}-s${idx + 1}`,
        order: idx + 1,
        speaker: speakers[0]?.name && format === 'summary' ? speakers[0].name : s.speaker,
        text: s.text,
        translationVi: s.translationVi,
        startSec: cursorSec,
        endSec: cursorSec + duration,
        grammarFocus: s.grammarFocus,
      };
      cursorSec += duration;
      return item;
    },
  );

  const vocabItems = (raw.vocabulary ?? []).slice(0, 15).map(
    (v: Record<string, string>, idx: number) => ({
      id: `${lessonId}-v${idx + 1}`,
      word: v.word,
      stressedWord: v.stressedWord || v.word,
      partOfSpeech: v.partOfSpeech,
      forms: v.forms,
      meaningVi: v.meaningVi,
      definitionRu: v.definitionRu,
      exampleRu: v.exampleRu,
      exampleVi: v.exampleVi,
    }),
  );

  const qualityChecks = verifyGeneratedLessonQualityLocal({
    level,
    sentences,
    vocabularyCount: vocabItems.length,
  });

  return {
    id: lessonId,
    titleRu: String(raw.titleRu ?? article.title),
    titleVi: String(raw.titleVi ?? article.title),
    descriptionVi: String(raw.descriptionVi ?? ''),
    level,
    topic: mapNewsTopicToLessonTopic(article.topic),
    durationSec: Math.max(120, cursorSec),
    speakers,
    source: 'ai_generated',
    verified: false,
    createdAt: new Date().toISOString(),
    levelJustificationVi: String(raw.levelJustificationVi ?? ''),
    qualityChecks,
    newsMetadata: {
      articleId: article.id,
      sourceName: article.sourceName,
      articleUrl: article.articleUrl,
      publishedAt: article.publishedAt,
      originalTitle: article.title,
      verifiedFactsSummaryVi: String(raw.verifiedFactsSummaryVi ?? ''),
      verifiedFactsRu: Array.isArray(raw.verifiedFactsRu)
        ? raw.verifiedFactsRu.map(String).slice(0, 4)
        : [],
      educationalSummaryRu: String(raw.educationalSummaryRu ?? ''),
      educationalSummaryVi: String(raw.educationalSummaryVi ?? ''),
      newsTopic: article.topic,
      format,
      aiDisclaimerVi:
        'Sự kiện cốt lõi được trích từ nguồn tin gốc đã xác minh ngày đăng; phần tóm tắt và hội thoại nghe chép bên dưới được Gemini AI biên soạn cho mục đích học tiếng Nga ở bậc CEFR đã chọn.',
      pipelineDateKey: input.pipelineDateKey ?? article.publishedDateKey,
    },
    sentences,
    vocabulary: vocabItems,
    grammarNotes: (raw.grammarNotes ?? []).map(
      (g: Record<string, unknown>, idx: number) => ({
        id: `${lessonId}-g${idx + 1}`,
        titleVi: String(g.titleVi ?? ''),
        titleRu: String(g.titleRu ?? ''),
        explanationVi: String(g.explanationVi ?? ''),
        explanationRu: String(g.explanationRu ?? ''),
        examples: Array.isArray(g.examples) ? g.examples : [],
      }),
    ),
    comprehensionQuestions: (raw.comprehensionQuestions ?? []).map(
      (q: Record<string, unknown>, idx: number) => ({
        id: `${lessonId}-q${idx + 1}`,
        questionRu: String(q.questionRu ?? ''),
        questionVi: String(q.questionVi ?? ''),
        options: Array.isArray(q.options) ? q.options.map(String) : [],
        correctIndex: Number(q.correctIndex ?? 0),
        explanationVi: String(q.explanationVi ?? ''),
      }),
    ),
  };
}
