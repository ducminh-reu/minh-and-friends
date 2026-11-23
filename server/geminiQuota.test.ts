import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { Lesson } from '../src/types/domain.ts';
import { encodeWavFromPcm } from '../src/utils/wavAudioUtils.ts';
import {
  classifyGeminiError,
  clearGeminiMonitoringEventsForTest,
  computeBackoffDelayMs,
  getRecentGeminiMonitoringEvents,
  sanitizeLogString,
  TtsRequestQueue,
} from './geminiQuotaManager.ts';
import { resolveSafeAudioFilePath } from './newsPipelineDb.ts';
import { synthesizeAndSplitLessonAudio } from './newsPipelineService.ts';
import {
  executeTtsWithSmartRetry,
  TtsQuotaError,
  type TtsProvider,
  type TtsSynthesisResult,
} from './ttsProvider.ts';

function makeValidBase64Wav(durationSec = 1.2): string {
  const sampleRate = 24000;
  const numSamples = Math.floor(sampleRate * durationSec);
  const pcm = Buffer.alloc(numSamples * 2);
  for (let i = 0; i < numSamples; i += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 4000);
    pcm.writeInt16LE(sample, i * 2);
  }
  return encodeWavFromPcm(pcm, sampleRate, 1, 16).toString('base64');
}

function createSampleNewsLesson(lessonId: string): Lesson {
  return {
    id: lessonId,
    titleRu: 'Экономика Европы и новые прогнозы роста',
    titleVi: 'Kinh tế châu Âu và dự báo tăng trưởng mới',
    descriptionVi: 'Bài luyện nghe tin tức thử nghiệm',
    level: 'B2',
    topic: 'economics',
    durationSec: 120,
    speakers: [
      {
        name: 'Анна',
        roleVi: 'Biên tập viên',
        roleEn: 'Host',
        voiceName: 'Kore',
        gender: 'female',
      },
      {
        name: 'Дмитрий',
        roleVi: 'Chuyên gia kinh tế',
        roleEn: 'Economist',
        voiceName: 'Charon',
        gender: 'male',
      },
    ],
    source: 'ai_generated',
    verified: false,
    createdAt: new Date().toISOString(),
    newsMetadata: {
      articleId: `art-${lessonId}`,
      sourceName: 'Test News',
      articleUrl: `https://example.com/${lessonId}`,
      publishedAt: new Date().toISOString(),
      originalTitle: 'European growth outlook',
      verifiedFactsSummaryVi: 'Dữ kiện xác minh thử nghiệm.',
      verifiedFactsRu: ['Проверенный факт один.'],
      educationalSummaryRu: 'Краткое учебное резюме новости.',
      educationalSummaryVi: 'Tóm tắt giáo dục ngắn.',
      newsTopic: 'european_economy_politics',
      format: 'dialogue',
      aiDisclaimerVi: 'AI educational disclaimer',
      audioStatus: 'pending',
      audioSegmentsCount: 0,
    },
    sentences: [
      {
        id: `${lessonId}-s1`,
        order: 1,
        speaker: 'Анна',
        text: 'Сегодня обсуждаем новые экономические показатели в Европе.',
        translationVi: 'Hôm nay chúng ta thảo luận các chỉ số kinh tế mới ở châu Âu.',
        startSec: 0,
        endSec: 5,
      },
      {
        id: `${lessonId}-s2`,
        order: 2,
        speaker: 'Дмитрий',
        text: 'Инфляция постепенно замедляется, но инвестиции растут осторожно.',
        translationVi: 'Lạm phát đang chậm lại dần, nhưng đầu tư tăng trưởng thận trọng.',
        startSec: 5,
        endSec: 11,
      },
    ],
    vocabulary: [
      {
        id: `${lessonId}-v1`,
        word: 'инфляция',
        stressedWord: 'инфля́ция',
        partOfSpeech: 'существительное',
        forms: 'инфляции',
        meaningVi: 'lạm phát',
        definitionRu: 'рост общего уровня цен',
        exampleRu: 'Инфляция замедляется.',
        exampleVi: 'Lạm phát đang chậm lại.',
      },
    ],
    grammarNotes: [],
    comprehensionQuestions: [],
  };
}

