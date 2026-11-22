import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, HardDrive, RotateCcw, Trash2 } from 'lucide-react';
import { AuthSyncSection } from '../components/AuthSyncSection';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { SYNC_STATUS_LABELS } from '../components/SyncStatusBadge';
import { useAppState } from '../context/AppStateContext';
import { SUPABASE_SCHEMA_SQL } from '../data/seedUserData';
import { t } from '../i18n/translations';
import type { DictationMode, InterfaceLanguage, PlaybackSpeed } from '../types/domain';
import { formatStorageBytes, summarizeOfflineStorage } from '../utils/offlineFormatters';

export const SettingsPage: React.FC = () => {
  const {
    profile,
    capabilities,
    isOnline,
    swRegistered,
    offlineLessons,
    removeOfflineLessonById,
    clearOfflineDownloads,
    updateProfile,
    resetDemoData,
    exportBackupJson,
    authUser,
    syncStatus,
  } = useAppState();
  const lang = profile.interfaceLanguage;

  const [savedToast, setSavedToast] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [clearingOffline, setClearingOffline] = useState(false);
  const toastTimerRef = useRef<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const offlineSummary = useMemo(
    () => summarizeOfflineStorage(offlineLessons),
    [offlineLessons],
  );

  const handleSaveName = (name: string) => {
    updateProfile({ displayName: name });
    setSavedToast(true);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setSavedToast(false), 1800);
  };

  const handleDownloadBackup = () => {
    const json = exportBackupJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `russian-dictation-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopySql = () => {
    void navigator.clipboard?.writeText(SUPABASE_SCHEMA_SQL);
    setCopiedSql(true);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopiedSql(false), 2000);
  };

  const handleClearOffline = async () => {
    setClearingOffline(true);
    try {
      await clearOfflineDownloads();
    } finally {
      setClearingOffline(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="border-b border-slate-200 pb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F2342]">
            {t(lang, 'navSettings')}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Tùy chỉnh ngôn ngữ giao diện, mục tiêu học hằng ngày, âm thanh TTS, cài đặt ứng dụng PWA và dữ liệu ngoại tuyến.
          </p>
        </div>
        {savedToast && (
          <span className="text-xs font-medium text-[#165B52] shrink-0">Đã lưu thay đổi</span>
        )}
      </div>

      {/* Supabase Authentication & Cloud Sync */}
      <AuthSyncSection />

      {/* PWA Installation & Offline Storage */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-[#0F2342]">
            Ứng dụng di động (PWA) & Dữ liệu ngoại tuyến
          </h2>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span>{isOnline ? 'Trực tuyến' : 'Ngoại tuyến'}</span>
            <span aria-hidden="true">·</span>
            <span>{swRegistered ? 'Service Worker hoạt động' : 'Đang khởi tạo SW'}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-[#FAFCFF] border border-slate-200">
          <div className="space-y-1">
            <div className="text-sm font-semibold text-[#0F2342]">
              Cài đặt Russian Dictation (RussianDict)
            </div>
            <p className="text-xs text-slate-600">
              Chạy độc lập toàn màn hình trên Android Chrome, iOS Safari và máy tính để bàn.
            </p>
          </div>
          <PWAInstallButton variant="card" />
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
              <HardDrive className="w-4 h-4 text-[#0F2342]" aria-hidden="true" />
              <span className="tabular-nums">
                Đã tải {offlineSummary.lessonCount} bài · {offlineSummary.totalAudioClips} tệp audio ·{' '}
                {formatStorageBytes(offlineSummary.totalBytes)}
              </span>
            </div>

            {offlineLessons.length > 0 && (
              <button
                type="button"
                disabled={clearingOffline}
                onClick={() => void handleClearOffline()}
                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg border border-red-200 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Xóa toàn bộ bộ nhớ ngoại tuyến</span>
              </button>
            )}
          </div>

          {offlineLessons.length > 0 ? (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {offlineLessons.map((rec) => (
                <div
                  key={rec.lessonId}
                  className="px-4 py-3 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-[#0F2342] truncate cyrillic-prose">
                      {rec.titleRu}
                    </div>
                    <div className="text-slate-600 truncate">
                      {rec.titleVi} · CEFR {rec.level} · {rec.cachedAudioCount}/{rec.sentenceCount}{' '}
                      audio ({formatStorageBytes(rec.totalAudioBytes)})
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeOfflineLessonById(rec.lessonId)}
                    aria-label={`Xóa dữ liệu ngoại tuyến bài ${rec.titleVi}`}
                    className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-red-700 hover:bg-red-50 shrink-0"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Chưa có bài học nào được tải về thiết bị. Mở Thư viện hoặc Phòng luyện nghe chép để tải bài học khi cần luyện không có mạng.
            </p>
          )}
        </div>
      </section>

      {/* Learner & Goal Settings */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-5">
        <h2 className="text-base font-semibold text-[#0F2342]">Hồ sơ & Mục tiêu học tập</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="set-name" className="block text-xs font-medium text-slate-600 mb-1">
              Tên người học
            </label>
            <input
              id="set-name"
              type="text"
              value={profile.displayName}
              onChange={(e) => handleSaveName(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>

          <div>
            <label htmlFor="set-lang" className="block text-xs font-medium text-slate-600 mb-1">
              Ngôn ngữ giao diện
            </label>
            <select
              id="set-lang"
              value={profile.interfaceLanguage}
              onChange={(e) =>
                updateProfile({ interfaceLanguage: e.target.value as InterfaceLanguage })
              }
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              <option value="vi">Tiếng Việt (Mặc định)</option>
              <option value="en">English (Sẵn sàng mở rộng)</option>
            </select>
          </div>

          <div>
            <label htmlFor="set-goal-lessons" className="block text-xs font-medium text-slate-600 mb-1">
              Mục tiêu bài nghe chép mỗi ngày
            </label>
            <input
              id="set-goal-lessons"
              type="number"
              min={1}
              max={10}
              value={profile.dailyGoalLessons}
              onChange={(e) =>
                updateProfile({
                  dailyGoalLessons: Math.max(1, Math.min(10, Number(e.target.value) || 1)),
                })
              }
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg tabular-nums"
            />
          </div>

          <div>
            <label htmlFor="set-goal-mins" className="block text-xs font-medium text-slate-600 mb-1">
              Mục tiêu phút luyện mỗi ngày
            </label>
            <input
              id="set-goal-mins"
              type="number"
              min={10}
              max={180}
              step={5}
              value={profile.dailyGoalMinutes}
              onChange={(e) =>
                updateProfile({
                  dailyGoalMinutes: Math.max(10, Math.min(180, Number(e.target.value) || 15)),
                })
              }
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg tabular-nums"
            />
          </div>
        </div>
      </section>

      {/* Audio & Dictation Defaults */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-5">
        <h2 className="text-base font-semibold text-[#0F2342]">
          Phòng nghe chép & Âm thanh tiếng Nga (TTS)
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="set-mode" className="block text-xs font-medium text-slate-600 mb-1">
              Chế độ mặc định
            </label>
            <select
              id="set-mode"
              value={profile.preferredMode}
              onChange={(e) => updateProfile({ preferredMode: e.target.value as DictationMode })}
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              <option value="sentence">Từng câu</option>
              <option value="full">Toàn bài</option>
            </select>
          </div>

          <div>
            <label htmlFor="set-speed" className="block text-xs font-medium text-slate-600 mb-1">
              Tốc độ mặc định
            </label>
            <select
              id="set-speed"
              value={profile.preferredSpeed}
              onChange={(e) =>
                updateProfile({ preferredSpeed: Number(e.target.value) as PlaybackSpeed })
              }
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              <option value={0.75}>0.75x</option>
              <option value={0.85}>0.85x</option>
              <option value={1}>1x</option>
              <option value={1.15}>1.15x</option>
            </select>
          </div>

          <div>
            <label htmlFor="set-tts" className="block text-xs font-medium text-slate-600 mb-1">
              Nhà cung cấp giọng đọc
            </label>
            <select
              id="set-tts"
              value={profile.ttsPreference}
              onChange={(e) =>
                updateProfile({ ttsPreference: e.target.value as 'auto' | 'browser' })
              }
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              <option value="auto">Tự động (Server TTS → Trình duyệt)</option>
              <option value="browser">Chỉ giọng đọc trình duyệt (ru-RU)</option>
            </select>
          </div>
        </div>
      </section>

      {/* Adaptive Thresholds Info */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-3">
        <h2 className="text-base font-semibold text-[#0F2342]">
          Ngưỡng đánh giá thích ứng CEFR (có thể cấu hình)
        </h2>
        <p className="text-xs text-slate-600">
          Đây là ngưỡng ước tính ban đầu dựa trên nhiều bài hoàn thành gần nhất (không nâng cấp bậc CEFR chỉ sau 1 bài đạt điểm tuyệt đối và luôn phân biệt với chứng nhận CEFR chính thức).
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-2">
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div className="font-semibold text-[#0F2342] tabular-nums">&lt; 70%</div>
            <div className="text-slate-600 mt-0.5">Củng cố bậc hiện tại</div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div className="font-semibold text-[#0F2342] tabular-nums">70–84%</div>
            <div className="text-slate-600 mt-0.5">Tiếp tục bậc hiện tại</div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div className="font-semibold text-[#0F2342] tabular-nums">85–94%</div>
            <div className="text-slate-600 mt-0.5">Tăng dần độ phức tạp</div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div className="font-semibold text-[#0F2342] tabular-nums">95–100%</div>
            <div className="text-slate-600 mt-0.5">Thử thách bậc kế tiếp</div>
          </div>
        </div>
      </section>

      {/* Services & Cloud Sync Status */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4">
        <h2 className="text-base font-semibold text-[#0F2342]">
          Trạng thái kết nối dịch vụ & Đồng bộ đám mây
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3.5 rounded-lg border border-slate-200">
            <div className="text-slate-500">Gemini AI Lesson & Phân tích</div>
            <div className="font-semibold text-[#0F2342] mt-1">
              {capabilities.geminiConfigured ? 'Đã kết nối trên máy chủ' : 'Chưa cấu hình (Demo cục bộ)'}
            </div>
          </div>
          <div className="p-3.5 rounded-lg border border-slate-200">
            <div className="text-slate-500">Russian TTS (Gemini 3.8 TTS)</div>
            <div className="font-semibold text-[#0F2342] mt-1">
              {capabilities.ttsAvailable ? 'Sẵn sàng trên máy chủ' : 'Dùng trình duyệt / Mô phỏng'}
            </div>
          </div>
          <div className="p-3.5 rounded-lg border border-slate-200">
            <div className="text-slate-500">Supabase Auth & PostgreSQL</div>
            <div className="font-semibold text-[#0F2342] mt-1">
              {authUser
                ? `${authUser.email} · ${SYNC_STATUS_LABELS[syncStatus][lang]}`
                : capabilities.supabaseConfigured
                  ? 'Đã kết nối biến env · Chỉ lưu cục bộ (chưa đăng nhập)'
                  : 'Lưu cục bộ (localStorage)'}
            </div>
          </div>
        </div>

        <div className="pt-2 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-600">
              Lược đồ SQL & Row Level Security (Phase 4 Supabase)
            </span>
            <button
              type="button"
              onClick={handleCopySql}
              className="inline-flex items-center gap-1 min-h-[44px] px-2 text-xs font-medium text-[#1E4178] hover:underline"
            >
              {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSql ? 'Đã sao chép SQL' : 'Sao chép SQL Schema'}</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={handleDownloadBackup}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-lg border border-slate-200 text-xs font-semibold text-[#0F2342] hover:bg-slate-50"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Xuất dữ liệu học tập (.json)</span>
          </button>

          <button
            type="button"
            onClick={resetDemoData}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-lg border border-red-200 text-xs font-semibold text-red-700 hover:bg-red-50"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Khôi phục dữ liệu Demo ban đầu</span>
          </button>
        </div>
      </section>
    </div>
  );
};
