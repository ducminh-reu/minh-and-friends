import type { SpeakerProfile } from '../types/domain';
import { stripStressMarks } from './transcriptDiff';

export const VOICE_PERSONA_LABELS_VI: Record<SpeakerProfile['voiceName'], string> = {
  Kore: 'Giọng nữ · Ấm áp, truyền cảm',
  Zephyr: 'Giọng nữ · Tươi sáng, tự nhiên',
  Puck: 'Giọng nam · Trẻ trung, thân thiện',
  Charon: 'Giọng nam · Trầm ấm, điềm đạm',
  Fenrir: 'Giọng nam · Chững chạc, rõ nét',
};

const KNOWN_FEMALE_FIRST_NAMES = new Set([
  'анна', 'елена', 'мария', 'наталья', 'ольга', 'оля', 'катя', 'екатерина',
  'ирина', 'светлана', 'татьяна', 'вера', 'дарья', 'анастасия', 'софья',
  'софия', 'виктория', 'юлия', 'полина', 'алина', 'ксения', 'марина',
  'людмила', 'валентина', 'галина', 'надежда', 'лариса', 'евгения', 'валерия',
]);

/**
 * Matches a sentence speaker label against `lesson.speakers`, normalizing Russian
 * combining stress marks (U+0301), whitespace, and casing so male speakers never
 * accidentally fall back to a default female voice.
 */
export function findSpeakerProfile(
  speakers: SpeakerProfile[],
  speakerLabel: string,
): SpeakerProfile | undefined {
  if (speakers.length === 0) return undefined;
  const target = stripStressMarks(speakerLabel).trim().toLowerCase();
  if (!target) return speakers[0];

  const exact = speakers.find(
    (sp) => stripStressMarks(sp.name).trim().toLowerCase() === target,
  );
  if (exact) return exact;

  const partial = speakers.find((sp) => {
    const cleanName = stripStressMarks(sp.name).trim().toLowerCase();
    return cleanName.includes(target) || target.includes(cleanName);
  });
  if (partial) return partial;

  const firstWord = target.split(/\s+/)[0] ?? '';
  const inferredGender: 'male' | 'female' = KNOWN_FEMALE_FIRST_NAMES.has(firstWord)
    ? 'female'
    : 'male';
  return (
    speakers.find((sp) => sp.gender === inferredGender) ?? speakers[0]
  );
}
