import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  GeminiVoiceId,
  TtsModelId,
  VoiceAgeStyle,
  VoiceSpeakingStyle,
} from '../src/types/domain.ts';
import {
  analyzeWavAcoustics,
  ensureWavBuffer,
  type WavAcousticDiagnostics,
} from '../src/utils/wavAudioUtils.ts';
import { classifyGeminiError, type GeminiErrorCategory } from './geminiQuotaManager.ts';
import { TtsQuotaError, ttsProvider, type TtsProvider } from './ttsProvider.ts';

export type QaSampleCategory =
  | 'female_single'
  | 'male_single'
  | 'dialogue_mixed'
  | 'intonation_long'
  | 'stress_proper_nouns';

export interface QaDialogueSpeakerSpec {
  speaker: string;
  gender: 'male' | 'female';
  voiceName: GeminiVoiceId;
  ageStyle?: VoiceAgeStyle;
  speakingStyle?: VoiceSpeakingStyle;
  role?: string;
}

export interface QaDialogueTurnSpec {
  speaker: string;
  text: string;
}

export interface TtsQaSampleSpec {
  id: string;
  index: number;
  category: QaSampleCategory;
  categoryLabelVi: string;
  titleVi: string;
  kind: 'single' | 'dialogue';
  gender: 'female' | 'male' | 'mixed';
  voiceName?: GeminiVoiceId;
  ageStyle?: VoiceAgeStyle;
  speakingStyle?: VoiceSpeakingStyle;
  emotion?: string;
  text?: string;
  speakers?: QaDialogueSpeakerSpec[];
  turns?: QaDialogueTurnSpec[];
  checkFocusVi: string;
}

export interface TtsQaSampleRuntimeState {
  status: 'ready' | 'pending' | 'failed';
  audioUrl: string | null;
  model: TtsModelId | null;
  voiceIds: GeminiVoiceId[];
  genders: ('male' | 'female')[];
  acoustics: WavAcousticDiagnostics | null;
  reusedFromCache: boolean;
  generatedAt: string | null;
  error: string | null;
  errorCategory: GeminiErrorCategory;
}

export interface TtsQaSampleView extends TtsQaSampleSpec {
  runtime: TtsQaSampleRuntimeState;
}

const QA_DIR = path.resolve(process.cwd(), '.data', 'tts-qa');
const QA_MANIFEST_PATH = path.join(QA_DIR, 'manifest.json');
const SAFE_SAMPLE_ID_RE = /^[a-z0-9_-]{3,24}$/;

/**
 * 35 real Russian TTS QA samples:
 * - 10 female sentences (f-01..f-10)
 * - 10 male sentences (m-01..m-10)
 * - 5 multi-speaker male & female dialogues (d-01..d-05, including 3-speaker A female / B male / C female)
 * - 5 questions, exclamations & long complex sentences (e-01..e-05)
 * - 5 difficult words, stress contrasts & proper nouns (h-01..h-05)
 */
