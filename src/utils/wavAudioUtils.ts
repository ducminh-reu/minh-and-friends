export interface ParsedWavInfo {
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
  byteRate: number;
  blockAlign: number;
  pcmData: Buffer;
  durationSec: number;
}

export interface SplitWavSegment {
  segmentWav: Buffer;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export function encodeWavFromPcm(
  pcmData: Buffer,
  sampleRate = 24000,
  numChannels = 1,
  bitsPerSample = 16,
): Buffer {
  const bytesPerSample = Math.max(1, bitsPerSample >> 3);
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const alignedLen = pcmData.length - (pcmData.length % blockAlign);
  const cleanPcm = alignedLen === pcmData.length ? pcmData : pcmData.subarray(0, alignedLen);

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + cleanPcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // AudioFormat = 1 (PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(cleanPcm.length, 40);

  return Buffer.concat([header, cleanPcm]);
}

export function isRiffWavBuffer(buf: Buffer): boolean {
  return (
    buf.length >= 44 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WAVE'
  );
}

export function ensureWavBuffer(rawBuffer: Buffer, fallbackSampleRate = 24000): Buffer {
  if (isRiffWavBuffer(rawBuffer)) {
    return rawBuffer;
  }
  return encodeWavFromPcm(rawBuffer, fallbackSampleRate, 1, 16);
}

export function parseWavBuffer(rawBuffer: Buffer): ParsedWavInfo {
  const buf = ensureWavBuffer(rawBuffer);
  if (buf.length < 44) {
    throw new Error('Invalid WAV buffer: shorter than 44 bytes.');
  }

  let sampleRate = 24000;
  let numChannels = 1;
  let bitsPerSample = 16;
  let pcmData: Buffer | null = null;

  let offset = 12;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = buf.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = Math.min(buf.length, dataStart + chunkSize);

    if (chunkId === 'fmt ' && chunkSize >= 16 && dataStart + 16 <= buf.length) {
      numChannels = Math.max(1, buf.readUInt16LE(dataStart + 2));
      sampleRate = Math.max(8000, buf.readUInt32LE(dataStart + 4));
      bitsPerSample = Math.max(8, buf.readUInt16LE(dataStart + 14));
    } else if (chunkId === 'data') {
      pcmData = buf.subarray(dataStart, dataEnd);
      break;
    }

    const paddedSize = chunkSize + (chunkSize % 2);
    offset = dataStart + paddedSize;
  }

  if (!pcmData) {
    pcmData = buf.subarray(44);
  }

  const bytesPerSample = Math.max(1, bitsPerSample >> 3);
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const durationSec = byteRate > 0 ? pcmData.length / byteRate : 0;

  return {
    sampleRate,
    numChannels,
    bitsPerSample,
    byteRate,
    blockAlign,
    pcmData,
    durationSec,
  };
}

function computeFrameRms(
  pcmData: Buffer,
  frameStart: number,
  frameCount: number,
  blockAlign: number,
  bitsPerSample: number,
): number {
  if (bitsPerSample !== 16 || frameCount <= 0) return 0;
  const totalFrames = Math.floor(pcmData.length / blockAlign);
  const clampedStart = Math.max(0, Math.min(totalFrames, frameStart));
  const clampedEnd = Math.max(clampedStart, Math.min(totalFrames, clampedStart + frameCount));
  const count = clampedEnd - clampedStart;
  if (count <= 0) return 0;

  let sumSq = 0;
  for (let f = clampedStart; f < clampedEnd; f += 1) {
    const sample = pcmData.readInt16LE(f * blockAlign);
    sumSq += sample * sample;
  }
  return Math.sqrt(sumSq / count);
}

/**
 * Splits a multi-sentence WAV buffer into N individual sentence WAV files.
 * Scans a +/-22% window around proportional word-count boundaries to snap to the
 * quietest inter-sentence pause/silence valley instead of chopping mid-word.
 */
