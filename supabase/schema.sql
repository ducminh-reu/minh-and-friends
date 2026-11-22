-- RUSSIAN DICTATION Supabase PostgreSQL Schema & Strict Row Level Security (RLS)
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

-- Enable strict Row Level Security on all user tables
alter table public.learner_profiles enable row level security;
alter table public.lessons enable row level security;
alter table public.saved_lessons enable row level security;
alter table public.dictation_drafts enable row level security;
alter table public.dictation_attempts enable row level security;
alter table public.vocabulary enable row level security;
alter table public.vocabulary_review_logs enable row level security;
alter table public.daily_activity enable row level security;

-- Force RLS even for table owners where applicable and grant authenticated user privileges
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

-- Automated Daily News Learning Pipeline Tables (server service_role writes; read-only for clients)
create table if not exists public.news_articles (
  id text primary key,
  canonical_url text not null unique,
  headline_fingerprint text not null,
  title text not null,
  summary_snippet text not null default '',
  source_name text not null,
  source_language text not null,
  article_url text not null,
  published_at timestamptz not null,
  published_date_key text not null,
  topic text not null,
  fetched_at timestamptz not null default now()
);

create table if not exists public.news_lessons (
  id text primary key,
  article_id text not null references public.news_articles(id) on delete cascade,
  cefr_level text not null check (cefr_level in ('B1', 'B2', 'C1', 'C2')),
  format text not null check (format in ('summary', 'dialogue')),
  title_ru text not null,
  title_vi text not null,
  educational_summary_ru text,
  educational_summary_vi text,
  published_at timestamptz not null,
  source_name text not null,
  article_url text not null,
  full_audio_url text,
  audio_status text not null default 'pending',
  audio_error text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (article_id, cefr_level, format)
);

create table if not exists public.news_audio_segments (
  id text primary key,
  lesson_id text not null references public.news_lessons(id) on delete cascade,
  sentence_id text not null,
  sentence_order int not null,
  speaker text not null,
  transcript_ru text not null,
  translation_vi text not null,
  start_sec numeric not null,
  end_sec numeric not null,
  audio_url text,
  created_at timestamptz not null default now(),
  unique (lesson_id, sentence_order)
);

create table if not exists public.news_pipeline_runs (
  id text primary key,
  trigger_type text not null,
  run_date_key text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  stories_fetched int not null default 0,
  duplicates_removed int not null default 0,
  stories_selected int not null default 0,
  lessons_generated int not null default 0,
  audio_segments_saved int not null default 0,
  error_summary text
);

alter table public.news_articles enable row level security;
alter table public.news_lessons enable row level security;
alter table public.news_audio_segments enable row level security;
alter table public.news_pipeline_runs enable row level security;

grant select on public.news_articles to anon, authenticated;
grant select on public.news_lessons to anon, authenticated;
grant select on public.news_audio_segments to anon, authenticated;
grant select on public.news_pipeline_runs to anon, authenticated;

drop policy if exists "Public read news articles" on public.news_articles;
create policy "Public read news articles" on public.news_articles
  for select to anon, authenticated using (true);

drop policy if exists "Public read news lessons" on public.news_lessons;
create policy "Public read news lessons" on public.news_lessons
  for select to anon, authenticated using (true);

drop policy if exists "Public read news audio segments" on public.news_audio_segments;
create policy "Public read news audio segments" on public.news_audio_segments
  for select to anon, authenticated using (true);

drop policy if exists "Public read news pipeline runs" on public.news_pipeline_runs;
create policy "Public read news pipeline runs" on public.news_pipeline_runs
  for select to anon, authenticated using (true);