export const TTS_QA_SAMPLES: readonly TtsQaSampleSpec[] = [
  // === 10 FEMALE SENTENCES ===
  {
    id: 'f-01',
    index: 1,
    category: 'female_single',
    categoryLabelVi: '10 câu giọng nữ',
    titleVi: 'Chào hỏi đời thường buổi sáng',
    kind: 'single',
    gender: 'female',
    voiceName: 'Sulafat',
    ageStyle: 'mature',
    speakingStyle: 'conversational',
    emotion: 'warm',
    text: 'Доброе утро! Я только что сварила свежий кофе, будешь чашечку перед работой?',
    checkFocusVi: 'Giọng nữ ấm áp tự nhiên, ngữ điệu câu hỏi thân mật.',
  },
  {
    id: 'f-02',
    index: 2,
    category: 'female_single',
    categoryLabelVi: '10 câu giọng nữ',
    titleVi: 'Kể chuyện cuối tuần cùng bạn bè',
    kind: 'single',
    gender: 'female',
    voiceName: 'Leda',
    ageStyle: 'young',
    speakingStyle: 'conversational',
    emotion: 'friendly',
    text: 'В субботу мы гуляли по набережной почти три часа, а потом зашли в маленькую пекарню на углу.',
    checkFocusVi: 'Giọng nữ trẻ, nhịp điệu tự nhiên, nối âm mượt.',
  },
  {
    id: 'f-03',
    index: 3,
    category: 'female_single',
    categoryLabelVi: '10 câu giọng nữ',
    titleVi: 'Tin tức kinh tế ngắn gọn',
    kind: 'single',
    gender: 'female',
    voiceName: 'Despina',
    ageStyle: 'mature',
    speakingStyle: 'narration',
    emotion: 'calm',
    text: 'Аналитики отмечают постепенное снижение инфляции и осторожный рост деловой активности в регионе.',
    checkFocusVi: 'Giọng nữ dẫn tin chuẩn, phụ âm cứng/mềm rõ nét.',
  },
  {
    id: 'f-04',
    index: 4,
    category: 'female_single',
    categoryLabelVi: '10 câu giọng nữ',
    titleVi: 'Giải thích học thuật nhẹ nhàng',
    kind: 'single',
    gender: 'female',
    voiceName: 'Gacrux',
    ageStyle: 'mature',
    speakingStyle: 'educational',
    emotion: 'authoritative',
    text: 'При изучении русского языка особенно важно обращать внимание на редукцию безударных гласных.',
    checkFocusVi: 'Giọng nữ trưởng thành, phát âm rõ nguyên âm không trọng âm.',
  },
  {
    id: 'f-05',
    index: 5,
    category: 'female_single',
    categoryLabelVi: '10 câu giọng nữ',
    titleVi: 'Trao đổi kế hoạch công việc',
    kind: 'single',
    gender: 'female',
    voiceName: 'Kore',
    ageStyle: 'mature',
    speakingStyle: 'educational',
    emotion: 'warm',
    text: 'Давайте перенесём встречу на четверг в одиннадцать утра, чтобы все успели подготовить отчёты.',
    checkFocusVi: 'Giọng nữ Kore chuẩn xác, phát âm số từ và chữ ё.',
  },
  {
    id: 'f-06',
    index: 6,
    category: 'female_single',
    categoryLabelVi: '10 câu giọng nữ',
    titleVi: 'Chia sẻ cảm nhận về bộ phim',
    kind: 'single',
    gender: 'female',
    voiceName: 'Zephyr',
    ageStyle: 'young',
    speakingStyle: 'conversational',
    emotion: 'lively',
    text: 'Мне ужасно понравилась музыка в этом фильме, она создаёт удивительно тёплую атмосферу.',
    checkFocusVi: 'Giọng nữ trẻ Zephyr giàu cảm xúc nhưng không quá lố.',
  },
  {
    id: 'f-07',
    index: 7,
    category: 'female_single',
    categoryLabelVi: '10 câu giọng nữ',
    titleVi: 'Đặt bàn tại nhà hàng',
    kind: 'single',
    gender: 'female',
    voiceName: 'Sulafat',
    ageStyle: 'mature',
    speakingStyle: 'conversational',
    emotion: 'warm',
    text: 'Здравствуйте, я хотела бы забронировать столик на четверых у окна сегодня вечером в семь часов.',
    checkFocusVi: 'Tự nhiên trong giao tiếp dịch vụ, ngắt nghỉ hợp lý.',
  },
  {
    id: 'f-08',
    index: 8,
    category: 'female_single',
    categoryLabelVi: '10 câu giọng nữ',
    titleVi: 'Nói về thời tiết mùa thu',
    kind: 'single',
    gender: 'female',
    voiceName: 'Despina',
    ageStyle: 'mature',
    speakingStyle: 'narration',
    emotion: 'calm',
    text: 'Осенью воздух становится прозрачным и прохладным, а в парках пахнет мокрыми листьями.',
    checkFocusVi: 'Mềm hóa phụ âm (осенью, листьями), nhịp thơ mộng tự nhiên.',
  },
  {
    id: 'f-09',
    index: 9,
    category: 'female_single',
    categoryLabelVi: '10 câu giọng nữ',
    titleVi: 'Lời khuyên sức khỏe hàng ngày',
    kind: 'single',
    gender: 'female',
    voiceName: 'Gacrux',
    ageStyle: 'mature',
    speakingStyle: 'educational',
    emotion: 'calm',
    text: 'Регулярные прогулки на свежем воздухе помогают восстановить концентрацию после долгого рабочего дня.',
    checkFocusVi: 'Ngắt cụm dài không rời rạc, đọc trọn vẹn từng từ.',
  },
  {
    id: 'f-10',
    index: 10,
    category: 'female_single',
    categoryLabelVi: '10 câu giọng nữ',
    titleVi: 'Nhắn nhủ bạn trước chuyến bay',
    kind: 'single',
    gender: 'female',
    voiceName: 'Leda',
    ageStyle: 'young',
    speakingStyle: 'conversational',
    emotion: 'friendly',
    text: 'Обязательно напиши мне, как только приземлишься и получишь багаж, ладно?',
    checkFocusVi: 'Kết câu hỏi đuôi "ладно?" tự nhiên như người bản xứ.',
  },

  // === 10 MALE SENTENCES ===
  {
    id: 'm-01',
    index: 11,
    category: 'male_single',
    categoryLabelVi: '10 câu giọng nam',
    titleVi: 'Bắt chuyện thân mật với bạn',
    kind: 'single',
    gender: 'male',
    voiceName: 'Achird',
    ageStyle: 'young',
    speakingStyle: 'conversational',
    emotion: 'friendly',
    text: 'Привет! Извини, что немного опоздал — на проспекте сегодня жуткие пробки из-за дождя.',
    checkFocusVi: 'Giọng nam trẻ thân thiện, xử lý dấu gạch ngang tự nhiên.',
  },
  {
    id: 'm-02',
    index: 12,
    category: 'male_single',
    categoryLabelVi: '10 câu giọng nam',
    titleVi: 'Phân tích công nghệ điềm đạm',
    kind: 'single',
    gender: 'male',
    voiceName: 'Charon',
    ageStyle: 'mature',
    speakingStyle: 'educational',
    emotion: 'calm',
    text: 'Современные языковые модели значительно упрощают работу с большими объёмами текстовой информации.',
    checkFocusVi: 'Giọng nam trầm trưởng thành Charon, không bị đọc như máy.',
  },
  {
    id: 'm-03',
    index: 13,
    category: 'male_single',
    categoryLabelVi: '10 câu giọng nam',
    titleVi: 'Bản tin kinh tế châu Âu',
    kind: 'single',
    gender: 'male',
    voiceName: 'Sadaltager',
    ageStyle: 'mature',
    speakingStyle: 'narration',
    emotion: 'authoritative',
    text: 'Европейские компании всё активнее инвестируют в возобновляемую энергетику и цифровую инфраструктуру.',
    checkFocusVi: 'Giọng nam chuyên gia Sadaltager, nhấn trọng âm chuẩn.',
  },
  {
    id: 'm-04',
    index: 14,
    category: 'male_single',
    categoryLabelVi: '10 câu giọng nam',
    titleVi: 'Kể trải nghiệm du lịch tàu hỏa',
    kind: 'single',
    gender: 'male',
    voiceName: 'Algieba',
    ageStyle: 'mature',
    speakingStyle: 'narration',
    emotion: 'warm',
    text: 'Ночной поезд тронулся ровно в полночь, и за окном медленно поплыли огни пригородов.',
    checkFocusVi: 'Giọng nam mượt Algieba, ngữ điệu kể chuyện dễ nghe.',
  },
  {
    id: 'm-05',
    index: 15,
    category: 'male_single',
    categoryLabelVi: '10 câu giọng nam',
    titleVi: 'Trao đổi nhanh về dự án',
    kind: 'single',
    gender: 'male',
    voiceName: 'Puck',
    ageStyle: 'young',
    speakingStyle: 'conversational',
    emotion: 'lively',
    text: 'Слушай, у меня появилась отличная идея, как ускорить загрузку приложения почти вдвое.',
    checkFocusVi: 'Giọng nam hoạt bát Puck, ngữ điệu đời thường.',
  },
  {
    id: 'm-06',
    index: 16,
    category: 'male_single',
    categoryLabelVi: '10 câu giọng nam',
    titleVi: 'Bình luận bóng đá / thể thao',
    kind: 'single',
    gender: 'male',
    voiceName: 'Fenrir',
    ageStyle: 'mature',
    speakingStyle: 'conversational',
    emotion: 'engaged',
    text: 'Команда провела блестящий второй тайм и сумела переломить ход матча на последних минутах.',
    checkFocusVi: 'Giọng nam truyền cảm Fenrir, nhấn đúng trọng âm câu.',
  },
  {
    id: 'm-07',
    index: 17,
    category: 'male_single',
    categoryLabelVi: '10 câu giọng nam',
    titleVi: 'Hướng dẫn đường đi ở trung tâm',
    kind: 'single',
    gender: 'male',
    voiceName: 'Achird',
    ageStyle: 'young',
    speakingStyle: 'conversational',
    emotion: 'friendly',
    text: 'Пройдите два квартала прямо, поверните налево у книжного магазина, и сразу увидите вход в метро.',
    checkFocusVi: 'Ngắt nhịp liệt kê chỉ đường tự nhiên, không rời rạc.',
  },
  {
    id: 'm-08',
    index: 18,
    category: 'male_single',
    categoryLabelVi: '10 câu giọng nam',
    titleVi: 'Nhận xét sách lịch sử',
    kind: 'single',
    gender: 'male',
    voiceName: 'Charon',
    ageStyle: 'mature',
    speakingStyle: 'educational',
    emotion: 'calm',
    text: 'Автор опирается на редкие архивные документы и избегает слишком упрощённых выводов.',
    checkFocusVi: 'Phát âm cụm phụ âm dày (архивные, упрощённых).',
  },
  {
    id: 'm-09',
    index: 19,
    category: 'male_single',
    categoryLabelVi: '10 câu giọng nam',
    titleVi: 'Hỏi thăm lịch trình đồng nghiệp',
    kind: 'single',
    gender: 'male',
    voiceName: 'Algieba',
    ageStyle: 'mature',
    speakingStyle: 'conversational',
    emotion: 'warm',
    text: 'Ты уже успел посмотреть презентацию, которую я прислал вчера вечером?',
    checkFocusVi: 'Ngữ điệu câu hỏi yes/no tiếng Nga (ИК-3 trên "успел").',
  },
  {
    id: 'm-10',
    index: 20,
    category: 'male_single',
    categoryLabelVi: '10 câu giọng nam',
    titleVi: 'Tổng kết buổi họp ngắn',
    kind: 'single',
    gender: 'male',
    voiceName: 'Sadaltager',
    ageStyle: 'mature',
    speakingStyle: 'educational',
    emotion: 'authoritative',
    text: 'Итак, мы договорились завершить тестирование к пятнице и опубликовать обновлённую версию на следующей неделе.',
    checkFocusVi: 'Giọng nam vững, giữ đều chất giọng suốt câu dài.',
  },

  // === 5 MULTI-SPEAKER DIALOGUES (MALE & FEMALE + 3-SPEAKER) ===
  {
    id: 'd-01',
    index: 21,
    category: 'dialogue_mixed',
    categoryLabelVi: '5 hội thoại nam – nữ',
    titleVi: 'Hội thoại 1: Gặp nhau tại quán cà phê (Nữ + Nam)',
    kind: 'dialogue',
    gender: 'mixed',
    speakers: [
      { speaker: 'Анна', gender: 'female', voiceName: 'Sulafat', speakingStyle: 'conversational', role: 'Friend' },
      { speaker: 'Максим', gender: 'male', voiceName: 'Achird', speakingStyle: 'conversational', role: 'Friend' },
    ],
    turns: [
      { speaker: 'Анна', text: 'Привет, Максим! Давно не виделись. Как твоя новая работа?' },
      { speaker: 'Максим', text: 'Привет, Ань! Всё отлично, команда классная, хотя задач сейчас очень много.' },
      { speaker: 'Анна', text: 'Ну хоть на выходных удаётся отдохнуть?' },
      { speaker: 'Максим', text: 'Да, стараюсь в воскресенье вообще не открывать рабочий ноутбук.' },
    ],
    checkFocusVi: 'Phân biệt rõ giọng nữ Sulafat và giọng nam Achird, khoảng nghỉ chuyển lượt tự nhiên.',
  },
  {
    id: 'd-02',
    index: 22,
    category: 'dialogue_mixed',
    categoryLabelVi: '5 hội thoại nam – nữ',
    titleVi: 'Hội thoại 2: Bản tin phỏng vấn kinh tế (Nữ + Nam)',
    kind: 'dialogue',
    gender: 'mixed',
    speakers: [
      { speaker: 'Ольга', gender: 'female', voiceName: 'Despina', speakingStyle: 'narration', role: 'News anchor' },
      { speaker: 'Сергей', gender: 'male', voiceName: 'Charon', speakingStyle: 'educational', role: 'Economist' },
    ],
    turns: [
      { speaker: 'Ольга', text: 'Сергей, как новые процентные ставки повлияют на малый бизнес в этом году?' },
      { speaker: 'Сергей', text: 'В ближайшие месяцы кредиты останутся дорогими, поэтому компании будут осторожнее с расширением.' },
      { speaker: 'Ольга', text: 'А какие отрасли чувствуют себя наиболее уверенно?' },
      { speaker: 'Сергей', text: 'Прежде всего логистика, внутренний туризм и разработка программного обеспечения.' },
    ],
    checkFocusVi: 'Hội thoại tin tức 2 nhân vật, không bao giờ đổi giới tính giữa các lượt.',
  },
  {
    id: 'd-03',
    index: 23,
    category: 'dialogue_mixed',
    categoryLabelVi: '5 hội thoại nam – nữ',
    titleVi: 'Hội thoại 3: Lên kế hoạch đi tàu tới Kazan (Nam + Nữ)',
    kind: 'dialogue',
    gender: 'mixed',
    speakers: [
      { speaker: 'Дмитрий', gender: 'male', voiceName: 'Puck', speakingStyle: 'conversational', role: 'Traveler' },
      { speaker: 'Катя', gender: 'female', voiceName: 'Leda', speakingStyle: 'conversational', role: 'Traveler' },
    ],
    turns: [
      { speaker: 'Дмитрий', text: 'Катя, ты уже купила билеты в Казань на майские праздники?' },
      { speaker: 'Катя', text: 'Ещё нет, выбираю между ночным поездом и утренним рейсом.' },
      { speaker: 'Дмитрий', text: 'Бери ночной поезд — приедем прямо в центр и сразу пойдём завтракать!' },
    ],
    checkFocusVi: 'Hai giọng trẻ nam Puck + nữ Leda chuyển lượt mượt, giữ đúng thứ tự.',
  },
  {
    id: 'd-04',
    index: 24,
    category: 'dialogue_mixed',
    categoryLabelVi: '5 hội thoại nam – nữ',
    titleVi: 'Hội thoại 4: Thảo luận đọc sách (Nữ + Nam)',
    kind: 'dialogue',
    gender: 'mixed',
    speakers: [
      { speaker: 'Вера', gender: 'female', voiceName: 'Gacrux', speakingStyle: 'educational', role: 'Psychologist' },
      { speaker: 'Александр', gender: 'male', voiceName: 'Algieba', speakingStyle: 'conversational', role: 'Host' },
    ],
    turns: [
      { speaker: 'Александр', text: 'Вера, правда ли, что бумажные книги помогают запоминать текст лучше электронных?' },
      { speaker: 'Вера', text: 'Исследования показывают, что тактильное ощущение страниц действительно помогает мозгу выстраивать карту текста.' },
      { speaker: 'Александр', text: 'Значит, отказываться от домашней библиотеки пока рано.' },
    ],
    checkFocusVi: 'Hai giọng trưởng thành Gacrux (nữ) & Algieba (nam), đối đáp tự nhiên.',
  },
  {
    id: 'd-05',
    index: 25,
    category: 'dialogue_mixed',
    categoryLabelVi: '5 hội thoại nam – nữ',
    titleVi: 'Hội thoại 5 (3 nhân vật): A nữ · B nam · C nữ khác A',
    kind: 'dialogue',
    gender: 'mixed',
    speakers: [
      { speaker: 'Елена', gender: 'female', voiceName: 'Sulafat', speakingStyle: 'conversational', role: 'Product Lead' },
      { speaker: 'Игорь', gender: 'male', voiceName: 'Charon', speakingStyle: 'educational', role: 'Tech Lead' },
      { speaker: 'Мария', gender: 'female', voiceName: 'Leda', speakingStyle: 'conversational', role: 'Designer' },
    ],
    turns: [
      { speaker: 'Елена', text: 'Коллеги, давайте быстро сверимся по запуску новой функции к концу недели.' },
      { speaker: 'Игорь', text: 'Серверная часть уже готова, осталось прогнать финальные тесты нагрузки.' },
      { speaker: 'Мария', text: 'А я только что обновила мобильные экраны — теперь всё читается намного чище!' },
      { speaker: 'Елена', text: 'Отлично, тогда завтра утром проводим общее демо.' },
    ],
    checkFocusVi: 'Kiểm chứng 3 nhân vật riêng biệt: Елена (Sulafat nữ) · Игорь (Charon nam) · Мария (Leda nữ khác Елена).',
  },

  // === 5 QUESTIONS, EXCLAMATIONS & LONG COMPLEX SENTENCES ===
  {
    id: 'e-01',
    index: 26,
    category: 'intonation_long',
    categoryLabelVi: '5 câu hỏi, cảm thán & câu dài',
    titleVi: 'Câu hỏi liên tiếp giàu ngữ điệu (Nữ)',
    kind: 'single',
    gender: 'female',
    voiceName: 'Sulafat',
    speakingStyle: 'conversational',
    emotion: 'warm',
    text: 'Подожди, ты серьёзно решил переехать в другой город уже в следующем месяце? А как же квартира и университет?',
    checkFocusVi: 'Ngữ điệu ngạc nhiên + 2 câu hỏi liên tiếp tự nhiên (ИК-3 / ИК-2).',
  },
  {
    id: 'e-02',
    index: 27,
    category: 'intonation_long',
    categoryLabelVi: '5 câu hỏi, cảm thán & câu dài',
    titleVi: 'Câu cảm thán tự nhiên (Nam)',
    kind: 'single',
    gender: 'male',
    voiceName: 'Puck',
    speakingStyle: 'conversational',
    emotion: 'lively',
    text: 'Какой потрясающий вид открывается с этой смотровой площадки! Неужели мы чуть не пропустили закат!',
    checkFocusVi: 'Câu cảm thán tiếng Nga (ИК-5) có cảm xúc tự nhiên, không diễn kịch quá mức.',
  },
  {
    id: 'e-03',
    index: 28,
    category: 'intonation_long',
    categoryLabelVi: '5 câu hỏi, cảm thán & câu dài',
    titleVi: 'Câu phức dài nhiều mệnh đề (Nữ)',
    kind: 'single',
    gender: 'female',
    voiceName: 'Despina',
    speakingStyle: 'narration',
    emotion: 'calm',
    text: 'Несмотря на то что переговоры продолжались почти до полуночи, стороны всё-таки смогли согласовать ключевые пункты договора, которые вступят в силу в начале следующего квартала.',
    checkFocusVi: 'Câu dài ~25 từ: kiểm tra hơi thở, ngắt dấu phẩy, không bỏ từ hoặc tăng tốc bất thường.',
  },
  {
    id: 'e-04',
    index: 29,
    category: 'intonation_long',
    categoryLabelVi: '5 câu hỏi, cảm thán & câu dài',
    titleVi: 'Câu dài có liệt kê & dấu hai chấm (Nam)',
    kind: 'single',
    gender: 'male',
    voiceName: 'Charon',
    speakingStyle: 'educational',
    emotion: 'calm',
    text: 'Для качественного диктанта важны три вещи: естественный темп речи, точное ударение в каждом слове и чёткие паузы между смысловыми частями предложения.',
    checkFocusVi: 'Ngắt nghỉ chính xác ở dấu hai chấm và các cụm liệt kê.',
  },
  {
    id: 'e-05',
    index: 30,
    category: 'intonation_long',
    categoryLabelVi: '5 câu hỏi, cảm thán & câu dài',
    titleVi: 'Câu hỏi tu từ kết hợp cảm thán (Nữ)',
    kind: 'single',
    gender: 'female',
    voiceName: 'Zephyr',
    speakingStyle: 'conversational',
    emotion: 'lively',
    text: 'Разве можно не влюбиться в этот город, когда вечером загораются фонари и на площади звучит живая музыка?!',
    checkFocusVi: 'Ngữ điệu kết hợp hỏi + cảm thán mượt mà, giữ chất giọng nữ nhất quán.',
  },

  // === 5 DIFFICULT WORDS, STRESS & PROPER NOUNS ===
  {
    id: 'h-01',
    index: 31,
    category: 'stress_proper_nouns',
    categoryLabelVi: '5 câu từ khó, trọng âm & tên riêng',
    titleVi: 'Từ đồng tự khác trọng âm (за́мок / замо́к, сто́ит / стои́т)',
    kind: 'single',
    gender: 'female',
    voiceName: 'Gacrux',
    speakingStyle: 'educational',
    emotion: 'authoritative',
    text: 'На воротах старинного замка висел тяжёлый железный замок, и экскурсовод объяснил, сколько стоит билет и где стоит подождать группу.',
    checkFocusVi: 'Phân biệt đúng ngữ cảnh trọng âm: за́мка vs замо́к, сто́ит vs стои́т.',
  },
  {
    id: 'h-02',
    index: 32,
    category: 'stress_proper_nouns',
    categoryLabelVi: '5 câu từ khó, trọng âm & tên riêng',
    titleVi: 'Tên riêng địa danh & danh nhân Nga (Nam)',
    kind: 'single',
    gender: 'male',
    voiceName: 'Sadaltager',
    speakingStyle: 'narration',
    emotion: 'authoritative',
    text: 'В Санкт-Петербурге и Екатеринбурге прошли выставки, посвящённые творчеству Фёдора Достоевского и Петра Ильича Чайковского.',
    checkFocusVi: 'Phát âm chuẩn tên riêng: Санкт-Петербург, Екатеринбург, Фёдор Достоевский, Чайковский.',
  },
  {
    id: 'h-03',
    index: 33,
    category: 'stress_proper_nouns',
    categoryLabelVi: '5 câu từ khó, trọng âm & tên riêng',
    titleVi: 'Từ ghép dài & cụm phụ âm khó (Nữ)',
    kind: 'single',
    gender: 'female',
    voiceName: 'Kore',
    speakingStyle: 'educational',
    emotion: 'warm',
    text: 'Высококвалифицированные специалисты осмотрели главную достопримечательность и подготовили обстоятельное заключение.',
    checkFocusVi: 'Từ rất dài (высококвалифицированные, достопримечательность) không bị vấp hay nuốt âm.',
  },
  {
    id: 'h-04',
    index: 34,
    category: 'stress_proper_nouns',
    categoryLabelVi: '5 câu từ khó, trọng âm & tên riêng',
    titleVi: 'Từ vay mượn quốc tế đọc theo chuẩn Nga (Nam)',
    kind: 'single',
    gender: 'male',
    voiceName: 'Algieba',
    speakingStyle: 'narration',
    emotion: 'calm',
    text: 'В Женеве и Брюсселе обсуждали кибербезопасность, квантовые алгоритмы и международные стандарты искусственного интеллекта.',
    checkFocusVi: 'Tên thành phố quốc tế & thuật ngữ công nghệ đọc theo âm vị tiếng Nga bản xứ.',
  },
  {
    id: 'h-05',
    index: 35,
    category: 'stress_proper_nouns',
    categoryLabelVi: '5 câu từ khó, trọng âm & tên riêng',
    titleVi: 'Cặp từ dễ sai trọng âm kinh điển (звони́т, догово́р, кварта́л)',
    kind: 'single',
    gender: 'female',
    voiceName: 'Despina',
    speakingStyle: 'educational',
    emotion: 'calm',
    text: 'Юрист звонит клиенту, чтобы уточнить договор на четвёртый квартал и проверить правильность банковских реквизитов.',
    checkFocusVi: 'Trọng âm chuẩn Nga: звони́т, догово́р, кварта́л, реквизи́тов.',
  },
];