export function splitWavIntoSentenceSegments(
  rawWavBuffer: Buffer,
  sentenceWeights: number[],
): SplitWavSegment[] {
  const parsed = parseWavBuffer(rawWavBuffer);
  const count = sentenceWeights.length;
  if (count === 0) return [];

  const totalFrames = Math.floor(parsed.pcmData.length / parsed.blockAlign);
  if (count === 1 || totalFrames <= 0) {
    const dur = Number(parsed.durationSec.toFixed(2));
    return [
      {
        segmentWav: encodeWavFromPcm(
          parsed.pcmData,
          parsed.sampleRate,
          parsed.numChannels,
          parsed.bitsPerSample,
        ),
        startSec: 0,
        endSec: dur,
        durationSec: dur,
      },
    ];
  }

  const safeWeights = sentenceWeights.map((w) => Math.max(1, Number.isFinite(w) ? w : 1));
  const totalWeight = safeWeights.reduce((acc, w) => acc + w, 0);

  const windowFrames = Math.max(1, Math.round(parsed.sampleRate * 0.06)); // 60ms RMS window
  const stepFrames = Math.max(1, Math.round(parsed.sampleRate * 0.02)); // 20ms stride
  const minSegmentFrames = Math.max(1, Math.round(parsed.sampleRate * 0.25));

  const splitFrames: number[] = [0];
  let cumulativeWeight = 0;

  for (let i = 0; i < count - 1; i += 1) {
    cumulativeWeight += safeWeights[i];
    const targetFrame = Math.round((cumulativeWeight / totalWeight) * totalFrames);
    const prevBoundary = splitFrames[i];
    const remainingCount = count - 1 - i;
    const maxAllowed = totalFrames - remainingCount * minSegmentFrames;
    const minAllowed = prevBoundary + minSegmentFrames;

    if (minAllowed >= maxAllowed) {
      splitFrames.push(Math.max(prevBoundary, Math.min(totalFrames, targetFrame)));
      continue;
    }

    const searchRadius = Math.round(totalFrames * (0.22 / Math.max(1, count * 0.35)));
    const searchStart = Math.max(minAllowed, targetFrame - searchRadius);
    const searchEnd = Math.min(maxAllowed, targetFrame + searchRadius);

    let bestFrame = Math.max(minAllowed, Math.min(maxAllowed, targetFrame));
    let bestScore = Number.POSITIVE_INFINITY;

    for (let f = searchStart; f <= searchEnd; f += stepFrames) {
      const halfWin = Math.floor(windowFrames / 2);
      const rms = computeFrameRms(
        parsed.pcmData,
        Math.max(0, f - halfWin),
        windowFrames,
        parsed.blockAlign,
        parsed.bitsPerSample,
      );
      // Slight proximity bias so equal-silence plateaus pick near proportional center
      const distPenalty = Math.abs(f - targetFrame) * 0.002;
      const score = rms + distPenalty;
      if (score < bestScore) {
        bestScore = score;
        bestFrame = f;
      }
    }

    splitFrames.push(bestFrame);
  }
  splitFrames.push(totalFrames);

  const segments: SplitWavSegment[] = [];
  for (let i = 0; i < count; i += 1) {
    const startByte = splitFrames[i] * parsed.blockAlign;
    const endByte = splitFrames[i + 1] * parsed.blockAlign;
    const slice = parsed.pcmData.subarray(startByte, endByte);
    const startSec = Number((splitFrames[i] / parsed.sampleRate).toFixed(2));
    const endSec = Number((splitFrames[i + 1] / parsed.sampleRate).toFixed(2));
    const durationSec = Number(Math.max(0, endSec - startSec).toFixed(2));
    segments.push({
      segmentWav: encodeWavFromPcm(
        slice,
        parsed.sampleRate,
        parsed.numChannels,
        parsed.bitsPerSample,
      ),
      startSec,
      endSec,
      durationSec,
    });
  }

  return segments;
}

