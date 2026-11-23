export type CefrLevel = 'B1' | 'B2' | 'C1' | 'C2';

export type TopicCategory =
  | 'everyday'
  | 'work'
  | 'education'
  | 'psychology'
  | 'economics'
  | 'society'
  | 'politics'
  | 'science'
  | 'environment'
  | 'relationships';

export type InterfaceLanguage = 'vi' | 'en';

export type DictationMode = 'sentence' | 'full';

export type PlaybackSpeed = 0.75 | 0.85 | 1 | 1.15;

export type TtsProviderId = 'gemini-tts';

export type TtsModelId = 'gemini-3.8-flash-lite-tts' | 'gemini-3.8-flash-tts';

export type GeminiVoiceId =
  | 'Sulafat'
  | 'Despina'
  | 'Leda'
  | 'Gacrux'
  | 'Kore'
  | 'Zephyr'
  | 'Achird'
  | 'Charon'
  | 'Algieba'
  | 'Sadaltager'
  | 'Puck'
  | 'Fenrir';

export type VoiceAgeStyle = 'young' | 'mature';

export type VoiceSpeakingStyle = 'conversational' | 'narration' | 'educational';

export interface VoiceConfigProfile {
  voiceId: GeminiVoiceId;
  provider: TtsProviderId;
  model: TtsModelId;
  language: 'Russian';
  locale: 'ru-RU';
  gender: 'male' | 'female';
  ageStyle: VoiceAgeStyle;
  speakingStyle: VoiceSpeakingStyle;
  speakingRate: number;
  pitch: number | null;
  emotion: string;
  labelVi: string;
  labelEn: string;
  styleDirective: string;
}

export interface SpeakerProfile {
  name: string;
  roleVi: string;
  roleEn: string;
  voiceName: GeminiVoiceId;
  gender: 'male' | 'female';
  ageStyle?: VoiceAgeStyle;
  speakingStyle?: VoiceSpeakingStyle;
  speakingRate?: number;
  emotion?: string;
}

export interface DialogueSentence {
  id: string;
  order: number;
  speaker: string;
  text: string;
  translationVi: string;
  startSec: number;
  endSec: number;
  grammarFocus?: string;
  audioUrl?: string | null;
}

export interface LessonVocabulary {
  id: string;
  word: string;
  stressedWord: string;
  partOfSpeech: string;
  forms: string;
  meaningVi: string;
  definitionRu: string;
  exampleRu: string;
  exampleVi: string;
}

export interface GrammarNote {
  id: string;
  titleVi: string;
  titleRu: string;
  explanationVi: string;
  explanationRu: string;
  examples: {
    ru: string;
    vi: string;
  }[];
}

export interface ComprehensionQuestion {
  id: string;
  questionRu: string;
  questionVi: string;
  options: string[];
  correctIndex: number;
  explanationVi: string;
}

export interface LessonQualityChecks {
  grammar: boolean;
  naturalness: boolean;
  cefrMatch: boolean;
  vocabAppropriate: boolean;
  transcriptConsistent: boolean;
}

export type NewsTopicCategory =
  | 'world_economy'
  | 'international_politics'
  | 'european_economy_politics'
  | 'business_finance'
  | 'technology'
  | 'geopolitics'
  | 'energy_environment';

export type NewsFormat = 'summary' | 'dialogue';

export interface NewsArticle {
  id: string;
  title: string;
  summarySnippet: string;
  sourceName: string;
  sourceLanguage: 'ru' | 'en';
  articleUrl: string;
  publishedAt: string;
  publishedDateKey: string;
  topic: NewsTopicCategory;
}

export interface LessonNewsMetadata {
  articleId: string;
  sourceName: string;
  articleUrl: string;
  publishedAt: string;
  originalTitle: string;
  verifiedFactsSummaryVi: string;
  verifiedFactsRu: string[];
  educationalSummaryRu?: string;
  educationalSummaryVi?: string;
  newsTopic: NewsTopicCategory;
  format: NewsFormat;
  aiDisclaimerVi: string;
  fullAudioUrl?: string | null;
  audioStatus?: 'ready' | 'partial' | 'pending' | 'failed';
  audioError?: string | null;
  audioErrorCategory?: string | null;
  audioConfigHash?: string | null;
  audioQueueState?: 'idle' | 'queued' | 'processing' | 'completed' | 'failed';
  audioSegmentsCount?: number;
  pipelineDateKey?: string;
}