interface QaManifestRecord {
  sampleId: string;
  model: TtsModelId;
  voiceIds: GeminiVoiceId[];
  genders: ('male' | 'female')[];
  acoustics: WavAcousticDiagnostics;
  reusedFromCache: boolean;
  generatedAt: string;
}

type QaManifestMap = Record<string, QaManifestRecord>;

function ensureQaDir(): void {
  fs.mkdirSync(QA_DIR, { recursive: true });
}

function readQaManifest(): QaManifestMap {
  try {
    if (!fs.existsSync(QA_MANIFEST_PATH)) return {};
    return JSON.parse(fs.readFileSync(QA_MANIFEST_PATH, 'utf8')) as QaManifestMap;
  } catch {
    return {};
  }
}

function writeQaManifest(manifest: QaManifestMap): void {
  ensureQaDir();
  const tmp = `${QA_MANIFEST_PATH}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  fs.renameSync(tmp, QA_MANIFEST_PATH);
}

export function resolveSafeQaAudioPath(sampleId: string): string | null {
  const cleanId = sampleId.replace(/\.wav$/i, '');
  if (!SAFE_SAMPLE_ID_RE.test(cleanId)) return null;
  const fullPath = path.resolve(QA_DIR, `${cleanId}.wav`);
  if (!fullPath.startsWith(QA_DIR + path.sep)) return null;
  return fullPath;
}

function writeWavAtomically(targetPath: string, wavBuf: Buffer): void {
  ensureQaDir();
  const tmp = `${targetPath}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  fs.writeFileSync(tmp, wavBuf);
  fs.renameSync(tmp, targetPath);
}

