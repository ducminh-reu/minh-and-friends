import type {
  DailyActivityPoint,
  DictationAttempt,
  LearnerProfile,
  VocabularyRecord,
} from '../types/domain';

export const SEED_PROFILE: LearnerProfile = {
  displayName: 'Minh Trần',
  estimatedLevel: 'B1',
  verifiedLevel: null,
  dailyGoalLessons: 2,
  dailyGoalMinutes: 25,
  streakDays: 5,
  lastPracticeDate: '2026-11-21',
  interfaceLanguage: 'vi',
  preferredMode: 'sentence',
  preferredSpeed: 1,
  ttsPreference: 'auto',
  cefrHistory: [
    {
      date: '2026-10-28',
      estimatedLevel: 'B1',
      compositeScore: 68,
      noteVi: 'Khởi tạo hồ sơ đánh giá nền tảng B1',
    },
    {
      date: '2026-11-08',
      estimatedLevel: 'B1',
      compositeScore: 76,
      noteVi: 'Cải thiện nhận diện nguyên âm không trọng âm',
    },
    {
      date: '2026-11-18',
      estimatedLevel: 'B1',
      compositeScore: 81,
      noteVi: 'Ổn định nghe chép hội thoại B1, bắt đầu thử B2',
    },
  ],
};

export const SEED_ATTEMPTS: DictationAttempt[] = [];

