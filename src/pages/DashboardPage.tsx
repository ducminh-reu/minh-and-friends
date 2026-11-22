import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Flame,
  Headphones,
  Mail,
  Newspaper,
  Sparkles,
} from 'lucide-react';
import { AuthModal } from '../components/AuthModal';
import { SyncStatusBadge } from '../components/SyncStatusBadge';
import { useAppState } from '../context/AppStateContext';
import { CEFR_DESCRIPTIONS, TOPIC_LABELS, t } from '../i18n/translations';

export const DashboardPage: React.FC = () => {
  const {
    profile,
    attempts,
    vocabulary,
    dailyActivity,
    adaptiveAssessment,
    recommendedLesson,
    authUser,
    signInWithGoogleCloud,
  } = useAppState();

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<'login' | 'signup' | 'reset'>('login');
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const lang = profile.interfaceLanguage;

  const handleGoogleLogin = async () => {
    setGoogleError(null);
    setGoogleLoading(true);
    try {
      await signInWithGoogleCloud();
    } catch (err) {
      setGoogleError(err instanceof Error ? err.message : 'Không thể đăng nhập bằng Google.');
      setGoogleLoading(false);
    }
  };

  // Requirement 2: Unauthenticated state - welcome screen without any mock data or fake stats
  if (!authUser) {
    return (
      <div className="max-w-4xl mx-auto py-10 px-4 space-y-8">
        <div className="bg-white border border-slate-200 rounded-3xl p-8 sm:p-14 text-center space-y-6 shadow-xs">
          <div className="w-18 h-18 mx-auto rounded-2xl bg-[#0F2342] text-white flex items-center justify-center text-2xl font-bold shadow-md">
            RU
          </div>
          <div className="space-y-3 max-w-xl mx-auto">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#0F2342]">
              Chào mừng đến với Russian Dictation
            </h1>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
              Đăng nhập hoặc tạo tài khoản để lưu tiến trình học tập, theo dõi trình độ tiếng Nga và đồng bộ dữ liệu trên nhiều thiết bị.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4 max-w-md mx-auto">
            <button
              type="button"
              disabled={googleLoading}
              onClick={() => void handleGoogleLogin()}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-6 py-3.5 min-h-[48px] rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 transition-colors shadow-2xs"
            >
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.19v3.15C3.17 21.36 7.24 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.19C.43 8.1 0 9.99 0 12s.43 3.9 1.19 5.42l4.09-3.15z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.24 0 3.17 2.64 1.19 6.58l4.09 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                />
              </svg>
              <span>Đăng nhập bằng Google</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setAuthModalTab('signup');
                setAuthModalOpen(true);
              }}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 min-h-[48px] rounded-xl bg-[#0F2342] text-white text-sm font-semibold hover:bg-[#163059] transition-colors shadow-sm"
            >
              <Mail className="w-4 h-4" aria-hidden="true" />
              <span>Đăng ký / Đăng nhập bằng Email</span>
            </button>
          </div>

          {googleError && (
            <div role="alert" className="text-xs text-red-600 font-medium">
              {googleError}
            </div>
          )}

          <div className="pt-6 border-t border-slate-100 flex flex-wrap items-center justify-center gap-6 text-xs text-slate-500">
            <span>· Bảo mật dữ liệu với Supabase RLS</span>
            <span>· Đồng bộ tự động trên nhiều thiết bị</span>
            <span>· Không mất tiến trình học tập</span>
          </div>
        </div>

        {/* Guest explore mode */}
        <div className="bg-[#F2F9F8] border border-[#1F7A6E]/30 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="space-y-1 text-center sm:text-left">
            <h2 className="text-sm font-bold text-[#165B52]">Khám phá chế độ khách</h2>
            <p className="text-xs text-slate-600">
              Bạn có thể xem trước thư viện bài học hoặc tin tức thời sự. Tiến trình chỉ được ghi nhận khi đăng nhập.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              to="/library"
              className="px-4 py-2.5 min-h-[44px] rounded-xl bg-white border border-[#1F7A6E]/40 text-xs font-semibold text-[#165B52] hover:bg-[#F7F9FC] transition-colors"
            >
              Xem Thư viện bài nghe
            </Link>
          </div>
        </div>

        <AuthModal
          isOpen={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          initialTab={authModalTab}
        />
      </div>
    );
  }

  // Logged-in Dashboard state
  const today = new Date().toISOString().slice(0, 10);
  const todayAttemptsCount = attempts.filter((a) => a.completedAt.startsWith(today)).length;
  const todayActivity = dailyActivity.find((d) => d.date === today);
  const todayMinutes = todayActivity?.minutes ?? 0;

  const goalPercent = Math.min(
    100,
    Math.round(
      ((todayAttemptsCount / Math.max(1, profile.dailyGoalLessons)) * 0.6 +
        (todayMinutes / Math.max(1, profile.dailyGoalMinutes)) * 0.4) *
        100,
    ),
  );

  const dueVocabCount = vocabulary.filter(
    (v) => new Date(v.nextReviewAt).getTime() <= Date.now(),
  ).length;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-medium text-slate-500">
              {authUser ? `Tài khoản: ${authUser.email}` : 'Đã kết nối Supabase'}
            </p>
            <Link to="/settings" className="inline-flex items-center">
              <SyncStatusBadge compact />
            </Link>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0F2342] mt-1">
            {lang === 'vi' ? `Xin chào, ${profile.displayName}` : `Welcome back, ${profile.displayName}`}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            {lang === 'vi'
              ? 'Chu trình luyện tập: Nghe → Chép chính tả → So sánh → Phân tích lỗi → Học từ vựng → Ôn tập.'
              : 'Core loop: Listen → Dictate → Compare → Analyze → Learn Vocabulary → Review.'}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {recommendedLesson && (
            <Link
              to={`/dictation/${recommendedLesson.id}`}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg bg-[#0F2342] text-white text-sm font-medium hover:bg-[#163059] transition-colors whitespace-nowrap"
            >
              <Headphones className="w-4 h-4" aria-hidden="true" />
              <span>{t(lang, 'startDictation')}</span>
            </Link>
          )}
        </div>
      </div>

      {/* Primary KPI Grid */}
      <section aria-label="Chỉ số học tập tổng quan" className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">{t(lang, 'estimatedCefr')}</div>
          <div className="mt-2 flex items-baseline gap-2.5">
            <span className="text-3xl font-bold text-[#0F2342] tabular-nums">
              {adaptiveAssessment.estimatedLevel}
            </span>
            <span className="text-xs text-slate-500">
              {profile.verifiedLevel
                ? `Chứng nhận: ${profile.verifiedLevel}`
                : t(lang, 'notVerifiedYet')}
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-2 leading-relaxed">
            {CEFR_DESCRIPTIONS[adaptiveAssessment.estimatedLevel][lang]}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">{t(lang, 'dailyStreak')}</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-[#0F2342] tabular-nums">
              {profile.streakDays}
            </span>
            <span className="text-sm text-slate-600">{t(lang, 'daysUnit')}</span>
            <Flame className="w-4 h-4 text-amber-600 ml-auto" aria-hidden="true" />
          </div>
          <p className="text-xs text-slate-600 mt-2">
            Lần luyện gần nhất: <span className="tabular-nums">{profile.lastPracticeDate || 'Chưa có'}</span>
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">{t(lang, 'lessonsCompleted')}</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-[#0F2342] tabular-nums">
              {attempts.length}
            </span>
            <span className="text-sm text-slate-600">bài chép</span>
            <CheckCircle2 className="w-4 h-4 text-[#1F7A6E] ml-auto" aria-hidden="true" />
          </div>
          <p className="text-xs text-slate-600 mt-2">
            Dựa trên <span className="tabular-nums">{adaptiveAssessment.sampleSize}</span> bài gần nhất để ước tính CEFR
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">{t(lang, 'listeningAccuracy')}</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-[#0F2342] tabular-nums">
              {adaptiveAssessment.listeningAverage}%
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-2">
            Độ khớp từ vựng: <span className="tabular-nums">{adaptiveAssessment.lexicalAverage}%</span>
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">{t(lang, 'spellingGrammarAccuracy')}</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-[#0F2342] tabular-nums">
              {adaptiveAssessment.spellingGrammarAverage}%
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-2">
            Tính tách biệt với lỗi dấu câu nhẹ
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">{t(lang, 'savedVocabulary')}</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-[#0F2342] tabular-nums">
              {vocabulary.length}
            </span>
            <span className="text-sm text-slate-600">từ & cụm</span>
          </div>
          <p className="text-xs text-slate-600 mt-1">
            <Link
              to="/review"
              className="inline-flex items-center min-h-[44px] text-[#1E4178] hover:underline font-medium"
            >
              <span>
                <span className="tabular-nums">{dueVocabCount}</span> từ cần ôn tập hôm nay
              </span>
            </Link>
          </p>
        </div>
      </section>

      {/* Main Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#0F2342]">
                {t(lang, 'dailyGoal')}
              </h2>
              <span className="text-sm font-semibold text-[#1F7A6E] tabular-nums">
                {goalPercent}%
              </span>
            </div>

            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden mt-3">
              <div
                className="h-full bg-[#1F7A6E] rounded-full transition-all"
                style={{ width: `${goalPercent}%` }}
              />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4 pt-4 border-t border-slate-100 text-sm">
              <div>
                <div className="text-xs text-slate-500">Số bài hôm nay</div>
                <div className="font-semibold text-[#0F2342] tabular-nums mt-0.5">
                  {todayAttemptsCount} / {profile.dailyGoalLessons} bài
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Thời gian luyện</div>
                <div className="font-semibold text-[#0F2342] tabular-nums mt-0.5">
                  {todayMinutes} / {profile.dailyGoalMinutes} phút
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-5 border-t border-slate-100">
            <div className="text-xs font-medium text-slate-500">
              Đánh giá thích ứng
            </div>
            <div className="text-sm font-semibold text-[#0F2342] mt-1">
              {adaptiveAssessment.actionLabelVi}
            </div>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              {adaptiveAssessment.actionDescriptionVi}
            </p>
          </div>
        </section>

        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
          {recommendedLesson ? (
            <>
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-semibold text-[#1F7A6E]">
                    {t(lang, 'recommendedLesson')}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>CEFR {recommendedLesson.level}</span>
                  <span aria-hidden="true">·</span>
                  <span>{TOPIC_LABELS[recommendedLesson.topic][lang]}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {Math.round(recommendedLesson.durationSec / 60)} phút ({recommendedLesson.sentences.length} câu)
                  </span>
                </div>

                <h2 className="text-xl font-bold text-[#0F2342] mt-2 cyrillic-prose">
                  {recommendedLesson.titleRu}
                </h2>
                <p className="text-sm font-medium text-slate-700 mt-0.5">
                  {recommendedLesson.titleVi}
                </p>
                <p className="text-sm text-slate-600 mt-3 leading-relaxed">
                  {recommendedLesson.descriptionVi}
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-500">
                  {recommendedLesson.speakers.map((s) => s.name).join(' & ')} ·{' '}
                  {recommendedLesson.vocabulary.length} từ vựng trọng tâm
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <Link
                    to="/library"
                    className="inline-flex items-center justify-center px-3.5 py-2 min-h-[44px] rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
                  >
                    Xem tất cả bài
                  </Link>
                  <Link
                    to={`/dictation/${recommendedLesson.id}`}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] rounded-lg bg-[#0F2342] text-white text-sm font-medium hover:bg-[#163059] transition-colors whitespace-nowrap"
                  >
                    <span>Vào phòng luyện chép</span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-500">Chưa có bài học được đề xuất.</div>
          )}
        </section>
      </div>

      {/* Recent History */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[#0F2342]">
            {t(lang, 'recentHistory')}
          </h2>
          <Link
            to="/progress"
            className="inline-flex items-center min-h-[44px] px-1 text-xs font-medium text-[#1E4178] hover:underline whitespace-nowrap"
          >
            Xem phân tích chi tiết
          </Link>
        </div>

        {attempts.length === 0 ? (
          <div className="py-10 text-center space-y-3">
            <p className="text-sm font-medium text-slate-700">
              Bạn chưa có bài luyện tập nào. Hãy bắt đầu bài chép chính tả đầu tiên!
            </p>
            <Link
              to="/library"
              className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-[#0F2342] text-white text-xs font-semibold hover:bg-[#163059] transition-colors"
            >
              <span>Khám phá Thư viện bài nghe</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {attempts.slice(0, 5).map((attempt) => (
              <div
                key={attempt.id}
                className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-semibold text-[#0F2342]">
                      CEFR {attempt.lessonLevel}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {attempt.mode === 'sentence' ? 'Chế độ từng câu' : 'Chế độ toàn bài'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {new Date(attempt.completedAt).toLocaleDateString('vi-VN')}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-[#0F2342] mt-0.5 truncate">
                    {attempt.lessonTitleVi}
                  </div>
                  <div className="text-xs text-slate-500 cyrillic-prose truncate">
                    {attempt.lessonTitleRu}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between sm:justify-end gap-4 shrink-0 text-xs">
                  <div className="flex items-center gap-4">
                    <div className="sm:text-right">
                      <div className="text-slate-500">Nghe</div>
                      <div className="font-semibold text-[#0F2342] tabular-nums">
                        {attempt.listeningAccuracy !== null ? `${attempt.listeningAccuracy}%` : '—'}
                      </div>
                    </div>
                    <div className="sm:text-right">
                      <div className="text-slate-500">Chính tả & NP</div>
                      <div className="font-semibold text-[#1F7A6E] tabular-nums">
                        {attempt.spellingGrammarAccuracy !== null
                          ? `${attempt.spellingGrammarAccuracy}%`
                          : '—'}
                      </div>
                    </div>
                  </div>
                  <Link
                    to={`/dictation/${attempt.lessonId}`}
                    className="inline-flex items-center justify-center px-3.5 py-2 min-h-[44px] rounded-lg border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 whitespace-nowrap"
                  >
                    Luyện lại
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Secondary Action Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          to="/news"
          className="bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 transition-colors flex items-center justify-between gap-4"
        >
          <div>
            <div className="text-sm font-semibold text-[#0F2342]">
              Tin tức hằng ngày – Новости дня
            </div>
            <div className="text-xs text-slate-600 mt-1">
              Luyện nghe chép thời sự kinh tế, chính trị & công nghệ từ RSS xác thực.
            </div>
          </div>
          <Newspaper className="w-5 h-5 text-[#0F2342] shrink-0" aria-hidden="true" />
        </Link>

        <Link
          to="/ai-lessons"
          className="bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 transition-colors flex items-center justify-between gap-4"
        >
          <div>
            <div className="text-sm font-semibold text-[#0F2342]">
              Tạo bài hội thoại AI theo trình độ
            </div>
            <div className="text-xs text-slate-600 mt-1">
              Tùy chỉnh chủ đề, ngữ pháp trọng tâm và kiểm tra chất lượng CEFR.
            </div>
          </div>
          <Sparkles className="w-5 h-5 text-[#1E4178] shrink-0" aria-hidden="true" />
        </Link>

        <Link
          to="/review"
          className="bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 transition-colors flex items-center justify-between gap-4"
        >
          <div>
            <div className="text-sm font-semibold text-[#0F2342]">
              Ôn tập từ vựng theo lịch lặp lại ngắt quãng
            </div>
            <div className="text-xs text-slate-600 mt-1">
              Hiện có <span className="tabular-nums font-medium">{dueVocabCount}</span> từ đến hạn với 6 định dạng bài tập.
            </div>
          </div>
          <BookOpen className="w-5 h-5 text-[#1F7A6E] shrink-0" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
};
