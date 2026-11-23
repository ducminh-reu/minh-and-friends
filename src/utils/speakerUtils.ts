import type { GeminiVoiceId, SpeakerProfile } from '../types/domain.ts';
import { stripStressMarks } from './transcriptDiff.ts';
import { RUSSIAN_VOICE_REGISTRY, isValidGeminiVoiceId } from './voiceRegistry.ts';

export const VOICE_PERSONA_LABELS_VI: Record<GeminiVoiceId, string> = Object.fromEntries(
  (Object.keys(RUSSIAN_VOICE_REGISTRY) as GeminiVoiceId[]).map((id) => [
    id,
    RUSSIAN_VOICE_REGISTRY[id].labelVi,
  ]),
) as Record<GeminiVoiceId, string>;

export function getVoicePersonaLabelVi(voiceName: string | undefined): string {
  if (isValidGeminiVoiceId(voiceName)) {
    return RUSSIAN_VOICE_REGISTRY[voiceName].labelVi;
  }
  return RUSSIAN_VOICE_REGISTRY.Sulafat.labelVi;
}

const KNOWN_FEMALE_FIRST_NAMES = new Set([
  'анна', 'аня', 'елена', 'лена', 'мария', 'маша', 'наталья', 'наталия', 'наташа',
  'ольга', 'оля', 'катя', 'екатерина', 'ирина', 'ира', 'светлана', 'света',
  'татьяна', 'таня', 'вера', 'дарья', 'даша', 'анастасия', 'настя', 'софья',
  'софия', 'соня', 'виктория', 'вика', 'юлия', 'юля', 'полина', 'алина',
  'ксения', 'ксюша', 'марина', 'людмила', 'люда', 'валентина', 'валя',
  'галина', 'галя', 'надежда', 'надя', 'лариса', 'евгения', 'валерия', 'лера',
  'оксана', 'вероника', 'маргарита', 'рита', 'кристина', 'тамара', 'диана',
  'жанна', 'лидия', 'алла', 'нина', 'инна', 'яна', 'ульяна', 'зоя', 'варвара',
  'варя', 'елизавета', 'лиза', 'алиса', 'кира', 'милана', 'карина', 'регина',
  'любовь', 'люба', 'ангелина', 'элина', 'олеся', 'алена', 'алёна', 'раиса',
]);

const MALE_NAMES_ENDING_IN_A_YA = new Set([
  'никита', 'илья', 'лука', 'фома', 'кузьма', 'данила', 'савва', 'дима',
  'миша', 'коля', 'ваня', 'серёжа', 'сережа', 'алёша', 'алеша', 'паша',
  'вова', 'петя', 'костя', 'толя', 'витя', 'гоша', 'гриша', 'юра', 'стёпа',
  'степа', 'тима', 'рома', 'слава', 'боря', 'сеня', 'федя', 'филя', 'женя',
  'саша', 'вася', 'гена', 'леша', 'лёша',
]);

/**
 * Determines gender from explicit label + authentic Russian first-name / morphology rules.
 */
export function inferRussianSpeakerGender(
  rawGender: string | undefined,
  speakerName: string,
): 'male' | 'female' {
  const g = (rawGender ?? '').trim().toLowerCase();
  if (['female', 'f', 'woman', 'женский', 'жен', 'ж', 'nữ', 'nu'].includes(g)) {
    return 'female';
  }
  if (['male', 'm', 'man', 'мужской', 'муж', 'м', 'nam'].includes(g)) {
    return 'male';
  }

  const cleanTokens = stripStressMarks(speakerName)
    .toLowerCase()
    .replace(/[^а-яёa-z\s-]/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const firstName = cleanTokens[0] ?? '';
  if (!firstName) return 'female';
  if (KNOWN_FEMALE_FIRST_NAMES.has(firstName)) return 'female';
  if (MALE_NAMES_ENDING_IN_A_YA.has(firstName)) return 'male';

  // Russian feminine surname check (e.g., Соколова, Иванова, Смирнова, Орлова)
  const lastName = cleanTokens.length > 1 ? cleanTokens[cleanTokens.length - 1] : '';
  if (lastName && /(ова|ева|ёва|ина|ая|яя)$/.test(lastName)) {
    return 'female';
  }
  if (lastName && /(ов|ев|ёв|ин|ский|цкий|ой|ий|ый)$/.test(lastName)) {
    return 'male';
  }

  // Standard Russian feminine given-name endings (-а / -я) excluding male exceptions above
  if (/[ая]$/.test(firstName) && firstName.length >= 3) {
    return 'female';
  }

  return 'male';
}

function normalizeSpeakerKey(label: string): string {
  return stripStressMarks(label)
    .toLowerCase()
    .replace(/[«»"'.,:;()[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Matches a sentence speaker label against `lesson.speakers`, normalizing Russian
 * combining stress marks (U+0301), punctuation, whitespace, first-name vs full-name
 * variants, and gender inference so speakers never accidentally receive the wrong voice.
 */
export function findSpeakerProfile(
  speakers: SpeakerProfile[],
  speakerLabel: string,
): SpeakerProfile | undefined {
  if (speakers.length === 0) return undefined;
  const target = normalizeSpeakerKey(speakerLabel);
  if (!target) return speakers[0];

  // 1. Exact normalized full-name match
  const exact = speakers.find((sp) => normalizeSpeakerKey(sp.name) === target);
  if (exact) return exact;

  // 2. First-name token match (e.g., sentence uses "Анна" while roster has "Анна Соколова")
  const targetFirst = target.split(' ')[0] ?? '';
  if (targetFirst.length >= 2) {
    const firstTokenMatch = speakers.find((sp) => {
      const spFirst = normalizeSpeakerKey(sp.name).split(' ')[0] ?? '';
      return spFirst === targetFirst;
    });
    if (firstTokenMatch) return firstTokenMatch;
  }

  // 3. Partial containment match
  const partial = speakers.find((sp) => {
    const cleanName = normalizeSpeakerKey(sp.name);
    return cleanName.includes(target) || target.includes(cleanName);
  });
  if (partial) return partial;

  // 4. Gender-matched fallback (never randomly flip gender if roster has matching gender)
  const inferredGender = inferRussianSpeakerGender(undefined, speakerLabel);
  return speakers.find((sp) => sp.gender === inferredGender) ?? speakers[0];
}