test('1. HTTP 429 temporary rate limit respects RetryInfo/Retry-After, backoff+jitter, and max 3 attempts', async () => {
  const slept: number[] = [];
  let calls = 0;

  const rateLimitPayload = JSON.stringify({
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      message: 'Rate limit exceeded. Please retry in 12s.',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.RetryInfo',
          retryDelay: '12s',
        },
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [
            {
              quotaId: 'GenerateRequestsPerMinutePerProjectPerModel',
              quotaMetric: 'generativelanguage.googleapis.com/generate_content_requests',
            },
          ],
        },
      ],
    },
  });

  const classified = classifyGeminiError(new Error(rateLimitPayload));
  assert.equal(classified.category, 'rate_limit_temporary');
  assert.equal(classified.retryable, true);
  assert.equal(classified.retryAfterMs, 12_000);
  assert.equal(classified.quotaId, 'GenerateRequestsPerMinutePerProjectPerModel');

  // Verify backoff respects retryAfterMs + random jitter
  const delay = computeBackoffDelayMs({
    attempt: 1,
    retryAfterMs: 12_000,
    randomFn: () => 0.5,
  });
  assert.equal(delay, 12_625);

  // Recovers on 3rd attempt (2 retries)
  const res = await executeTtsWithSmartRetry({
    model: 'gemini-3.8-flash-tts',
    maxAttempts: 3,
    sleepFn: async (ms) => {
      slept.push(ms);
    },
    randomFn: () => 0.2,
    invoke: async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error(rateLimitPayload);
      }
      return 'OK_AUDIO';
    },
  });

  assert.equal(res.value, 'OK_AUDIO');
  assert.equal(calls, 3);
  assert.equal(res.retryCount, 2);
  assert.equal(slept.length, 2);
  assert.ok(slept[0] >= 12_250 && slept[0] <= 13_000);

  // Hard cap at max 3 attempts when 429 persists
  let cappedCalls = 0;
  await assert.rejects(
    () =>
      executeTtsWithSmartRetry({
        model: 'gemini-3.8-flash-tts',
        maxAttempts: 3,
        sleepFn: async () => {},
        invoke: async () => {
          cappedCalls += 1;
          throw new Error(rateLimitPayload);
        },
      }),
    (err: unknown) => {
      assert.ok(err instanceof TtsQuotaError);
      assert.equal(err.classified.category, 'rate_limit_temporary');
      assert.equal(err.retryCount, 2);
      return true;
    },
  );
  assert.equal(cappedCalls, 3);
});

test('2. Temporary 503 UNAVAILABLE retries with exponential backoff and recovers', async () => {
  const slept: number[] = [];
  let calls = 0;

  const res = await executeTtsWithSmartRetry({
    model: 'gemini-3.8-flash-tts',
    maxAttempts: 3,
    baseDelayMs: 1000,
    sleepFn: async (ms) => {
      slept.push(ms);
    },
    randomFn: () => 0,
    invoke: async () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('503 UNAVAILABLE: The model is overloaded.');
        (err as { status?: number }).status = 503;
        throw err;
      }
      return 'RECOVERED_AFTER_503';
    },
  });

  assert.equal(res.value, 'RECOVERED_AFTER_503');
  assert.equal(calls, 2);
  assert.equal(res.retryCount, 1);
  assert.deepEqual(slept, [1000]);
});

