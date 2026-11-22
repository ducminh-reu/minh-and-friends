import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Download,
  Headphones,
  Loader2,
  Search,
  Trash2,
} from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import { TOPIC_LABELS, t } from '../i18n/translations';
import type { CefrLevel, Lesson, TopicCategory } from '../types/domain';
import { formatStorageBytes } from '../utils/offlineFormatters';

const LEVELS: ('ALL' | CefrLevel)[] = ['ALL', 'B1', 'B2', 'C1', 'C2'];

export const LibraryPage: React.FC = () => {
  const {
    allLessons,
    attempts,
    profile,
    capabilities,
    isOnline,
    offlineLessons,
    offlineLessonIds,
    savedLessonIds,
    toggleSaveLesson,
    downloadLessonOffline,
    removeOfflineLessonById,
    deleteLesson,
  } = useAppState();
  const lang = profile.interfaceLanguage;

  const [levelFilter, setLevelFilter] = useState<'ALL' | CefrLevel>('ALL');
  const [topicFilter, setTopicFilter] = useState<'ALL' | TopicCategory>('ALL');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'curated' | 'ai_generated'>('ALL');
  const [onlyOffline, setOnlyOffline] = useState(false);
  const [onlySaved, setOnlySaved] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const offlineMap = useMemo(() => {
    const map = new Map(offlineLessons.map((rec) => [rec.lessonId, rec]));
    return map;
  }, [offlineLessons]);

  const filteredLessons = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allLessons.filter((lesson) => {
      if (levelFilter !== 'ALL' && lesson.level !== levelFilter) return false;
      if (topicFilter !== 'ALL' && lesson.topic !== topicFilter) return false;
      if (sourceFilter !== 'ALL' && lesson.source !== sourceFilter) return false;
      if (onlyOffline && !offlineLessonIds.has(lesson.id)) return false;
      if (onlySaved && !savedLessonIds.has(lesson.id)) return false;
      if (q) {
        const hay = `${lesson.titleRu} ${lesson.titleVi} ${lesson.descriptionVi}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    allLessons,
    levelFilter,
    topicFilter,
    sourceFilter,
    onlyOffline,
    onlySaved,
    offlineLessonIds,
    savedLessonIds,
    searchQuery,
  ]);

  const bestScoreByLesson = useMemo(() => {
    const map = new Map<string, number>();
    for (const att of attempts) {
      if (att.listeningAccuracy === null) continue;
      const prev = map.get(att.lessonId) ?? 0;
      if (att.listeningAccuracy > prev) map.set(att.lessonId, att.listeningAccuracy);
    }
    return map;
  }, [attempts]);

  const handleDownloadOffline = async (lesson: Lesson) => {
    setDownloadError(null);
    setDownloadingId(lesson.id);
    setDownloadProgress({ done: 0, total: lesson.sentences.length });
    try {
      const topicEn = TOPIC_LABELS[lesson.topic]?.en ?? lesson.topic;
      await downloadLessonOffline(lesson, {
        includeAudio: capabilities.ttsAvailable && isOnline,
        topicEn,
        onProgress: (done, total) => setDownloadProgress({ done, total }),
      });
    } catch (err) {
      setDownloadError(
        err instanceof Error ? err.message : 'Không thể tải bài học ngoại tuyến.',
      );
    } finally {
      setDownloadingId(null);
      setDownloadProgress(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F2342]">
            {t(lang, 'navLibrary')}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Kho hội thoại tiếng Nga tự nhiên từ B1 đến C2 kèm transcript đối chiếu, từ vựng song ngữ và tùy chọn tải học ngoại tuyến.
          </p>
        </div>
        <Link
          to="/ai-lessons"
          className="inline-flex items-center justify-center px-4 py-2.5 min-h-[44px] rounded-lg border border-slate-200 bg-white text-sm font-medium text-[#0F2342] hover:bg-slate-50 transition-colors whitespace-nowrap self-start sm:self-auto"
        >
          + Tạo bài học AI mới
        </Link>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t(lang, 'searchPlaceholder')}
              aria-label={t(lang, 'searchPlaceholder')}
              className="w-full min-h-[44px] pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F2342]/20 focus:border-[#0F2342]"
            />
          </div>

          <select
            value={topicFilter}
            onChange={(e) => setTopicFilter(e.target.value as 'ALL' | TopicCategory)}
            aria-label="Lọc theo chủ đề"
            className="min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#0F2342]/20"
          >
            <option value="ALL">{t(lang, 'allTopics')}</option>
            {(Object.keys(TOPIC_LABELS) as TopicCategory[]).map((key) => (
              <option key={key} value={key}>
                {TOPIC_LABELS[key][lang]}
              </option>
            ))}
          </select>

          <select
            value={sourceFilter}
            onChange={(e) =>
              setSourceFilter(e.target.value as 'ALL' | 'curated' | 'ai_generated')
            }
            aria-label="Lọc theo nguồn bài học"
            className="min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#0F2342]/20"
          >
            <option value="ALL">Mọi nguồn bài</option>
            <option value="curated">Bài biên tập chuẩn</option>
            <option value="ai_generated">Bài tạo bởi AI</option>
          </select>
        </div>

        {/* CEFR Level Segmented Filter + Offline Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {LEVELS.map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setLevelFilter(lvl)}
                className={`px-3.5 py-2 min-h-[44px] text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  levelFilter === lvl
                    ? 'bg-[#0F2342] text-white'
                    : 'bg-slate-100 text-slate-600 hover:text-[#0F2342]'
                }`}
              >
                {lvl === 'ALL' ? t(lang, 'allLevels') : `CEFR ${lvl}`}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setOnlySaved((v) => !v)}
              aria-pressed={onlySaved}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap ${
                onlySaved
                  ? 'bg-[#F2F6FC] text-[#0F2342] border-[#0F2342]/30'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Bài đã lưu ({savedLessonIds.size})</span>
            </button>

            <button
              type="button"
              onClick={() => setOnlyOffline((v) => !v)}
              aria-pressed={onlyOffline}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap ${
                onlyOffline
                  ? 'bg-[#F2F9F8] text-[#165B52] border-[#1F7A6E]/40'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Đã tải ngoại tuyến ({offlineLessons.length})</span>
            </button>
          </div>
        </div>
      </div>

      {downloadError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900">
          {downloadError}
        </div>
      )}

      {/* Lesson Grid */}
      {filteredLessons.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <p className="text-sm text-slate-600">{t(lang, 'noResults')}</p>
          <button
            type="button"
            onClick={() => {
              setLevelFilter('ALL');
              setTopicFilter('ALL');
              setSourceFilter('ALL');
              setOnlyOffline(false);
              setOnlySaved(false);
              setSearchQuery('');
            }}
            className="mt-3 px-4 py-2.5 min-h-[44px] rounded-lg border border-slate-200 text-xs font-medium text-[#0F2342] hover:bg-slate-50"
          >
            Đặt lại bộ lọc
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
          {filteredLessons.map((lesson) => {
            const best = bestScoreByLesson.get(lesson.id);
            const offlineRec = offlineMap.get(lesson.id);
            const isDownloading = downloadingId === lesson.id;

            return (
              <article
                key={lesson.id}
                className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col justify-between hover:border-slate-300 transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span className="font-semibold text-[#0F2342]">
                        CEFR {lesson.level}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{TOPIC_LABELS[lesson.topic][lang]}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          lesson.source === 'curated'
                            ? 'text-[#1F7A6E] font-medium'
                            : 'text-[#1E4178] font-medium'
                        }
                      >
                        {lesson.source === 'curated' ? t(lang, 'curatedBadge') : t(lang, 'aiBadge')}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => toggleSaveLesson(lesson)}
                        aria-pressed={savedLessonIds.has(lesson.id)}
                        aria-label={
                          savedLessonIds.has(lesson.id)
                            ? `Bỏ lưu bài ${lesson.titleVi}`
                            : `Lưu bài ${lesson.titleVi}`
                        }
                        className={`p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition-colors ${
                          savedLessonIds.has(lesson.id)
                            ? 'text-[#0F2342] bg-[#F2F6FC]'
                            : 'text-slate-400 hover:text-[#0F2342]'
                        }`}
                      >
                        {savedLessonIds.has(lesson.id) ? (
                          <BookmarkCheck className="w-4 h-4" aria-hidden="true" />
                        ) : (
                          <Bookmark className="w-4 h-4" aria-hidden="true" />
                        )}
                      </button>

                      {lesson.source !== 'curated' && (
                        <button
                          type="button"
                          onClick={() => deleteLesson(lesson.id)}
                          aria-label={`Xóa bài ${lesson.titleVi}`}
                          className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-red-600 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>

                  <h2 className="text-lg font-bold text-[#0F2342] mt-2 cyrillic-prose">
                    {lesson.titleRu}
                  </h2>
                  <div className="text-sm font-medium text-slate-700 mt-0.5">
                    {lesson.titleVi}
                  </div>
                  <p className="text-xs text-slate-600 mt-2.5 leading-relaxed">
                    {lesson.descriptionVi}
                  </p>
                </div>

                <div className="mt-5 pt-4 border-t border-slate-100 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 tabular-nums">
                    <span>
                      {Math.round(lesson.durationSec / 60)} phút · {lesson.sentences.length} câu ·{' '}
                      {lesson.vocabulary.length} từ vựng
                      {best !== undefined ? ` · Điểm cao nhất: ${best}%` : ' · Chưa nộp bài'}
                    </span>

                    {offlineRec && (
                      <span className="text-[#165B52] font-medium">
                        Đã lưu ngoại tuyến
                        {offlineRec.cachedAudioCount > 0
                          ? ` (${offlineRec.cachedAudioCount}/${offlineRec.sentenceCount} audio · ${formatStorageBytes(offlineRec.totalAudioBytes)})`
                          : ' (văn bản)'}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {offlineRec ? (
                      <button
                        type="button"
                        onClick={() => void removeOfflineLessonById(lesson.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:text-red-700 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Xóa bản ngoại tuyến</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={Boolean(downloadingId)}
                        onClick={() => void handleDownloadOffline(lesson)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg border border-slate-200 bg-white text-xs font-medium text-[#0F2342] hover:bg-slate-50 disabled:opacity-60 transition-colors"
                      >
                        {isDownloading ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                            <span>
                              Đang tải{' '}
                              {downloadProgress
                                ? `${downloadProgress.done}/${downloadProgress.total}`
                                : '...'}
                            </span>
                          </>
                        ) : (
                          <>
                            <Download className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Tải ngoại tuyến</span>
                          </>
                        )}
                      </button>
                    )}

                    <Link
                      to={`/dictation/${lesson.id}`}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 min-h-[44px] rounded-lg bg-[#0F2342] text-white text-xs font-medium hover:bg-[#163059] transition-colors whitespace-nowrap shrink-0 ml-auto"
                    >
                      <Headphones className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Luyện nghe chép</span>
                      <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