export interface TtsQueueJobSummary {
  jobId: string;
  lessonId: string | null;
  cefrLevel: CefrLevel | null;
  model: string;
  requestType: 'tts_single' | 'tts_dialogue';
  status: 'queued' | 'processing' | 'completed' | 'failed';
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  queueWaitMs: number;
  processingDurationMs: number;
  retryCount: number;
  reusedFromCache: boolean;
  errorCategory: string;
  errorMessage: string | null;
}

export interface TtsQueueStatusSummary {
  maxConcurrency: number;
  activeCount: number;
  queuedCount: number;
  cooldownUntil: string | null;
  dailyQuotaExhausted: boolean;
  dailyQuotaExhaustedModel: string | null;
  dailyQuotaResetHint: string | null;
  activeJobs: TtsQueueJobSummary[];
  queuedJobs: TtsQueueJobSummary[];
  recentJobs: TtsQueueJobSummary[];
}

export interface GeminiMonitoringEventSummary {
  id: string;
  requestType: 'text' | 'tts_single' | 'tts_dialogue';
  model: string;
  timestamp: string;
  lessonId: string | null;
  cefrLevel: CefrLevel | null;
  httpStatus: number | null;
  errorCategory: string;
  retryCount: number;
  queueWaitMs: number;
  processingDurationMs: number;
  reusedFromCache: boolean;
  outcome: 'completed' | 'failed';
  retryAfterMs: number | null;
  quotaId: string | null;
}

export interface NewsPipelineRunSummary {
  id: string;
  triggerType: 'scheduled' | 'manual' | 'startup';
  runDateKey: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'completed' | 'partial' | 'failed';
  storiesFetched: number;
  duplicatesRemoved: number;
  storiesSelected: number;
  lessonsGenerated: number;
  audioSegmentsSaved: number;
  errorSummary: string | null;
}

export interface NewsPipelineErrorItem {
  id: string;
  runId: string | null;
  stage: string;
  targetRef: string | null;
  errorMessage: string;
  retryCount: number;
  createdAt: string;
}

export interface NewsPipelineStatusResponse {
  schedulerActive: boolean;
  running: boolean;
  intervalHours: number;
  lastRun: NewsPipelineRunSummary | null;
  nextScheduledRunAt: string;
  totalDbArticles: number;
  totalDbLessons: number;
  totalAudioSegments: number;
  recentRuns: NewsPipelineRunSummary[];
  recentErrors: NewsPipelineErrorItem[];
  ttsQueue?: TtsQueueStatusSummary;
  recentMonitoring?: GeminiMonitoringEventSummary[];
}

export interface Lesson {
  id: string;
  titleRu: string;
  titleVi: string;
  descriptionVi: string;
  level: CefrLevel;
  topic: TopicCategory;
  durationSec: number;
  speakers: SpeakerProfile[];
  source: 'curated' | 'ai_generated';
  verified: boolean;
  createdAt: string;
  levelJustificationVi?: string;
  qualityChecks?: LessonQualityChecks;
  newsMetadata?: LessonNewsMetadata;
  sentences: DialogueSentence[];
  vocabulary: LessonVocabulary[];
  grammarNotes: GrammarNote[];
  comprehensionQuestions: ComprehensionQuestion[];
}

export type DictationErrorCategory =
  | 'listening'
  | 'missing'
  | 'extra'
  | 'word_form'
  | 'spelling'
  | 'grammar'
  | 'case'
  | 'gender_number'
  | 'aspect'
  | 'punctuation';

export interface DiffToken {
  type: 'match' | 'missing' | 'extra' | 'substitute';
  referenceWord?: string;
  learnerWord?: string;
  category?: DictationErrorCategory;
}

export interface DictationErrorItem {
  id: string;
  sentenceId: string;
  sentenceOrder: number;
  category: DictationErrorCategory;
  severity: 'major' | 'moderate' | 'minor';
  referenceSnippet: string;
  learnerSnippet: string;
  correctedSnippet: string;
  explanationVi: string;
  explanationRu: string;
}

