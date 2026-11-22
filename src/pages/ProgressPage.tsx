import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import { ERROR_CATEGORY_LABELS, t } from '../i18n/translations';
import { getRetentionRate } from '../utils/spacedRepetition';

export const ProgressPage: React.FC = () => {
  const { profile, attempts, vocabulary, dailyActivity, adaptiveAssessment } =
    useAppState();
  const lang = profile.interfaceLanguage;
  const [period, setPeriod] = useState<'week' | 'month'>('week');

  const activitySlice = useMemo(
    () => dailyActivity.slice(period === 'week' ? -7 : -30),
    [dailyActivity, period],
  );

  const maxMinutes = Math.max(25, ...activitySlice.map((d) => d.minutes));

  const accuracyPoints = useMemo(
    () =>
      [...attempts]
        .filter((a) => a.listeningAccuracy !== null)
        .slice(0, 10)
        .reverse(),
    [attempts],
  );

  const avgRetention = useMemo(() => {
    const reviewed = vocabulary.filter((v) => v.correctCount + v.incorrectCount > 0);
    if (reviewed.length === 0) return 0;
    return Math.round(
      reviewed.reduce((sum, v) => sum + getRetentionRate(v), 0) / reviewed.length,
    );
  }, [vocabulary]);

  const masteredCount = vocabulary.filter((v) => v.status === 'mastered').length;

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F2342]">
            {t(lang, 'navProgress')}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Theo dõi xu hướng độ chính xác nghe, chính tả, ngữ pháp, lưu trữ từ vựng và lộ trình CEFR ước tính.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setPeriod('week')}
            className={`px-3 py-2 min-h-[44px] text-xs font-semibold rounded-md transition-colors ${
              period === 'week' ? 'bg-white text-[#0F2342] shadow-sm' : 'text-slate-600'
            }`}
          >
            7 ngày gần nhất
          </button>
          <button
            type="button"
            onClick={() => setPeriod('month')}
            className={`px-3 py-2 min-h-[44px] text-xs font-semibold rounded-md transition-colors ${
              period === 'month' ? 'bg-white text-[#0F2342] shadow-sm' : 'text-slate-600'
            }`}
          >
            30 ngày
          </button>
        </div>
      </div>

      {/* Performance Comparison Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Nghe hiểu trung bình</div>
          <div className="text-2xl font-bold text-[#0F2342] tabular-nums mt-1">
            {adaptiveAssessment.listeningAverage}%
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Chính tả & Ngữ pháp</div>
          <div className="text-2xl font-bold text-[#1F7A6E] tabular-nums mt-1">
            {adaptiveAssessment.spellingGrammarAverage}%
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Từ vựng đã thuộc / Tổng</div>
          <div className="text-2xl font-bold text-[#0F2342] tabular-nums mt-1">
            {masteredCount} / {vocabulary.length}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Tỷ lệ nhớ từ vựng SRS</div>
          <div className="text-2xl font-bold text-[#0F2342] tabular-nums mt-1">
            {avgRetention}%
          </div>
        </div>
      </section>

      {/* Activity Chart & Accuracy Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-[#0F2342]">
              Thời gian luyện tập ({period === 'week' ? '7 ngày' : '30 ngày'})
            </h2>
            <span className="text-xs text-slate-500 tabular-nums">
              Chuỗi: {profile.streakDays} ngày
            </span>
          </div>

          <div className="h-44 flex items-end gap-1.5 sm:gap-2 pt-4">
            {activitySlice.map((pt) => {
              const heightPct = Math.max(6, Math.round((pt.minutes / maxMinutes) * 100));
              return (
                <div key={pt.date} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                  <span className="text-[10px] text-slate-500 tabular-nums">
                    {pt.minutes}p
                  </span>
                  <div className="w-full bg-slate-100 rounded-t h-28 flex items-end overflow-hidden">
                    <div
                      className="w-full bg-[#0F2342] rounded-t transition-all"
                      style={{ height: `${heightPct}%` }}
                      title={`${pt.date}: ${pt.minutes} phút, ${pt.sentencesCompleted} câu`}
                    />
                  </div>
                  <span className="text-[10px] text-slate-500 tabular-nums truncate max-w-full">
                    {pt.date.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Dictation Accuracy Trend SVG */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#0F2342]">
              Xu hướng Nghe vs Chính tả/Ngữ pháp
            </h2>
            <span className="text-xs text-slate-500 tabular-nums">
              {accuracyPoints.length} bài gần nhất
            </span>
          </div>

          {accuracyPoints.length === 0 ? (
            <div className="h-44 flex items-center justify-center text-sm text-slate-500">
              Hoàn thành bài nghe chép đầu tiên để xem biểu đồ xu hướng.
            </div>
          ) : (
            <div className="space-y-3">
              <svg viewBox="0 0 360 130" className="w-full h-36 overflow-visible" role="img" aria-label="Biểu đồ xu hướng độ chính xác">
                {[25, 50, 75, 100].map((v) => {
                  const y = 110 - (v / 100) * 95;
                  return (
                    <g key={v}>
                      <line x1="28" y1={y} x2="350" y2={y} stroke="#E2E8F0" strokeDasharray="3 3" />
                      <text x="0" y={y + 3} fontSize="9" fill="#64748B">
                        {v}%
                      </text>
                    </g>
                  );
                })}
                {accuracyPoints.length > 1 && (
                  <>
                    <polyline
                      fill="none"
                      stroke="#0F2342"
                      strokeWidth="2.2"
                      points={accuracyPoints
                        .map((a, idx) => {
                          const x = 35 + (idx / (accuracyPoints.length - 1)) * 305;
                          const y = 110 - ((a.listeningAccuracy ?? 0) / 100) * 95;
                          return `${x},${y}`;
                        })
                        .join(' ')}
                    />
                    <polyline
                      fill="none"
                      stroke="#1F7A6E"
                      strokeWidth="2.2"
                      points={accuracyPoints
                        .map((a, idx) => {
                          const x = 35 + (idx / (accuracyPoints.length - 1)) * 305;
                          const y = 110 - ((a.spellingGrammarAccuracy ?? 0) / 100) * 95;
                          return `${x},${y}`;
                        })
                        .join(' ')}
                    />
                  </>
                )}
                {accuracyPoints.map((a, idx) => {
                  const x =
                    accuracyPoints.length === 1
                      ? 180
                      : 35 + (idx / (accuracyPoints.length - 1)) * 305;
                  const yL = 110 - ((a.listeningAccuracy ?? 0) / 100) * 95;
                  const yG = 110 - ((a.spellingGrammarAccuracy ?? 0) / 100) * 95;
                  return (
                    <g key={a.id}>
                      <circle cx={x} cy={yL} r="3.5" fill="#0F2342" />
                      <circle cx={x} cy={yG} r="3.5" fill="#1F7A6E" />
                    </g>
                  );
                })}
              </svg>
              <div className="flex items-center gap-5 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-[#0F2342] inline-block" /> Nghe hiểu
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-[#1F7A6E] inline-block" /> Chính tả & Ngữ pháp
                </span>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Weak Grammar Categories & CEFR History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#0F2342]">
              Nhóm lỗi cần ưu tiên cải thiện
            </h2>
            <Link
              to="/library"
              className="inline-flex items-center min-h-[44px] px-1 text-xs font-medium text-[#1E4178] hover:underline"
            >
              Luyện thêm
            </Link>
          </div>

          {adaptiveAssessment.weakCategories.length === 0 ? (
            <p className="text-sm text-slate-500">
              Chưa có đủ dữ liệu lỗi để tổng hợp điểm yếu ngữ pháp.
            </p>
          ) : (
            <div className="space-y-3">
              {adaptiveAssessment.weakCategories.map((item) => {
                const maxErr = Math.max(1, adaptiveAssessment.weakCategories[0].count);
                const widthPct = Math.round((item.count / maxErr) * 100);
                return (
                  <div key={item.category} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-[#0F2342]">
                        {ERROR_CATEGORY_LABELS[item.category].vi}
                      </span>
                      <span className="text-slate-600 tabular-nums">{item.count} lỗi</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#1E4178] rounded-full"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#0F2342]">
              Lịch sử ước tính trình độ CEFR
            </h2>
            <span className="text-xs text-slate-500">
              {profile.verifiedLevel ? `Chứng nhận: ${profile.verifiedLevel}` : 'Ước tính nội bộ'}
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {profile.cefrHistory.map((entry, idx) => (
              <div key={idx} className="py-3 flex items-start justify-between gap-3 text-xs">
                <div>
                  <div className="font-semibold text-[#0F2342]">
                    CEFR {entry.estimatedLevel} · Điểm tổng hợp {entry.compositeScore}%
                  </div>
                  <div className="text-slate-600 mt-0.5">{entry.noteVi}</div>
                </div>
                <span className="text-slate-500 tabular-nums shrink-0">{entry.date}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
