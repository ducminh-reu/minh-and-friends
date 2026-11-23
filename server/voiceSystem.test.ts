import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FEMALE_VOICE_IDS,
  MALE_VOICE_IDS,
  RUSSIAN_VOICE_REGISTRY,
  assignDistinctSpeakerVoices,
  buildVoiceCacheSignature,
  resolveVoiceProfile,
} from '../src/utils/voiceRegistry.ts';
import {
  findSpeakerProfile,
  inferRussianSpeakerGender,
} from '../src/utils/speakerUtils.ts';
import {
  analyzeWavAcoustics,
  concatenateWavSegmentsWithTurnPauses,
  encodeWavFromPcm,
} from '../src/utils/wavAudioUtils.ts';
import { TtsRequestQueue, classifyGeminiError } from './geminiQuotaManager.ts';
import { TtsQuotaError } from './ttsProvider.ts';
import { TTS_QA_SAMPLES } from './ttsQaSuite.ts';

function makeToneWav(durationSec: number, freqHz = 360, amplitude = 8000): Buffer {
  const sampleRate = 24000;
  const numSamples = Math.floor(sampleRate * durationSec);
  const pcm = Buffer.alloc(numSamples * 2);
  for (let i = 0; i < numSamples; i += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * freqHz * i) / sampleRate) * amplitude);
    pcm.writeInt16LE(sample, i * 2);
  }
  return encodeWavFromPcm(pcm, sampleRate, 1, 16);
}

test('Voice registry enforces strict male/female separation and never flips gender on mismatch', () => {
  for (const v of FEMALE_VOICE_IDS) {
    assert.equal(RUSSIAN_VOICE_REGISTRY[v].gender, 'female');
    assert.equal(RUSSIAN_VOICE_REGISTRY[v].locale, 'ru-RU');
    assert.equal(RUSSIAN_VOICE_REGISTRY[v].language, 'Russian');
  }
  for (const v of MALE_VOICE_IDS) {
    assert.equal(RUSSIAN_VOICE_REGISTRY[v].gender, 'male');
    assert.equal(RUSSIAN_VOICE_REGISTRY[v].locale, 'ru-RU');
    assert.equal(RUSSIAN_VOICE_REGISTRY[v].language, 'Russian');
  }

  // Requesting a male voice for a female speaker must strictly resolve to a female voice
  const correctedFemale = resolveVoiceProfile('Charon', 'female');
  assert.equal(correctedFemale.gender, 'female');
  assert.ok(FEMALE_VOICE_IDS.includes(correctedFemale.voiceId));

  // Requesting a female voice for a male speaker must strictly resolve to a male voice
  const correctedMale = resolveVoiceProfile('Kore', 'male');
  assert.equal(correctedMale.gender, 'male');
  assert.ok(MALE_VOICE_IDS.includes(correctedMale.voiceId));
});

test('assignDistinctSpeakerVoices assigns unique gender-matched voices for 3-speaker dialogues', () => {
  const assigned = assignDistinctSpeakerVoices([
    { name: 'Анна', gender: 'female', voiceName: 'Sulafat' },
    { name: 'Дмитрий', gender: 'male', voiceName: 'Charon' },
    { name: 'Елена', gender: 'female', voiceName: 'Sulafat' }, // duplicate voice requested!
    { name: 'Игорь', gender: 'male', voiceName: 'Charon' }, // duplicate voice requested!
  ]);

  const ids = assigned.map((s) => s.voiceName);
  assert.equal(new Set(ids).size, 4, 'All 4 speakers must receive distinct voice IDs');
  assert.equal(RUSSIAN_VOICE_REGISTRY[assigned[0].voiceName].gender, 'female');
  assert.equal(RUSSIAN_VOICE_REGISTRY[assigned[1].voiceName].gender, 'male');
  assert.equal(RUSSIAN_VOICE_REGISTRY[assigned[2].voiceName].gender, 'female');
  assert.equal(RUSSIAN_VOICE_REGISTRY[assigned[3].voiceName].gender, 'male');
});