export interface SentenceComparisonResult {
  sentenceId: string;
  order: number;
  speaker: string;
  referenceText: string;
  learnerText: string;
  correctedText: string;
  tokens: DiffToken[];
  errors: DictationErrorItem[];
  listeningAccuracy: number | null;
  lexicalAccuracy: number | null;
  spellingGrammarAccuracy: number | null;
  punctuationAccuracy: number | null;
  yoNormalizedNotes: number;
}

export interface DictationAnalysisReport {
  lessonId: string;
  mode: DictationMode;
  referenceAvailable: boolean;
  listeningAccuracy: number | null;
  lexicalAccuracy: number | null;
  spellingGrammarAccuracy: number | null;
  punctuationAccuracy: number | null;
  totalReferenceWords: number;
  matchedWords: number;
  sentences: SentenceComparisonResult[];
  errors: DictationErrorItem[];
  errorCountsByCategory: Record<DictationErrorCategory, number>;
  recommendationsVi: string[];
}

export interface DictationAttempt {
  id: string;
  lessonId: string;
  lessonTitleVi: string;
  lessonTitleRu: string;
  lessonLevel: CefrLevel;
  lessonSource: 'curated' | 'ai_generated';
  mode: DictationMode;
  completedAt: string;
  durationSec: number;
  listeningAccuracy: number | null;
  lexicalAccuracy: number | null;
  spellingGrammarAccuracy: number | null;
  punctuationAccuracy: number | null;
  errorCounts: Record<DictationErrorCategory, number>;
  sentenceInputs: Record<string, string>;
  fullInput?: string;
}

export type ReviewStatus = 'new' | 'learning' | 'reviewing' | 'mastered';

export type ReviewFormat =
  | 'ru_to_vi'
  | 'vi_to_ru'
  | 'fill_blank'
  | 'choose_word'
  | 'complete_sentence'
  | 'listen_identify';

export interface VocabularyRecord {
  id: string;
  word: string;
  stressedWord: string;
  partOfSpeech: string;
  forms: string;
  meaningVi: string;
  definitionRu: string;
  exampleRu: string;
  exampleVi: string;
  sourceLessonId: string;
  sourceLessonTitle: string;
  notes: string;
  status: ReviewStatus;
  createdAt: string;
  lastReviewedAt: string | null;
  nextReviewAt: string;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  correctCount: number;
  incorrectCount: number;
  lapses: number;
}

export interface VocabularyReviewLog {
  id: string;
  vocabularyId: string;
  format: ReviewFormat;
  correct: boolean;
  quality: 0 | 3 | 4 | 5;
  reviewedAt: string;
}

export interface CefrHistoryEntry {
  date: string;
  estimatedLevel: CefrLevel;
  compositeScore: number;
  noteVi: string;
}

export interface DailyActivityPoint {
  date: string;
  minutes: number;
  sentencesCompleted: number;
  dictationAccuracy: number | null;
}

export interface LearnerProfile {
  displayName: string;
  estimatedLevel: CefrLevel;
  verifiedLevel: CefrLevel | null;
  dailyGoalLessons: number;
  dailyGoalMinutes: number;
  streakDays: number;
  lastPracticeDate: string;
  interfaceLanguage: InterfaceLanguage;
  preferredMode: DictationMode;
  preferredSpeed: PlaybackSpeed;
  ttsPreference: 'auto' | 'browser';
  cefrHistory: CefrHistoryEntry[];
}

export interface AdaptiveAssessment {
  estimatedLevel: CefrLevel;
  verifiedLevel: CefrLevel | null;
  compositeScore: number;
  listeningAverage: number;
  lexicalAverage: number;
  spellingGrammarAverage: number;
  retentionAverage: number;
  action: 'reinforce' | 'continue' | 'advance_gradually' | 'test_higher';
  actionLabelVi: string;
  actionDescriptionVi: string;
  nextTargetLevel: CefrLevel;
  sampleSize: number;
  weakCategories: { category: DictationErrorCategory; count: number }[];
}