/**
 * Returns all 35 QA samples with their persisted disk status (ZERO API calls).
 */
export function listTtsQaSamples(): {
  samples: TtsQaSampleView[];
  summary: {
    total: number;
    ready: number;
    pending: number;
    byCategory: Record<QaSampleCategory, { total: number; ready: number }>;
  };
} {
  const manifest = readQaManifest();
  const byCategory: Record<QaSampleCategory, { total: number; ready: number }> = {
    female_single: { total: 0, ready: 0 },
    male_single: { total: 0, ready: 0 },
    dialogue_mixed: { total: 0, ready: 0 },
    intonation_long: { total: 0, ready: 0 },
    stress_proper_nouns: { total: 0, ready: 0 },
  };

  let readyCount = 0;

  const samples: TtsQaSampleView[] = TTS_QA_SAMPLES.map((spec) => {
    byCategory[spec.category].total += 1;
    const wavPath = resolveSafeQaAudioPath(spec.id);
    const meta = manifest[spec.id];
    const hasFile = Boolean(wavPath && fs.existsSync(wavPath) && fs.statSync(wavPath).size > 44);

    if (hasFile && meta && meta.acoustics?.valid) {
      readyCount += 1;
      byCategory[spec.category].ready += 1;
      return {
        ...spec,
        runtime: {
          status: 'ready',
          audioUrl: `/api/tts/qa/audio/${spec.id}.wav`,
          model: meta.model,
          voiceIds: meta.voiceIds,
          genders: meta.genders,
          acoustics: meta.acoustics,
          reusedFromCache: true,
          generatedAt: meta.generatedAt,
          error: null,
          errorCategory: 'none',
        },
      };
    }

    const defaultVoiceIds: GeminiVoiceId[] =
      spec.kind === 'dialogue'
        ? (spec.speakers ?? []).map((s) => s.voiceName)
        : spec.voiceName
          ? [spec.voiceName]
          : [];
    const defaultGenders: ('male' | 'female')[] =
      spec.kind === 'dialogue'
        ? (spec.speakers ?? []).map((s) => s.gender)
        : spec.gender === 'male'
          ? ['male']
          : ['female'];

    return {
      ...spec,
      runtime: {
        status: 'pending',
        audioUrl: null,
        model: null,
        voiceIds: defaultVoiceIds,
        genders: defaultGenders,
        acoustics: null,
        reusedFromCache: false,
        generatedAt: null,
        error: null,
        errorCategory: 'none',
      },
    };
  });

  return {
    samples,
    summary: {
      total: TTS_QA_SAMPLES.length,
      ready: readyCount,
      pending: TTS_QA_SAMPLES.length - readyCount,
      byCategory,
    },
  };
}