export const SEED_VOCABULARY: VocabularyRecord[] = [
  {
    id: 'voc-seed-1',
    word: 'пробка',
    stressedWord: 'про́бка',
    partOfSpeech: 'существительное',
    forms: 'ж. р., -и; мн. про́бки',
    meaningVi: 'tắc đường, kẹt xe',
    definitionRu: 'большое скопление транспорта на дороге, затрудняющее движение',
    exampleRu: 'Из-за сильного дождя в центре образовались пробки.',
    exampleVi: 'Vì mưa lớn nên ở khu trung tâm đã xảy ra kẹt xe.',
    sourceLessonId: 'curated-b1-arbat-cafe',
    sourceLessonTitle: 'Cuộc hẹn buổi sáng ở quán cà phê trên phố Arbat',
    notes: 'Chú ý cụm «попасть в пробку» (bị kẹt xe).',
    status: 'reviewing',
    createdAt: '2026-11-15T10:00:00.000Z',
    lastReviewedAt: '2026-11-19T09:00:00.000Z',
    nextReviewAt: '2026-11-21T08:00:00.000Z',
    intervalDays: 2,
    easeFactor: 2.5,
    repetitions: 2,
    correctCount: 3,
    incorrectCount: 0,
    lapses: 0,
  },
  {
    id: 'voc-seed-2',
    word: 'узкое место',
    stressedWord: 'у́зкое ме́сто',
    partOfSpeech: 'идиома / термин',
    forms: 'ср. р., -ого -а',
    meaningVi: 'điểm nghẽn, nút thắt cổ chai',
    definitionRu: 'наиболее уязвимый или медленный участок системы, тормозящий процесс',
    exampleRu: 'Проверка документов стала узким местом при оформлении заказов.',
    exampleVi: 'Khâu kiểm tra giấy tờ đã trở thành điểm nghẽn khi xử lý đơn hàng.',
    sourceLessonId: 'curated-b2-hybrid-project',
    sourceLessonTitle: 'Thảo luận về dự án mới và lịch làm việc kết hợp',
    notes: 'Hay gặp trong họp dự án, vận hành.',
    status: 'learning',
    createdAt: '2026-11-16T10:00:00.000Z',
    lastReviewedAt: '2026-11-20T09:00:00.000Z',
    nextReviewAt: '2026-11-21T07:00:00.000Z',
    intervalDays: 1,
    easeFactor: 2.2,
    repetitions: 1,
    correctCount: 1,
    incorrectCount: 2,
    lapses: 2,
  },
  {
    id: 'voc-seed-3',
    word: 'подвести итоги',
    stressedWord: 'подвести́ ито́ги',
    partOfSpeech: 'устойчивое выражение',
    forms: 'СВ; НСВ подводи́ть ито́ги',
    meaningVi: 'tổng kết, đúc kết kết quả',
    definitionRu: 'обобщить результаты проделанной работы за определённый период',
    exampleRu: 'В конце квартала мы подводим итоги продаж.',
    exampleVi: 'Cuối quý chúng tôi tổng kết kết quả kinh doanh.',
    sourceLessonId: 'curated-b2-hybrid-project',
    sourceLessonTitle: 'Thảo luận về dự án mới và lịch làm việc kết hợp',
    notes: '',
    status: 'learning',
    createdAt: '2026-11-17T10:00:00.000Z',
    lastReviewedAt: '2026-11-19T12:00:00.000Z',
    nextReviewAt: '2026-11-21T06:00:00.000Z',
    intervalDays: 1,
    easeFactor: 2.36,
    repetitions: 1,
    correctCount: 2,
    incorrectCount: 1,
    lapses: 1,
  },
  {
    id: 'voc-seed-4',
    word: 'аудирование',
    stressedWord: 'ауди́рование',
    partOfSpeech: 'существительное',
    forms: 'ср. р., -я',
    meaningVi: 'kỹ năng nghe hiểu',
    definitionRu: 'восприятие и понимание устной речи на слух при изучении языка',
    exampleRu: 'Ежедневное аудирование помогает привыкнуть к темпу речи.',
    exampleVi: 'Luyện nghe hằng ngày giúp làm quen với tốc độ nói.',
    sourceLessonId: 'curated-b1-library-exam',
    sourceLessonTitle: 'Chuẩn bị cho kỳ thi ngoại ngữ tại thư viện',
    notes: 'Trọng âm rơi vào «и́».',
    status: 'mastered',
    createdAt: '2026-11-10T10:00:00.000Z',
    lastReviewedAt: '2026-11-18T10:00:00.000Z',
    nextReviewAt: '2026-11-29T10:00:00.000Z',
    intervalDays: 14,
    easeFactor: 2.6,
    repetitions: 4,
    correctCount: 5,
    incorrectCount: 0,
    lapses: 0,
  },
  {
    id: 'voc-seed-5',
    word: 'в ущерб',
    stressedWord: 'в уще́рб',
    partOfSpeech: 'производный предлог',
    forms: 'в уще́рб + дат. п.',
    meaningVi: 'gây tổn hại đến, đánh đổi bằng',
    definitionRu: 'во вред чему-либо, за счёт ухудшения другого важного аспекта',
    exampleRu: 'Нельзя увеличивать скорость работы в ущерб точности.',
    exampleVi: 'Không thể tăng tốc độ làm việc mà đánh đổi sự chính xác.',
    sourceLessonId: 'curated-c1-digital-fatigue',
    sourceLessonTitle: 'Mệt mỏi kỹ thuật số và ranh giới của sự tập trung',
    notes: 'Luôn đi với Cách tặng (кому́/чему́).',
    status: 'new',
    createdAt: '2026-11-20T14:00:00.000Z',
    lastReviewedAt: null,
    nextReviewAt: '2026-11-21T09:00:00.000Z',
    intervalDays: 0,
    easeFactor: 2.5,
    repetitions: 0,
    correctCount: 0,
    incorrectCount: 0,
    lapses: 0,
  },
  {
    id: 'voc-seed-6',
    word: 'составить компанию',
    stressedWord: 'соста́вить компа́нию',
    partOfSpeech: 'устойчивое выражение',
    forms: 'кому́? (дат. п.)',
    meaningVi: 'đi cùng, làm bạn đồng hành với ai đó',
    definitionRu: 'пойти куда-либо или провести время вместе с кем-нибудь',
    exampleRu: 'Спасибо, что составил мне компанию на прогулке.',
    exampleVi: 'Cảm ơn vì đã đi dạo cùng tôi.',
    sourceLessonId: 'curated-b1-arbat-cafe',
    sourceLessonTitle: 'Cuộc hẹn buổi sáng ở quán cà phê trên phố Arbat',
    notes: '',
    status: 'reviewing',
    createdAt: '2026-11-12T10:00:00.000Z',
    lastReviewedAt: '2026-11-19T15:00:00.000Z',
    nextReviewAt: '2026-11-21T11:00:00.000Z',
    intervalDays: 2,
    easeFactor: 2.5,
    repetitions: 2,
    correctCount: 2,
    incorrectCount: 0,
    lapses: 0,
  },
];

