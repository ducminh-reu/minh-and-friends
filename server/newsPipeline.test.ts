import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveSafeAudioFilePath,
  saveLessonAudioFilesToDisk,
} from './newsPipelineDb.ts';
import {
  encodeWavFromPcm,
  parseWavBuffer,
  splitWavIntoSentenceSegments,
} from '../src/utils/wavAudioUtils.ts';

function buildMultiSentenceTestWav(): Buffer {
  const sampleRate = 16000;
  const parts = [
    { sec: 0.7, amp: 10000 },
    { sec: 0.25, amp: 0 },
    { sec: 0.9, amp: 10000 },
    { sec: 0.25, amp: 0 },
    { sec: 0.8, amp: 10000 },
  ];
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const frames = Math.round(part.sec * sampleRate);
    const buf = Buffer.alloc(frames * 2);
    for (let i = 0; i < frames; i += 1) {
      const v =
        part.amp === 0
          ? 0
          : Math.round(Math.sin((2 * Math.PI * 330 * i) / sampleRate) * part.amp);
      buf.writeInt16LE(v, i * 2);
    }
    chunks.push(buf);
  }
  return encodeWavFromPcm(Buffer.concat(chunks), sampleRate, 1, 16);
}

test('resolveSafeAudioFilePath rejects path traversal and accepts valid WAV segment paths', () => {
  assert.equal(resolveSafeAudioFilePath('../etc', 'passwd'), null);
  assert.equal(resolveSafeAudioFilePath('news-b1-1234', '../full.wav'), null);
  assert.equal(resolveSafeAudioFilePath('news-b1-1234', 'script.js'), null);
  assert.equal(resolveSafeAudioFilePath('ab', 'full.wav'), null);

  const validFull = resolveSafeAudioFilePath('news-b1-test123', 'full.wav');
  const validSeg = resolveSafeAudioFilePath('news-b1-test123', 's-12.wav');
  assert.ok(validFull && validFull.endsWith(path.join('news-b1-test123', 'full.wav')));
  assert.ok(validSeg && validSeg.endsWith(path.join('news-b1-test123', 's-12.wav')));
});

test('splitWavIntoSentenceSegments + saveLessonAudioFilesToDisk saves playable full and segment WAVs', () => {
  const testLessonId = 'test-audio-split-verify';
  const fullWav = buildMultiSentenceTestWav();
  const segments = splitWavIntoSentenceSegments(fullWav, [7, 9, 8]);
  assert.equal(segments.length, 3);

  try {
    const saved = saveLessonAudioFilesToDisk(
      testLessonId,
      fullWav,
      segments.map((seg, idx) => ({ order: idx + 1, wav: seg.segmentWav })),
    );

    assert.equal(saved.fullAudioUrl, `/api/news/audio/${testLessonId}/full.wav`);
    assert.equal(saved.segmentUrls.size, 3);
    assert.equal(
      saved.segmentUrls.get(2)?.audioUrl,
      `/api/news/audio/${testLessonId}/s-2.wav`,
    );

    const diskFullPath = resolveSafeAudioFilePath(testLessonId, 'full.wav')!;
    const diskSeg1Path = resolveSafeAudioFilePath(testLessonId, 's-1.wav')!;
    assert.ok(fs.existsSync(diskFullPath));
    assert.ok(fs.existsSync(diskSeg1Path));

    const parsedFull = parseWavBuffer(fs.readFileSync(diskFullPath));
    const parsedSeg1 = parseWavBuffer(fs.readFileSync(diskSeg1Path));
    assert.ok(parsedFull.durationSec > 2.5);
    assert.ok(parsedSeg1.durationSec > 0.5);
  } finally {
    const dir = path.dirname(resolveSafeAudioFilePath(testLessonId, 'full.wav')!);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
