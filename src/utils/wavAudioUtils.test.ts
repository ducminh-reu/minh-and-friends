import test from 'node:test';
import assert from 'node:assert/strict';
import {
  concatenateWavSegments,
  encodeWavFromPcm,
  parseWavBuffer,
  splitWavIntoSentenceSegments,
} from './wavAudioUtils';

function buildToneAndSilenceWav(durationsAndAmps: { sec: number; amp: number }[], sampleRate = 8000): Buffer {
  const buffers: Buffer[] = [];
  for (const part of durationsAndAmps) {
    const frames = Math.round(part.sec * sampleRate);
    const buf = Buffer.alloc(frames * 2);
    for (let i = 0; i < frames; i += 1) {
      const val = part.amp === 0 ? 0 : Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * part.amp);
      buf.writeInt16LE(val, i * 2);
    }
    buffers.push(buf);
  }
  return encodeWavFromPcm(Buffer.concat(buffers), sampleRate, 1, 16);
}

test('encodeWavFromPcm and parseWavBuffer round-trip PCM metadata accurately', () => {
  const wav = buildToneAndSilenceWav([{ sec: 0.5, amp: 8000 }], 24000);
  const parsed = parseWavBuffer(wav);
  assert.equal(parsed.sampleRate, 24000);
  assert.equal(parsed.numChannels, 1);
  assert.equal(parsed.bitsPerSample, 16);
  assert.ok(Math.abs(parsed.durationSec - 0.5) < 0.01);
});

test('splitWavIntoSentenceSegments snaps split points to silence valleys between spoken phrases', () => {
  // Phrase 1 (1.0s) -> Silence (0.3s) -> Phrase 2 (1.0s) -> Silence (0.3s) -> Phrase 3 (1.0s)
  const wav = buildToneAndSilenceWav(
    [
      { sec: 1.0, amp: 12000 },
      { sec: 0.3, amp: 0 },
      { sec: 1.0, amp: 12000 },
      { sec: 0.3, amp: 0 },
      { sec: 1.0, amp: 12000 },
    ],
    8000,
  );

  const segments = splitWavIntoSentenceSegments(wav, [10, 10, 10]);
  assert.equal(segments.length, 3);
  assert.equal(segments[0].startSec, 0);
  // First boundary should land inside the 1.0s..1.3s silence valley
  assert.ok(segments[0].endSec >= 0.98 && segments[0].endSec <= 1.32, `got ${segments[0].endSec}`);
  // Second boundary should land inside the 2.3s..2.6s silence valley
  assert.ok(segments[1].endSec >= 2.28 && segments[1].endSec <= 2.62, `got ${segments[1].endSec}`);
  assert.ok(Math.abs(segments[2].endSec - 3.6) < 0.05);

  for (const seg of segments) {
    const info = parseWavBuffer(seg.segmentWav);
    assert.ok(info.durationSec > 0.8);
  }
});

test('concatenateWavSegments stitches individual sentence WAVs with pause intervals and exact timings', () => {
  const s1 = buildToneAndSilenceWav([{ sec: 0.6, amp: 6000 }], 16000);
  const s2 = buildToneAndSilenceWav([{ sec: 0.8, amp: 6000 }], 16000);

  const stitched = concatenateWavSegments([s1, s2], 250);
  const parsedFull = parseWavBuffer(stitched.fullWav);

  assert.equal(stitched.timings.length, 2);
  assert.equal(stitched.timings[0].startSec, 0);
  assert.equal(stitched.timings[0].endSec, 0.6);
  // 0.6 + 0.25s pause = 0.85s start for sentence 2
  assert.equal(stitched.timings[1].startSec, 0.85);
  assert.equal(stitched.timings[1].endSec, 1.65);
  assert.ok(Math.abs(parsedFull.durationSec - 1.65) < 0.02);
});