/**
 * Generates one or multiple QA samples ON DEMAND ONLY (never called on startup/deploy).
 * - Reuses existing valid WAV on disk with 0 API calls unless `force === true`.
 * - Stops immediately when Free Tier daily quota is exhausted.
 * - Never overwrites valid WAV files on failure.
 */
export async function generateTtsQaSamples(options: {
  sampleIds?: string[];
  force?: boolean;
  providerOverride?: TtsProvider;
  maxCount?: number;
} = {}): Promise<{
  generated: number;
  reusedFromDisk: number;
  failed: number;
  stoppedDueToQuota: boolean;
  quotaMessage: string | null;
  results: {
    sampleId: string;
    status: 'ready' | 'failed';
    reusedFromDisk: boolean;
    model?: string;
    durationSec?: number;
    error?: string;
    errorCategory?: GeminiErrorCategory;
  }[];
}> {
  const provider = options.providerOverride ?? ttsProvider;
  const manifest = readQaManifest();

  let targets = TTS_QA_SAMPLES.slice();
  if (options.sampleIds && options.sampleIds.length > 0) {
    const wanted = new Set(options.sampleIds);
    targets = targets.filter((s) => wanted.has(s.id));
  }
  if (typeof options.maxCount === 'number' && options.maxCount > 0) {
    targets = targets.slice(0, options.maxCount);
  }

  let generated = 0;
  let reusedFromDisk = 0;
  let failed = 0;
  let stoppedDueToQuota = false;
  let quotaMessage: string | null = null;
  const results: {
    sampleId: string;
    status: 'ready' | 'failed';
    reusedFromDisk: boolean;
    model?: string;
    durationSec?: number;
    error?: string;
    errorCategory?: GeminiErrorCategory;
  }[] = [];

  for (const spec of targets) {
    const wavPath = resolveSafeQaAudioPath(spec.id);
    if (!wavPath) continue;

    // 1. Reuse existing valid disk WAV with 0 API calls
    if (!options.force && fs.existsSync(wavPath) && manifest[spec.id]?.acoustics?.valid) {
      const existingBuf = fs.readFileSync(wavPath);
      const existingAcoustics = analyzeWavAcoustics(existingBuf);
      if (existingAcoustics.valid) {
        reusedFromDisk += 1;
        results.push({
          sampleId: spec.id,
          status: 'ready',
          reusedFromDisk: true,
          model: manifest[spec.id].model,
          durationSec: existingAcoustics.durationSec,
        });
        continue;
      }
    }

    if (stoppedDueToQuota) {
      failed += 1;
      results.push({
        sampleId: spec.id,
        status: 'failed',
        reusedFromDisk: false,
        error: quotaMessage ?? 'Đã dừng vì hết hạn mức miễn phí Gemini TTS.',
        errorCategory: 'daily_quota_exhausted',
      });
      continue;
    }

    try {
      let ttsRes;
      let voiceIds: GeminiVoiceId[] = [];
      let genders: ('male' | 'female')[] = [];

      if (spec.kind === 'dialogue' && spec.speakers && spec.turns) {
        voiceIds = spec.speakers.map((s) => s.voiceName);
        genders = spec.speakers.map((s) => s.gender);
        ttsRes = await provider.synthesizeDialogue({
          lessonId: `qa-${spec.id}`,
          topic: spec.titleVi,
          speakers: spec.speakers,
          turns: spec.turns,
          forceRegenerate: Boolean(options.force),
        });
      } else {
        const g: 'male' | 'female' = spec.gender === 'male' ? 'male' : 'female';
        const v: GeminiVoiceId = spec.voiceName ?? (g === 'male' ? 'Charon' : 'Sulafat');
        voiceIds = [v];
        genders = [g];
        ttsRes = await provider.synthesize({
          lessonId: `qa-${spec.id}`,
          text: spec.text ?? '',
          voiceName: v,
          gender: g,
          ageStyle: spec.ageStyle,
          speakingStyle: spec.speakingStyle,
          emotion: spec.emotion,
          topic: spec.titleVi,
          forceRegenerate: Boolean(options.force),
        });
      }

      const wavBuf = ensureWavBuffer(Buffer.from(ttsRes.audioBase64, 'base64'), 24000);
      const acoustics = analyzeWavAcoustics(wavBuf);
      if (!acoustics.valid) {
        throw new Error(`Generated WAV failed acoustic validation (duration=${acoustics.durationSec}s, rms=${acoustics.rms}).`);
      }

      writeWavAtomically(wavPath, wavBuf);
      manifest[spec.id] = {
        sampleId: spec.id,
        model: ttsRes.provider,
        voiceIds,
        genders,
        acoustics,
        reusedFromCache: ttsRes.cached,
        generatedAt: new Date().toISOString(),
      };
      writeQaManifest(manifest);

      generated += 1;
      results.push({
        sampleId: spec.id,
        status: 'ready',
        reusedFromDisk: false,
        model: ttsRes.provider,
        durationSec: acoustics.durationSec,
      });
    } catch (err) {
      const classified = err instanceof TtsQuotaError ? err.classified : classifyGeminiError(err);
      failed += 1;
      results.push({
        sampleId: spec.id,
        status: 'failed',
        reusedFromDisk: false,
        error: classified.userMessageVi,
        errorCategory: classified.category,
      });

      if (classified.category === 'daily_quota_exhausted') {
        stoppedDueToQuota = true;
        quotaMessage = classified.userMessageVi;
      }
    }
  }

  return {
    generated,
    reusedFromDisk,
    failed,
    stoppedDueToQuota,
    quotaMessage,
    results,
  };
}