test('Russian speaker name gender inference handles female endings and male -а/-я exceptions', () => {
  assert.equal(inferRussianSpeakerGender(undefined, 'Анна Петровна'), 'female');
  assert.equal(inferRussianSpeakerGender(undefined, 'Елена'), 'female');
  assert.equal(inferRussianSpeakerGender(undefined, 'Мария'), 'female');
  assert.equal(inferRussianSpeakerGender(undefined, 'Любовь'), 'female');
  assert.equal(inferRussianSpeakerGender(undefined, 'Никита'), 'male');
  assert.equal(inferRussianSpeakerGender(undefined, 'Илья'), 'male');
  assert.equal(inferRussianSpeakerGender(undefined, 'Дима'), 'male');
  assert.equal(inferRussianSpeakerGender(undefined, 'Дмитрий'), 'male');
  assert.equal(inferRussianSpeakerGender(undefined, 'Александр'), 'male');

  const speakers = [
    { name: 'Анна Смирнова', roleVi: 'MC', roleEn: 'Host', voiceName: 'Sulafat' as const, gender: 'female' as const },
    { name: 'Никита Волков', roleVi: 'Khách mời', roleEn: 'Guest', voiceName: 'Achird' as const, gender: 'male' as const },
  ];
  assert.equal(findSpeakerProfile(speakers, 'Анна')?.voiceName, 'Sulafat');
  assert.equal(findSpeakerProfile(speakers, 'Никита')?.voiceName, 'Achird');
});

test('buildVoiceCacheSignature invalidates cache on any voice parameter change', () => {
  const base = {
    text: 'Доброе утро, как дела?',
    provider: 'gemini-tts' as const,
    model: 'gemini-3.8-flash-lite-tts' as const,
    voiceId: 'Sulafat' as const,
    locale: 'ru-RU' as const,
    gender: 'female' as const,
    ageStyle: 'mature' as const,
    speakingStyle: 'conversational' as const,
    speakingRate: 1.0,
    pitch: null,
    emotion: 'warm',
    stylePrompt: 'Native Russian',
  };

  const sigBase = buildVoiceCacheSignature(base);
  // Same text with stress mark normalizes identically (maximizes cache reuse!)
  const sigStressed = buildVoiceCacheSignature({ ...base, text: 'До́брое у́тро, как дела́?' });
  assert.equal(sigBase, sigStressed);

  // Changing ANY voice config field produces a strictly different key
  assert.notEqual(sigBase, buildVoiceCacheSignature({ ...base, voiceId: 'Leda' }));
  assert.notEqual(sigBase, buildVoiceCacheSignature({ ...base, gender: 'male', voiceId: 'Charon' }));
  assert.notEqual(sigBase, buildVoiceCacheSignature({ ...base, model: 'gemini-3.8-flash-tts' }));
  assert.notEqual(sigBase, buildVoiceCacheSignature({ ...base, ageStyle: 'young' }));
  assert.notEqual(sigBase, buildVoiceCacheSignature({ ...base, speakingStyle: 'narration' }));
  assert.notEqual(sigBase, buildVoiceCacheSignature({ ...base, speakingRate: 0.85 }));
  assert.notEqual(sigBase, buildVoiceCacheSignature({ ...base, emotion: 'calm' }));
});

test('WAV acoustic diagnostics rejects silence and turn stitching computes exact sample boundaries', () => {
  const silentPcm = Buffer.alloc(24000 * 2); // 1 second of zeros
  const silentWav = encodeWavFromPcm(silentPcm, 24000, 1, 16);
  const silentDiag = analyzeWavAcoustics(silentWav);
  assert.equal(silentDiag.valid, false);
  assert.equal(silentDiag.isSilent, true);

  const turn1 = makeToneWav(0.8, 300);
  const turn2 = makeToneWav(1.1, 440);
  const turn3 = makeToneWav(0.9, 520);

  const diag1 = analyzeWavAcoustics(turn1);
  assert.equal(diag1.valid, true);
  assert.equal(diag1.isSilent, false);
  assert.ok(diag1.durationSec >= 0.79 && diag1.durationSec <= 0.81);

  const stitched = concatenateWavSegmentsWithTurnPauses([
    { speaker: 'Анна', wav: turn1 },
    { speaker: 'Дмитрий', wav: turn2 },
    { speaker: 'Елена', wav: turn3 },
  ]);

  assert.equal(stitched.timings.length, 3);
  assert.equal(stitched.timings[0].startSec, 0);
  assert.ok(stitched.timings[1].startSec > stitched.timings[0].endSec, 'Speaker switch inserts natural pause');
  assert.ok(stitched.timings[2].startSec > stitched.timings[1].endSec);
  assert.ok(stitched.totalDurationSec >= 3.4, 'Total duration includes 3 turns + 2 turn pauses');
});