test('3. Daily quota exhaustion stops immediately with 0 retries and trips queue daily breaker', async () => {
  let calls = 0;
  const dailyQuotaError = new Error(
    JSON.stringify({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message: 'You exceeded your current quota, please check your plan and billing details.',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [
              {
                quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
                quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
                quotaValue: '0',
              },
            ],
          },
        ],
      },
    }),
  );

  const classified = classifyGeminiError(dailyQuotaError);
  assert.equal(classified.category, 'daily_quota_exhausted');
  assert.equal(classified.retryable, false);

  await assert.rejects(
    () =>
      executeTtsWithSmartRetry({
        model: 'gemini-3.8-flash-tts',
        maxAttempts: 3,
        sleepFn: async () => {
          throw new Error('Must NOT sleep/retry on daily quota exhaustion!');
        },
        invoke: async () => {
          calls += 1;
          throw dailyQuotaError;
        },
      }),
    (err: unknown) => {
      assert.ok(err instanceof TtsQuotaError);
      assert.equal(err.classified.category, 'daily_quota_exhausted');
      assert.equal(err.retryCount, 0);
      return true;
    },
  );
  assert.equal(calls, 1, 'Daily quota exhaustion must stop immediately after 1 attempt');

  const queue = new TtsRequestQueue({ maxConcurrency: 1, minGapMs: 0, sleepFn: async () => {} });
  await assert.rejects(() =>
    queue.enqueue({
      idempotencyKey: 'daily-test',
      lessonId: 'lesson-daily-1',
      cefrLevel: 'B1',
      model: 'gemini-3.8-flash-tts',
      requestType: 'tts_dialogue',
      task: async () => {
        throw new TtsQuotaError(classified, 0);
      },
    }),
  );

  const snap = queue.getSnapshot();
  assert.equal(snap.dailyQuotaExhausted, true);
  assert.equal(snap.dailyQuotaExhaustedModel, 'gemini-3.8-flash-tts');
  assert.equal(snap.recentJobs[0]?.status, 'failed');
  assert.equal(snap.recentJobs[0]?.errorCategory, 'daily_quota_exhausted');
});

test('4. TTS timeout triggers real AbortSignal cancellation and terminates cleanly', async () => {
  let signalAborted = false;
  let attempts = 0;

  await assert.rejects(
    () =>
      executeTtsWithSmartRetry({
        model: 'gemini-3.8-flash-tts',
        timeoutMs: 40,
        maxAttempts: 2,
        baseDelayMs: 10,
        sleepFn: async () => {},
        invoke: (signal) =>
          new Promise<string>((_resolve, reject) => {
            attempts += 1;
            signal.addEventListener('abort', () => {
              signalAborted = true;
              const abortErr = new Error('The operation was aborted');
              abortErr.name = 'AbortError';
              reject(abortErr);
            });
          }),
      }),
    (err: unknown) => {
      assert.ok(err instanceof TtsQuotaError);
      assert.equal(err.classified.category, 'timeout');
      assert.equal(err.classified.httpStatus, 504);
      assert.equal(err.retryCount, 1);
      return true;
    },
  );

  assert.equal(signalAborted, true);
  assert.equal(attempts, 2);
});

test('5. Repeated clicks coalesce via idempotencyKey and lessonId to 1 single TTS worker', async () => {
  const queue = new TtsRequestQueue({ maxConcurrency: 1, minGapMs: 0, sleepFn: async () => {} });
  let executions = 0;

  const fire = (idx: number) =>
    queue.enqueue<string>({
      idempotencyKey: 'same-lesson-audio-key',
      lessonId: 'news-b2-repeat-click',
      cefrLevel: 'B2',
      model: 'gemini-3.8-flash-tts',
      requestType: 'tts_dialogue',
      task: async () => {
        executions += 1;
        await new Promise((r) => setTimeout(r, 30));
        return { result: `WAV_RESULT_${idx}`, httpStatus: 200 };
      },
    });

  const results = await Promise.all([fire(1), fire(2), fire(3), fire(4), fire(5)]);
  assert.equal(executions, 1, 'Repeated clicks must only invoke TTS once');
  assert.deepEqual(results, [
    'WAV_RESULT_1',
    'WAV_RESULT_1',
    'WAV_RESULT_1',
    'WAV_RESULT_1',
    'WAV_RESULT_1',
  ]);
});