export function concatenateWavSegments(
  segments: Buffer[],
  pauseMs = 320,
): {
  fullWav: Buffer;
  timings: { startSec: number; endSec: number; durationSec: number }[];
  totalDurationSec: number;
} {
  if (segments.length === 0) {
    const empty = encodeWavFromPcm(Buffer.alloc(0));
    return { fullWav: empty, timings: [], totalDurationSec: 0 };
  }

  const parsedSegments = segments.map((seg) => parseWavBuffer(seg));
  const base = parsedSegments[0];
  const pauseFrames = Math.max(0, Math.round((base.sampleRate * pauseMs) / 1000));
  const pauseBuffer = Buffer.alloc(pauseFrames * base.blockAlign);

  const chunks: Buffer[] = [];
  const timings: { startSec: number; endSec: number; durationSec: number }[] = [];
  let cursorFrames = 0;

  for (let i = 0; i < parsedSegments.length; i += 1) {
    const seg = parsedSegments[i];
    const segFrames = Math.floor(seg.pcmData.length / seg.blockAlign);
    const startSec = Number((cursorFrames / base.sampleRate).toFixed(2));
    const endSec = Number(((cursorFrames + segFrames) / base.sampleRate).toFixed(2));
    const durationSec = Number(Math.max(0, endSec - startSec).toFixed(2));

    chunks.push(seg.pcmData);
    timings.push({ startSec, endSec, durationSec });
    cursorFrames += segFrames;

    if (i < parsedSegments.length - 1 && pauseBuffer.length > 0) {
      chunks.push(pauseBuffer);
      cursorFrames += pauseFrames;
    }
  }

  const fullPcm = Buffer.concat(chunks);
  const fullWav = encodeWavFromPcm(
    fullPcm,
    base.sampleRate,
    base.numChannels,
    base.bitsPerSample,
  );
  const totalDurationSec = Number((cursorFrames / base.sampleRate).toFixed(2));

  return { fullWav, timings, totalDurationSec };
}

export interface WavAcousticDiagnostics {
  valid: boolean;
  bytes: number;
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
  durationSec: number;
  rms: number;
  rmsDb: number;
  peakAmplitude: number;
  clippingDetected: boolean;
  isSilent: boolean;
}

/**
 * Inspects a WAV buffer's PCM energy, duration, silence, and clipping to prevent
 * caching corrupt/silent/truncated audio and to verify real QA audio samples.
 */
export function analyzeWavAcoustics(rawBuffer: Buffer): WavAcousticDiagnostics {
  if (!rawBuffer || rawBuffer.length <= 44 || !isRiffWavBuffer(rawBuffer)) {
    return {
      valid: false,
      bytes: rawBuffer?.length ?? 0,
      sampleRate: 0,
      numChannels: 0,
      bitsPerSample: 0,
      durationSec: 0,
      rms: 0,
      rmsDb: -Infinity,
      peakAmplitude: 0,
      clippingDetected: false,
      isSilent: true,
    };
  }

  const parsed = parseWavBuffer(rawBuffer);
  const totalFrames = Math.floor(parsed.pcmData.length / Math.max(1, parsed.blockAlign));
  if (totalFrames <= 0 || parsed.bitsPerSample !== 16) {
    return {
      valid: false,
      bytes: rawBuffer.length,
      sampleRate: parsed.sampleRate,
      numChannels: parsed.numChannels,
      bitsPerSample: parsed.bitsPerSample,
      durationSec: Number(parsed.durationSec.toFixed(2)),
      rms: 0,
      rmsDb: -Infinity,
      peakAmplitude: 0,
      clippingDetected: false,
      isSilent: true,
    };
  }

  let sumSq = 0;
  let maxAbs = 0;
  let clippedSamples = 0;

  for (let f = 0; f < totalFrames; f += 1) {
    const sample = parsed.pcmData.readInt16LE(f * parsed.blockAlign);
    const abs = Math.abs(sample);
    if (abs > maxAbs) maxAbs = abs;
    if (abs >= 32760) clippedSamples += 1;
    const norm = sample / 32768;
    sumSq += norm * norm;
  }

  const rms = Math.sqrt(sumSq / totalFrames);
  const peakAmplitude = Number((maxAbs / 32768).toFixed(4));
  const rmsDb = rms > 0 ? Number((20 * Math.log10(rms)).toFixed(1)) : -Infinity;
  const isSilent = rms < 0.0015 || parsed.durationSec < 0.15;
  const clippingDetected = clippedSamples > Math.max(12, totalFrames * 0.005);

  return {
    valid: !isSilent && parsed.durationSec >= 0.15,
    bytes: rawBuffer.length,
    sampleRate: parsed.sampleRate,
    numChannels: parsed.numChannels,
    bitsPerSample: parsed.bitsPerSample,
    durationSec: Number(parsed.durationSec.toFixed(2)),
    rms: Number(rms.toFixed(5)),
    rmsDb,
    peakAmplitude,
    clippingDetected,
    isSilent,
  };
}