test('Per-model daily quota isolation blocks only the exhausted model while allowing another Free-Tier model', async () => {
  const queue = new TtsRequestQueue({ maxConcurrency: 1, minGapMs: 0, sleepFn: async () => {} });
  const dailyErr = classifyGeminiError(
    new Error(
      JSON.stringify({
        error: {
          code: 429,
          status: 'RESOURCE_EXHAUSTED',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
              violations: [
                {
                  quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
                  quotaValue: '0',
                },
              ],
            },
          ],
        },
      }),
    ),
  );

  await assert.rejects(() =>
    queue.enqueue({
      idempotencyKey: 'm-flash-1',
      model: 'gemini-3.8-flash-tts',
      requestType: 'tts_single',
      task: async () => {
        throw new TtsQuotaError(dailyErr, 0);
      },
    }),
  );

  assert.equal(queue.isDailyQuotaBlocked('gemini-3.8-flash-tts'), true);
  assert.equal(queue.isDailyQuotaBlocked('gemini-3.8-flash-lite-tts'), false);

  const liteResult = await queue.enqueue<string>({
    idempotencyKey: 'm-lite-1',
    model: 'gemini-3.8-flash-lite-tts',
    requestType: 'tts_single',
    task: async () => ({ result: 'LITE_OK', httpStatus: 200 }),
  });
  assert.equal(liteResult, 'LITE_OK');
});

test('35-sample Russian TTS QA suite covers all 5 required categories with strict gender mapping', () => {
  assert.equal(TTS_QA_SAMPLES.length, 35);
  assert.equal(TTS_QA_SAMPLES.filter((s) => s.category === 'female_single').length, 10);
  assert.equal(TTS_QA_SAMPLES.filter((s) => s.category === 'male_single').length, 10);
  assert.equal(TTS_QA_SAMPLES.filter((s) => s.category === 'dialogue_mixed').length, 5);
  assert.equal(TTS_QA_SAMPLES.filter((s) => s.category === 'intonation_long').length, 5);
  assert.equal(TTS_QA_SAMPLES.filter((s) => s.category === 'stress_proper_nouns').length, 5);

  // Verify every single-speaker sample has gender-matched voiceId
  for (const s of TTS_QA_SAMPLES) {
    if (s.kind === 'single') {
      assert.ok(s.voiceName, `Sample ${s.id} must specify voiceName`);
      assert.equal(
        RUSSIAN_VOICE_REGISTRY[s.voiceName].gender,
        s.gender,
        `Sample ${s.id} voice ${s.voiceName} must match gender ${s.gender}`,
      );
    } else {
      assert.ok(s.speakers && s.speakers.length >= 2, `Dialogue ${s.id} must have >=2 speakers`);
      const voiceIds = s.speakers.map((sp) => sp.voiceName);
      assert.equal(new Set(voiceIds).size, voiceIds.length, `Dialogue ${s.id} speakers must have distinct voices`);
      for (const sp of s.speakers) {
        assert.equal(RUSSIAN_VOICE_REGISTRY[sp.voiceName].gender, sp.gender);
      }
    }
  }

  // Verify at least one 3-speaker dialogue exists
  assert.ok(
    TTS_QA_SAMPLES.some((s) => s.kind === 'dialogue' && (s.speakers?.length ?? 0) >= 3),
    'QA suite must include a 3-speaker dialogue test case',
  );
});