test('6. Multiple simultaneous users are strictly serialized at maxConcurrency=1 with queued->processing->completed states', async () => {
  clearGeminiMonitoringEventsForTest();
  const queue = new TtsRequestQueue({ maxConcurrency: 1, minGapMs: 0, sleepFn: async () => {} });

  let currentRunning = 0;
  let maxObservedConcurrency = 0;
  let sawQueuedJobs = false;
  let sawProcessingJob = false;

  const runUser = (userNum: number) =>
    queue.enqueue<string>({
      idempotencyKey: `user-key-${userNum}`,
      lessonId: `news-user-${userNum}`,
      cefrLevel: userNum % 2 === 0 ? 'C1' : 'B1',
      model: 'gemini-3.8-flash-tts',
      requestType: 'tts_dialogue',
      task: async () => {
        currentRunning += 1;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, currentRunning);

        const snapDuringRun = queue.getSnapshot();
        if (snapDuringRun.activeJobs.some((j) => j.status === 'processing')) {
          sawProcessingJob = true;
        }
        if (snapDuringRun.queuedJobs.some((j) => j.status === 'queued')) {
          sawQueuedJobs = true;
        }

        await new Promise((r) => setTimeout(r, 25));
        currentRunning -= 1;
        return { result: `AUDIO_${userNum}`, httpStatus: 200 };
      },
    });

  const results = await Promise.all([runUser(1), runUser(2), runUser(3), runUser(4)]);
  assert.deepEqual(results, ['AUDIO_1', 'AUDIO_2', 'AUDIO_3', 'AUDIO_4']);
  assert.equal(maxObservedConcurrency, 1, 'Queue must enforce 1 concurrent TTS request');
  assert.equal(sawProcessingJob, true);
  assert.equal(sawQueuedJobs, true);

  const finalSnap = queue.getSnapshot();
  assert.equal(finalSnap.activeCount, 0);
  assert.equal(finalSnap.queuedCount, 0);
  assert.equal(finalSnap.recentJobs.length, 4);
  assert.ok(finalSnap.recentJobs.every((j) => j.status === 'completed'));

  const events = getRecentGeminiMonitoringEvents(10);
  assert.equal(events.length, 4);
  assert.ok(events.every((e) => e.model === 'gemini-3.8-flash-tts' && e.outcome === 'completed'));
});