/**
 * Stitches individually synthesized sentence WAVs into a single natural conversation WAV,
 * applying realistic conversational pauses (longer pause when speaker changes, shorter pause
 * when the same speaker continues) and returning exact sample-accurate timings per sentence.
 */
export function concatenateWavSegmentsWithTurnPauses(
  turns: { speaker: string; wav: Buffer }[],
  options: { sameSpeakerPauseMs?: number; speakerSwitchPauseMs?: number } = {},
): {
  fullWav: Buffer;
  timings: { startSec: number; endSec: number; durationSec: number }[];
  totalDurationSec: number;
} {
  if (turns.length === 0) {
    const empty = encodeWavFromPcm(Buffer.alloc(0));
    return { fullWav: empty, timings: [], totalDurationSec: 0 };
  }

  const samePauseMs = options.sameSpeakerPauseMs ?? 210;
  const switchPauseMs = options.speakerSwitchPauseMs ?? 360;

  const parsedTurns = turns.map((t) => ({
    speaker: t.speaker.normalize('NFC').replace(/\u0301/g, '').trim().toLowerCase(),
    parsed: parseWavBuffer(t.wav),
  }));

  const base = parsedTurns[0].parsed;
  const samePauseFrames = Math.max(0, Math.round((base.sampleRate * samePauseMs) / 1000));
  const switchPauseFrames = Math.max(0, Math.round((base.sampleRate * switchPauseMs) / 1000));
  const samePauseBuf = Buffer.alloc(samePauseFrames * base.blockAlign);
  const switchPauseBuf = Buffer.alloc(switchPauseFrames * base.blockAlign);

  const chunks: Buffer[] = [];
  const timings: { startSec: number; endSec: number; durationSec: number }[] = [];
  let cursorFrames = 0;

  for (let i = 0; i < parsedTurns.length; i += 1) {
    const cur = parsedTurns[i];
    const segFrames = Math.floor(cur.parsed.pcmData.length / cur.parsed.blockAlign);
    const startSec = Number((cursorFrames / base.sampleRate).toFixed(2));
    const endSec = Number(((cursorFrames + segFrames) / base.sampleRate).toFixed(2));
    const durationSec = Number(Math.max(0, endSec - startSec).toFixed(2));

    chunks.push(cur.parsed.pcmData);
    timings.push({ startSec, endSec, durationSec });
    cursorFrames += segFrames;

    if (i < parsedTurns.length - 1) {
      const next = parsedTurns[i + 1];
      const speakerChanged = cur.speaker !== next.speaker;
      const pauseBuf = speakerChanged ? switchPauseBuf : samePauseBuf;
      const pauseFrames = speakerChanged ? switchPauseFrames : samePauseFrames;
      if (pauseBuf.length > 0) {
        chunks.push(pauseBuf);
        cursorFrames += pauseFrames;
      }
    }
  }

  const fullPcm = Buffer.concat(chunks);
  const fullWav = encodeWavFromPcm(
    fullPcm,
    base.sampleRate,
    base.numChannels,
    base.bitsPerSample,
  );
  const totalDurationSec = Number((cursorFrames / base.sampleRate).toFixed(2));

  return { fullWav, timings, totalDurationSec };
}
