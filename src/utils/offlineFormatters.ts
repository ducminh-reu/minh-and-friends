import type { OfflineLessonRecord } from '../services/offlineLessonStore';

export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function summarizeOfflineStorage(records: OfflineLessonRecord[]): {
  lessonCount: number;
  totalAudioClips: number;
  totalBytes: number;
} {
  let totalAudioClips = 0;
  let totalBytes = 0;
  for (const rec of records) {
    totalAudioClips += rec.cachedAudioCount;
    totalBytes += rec.totalAudioBytes;
  }
  return {
    lessonCount: records.length,
    totalAudioClips,
    totalBytes,
  };
}
