import type { Lesson } from '../types/domain';
import { findSpeakerProfile } from '../utils/speakerUtils';
import { stripStressMarks } from '../utils/transcriptDiff';

const DB_NAME = 'rd_offline_store_v1';
const DB_VERSION = 1;
const STORE_LESSONS = 'lessons';
const STORE_AUDIO = 'audio';

export interface OfflineLessonRecord {
  lessonId: string;
  titleRu: string;
  titleVi: string;
  level: Lesson['level'];
  downloadedAt: string;
  sentenceCount: number;
  cachedAudioCount: number;
  totalAudioBytes: number;
  lessonSnapshot: Lesson;
}

interface OfflineAudioRecord {
  key: string; // `${lessonId}::${sentenceId}`
  lessonId: string;
  sentenceId: string;
  voiceName: string;
  blob: Blob;
  bytes: number;
  cachedAt: string;
}

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this environment.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_LESSONS)) {
        db.createObjectStore(STORE_LESSONS, { keyPath: 'lessonId' });
      }
      if (!db.objectStoreNames.contains(STORE_AUDIO)) {
        const audioStore = db.createObjectStore(STORE_AUDIO, { keyPath: 'key' });
        audioStore.createIndex('lessonId', 'lessonId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB.'));
  });
}

function base64ToWavBlob(base64: string, mimeType = 'audio/wav'): Blob {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export async function getAllOfflineLessons(): Promise<OfflineLessonRecord[]> {
  try {
    const db = await openOfflineDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_LESSONS, 'readonly');
      const store = tx.objectStore(STORE_LESSONS);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as OfflineLessonRecord[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function getOfflineLesson(lessonId: string): Promise<OfflineLessonRecord | null> {
  try {
    const db = await openOfflineDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_LESSONS, 'readonly');
      const req = tx.objectStore(STORE_LESSONS).get(lessonId);
      req.onsuccess = () => resolve((req.result as OfflineLessonRecord | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function getOfflineSentenceAudioBlob(
  lessonId: string,
  sentenceId: string,
): Promise<Blob | null> {
  try {
    const db = await openOfflineDb();
    const key = `${lessonId}::${sentenceId}`;
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_AUDIO, 'readonly');
      const req = tx.objectStore(STORE_AUDIO).get(key);
      req.onsuccess = () => {
        const rec = req.result as OfflineAudioRecord | undefined;
        resolve(rec?.blob ?? null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function removeOfflineLesson(lessonId: string): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_LESSONS, STORE_AUDIO], 'readwrite');
    tx.objectStore(STORE_LESSONS).delete(lessonId);
    const audioStore = tx.objectStore(STORE_AUDIO);
    const index = audioStore.index('lessonId');
    const cursorReq = index.openCursor(IDBKeyRange.only(lessonId));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllOfflineData(): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_LESSONS, STORE_AUDIO], 'readwrite');
    tx.objectStore(STORE_LESSONS).clear();
    tx.objectStore(STORE_AUDIO).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function downloadLessonForOffline(
  lesson: Lesson,
  options: {
    includeAudio: boolean;
    topicEn?: string;
    signal?: AbortSignal;
    onProgress?: (completed: number, total: number) => void;
  },
): Promise<OfflineLessonRecord> {
  const db = await openOfflineDb();
  const total = lesson.sentences.length;
  let cachedAudioCount = 0;
  let totalAudioBytes = 0;

  if (options.includeAudio) {
    for (let i = 0; i < lesson.sentences.length; i++) {
      if (options.signal?.aborted) {
        throw new Error('Đã hủy tải xuống ngoại tuyến.');
      }

      const sentence = lesson.sentences[i];
      const prevSentence = i > 0 ? lesson.sentences[i - 1] : undefined;
      const speakerProfile = findSpeakerProfile(lesson.speakers, sentence.speaker);
      const cleanText = stripStressMarks(sentence.text).trim();

      const existing = await getOfflineSentenceAudioBlob(lesson.id, sentence.id);
      if (existing) {
        cachedAudioCount += 1;
        totalAudioBytes += existing.size;
        options.onProgress?.(i + 1, total);
        continue;
      }

      try {
        let blob: Blob | null = null;
        if (sentence.audioUrl) {
          const preGeneratedResp = await fetch(sentence.audioUrl, {
            signal: options.signal,
          });
          if (preGeneratedResp.ok) {
            const candidate = await preGeneratedResp.blob();
            if (candidate.size > 44) {
              blob = candidate;
            }
          }
        }

        if (!blob) {
          const resp = await fetch('/api/tts/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: options.signal,
            body: JSON.stringify({
              text: cleanText,
              voiceName: speakerProfile?.voiceName,
              gender: speakerProfile?.gender,
              speakerRole: speakerProfile?.roleEn || speakerProfile?.roleVi,
              topic: options.topicEn,
              previousSpeaker: prevSentence
                ? stripStressMarks(prevSentence.speaker).trim()
                : undefined,
              previousText: prevSentence
                ? stripStressMarks(prevSentence.text).trim()
                : undefined,
            }),
          });

          if (resp.ok) {
            const data = await resp.json();
            if (data.audioBase64) {
              blob = base64ToWavBlob(data.audioBase64, data.mimeType || 'audio/wav');
            }
          }
        }

        if (blob) {
          const audioRec: OfflineAudioRecord = {
            key: `${lesson.id}::${sentence.id}`,
            lessonId: lesson.id,
            sentenceId: sentence.id,
            voiceName: speakerProfile?.voiceName ?? 'Kore',
            blob,
            bytes: blob.size,
            cachedAt: new Date().toISOString(),
          };
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_AUDIO, 'readwrite');
            tx.objectStore(STORE_AUDIO).put(audioRec);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
          cachedAudioCount += 1;
          totalAudioBytes += blob.size;
        }
      } catch (err) {
        if (options.signal?.aborted) throw err;
        // Skip failed sentence audio cleanly and continue saving remaining sentences + transcript
      }

      options.onProgress?.(i + 1, total);
    }
  } else {
    options.onProgress?.(total, total);
  }

  const record: OfflineLessonRecord = {
    lessonId: lesson.id,
    titleRu: lesson.titleRu,
    titleVi: lesson.titleVi,
    level: lesson.level,
    downloadedAt: new Date().toISOString(),
    sentenceCount: lesson.sentences.length,
    cachedAudioCount,
    totalAudioBytes,
    lessonSnapshot: lesson,
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_LESSONS, 'readwrite');
    tx.objectStore(STORE_LESSONS).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return record;
}