export const SEED_DAILY_ACTIVITY: DailyActivityPoint[] = [
  { date: '2026-11-15', minutes: 22, sentencesCompleted: 11, dictationAccuracy: 74 },
  { date: '2026-11-16', minutes: 15, sentencesCompleted: 8, dictationAccuracy: null },
  { date: '2026-11-17', minutes: 18, sentencesCompleted: 10, dictationAccuracy: null },
  { date: '2026-11-18', minutes: 28, sentencesCompleted: 14, dictationAccuracy: 81 },
  { date: '2026-11-19', minutes: 20, sentencesCompleted: 9, dictationAccuracy: null },
  { date: '2026-11-20', minutes: 31, sentencesCompleted: 15, dictationAccuracy: 86 },
  { date: '2026-11-21', minutes: 12, sentencesCompleted: 5, dictationAccuracy: null },
];

export const SUPABASE_SCHEMA_SQL = `-- RUSSIAN DICTATION Supabase PostgreSQL Schema & Strict Row Level Security (RLS)
-- Safe to run multiple times (idempotent migration).

create table if not exists public.learner_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Học viên',
  estimated_level text not null default 'B1',
  verified_level text,
  daily_goal_lessons int not null default 2,
  daily_goal_minutes int not null default 25,
  streak_days int not null default 0,
  last_practice_date text not null default '',
  interface_language text not null default 'vi',
  preferred_mode text not null default 'sentence',
  preferred_speed numeric not null default 1,
  tts_preference text not null default 'auto',
  cefr_history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.learner_profiles add column if not exists last_practice_date text not null default '';
alter table public.learner_profiles add column if not exists preferred_mode text not null default 'sentence';
alter table public.learner_profiles add column if not exists preferred_speed numeric not null default 1;
alter table public.learner_profiles add column if not exists tts_preference text not null default 'auto';
alter table public.learner_profiles add column if not exists cefr_history jsonb not null default '[]'::jsonb;

create table if not exists public.lessons (
  id text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title_ru text not null,
  title_vi text not null,
  level text not null,
  topic text not null,
  source text not null check (source in ('curated', 'ai_generated')),
  verified boolean not null default false,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (owner_id, id)
);

alter table public.lessons add column if not exists updated_at timestamptz not null default now();
alter table public.lessons add column if not exists deleted_at timestamptz;

create table if not exists public.saved_lessons (
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id text not null,
  lesson_snapshot jsonb,
  saved_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, lesson_id)
);

create table if not exists public.dictation_drafts (
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id text not null,
  mode text not null default 'sentence',
  sentence_inputs jsonb not null default '{}'::jsonb,
  word_slot_inputs jsonb not null default '{}'::jsonb,
  sentence_input_style text not null default 'slots',
  full_input text not null default '',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, lesson_id)
);

create table if not exists public.dictation_attempts (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id text not null,
  lesson_title_vi text not null default '',
  lesson_title_ru text not null default '',
  lesson_level text not null default 'B1',
  lesson_source text not null default 'curated',
  mode text not null,
  duration_sec int not null default 0,
  listening_accuracy int,
  lexical_accuracy int,
  spelling_grammar_accuracy int,
  punctuation_accuracy int,
  error_counts jsonb not null default '{}'::jsonb,
  sentence_inputs jsonb not null default '{}'::jsonb,
  full_input text,
  completed_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.dictation_attempts add column if not exists lesson_title_vi text not null default '';
alter table public.dictation_attempts add column if not exists lesson_title_ru text not null default '';
alter table public.dictation_attempts add column if not exists lesson_level text not null default 'B1';
alter table public.dictation_attempts add column if not exists lesson_source text not null default 'curated';
alter table public.dictation_attempts add column if not exists duration_sec int not null default 0;
alter table public.dictation_attempts add column if not exists full_input text;

create table if not exists public.vocabulary (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  word text not null,
  stressed_word text not null,
  meaning_vi text not null,
  definition_ru text not null,
  example_ru text not null,
  example_vi text not null,
  part_of_speech text not null,
  forms text not null,
  source_lesson_id text,
  source_lesson_title text not null default '',
  notes text not null default '',
  status text not null default 'new',
  last_reviewed_at timestamptz,
  next_review_at timestamptz not null default now(),
  interval_days int not null default 0,
  ease_factor numeric not null default 2.5,
  repetitions int not null default 0,
  correct_count int not null default 0,
  incorrect_count int not null default 0,
  lapses int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

alter table public.vocabulary add column if not exists source_lesson_title text not null default '';
alter table public.vocabulary add column if not exists last_reviewed_at timestamptz;
alter table public.vocabulary add column if not exists updated_at timestamptz not null default now();
alter table public.vocabulary add column if not exists deleted_at timestamptz;

create table if not exists public.vocabulary_review_logs (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  vocabulary_id text not null,
  format text not null,
  correct boolean not null,
  quality int not null,
  reviewed_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.daily_activity (
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_date text not null,
  minutes int not null default 0,
  sentences_completed int not null default 0,
  dictation_accuracy int,
  updated_at timestamptz not null default now(),
  primary key (user_id, activity_date)
);

alter table public.learner_profiles enable row level security;
alter table public.lessons enable row level security;
alter table public.saved_lessons enable row level security;
alter table public.dictation_drafts enable row level security;
alter table public.dictation_attempts enable row level security;
alter table public.vocabulary enable row level security;
alter table public.vocabulary_review_logs enable row level security;
alter table public.daily_activity enable row level security;

revoke all on public.learner_profiles from anon;
revoke all on public.lessons from anon;
revoke all on public.saved_lessons from anon;
revoke all on public.dictation_drafts from anon;
revoke all on public.dictation_attempts from anon;
revoke all on public.vocabulary from anon;
revoke all on public.vocabulary_review_logs from anon;
revoke all on public.daily_activity from anon;

grant select, insert, update, delete on public.learner_profiles to authenticated;
grant select, insert, update, delete on public.lessons to authenticated;
grant select, insert, update, delete on public.saved_lessons to authenticated;
grant select, insert, update, delete on public.dictation_drafts to authenticated;
grant select, insert, update, delete on public.dictation_attempts to authenticated;
grant select, insert, update, delete on public.vocabulary to authenticated;
grant select, insert, update, delete on public.vocabulary_review_logs to authenticated;
grant select, insert, update, delete on public.daily_activity to authenticated;

drop policy if exists "Users manage own profile" on public.learner_profiles;
create policy "Users manage own profile" on public.learner_profiles
  for all to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Read curated or own AI lessons" on public.lessons;
drop policy if exists "Insert own AI lessons" on public.lessons;
drop policy if exists "Update own AI lessons" on public.lessons;
drop policy if exists "Delete own AI lessons" on public.lessons;
drop policy if exists "Users manage own lessons" on public.lessons;
create policy "Users manage own lessons" on public.lessons
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "Users manage own saved lessons" on public.saved_lessons;
create policy "Users manage own saved lessons" on public.saved_lessons
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage own drafts" on public.dictation_drafts;
create policy "Users manage own drafts" on public.dictation_drafts
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage own attempts" on public.dictation_attempts;
create policy "Users manage own attempts" on public.dictation_attempts
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage own vocabulary" on public.vocabulary;
create policy "Users manage own vocabulary" on public.vocabulary
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage own review logs" on public.vocabulary_review_logs;
create policy "Users manage own review logs" on public.vocabulary_review_logs
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage own daily activity" on public.daily_activity;
create policy "Users manage own daily activity" on public.daily_activity
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
`;