test('7 & 8. Retry failed audio preserves text, reuses cached audio without API call, and never overwrites valid audio on failure', async () => {
  const testLessonId = `test-quota-${Date.now()}`;
  const lessonDir = path.dirname(resolveSafeAudioFilePath(testLessonId, 'full.wav')!);

  try {
    const initialLesson = createSampleNewsLesson(testLessonId);
    let providerCalls = 0;
    let mode: 'fail_429' | 'succeed' | 'fail_503' = 'fail_429';
    const validBase64 = makeValidBase64Wav(1.5);

    const mockProvider: TtsProvider = {
      name: 'gemini-3.8-flash-lite-tts',
      isAvailable: () => true,
      synthesize: async (input): Promise<TtsSynthesisResult> => {
        providerCalls += 1;
        if (mode === 'fail_429') {
          throw new TtsQuotaError(
            classifyGeminiError(new Error('429 RESOURCE_EXHAUSTED: Please retry in 15s')),
            2,
          );
        }
        if (mode === 'fail_503') {
          throw new TtsQuotaError(
            classifyGeminiError(new Error('503 UNAVAILABLE: Service temporarily overloaded')),
            2,
          );
        }
        return {
          audioBase64: validBase64,
          mimeType: 'audio/wav',
          cached: false,
          provider: 'gemini-3.8-flash-lite-tts',
          retryCount: 0,
        };
      },
      synthesizeDialogue: async (): Promise<TtsSynthesisResult> => {
        throw new Error('Per-turn synthesize should be used to preserve exact sentence boundaries');
      },
    };

    // Step A: Initial TTS fails with 429 -> lesson text & vocabulary MUST remain intact
    const failedRes = await synthesizeAndSplitLessonAudio(initialLesson, null, {
      providerOverride: mockProvider,
      skipDbPersistence: true,
    });
    assert.equal(failedRes.errorCategory, 'rate_limit_temporary');
    assert.equal(failedRes.lesson.newsMetadata?.audioStatus, 'failed');
    assert.equal(failedRes.lesson.titleRu, initialLesson.titleRu);
    assert.equal(failedRes.lesson.sentences.length, 2);
    assert.equal(failedRes.lesson.vocabulary.length, 1);
    assert.equal(providerCalls, 1);

    // Step B: Retry audio succeeds -> creates exact per-sentence + stitched full WAV files on disk
    mode = 'succeed';
    const retrySuccess = await synthesizeAndSplitLessonAudio(failedRes.lesson, null, {
      providerOverride: mockProvider,
      skipDbPersistence: true,
    });
    assert.equal(retrySuccess.error, null);
    assert.equal(retrySuccess.reusedFromCache, false);
    assert.equal(retrySuccess.segmentsSaved, 2);
    assert.equal(retrySuccess.lesson.newsMetadata?.audioStatus, 'ready');
    assert.ok(retrySuccess.lesson.newsMetadata?.fullAudioUrl?.endsWith('/full.wav'));
    // 1 failed call in Step A + 2 exact per-turn calls in Step B
    assert.equal(providerCalls, 3);

    const fullPath = resolveSafeAudioFilePath(testLessonId, 'full.wav')!;
    const seg1Path = resolveSafeAudioFilePath(testLessonId, 's-1.wav')!;
    const seg2Path = resolveSafeAudioFilePath(testLessonId, 's-2.wav')!;
    const originalFullBytes = fs.readFileSync(fullPath);
    assert.ok(originalFullBytes.length > 44);
    assert.ok(fs.statSync(seg1Path).size > 44);
    assert.ok(fs.statSync(seg2Path).size > 44);

    // Step C: Reusing previously generated audio -> 0 upstream calls!
    const reusedRes = await synthesizeAndSplitLessonAudio(retrySuccess.lesson, null, {
      providerOverride: mockProvider,
      skipDbPersistence: true,
    });
    assert.equal(reusedRes.reusedFromCache, true);
    assert.equal(reusedRes.error, null);
    assert.equal(providerCalls, 3, 'Cached valid audio must be reused without calling TTS API');

    // Step D: Forced regeneration fails with 503 -> MUST NOT overwrite valid audio on disk or in metadata!
    mode = 'fail_503';
    const failedForce = await synthesizeAndSplitLessonAudio(retrySuccess.lesson, null, {
      forceRegenerate: true,
      providerOverride: mockProvider,
      skipDbPersistence: true,
    });
    assert.equal(failedForce.errorCategory, 'server_overloaded');
    assert.equal(failedForce.lesson.newsMetadata?.audioStatus, 'ready');
    assert.equal(
      failedForce.lesson.newsMetadata?.fullAudioUrl,
      retrySuccess.lesson.newsMetadata?.fullAudioUrl,
    );
    assert.equal(
      Buffer.compare(fs.readFileSync(fullPath), originalFullBytes),
      0,
      'Valid WAV file on disk must never be overwritten by a failed regeneration',
    );
  } finally {
    fs.rmSync(lessonDir, { recursive: true, force: true });
  }
});

test('9. Secret redaction ensures API keys and bearer tokens are never logged', () => {
  const leaked =
    'Request failed with key=AIzaSyA1234567890abcdefghijklmnopQRSTUV and Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret';
  const sanitized = sanitizeLogString(leaked);
  assert.ok(!sanitized.includes('AIzaSyA1234567890'));
  assert.ok(!sanitized.includes('eyJhbGciOiJIUzI1NiJ9'));
  assert.ok(sanitized.includes('[REDACTED_API_KEY]'));
  assert.ok(sanitized.includes('Bearer [REDACTED]'));
});
