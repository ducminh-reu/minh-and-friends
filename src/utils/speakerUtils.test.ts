import test from 'node:test';
import assert from 'node:assert/strict';
import type { SpeakerProfile } from '../types/domain';
import { findSpeakerProfile } from './speakerUtils.ts';
import {
  buildConversationalStyle,
  resolveVoiceForGender,
} from '../../server/ttsProvider.ts';

const SAMPLE_SPEAKERS: SpeakerProfile[] = [
  {
    name: 'А́нна',
    roleVi: 'Người kể chuyện',
    roleEn: 'Designer',
    voiceName: 'Kore',
    gender: 'female',
  },
  {
    name: 'Макси́м',
    roleVi: 'Kỹ sư phần mềm',
    roleEn: 'Software engineer',
    voiceName: 'Puck',
    gender: 'male',
  },
];

test('findSpeakerProfile matches speakers despite missing or differing stress marks', () => {
  const anna = findSpeakerProfile(SAMPLE_SPEAKERS, 'Анна');
  assert.equal(anna?.name, 'А́нна');
  assert.equal(anna?.gender, 'female');
  assert.equal(anna?.voiceName, 'Kore');

  const maxim = findSpeakerProfile(SAMPLE_SPEAKERS, 'Максим');
  assert.equal(maxim?.name, 'Макси́м');
  assert.equal(maxim?.gender, 'male');
  assert.equal(maxim?.voiceName, 'Puck');
});

test('resolveVoiceForGender enforces gender-appropriate Gemini voices', () => {
  // If a male speaker accidentally requests a female voice, resolveVoiceForGender corrects it to a male voice
  assert.equal(resolveVoiceForGender('Kore', 'male'), 'Charon');
  assert.equal(resolveVoiceForGender('Zephyr', 'male'), 'Charon');
  assert.equal(resolveVoiceForGender('Charon', 'male'), 'Charon');
  assert.equal(resolveVoiceForGender('Puck', 'male'), 'Puck');

  // If a female speaker accidentally requests a male voice, resolveVoiceForGender corrects it to a female voice
  assert.equal(resolveVoiceForGender('Puck', 'female'), 'Sulafat');
  assert.equal(resolveVoiceForGender('Charon', 'female'), 'Sulafat');
  assert.equal(resolveVoiceForGender('Zephyr', 'female'), 'Zephyr');
  assert.equal(resolveVoiceForGender('Kore', 'female'), 'Kore');
});

test('buildConversationalStyle embeds Russian phonetic guidance without verbose token waste', () => {
  const style = buildConversationalStyle({
    voiceName: 'Puck',
    gender: 'male',
    speakerRole: 'Software engineer',
    topic: 'everyday',
  });

  assert.match(style, /Russian man/i);
  assert.match(style, /Software engineer/);
  assert.match(style, /ru-RU/);
});
