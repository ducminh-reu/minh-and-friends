import type {
  CefrLevel,
  DictationErrorCategory,
  InterfaceLanguage,
  NewsTopicCategory,
  ReviewFormat,
  ReviewStatus,
  TopicCategory,
} from '../types/domain';

export const TOPIC_LABELS: Record<TopicCategory, { vi: string; en: string; ru: string }> = {
  everyday: { vi: 'Đời sống hằng ngày', en: 'Everyday Life', ru: 'Повседневная жизнь' },
  work: { vi: 'Công việc & Sự nghiệp', en: 'Work & Career', ru: 'Работа и карьера' },
  education: { vi: 'Giáo dục & Học tập', en: 'Education', ru: 'Образование' },
  psychology: { vi: 'Tâm lý học', en: 'Psychology', ru: 'Психология' },
  economics: { vi: 'Kinh tế học', en: 'Economics', ru: 'Экономика' },
  society: { vi: 'Xã hội & Văn hoá', en: 'Society & Culture', ru: 'Общество и культура' },
  politics: { vi: 'Chính trị & Quan hệ quốc tế', en: 'Politics & IR', ru: 'Политика и международные отношения' },
  science: { vi: 'Khoa học & Công nghệ', en: 'Science & Tech', ru: 'Наука и технологии' },
  environment: { vi: 'Môi trường & Khí hậu', en: 'Environment', ru: 'Экология' },
  relationships: { vi: 'Các mối quan hệ', en: 'Relationships', ru: 'Отношения' },
};

export const NEWS_TOPIC_LABELS: Record<NewsTopicCategory, { vi: string; en: string; ru: string }> = {
  world_economy: { vi: 'Kinh tế thế giới', en: 'World economy', ru: 'Мировая экономика' },
  international_politics: { vi: 'Chính trị quốc tế', en: 'International politics', ru: 'Международная политика' },
  european_economy_politics: { vi: 'Kinh tế & Chính trị châu Âu', en: 'European economy & politics', ru: 'Экономика и политика Европы' },
  business_finance: { vi: 'Kinh doanh & Tài chính', en: 'Business & finance', ru: 'Бизнес и финансы' },
  technology: { vi: 'Công nghệ', en: 'Technology', ru: 'Технологии' },
  geopolitics: { vi: 'Địa chính trị', en: 'Geopolitics', ru: 'Геополитика' },
  energy_environment: { vi: 'Năng lượng & Môi trường', en: 'Energy & environment', ru: 'Энергетика и экология' },
};

export const ERROR_CATEGORY_LABELS: Record<
  DictationErrorCategory,
  { vi: string; en: string; ru: string; severity: 'major' | 'moderate' | 'minor' }
> = {
  listening: {
    vi: 'Lỗi nghe nhầm âm',
    en: 'Listening mishearing',
    ru: 'Фонетическая ошибка восприятия',
    severity: 'major',
  },
  missing: {
    vi: 'Thiếu từ',
    en: 'Missing word',
    ru: 'Пропуск слова',
    severity: 'major',
  },
  extra: {
    vi: 'Thừa từ',
    en: 'Extra word',
    ru: 'Лишнее слово',
    severity: 'moderate',
  },
  word_form: {
    vi: 'Sai dạng từ',
    en: 'Incorrect word form',
    ru: 'Неверная словоформа',
    severity: 'moderate',
  },
  spelling: {
    vi: 'Lỗi chính tả',
    en: 'Spelling error',
    ru: 'Орфографическая ошибка',
    severity: 'moderate',
  },
  grammar: {
    vi: 'Lỗi ngữ pháp',
    en: 'Grammar error',
    ru: 'Грамматическая ошибка',
    severity: 'moderate',
  },
  case: {
    vi: 'Lỗi cách (Падеж)',
    en: 'Case error',
    ru: 'Падежная ошибка',
    severity: 'moderate',
  },
  gender_number: {
    vi: 'Hợp giống & số',
    en: 'Gender & number agreement',
    ru: 'Согласование в роде и числе',
    severity: 'moderate',
  },
  aspect: {
    vi: 'Lỗi thể động từ (СВ/НСВ)',
    en: 'Verb aspect error',
    ru: 'Ошибка вида глагола (СВ/НСВ)',
    severity: 'moderate',
  },
  punctuation: {
    vi: 'Lỗi dấu câu',
    en: 'Punctuation difference',
    ru: 'Пунктуационная неточность',
    severity: 'minor',
  },
};

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, { vi: string; en: string }> = {
  new: { vi: 'Từ mới', en: 'New' },
  learning: { vi: 'Đang học', en: 'Learning' },
  reviewing: { vi: 'Đang ôn tập', en: 'Reviewing' },
  mastered: { vi: 'Đã thành thạo', en: 'Mastered' },
};

export const REVIEW_FORMAT_LABELS: Record<ReviewFormat, { vi: string; en: string }> = {
  ru_to_vi: { vi: 'Nga → Việt', en: 'Russian → Vietnamese' },
  vi_to_ru: { vi: 'Việt → Nga', en: 'Vietnamese → Russian' },
  fill_blank: { vi: 'Điền vào chỗ trống', en: 'Fill in the blank' },
  choose_word: { vi: 'Chọn từ đúng', en: 'Choose the right word' },
  complete_sentence: { vi: 'Hoàn thành câu', en: 'Complete the sentence' },
  listen_identify: { vi: 'Nghe & nhận diện', en: 'Listen & identify' },
};

export const CEFR_DESCRIPTIONS: Record<CefrLevel, { vi: string; en: string }> = {
  B1: { vi: 'Trung cấp · Giao tiếp tự nhiên chủ đề quen thuộc', en: 'Intermediate · Familiar topics & clear speech' },
  B2: { vi: 'Trung cao cấp · Hội thoại tốc độ tự nhiên & lập luận', en: 'Upper Intermediate · Natural pace & argumentation' },
  C1: { vi: 'Cao cấp · Diễn ngôn học thuật, chuyên ngành & sắc thái', en: 'Advanced · Academic, nuanced & idiomatic Russian' },
  C2: { vi: 'Thành thạo · Ngôn ngữ tinh tế, tốc độ bản ngữ đầy đủ', en: 'Proficiency · Native subtlety & complex discourse' },
};

const DICTIONARY = {
  vi: {
    brandName: 'RUSSIAN DICTATION',
    brandTagline: 'Nghe · Viết · Hiểu · Làm chủ',
    navDashboard: 'Tổng quan',
    navLibrary: 'Thư viện bài nghe',
    navDailyNews: 'Tin tức · Новости',
    navAiLessons: 'Bài học AI',
    navVocabulary: 'Sổ tay từ vựng',
    navReview: 'Ôn tập SRS',
    navProgress: 'Tiến độ',
    navSettings: 'Cài đặt',
    navMore: 'Thêm',
    estimatedCefr: 'Trình độ CEFR ước tính',
    verifiedCefr: 'Chứng nhận chính thức',
    notVerifiedYet: 'Chưa kiểm định chính thức',
    dailyStreak: 'Chuỗi ngày học',
    daysUnit: 'ngày',
    lessonsCompleted: 'Bài đã hoàn thành',
    listeningAccuracy: 'Độ chính xác nghe',
    spellingGrammarAccuracy: 'Chính tả & Ngữ pháp',
    savedVocabulary: 'Từ vựng đã lưu',
    dailyGoal: 'Mục tiêu hôm nay',
    recommendedLesson: 'Bài học đề xuất tiếp theo',
    recentHistory: 'Lịch sử luyện tập gần đây',
    startDictation: 'Bắt đầu chép chính tả',
    continuePractice: 'Tiếp tục luyện tập',
    curatedBadge: 'Biên tập chuẩn',
    aiBadge: 'Tạo bởi AI',
    sentenceMode: 'Từng câu',
    fullMode: 'Toàn bài',
    submitAndAnalyze: 'Nộp bài & Phân tích lỗi',
    saveDraftAuto: 'Tự động lưu bản nháp',
    transcriptHiddenNotice: 'Văn bản gốc đang được ẩn trong chế độ chép chính tả để đảm bảo hiệu quả luyện nghe.',
    allLevels: 'Tất cả trình độ',
    allTopics: 'Tất cả chủ đề',
    searchPlaceholder: 'Tìm theo tiêu đề tiếng Việt, tiếng Nga hoặc từ khóa...',
    noResults: 'Không tìm thấy nội dung phù hợp.',
    demoModeNotice: 'Chế độ Demo cục bộ',
  },
  en: {
    brandName: 'RUSSIAN DICTATION',
    brandTagline: 'Listen · Write · Understand · Master',
    navDashboard: 'Dashboard',
    navLibrary: 'Dictation Library',
    navDailyNews: 'Daily News · Новости',
    navAiLessons: 'AI Lessons',
    navVocabulary: 'Vocabulary',
    navReview: 'Review SRS',
    navProgress: 'Progress',
    navSettings: 'Settings',
    navMore: 'More',
    estimatedCefr: 'Estimated CEFR Level',
    verifiedCefr: 'Verified Proficiency',
    notVerifiedYet: 'Not officially verified',
    dailyStreak: 'Daily Streak',
    daysUnit: 'days',
    lessonsCompleted: 'Lessons Completed',
    listeningAccuracy: 'Listening Accuracy',
    spellingGrammarAccuracy: 'Spelling & Grammar',
    savedVocabulary: 'Saved Vocabulary',
    dailyGoal: 'Daily Learning Goal',
    recommendedLesson: 'Recommended Next Lesson',
    recentHistory: 'Recent Learning History',
    startDictation: 'Start Dictation',
    continuePractice: 'Continue Practice',
    curatedBadge: 'Curated',
    aiBadge: 'AI Generated',
    sentenceMode: 'Sentence by Sentence',
    fullMode: 'Full Dialogue',
    submitAndAnalyze: 'Submit & Analyze',
    saveDraftAuto: 'Draft saved automatically',
    transcriptHiddenNotice: 'Reference transcript is hidden during dictation mode to train active listening.',
    allLevels: 'All Levels',
    allTopics: 'All Topics',
    searchPlaceholder: 'Search by Vietnamese/Russian title or keyword...',
    noResults: 'No matching entries found.',
    demoModeNotice: 'Local Demo Mode',
  },
} as const;

export type TranslationKey = keyof typeof DICTIONARY.vi;

export function t(lang: InterfaceLanguage, key: TranslationKey): string {
  return DICTIONARY[lang][key] ?? DICTIONARY.vi[key];
}
