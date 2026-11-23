import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  ExternalLink,
  Headphones,
  Loader2,
  Newspaper,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import { NEWS_TOPIC_LABELS } from '../i18n/translations';
import type {
  CefrLevel,
  Lesson,
  NewsArticle,
  NewsFormat,
  NewsPipelineStatusResponse,
  NewsTopicCategory,
} from '../types/domain';
import { filterNewsArticles } from '../utils/newsFeedUtils';
import { formatStorageBytes } from '../utils/offlineFormatters';

interface NewsApiResponse {
  articles: NewsArticle[];
  totalFetched: number;
  duplicatesRemoved?: number;
  availableDates: string[];
  fetchedAt: string;
  sourcesUsed: string[];
  failedSources: string[];
  fromCache: boolean;
}

const CEFR_LEVELS: CefrLevel[] = ['B1', 'B2', 'C1', 'C2'];

function formatVerifiedDateVi(isoDate: string, lang: 'vi' | 'en'): string {
  const ms = Date.parse(isoDate);
  if (!Number.isFinite(ms)) return isoDate;
  return new Date(ms).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateKeyLabel(dateKey: string, lang: 'vi' | 'en'): string {
  const parts = dateKey.split('-');
  if (parts.length !== 3) return dateKey;
  return lang === 'vi' ? `${parts[2]}/${parts[1]}/${parts[0]}` : dateKey;
}

export const DailyNewsPage: React.FC = () => {
  const {
    profile,
    aiLessons,
    serverNewsLessons,
    refreshServerNewsLessons,
    adaptiveAssessment,
    capabilities,
    isOnline,
    addAiLesson,
    deleteAiLesson,
    deleteLesson,
    savedLessonIds,
    toggleSaveLesson,
    offlineLessons,
    offlineLessonIds,
    downloadLessonOffline,
  } = useAppState();

  const lang = profile.interfaceLanguage;

  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [sourcesUsed, setSourcesUsed] = useState<string[]>([]);
  const [duplicatesRemoved, setDuplicatesRemoved] = useState<number>(0);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loadingFeed, setLoadingFeed] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  const [pipelineStatus, setPipelineStatus] = useState<NewsPipelineStatusResponse | null>(null);
  const [runningPipeline, setRunningPipeline] = useState<boolean>(false);
  const [pipelineMessage, setPipelineMessage] = useState<string | null>(null);
  const [showPipelineErrors, setShowPipelineErrors] = useState<boolean>(false);
  const [retryingAudioId, setRetryingAudioId] = useState<string | null>(null);
  const [audioRetryError, setAudioRetryError] = useState<string | null>(null);

  const [topicFilter, setTopicFilter] = useState<'ALL' | NewsTopicCategory>('ALL');
  const [dateFilter, setDateFilter] = useState<string>('ALL');
  const [levelFilter, setLevelFilter] = useState<'ALL' | CefrLevel>('ALL');
  const [targetLevel, setTargetLevel] = useState<CefrLevel>(adaptiveAssessment.nextTargetLevel);
  const [format, setFormat] = useState<NewsFormat>('dialogue');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [generatingArticleId, setGeneratingArticleId] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [justGeneratedLessonId, setJustGeneratedLessonId] = useState<string | null>(null);
  const [articleLevels, setArticleLevels] = useState<Record<string, CefrLevel>>({});
  const [articleFormats, setArticleFormats] = useState<Record<string, NewsFormat>>({});
  const generatingRef = useRef<boolean>(false);
  const retryingRef = useRef<boolean>(false);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const offlineMap = useMemo(
    () => new Map(offlineLessons.map((rec) => [rec.lessonId, rec])),
    [offlineLessons],
  );

  const loadPipelineStatus = useCallback(async () => {
    if (!isOnline) return;
    try {
      const resp = await fetch('/api/news/pipeline/status');
      if (!resp.ok) return;
      const data = (await resp.json()) as NewsPipelineStatusResponse;
      setPipelineStatus(data);
    } catch {
      // Non-fatal
    }
  }, [isOnline]);

  const loadFeed = useCallback(
    async (forceRefresh = false) => {
      if (forceRefresh) {
        setRefreshing(true);
      } else {
        setLoadingFeed(true);
      }
      setFeedError(null);

      try {
        const url = forceRefresh ? '/api/news?refresh=1' : '/api/news';
        const resp = await fetch(url);
        const data = (await resp.json()) as Partial<NewsApiResponse> & { message?: string };
        if (!resp.ok) {
          setFeedError(data.message || 'Không thể tải nguồn tin RSS vào lúc này.');
          return;
        }
        setArticles(Array.isArray(data.articles) ? data.articles : []);
        setAvailableDates(Array.isArray(data.availableDates) ? data.availableDates : []);
        setSourcesUsed(Array.isArray(data.sourcesUsed) ? data.sourcesUsed : []);
        setDuplicatesRemoved(Number(data.duplicatesRemoved ?? 0));
        setFetchedAt(typeof data.fetchedAt === 'string' ? data.fetchedAt : null);
      } catch {
        setFeedError('Không thể kết nối tới máy chủ để tải bản tin RSS.');
      } finally {
        setLoadingFeed(false);
        setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (isOnline) {
      void loadFeed(false);
      void loadPipelineStatus();
      void refreshServerNewsLessons();
    } else {
      setLoadingFeed(false);
    }
  }, [isOnline, loadFeed, loadPipelineStatus, refreshServerNewsLessons]);

  const effectiveTargetLevel: CefrLevel = levelFilter === 'ALL' ? targetLevel : levelFilter;

  const filteredArticles = useMemo(
    () =>
      filterNewsArticles(articles, {
        topic: topicFilter,
        dateFilter,
        search: searchQuery,
      }),
    [articles, topicFilter, dateFilter, searchQuery],
  );

  const serverNewsIdSet = useMemo(
    () => new Set(serverNewsLessons.map((l) => l.id)),
    [serverNewsLessons],
  );
  const localAiOnlyIdSet = useMemo(
    () => new Set(aiLessons.filter((l) => !serverNewsIdSet.has(l.id)).map((l) => l.id)),
    [aiLessons, serverNewsIdSet],
  );

  // Merge DB-persisted automated pipeline lessons + any local AI-generated news lessons
  const newsLessons = useMemo(() => {
    const map = new Map<string, Lesson>();
    for (const l of serverNewsLessons) {
      if (l.newsMetadata) map.set(l.id, l);
    }
    for (const l of aiLessons) {
      if (l.newsMetadata && !map.has(l.id)) {
        map.set(l.id, l);
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const timeDiff =
        Date.parse(b.newsMetadata?.publishedAt ?? b.createdAt) -
        Date.parse(a.newsMetadata?.publishedAt ?? a.createdAt);
      if (Number.isFinite(timeDiff) && timeDiff !== 0) return timeDiff;
      const order: Record<CefrLevel, number> = { B1: 1, B2: 2, C1: 3, C2: 4 };
      return order[a.level] - order[b.level];
    });
  }, [serverNewsLessons, aiLessons]);

  const filteredNewsLessons = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);

    return newsLessons.filter((lesson) => {
      const meta = lesson.newsMetadata;
      if (!meta) return false;
      if (topicFilter !== 'ALL' && meta.newsTopic !== topicFilter) return false;
      if (levelFilter !== 'ALL' && lesson.level !== levelFilter) return false;

      if (dateFilter !== 'ALL') {
        const pubKey = meta.publishedAt.slice(0, 10);
        if (dateFilter === 'today') {
          if (pubKey !== todayKey) return false;
        } else if (dateFilter === 'last_3_days' || dateFilter === 'last_7_days') {
          const days = dateFilter === 'last_3_days' ? 3 : 7;
          const diffMs = now.getTime() - Date.parse(meta.publishedAt);
          if (!Number.isFinite(diffMs) || diffMs > days * 86_400_000 || diffMs < -86_400_000) {
            return false;
          }
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateFilter)) {
          if (pubKey !== dateFilter) return false;
        }
      }

      if (q) {
        const hay =
          `${lesson.titleRu} ${lesson.titleVi} ${meta.originalTitle} ${meta.sourceName} ${meta.verifiedFactsSummaryVi} ${meta.educationalSummaryRu ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [newsLessons, topicFilter, levelFilter, dateFilter, searchQuery]);

  const handleSelectLevelFilter = (next: 'ALL' | CefrLevel) => {
    setLevelFilter(next);
    if (next !== 'ALL') {
      setTargetLevel(next);
    }
  };

  const handleRunDailyPipelineNow = async () => {
    if (!isOnline || runningPipeline) return;
    setRunningPipeline(true);
    setPipelineMessage(null);
    setGenerateError(null);

    try {
      const resp = await fetch('/api/news/pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxStories: 1,
          format,
        }),
      });
      const data = (await resp.json()) as {
        alreadyRunning?: boolean;
        runSummary?: { lessonsGenerated: number; audioSegmentsSaved: number; status: string };
        status?: NewsPipelineStatusResponse;
        message?: string;
      };
      if (data.status) {
        setPipelineStatus(data.status);
      }
      await Promise.all([refreshServerNewsLessons(), loadFeed(false), loadPipelineStatus()]);
      if (data.alreadyRunning) {
        setPipelineMessage('Quy trình tự động đang chạy ở nền. Danh sách bài học sẽ cập nhật khi hoàn tất.');
      } else if (data.runSummary) {
        setPipelineMessage(
          `Đã hoàn tất đợt cập nhật (${data.runSummary.status}): tạo ${data.runSummary.lessonsGenerated} bài B1–C2, lưu ${data.runSummary.audioSegmentsSaved} đoạn audio tách câu.`,
        );
      } else if (!resp.ok) {
        setPipelineMessage(data.message || 'Không thể chạy quy trình cập nhật tin tức.');
      }
    } catch {
      setPipelineMessage('Lỗi kết nối tới máy chủ khi chạy quy trình cập nhật tin tức.');
    } finally {
      setRunningPipeline(false);
    }
  };

  const handleRetryAudio = async (lessonId: string) => {
    if (!isOnline || retryingAudioId || retryingRef.current) return;
    retryingRef.current = true;
    setRetryingAudioId(lessonId);
    setAudioRetryError(null);
    try {
      const resp = await fetch(`/api/news/pipeline/retry-audio/${encodeURIComponent(lessonId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
      });
      const data = (await resp.json()) as {
        lesson?: Lesson;
        error?: string | null;
        errorCategory?: string;
        reusedFromCache?: boolean;
        message?: string;
      };
      if (!resp.ok || !data.lesson) {
        setAudioRetryError(data.message || data.error || 'Không thể tạo lại audio cho bài học này.');
      } else if (data.error) {
        setAudioRetryError(`${data.lesson.level}: ${data.error}`);
      } else if (data.reusedFromCache) {
        setPipelineMessage(`Đã tái sử dụng tệp audio hợp lệ sẵn có cho bài ${data.lesson.level} (không tốn thêm lượt gọi API).`);
      } else {
        setPipelineMessage(`Đã tạo và lưu xong audio tách từng câu cho bài ${data.lesson.level}.`);
      }
      await Promise.all([refreshServerNewsLessons(), loadPipelineStatus()]);
    } catch {
      setAudioRetryError('Lỗi kết nối tới máy chủ khi thử tạo lại audio.');
    } finally {
      retryingRef.current = false;
      setRetryingAudioId(null);
    }
  };

  const handleGenerateLessonFromArticle = async (
    article: NewsArticle,
    targetLevel: CefrLevel,
    targetFormat: NewsFormat,
  ) => {
    if (generatingRef.current || generatingArticleId) return;
    if (!isOnline) {
      setGenerateError('Đang ngoại tuyến — Cần kết nối mạng để tạo bài nghe từ tin tức.');
      return;
    }
    generatingRef.current = true;
    setGenerateError(null);
    setAudioRetryError(null);
    setGeneratingArticleId(article.id);
    setJustGeneratedLessonId(null);

    try {
      const resp = await fetch('/api/news/generate-lesson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article,
          level: targetLevel,
          format: targetFormat,
        }),
      });
      const data = (await resp.json()) as {
        lesson?: Lesson;
        audioError?: string | null;
        reusedFromCache?: boolean;
        message?: string;
      };
      if (!resp.ok || !data.lesson) {
        setGenerateError(
          data.message || 'Không thể chuyển bản tin thành bài luyện nghe vào lúc này.',
        );
        return;
      }
      addAiLesson(data.lesson);
      await Promise.all([refreshServerNewsLessons(), loadPipelineStatus()]);
      setJustGeneratedLessonId(data.lesson.id);
      if (data.audioError) {
        setAudioRetryError(
          `Đã tạo và lưu hoàn chỉnh văn bản bài ${data.lesson.level}, nhưng audio TTS chưa sẵn sàng: ${data.audioError}`,
        );
      }
    } catch {
      setGenerateError('Lỗi kết nối tới máy chủ khi tạo bài nghe từ tin tức.');
    } finally {
      generatingRef.current = false;
      setGeneratingArticleId(null);
    }
  };

  const handleDownloadOffline = async (lesson: Lesson) => {
    setDownloadError(null);
    setDownloadingId(lesson.id);
    setDownloadProgress({ done: 0, total: lesson.sentences.length });
    try {
      const topicEn = lesson.newsMetadata
        ? NEWS_TOPIC_LABELS[lesson.newsMetadata.newsTopic].en
        : lesson.topic;
      await downloadLessonOffline(lesson, {
        includeAudio:
          Boolean(lesson.newsMetadata?.fullAudioUrl || (capabilities.ttsAvailable && isOnline)),
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

  const resetFilters = () => {
    setTopicFilter('ALL');
    setDateFilter('ALL');
    setLevelFilter('ALL');
    setSearchQuery('');
  };

  const lastRun = pipelineStatus?.lastRun ?? null;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="border-b border-slate-200 pb-5 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-medium text-[#1F7A6E]">Bản tin RSS xác thực</span>
            {sourcesUsed.length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{sourcesUsed.length} nguồn báo quốc tế</span>
              </>
            )}
            {duplicatesRemoved > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">Đã loại {duplicatesRemoved} tin trùng lặp</span>
              </>
            )}
            {fetchedAt && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  Cập nhật {formatVerifiedDateVi(fetchedAt, lang)}
                </span>
              </>
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F2342] mt-1">
            Daily News Dictation – Новости дня
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-3xl">
            Hệ thống tự động thu thập tin kinh tế – chính trị mới mỗi ngày, lọc trùng lặp, xác minh ngày đăng và chuyển thể thành 4 phiên bản CEFR B1–C2 kèm bản tóm tắt tiếng Nga, hội thoại, giải thích song ngữ Nga–Việt và file audio tách từng câu lưu trên cơ sở dữ liệu.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => void loadFeed(true)}
            disabled={refreshing || !isOnline}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 min-h-[44px] rounded-lg border border-slate-200 bg-white text-sm font-medium text-[#0F2342] hover:bg-slate-50 disabled:opacity-60 transition-colors whitespace-nowrap"
          >
            <RefreshCw
              className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{refreshing ? 'Đang tải RSS...' : 'Làm mới RSS'}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleRunDailyPipelineNow()}
            disabled={runningPipeline || !isOnline || (capabilities.loaded && !capabilities.geminiConfigured)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg bg-[#0F2342] text-white text-sm font-semibold hover:bg-[#163059] disabled:opacity-55 transition-colors whitespace-nowrap"
          >
            {runningPipeline ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>Đang tạo 4 cấp độ...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" aria-hidden="true" />
                <span>Cập nhật bản tin B1–C2 ngay</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Automated Daily Pipeline Status Strip */}
      <section
        aria-label="Trạng thái hệ thống cập nhật tin tức tự động"
        className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-slate-700 min-w-0">
            <Clock className="w-4 h-4 text-[#1E4178] shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0 space-y-0.5">
              <div className="font-semibold text-[#0F2342]">
                Tác vụ máy chủ tự động mỗi 24 giờ · Cơ sở dữ liệu tin tức
              </div>
              <div className="text-slate-600 tabular-nums flex flex-wrap gap-x-3 gap-y-1">
                <span>
                  Lần chạy gần nhất:{' '}
                  {lastRun
                    ? `${formatVerifiedDateVi(lastRun.startedAt, lang)} (${
                        lastRun.status === 'completed'
                          ? 'Hoàn tất'
                          : lastRun.status === 'partial'
                            ? 'Một phần'
                            : lastRun.status === 'running'
                              ? 'Đang chạy'
                              : 'Có lỗi'
                      })`
                    : 'Chưa chạy'}
                </span>
                {pipelineStatus && (
                  <>
                    <span>· {pipelineStatus.totalDbArticles} tin đã lưu</span>
                    <span>· {pipelineStatus.totalDbLessons} bài học B1–C2</span>
                    <span>· {pipelineStatus.totalAudioSegments} đoạn audio câu</span>
                    <span>
                      · Lần kế tiếp: {formatVerifiedDateVi(pipelineStatus.nextScheduledRunAt, lang)}
                    </span>
                    {pipelineStatus.ttsQueue && (
                      <span>
                        · Hàng đợi TTS (tối đa {pipelineStatus.ttsQueue.maxConcurrency} luồng):{' '}
                        {pipelineStatus.ttsQueue.activeCount > 0 || pipelineStatus.ttsQueue.queuedCount > 0
                          ? `đang xử lý ${pipelineStatus.ttsQueue.activeCount}, chờ ${pipelineStatus.ttsQueue.queuedCount}`
                          : pipelineStatus.ttsQueue.dailyQuotaExhausted
                            ? 'đã chạm hạn mức ngày'
                            : 'sẵn sàng'}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {pipelineStatus && pipelineStatus.recentErrors.length > 0 && (
            <button
              type="button"
              aria-expanded={showPipelineErrors}
              onClick={() => setShowPipelineErrors((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap self-start md:self-auto"
            >
              <span>Nhật ký lỗi ({pipelineStatus.recentErrors.length})</span>
              {showPipelineErrors ? (
                <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>
          )}
        </div>

        {pipelineMessage && (
          <div className="text-xs text-[#0F2342] bg-[#F2F6FC] border border-slate-200 rounded-lg px-3.5 py-2.5">
            {pipelineMessage}
          </div>
        )}

        {showPipelineErrors && pipelineStatus && pipelineStatus.recentErrors.length > 0 && (
          <div className="pt-3 border-t border-slate-100 space-y-1.5 text-xs">
            <div className="font-semibold text-[#0F2342]">Nhật ký sự cố gần đây từ máy chủ</div>
            <ul className="space-y-1 text-slate-600 max-h-44 overflow-y-auto">
              {pipelineStatus.recentErrors.map((err) => (
                <li key={err.id} className="flex flex-wrap gap-x-2">
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                    {formatVerifiedDateVi(err.createdAt, lang)}
                  </span>
                  <span className="font-semibold text-slate-800">[{err.stage}]</span>
                  {err.targetRef && <span className="text-slate-500">({err.targetRef})</span>}
                  <span>{err.errorMessage}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Capabilities / Offline Notices */}
      {capabilities.loaded && !capabilities.geminiConfigured && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 text-xs text-amber-900">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <div className="font-semibold">Máy chủ chưa cấu hình GEMINI_API_KEY</div>
            <p className="mt-0.5 text-amber-800">
              Bạn vẫn có thể duyệt và lọc bản tin RSS xác thực bên dưới, mở liên kết bài gốc và ôn các bài đã tải ngoại tuyến. Quy trình chuyển tin tức thành bài học 4 cấp độ và TTS tiếng Nga cần <code className="font-mono">GEMINI_API_KEY</code> trên máy chủ.
            </p>
          </div>
        </div>
      )}

      {!isOnline && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 text-xs text-amber-900">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <div className="font-semibold">Đang ngoại tuyến</div>
            <p className="mt-0.5 text-amber-800">
              Không thể tải RSS mới hoặc chạy quy trình tạo bài mới khi mất mạng. Các bài tin tức bạn đã tải ngoại tuyến vẫn luyện tập bình thường ở phần bên dưới.
            </p>
          </div>
        </div>
      )}

      {/* Filter & Generation Config Toolbar */}
      <section
        aria-label="Bộ lọc tin tức và cấu hình bài luyện nghe"
        className="bg-white border border-slate-200 rounded-xl p-4 space-y-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="relative md:col-span-5">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm tiêu đề tin tức, nguồn báo hoặc từ khóa..."
              aria-label="Tìm kiếm tin tức"
              className="w-full min-h-[44px] pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F2342]/20 focus:border-[#0F2342]"
            />
          </div>

          <div className="md:col-span-4">
            <select
              value={topicFilter}
              onChange={(e) => setTopicFilter(e.target.value as 'ALL' | NewsTopicCategory)}
              aria-label="Lọc theo chủ đề tin tức"
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#0F2342]/20"
            >
              <option value="ALL">Tất cả 7 chủ đề thời sự</option>
              {(Object.keys(NEWS_TOPIC_LABELS) as NewsTopicCategory[]).map((key) => (
                <option key={key} value={key}>
                  {NEWS_TOPIC_LABELS[key][lang]} ({NEWS_TOPIC_LABELS[key].ru})
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              aria-label="Lọc theo ngày xuất bản"
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#0F2342]/20"
            >
              <option value="ALL">Mọi ngày xuất bản</option>
              <option value="today">Hôm nay</option>
              <option value="last_3_days">3 ngày gần đây</option>
              <option value="last_7_days">7 ngày gần đây</option>
              {availableDates.map((dateKey) => (
                <option key={dateKey} value={dateKey}>
                  Ngày {formatDateKeyLabel(dateKey, lang)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-2 border-t border-slate-100">
          {/* CEFR Filter & Target Level */}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Trình độ CEFR">
            <button
              type="button"
              onClick={() => handleSelectLevelFilter('ALL')}
              aria-pressed={levelFilter === 'ALL'}
              className={`px-3.5 py-2 min-h-[44px] text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                levelFilter === 'ALL'
                  ? 'bg-[#0F2342] text-white'
                  : 'bg-slate-100 text-slate-600 hover:text-[#0F2342]'
              }`}
            >
              Mọi bậc (tạo {targetLevel})
            </button>
            {CEFR_LEVELS.map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => handleSelectLevelFilter(lvl)}
                aria-pressed={levelFilter === lvl}
                className={`px-3.5 py-2 min-h-[44px] text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  levelFilter === lvl
                    ? 'bg-[#0F2342] text-white'
                    : 'bg-slate-100 text-slate-600 hover:text-[#0F2342]'
                }`}
              >
                CEFR {lvl}
              </button>
            ))}
          </div>

          {/* Format Switcher */}
          <div
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start lg:self-auto"
            role="group"
            aria-label="Định dạng bài nghe tin tức"
          >
            <button
              type="button"
              onClick={() => setFormat('dialogue')}
              aria-pressed={format === 'dialogue'}
              className={`px-3 py-2 min-h-[44px] text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                format === 'dialogue'
                  ? 'bg-white text-[#0F2342] shadow-sm'
                  : 'text-slate-600 hover:text-[#0F2342]'
              }`}
            >
              Tóm tắt + Hội thoại (2–3 phút)
            </button>
            <button
              type="button"
              onClick={() => setFormat('summary')}
              aria-pressed={format === 'summary'}
              className={`px-3 py-2 min-h-[44px] text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                format === 'summary'
                  ? 'bg-white text-[#0F2342] shadow-sm'
                  : 'text-slate-600 hover:text-[#0F2342]'
              }`}
            >
              Bản tin tóm tắt (2–3 phút)
            </button>
          </div>
        </div>
      </section>

      {generateError && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start justify-between gap-3 text-xs text-red-800"
        >
          <span>{generateError}</span>
          <button
            type="button"
            onClick={() => setGenerateError(null)}
            className="font-semibold underline whitespace-nowrap shrink-0"
          >
            Đóng
          </button>
        </div>
      )}

      {audioRetryError && (
        <div
          role="alert"
          className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start justify-between gap-3 text-xs text-amber-900"
        >
          <span>{audioRetryError}</span>
          <button
            type="button"
            onClick={() => setAudioRetryError(null)}
            className="font-semibold underline whitespace-nowrap shrink-0"
          >
            Đóng
          </button>
        </div>
      )}

      {downloadError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900">
          {downloadError}
        </div>
      )}



      {/* SECTION 2: Verified RSS News Feed */}
      <section aria-label="Bản tin RSS xác thực" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-[#0F2342] flex items-center gap-2">
              <Newspaper className="w-5 h-5 text-[#1E4178]" aria-hidden="true" />
              <span>Bản tin thời sự từ nguồn RSS ({filteredArticles.length})</span>
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Chỉ hiển thị bài báo có ngày xuất bản, tên nguồn và đường dẫn gốc hợp lệ sau khi khử trùng lặp. Không sao chép toàn văn bài báo.
            </p>
          </div>
        </div>

        {loadingFeed ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 flex items-center justify-center gap-3 text-sm text-slate-600">
            <Loader2 className="w-4 h-4 animate-spin text-[#0F2342]" aria-hidden="true" />
            <span>Đang tải bản tin thời sự mới nhất từ RSS...</span>
          </div>
        ) : feedError ? (
          <div className="bg-white border border-red-200 rounded-xl p-6 space-y-3">
            <div className="text-sm font-semibold text-red-800">{feedError}</div>
            <button
              type="button"
              onClick={() => void loadFeed(true)}
              className="px-4 py-2 min-h-[44px] rounded-lg border border-slate-200 text-xs font-semibold text-[#0F2342] hover:bg-slate-50"
            >
              Thử tải lại bản tin
            </button>
          </div>
        ) : filteredArticles.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
            <p className="text-sm text-slate-600">
              Không tìm thấy bản tin nào phù hợp với chủ đề, ngày hoặc từ khóa đã chọn.
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="px-4 py-2 min-h-[44px] rounded-lg border border-slate-200 text-xs font-semibold text-[#0F2342] hover:bg-slate-50"
            >
              Đặt lại bộ lọc
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredArticles.map((article) => {
              const isGenerating = generatingArticleId === article.id;
              const chosenLevel = articleLevels[article.id] || 'B1';
              const chosenFormat = articleFormats[article.id] || 'dialogue';
              const existingLesson = newsLessons.find(
                (l) =>
                  (l.newsMetadata?.articleId === article.id ||
                    l.newsMetadata?.articleUrl === article.articleUrl) &&
                  l.level === chosenLevel &&
                  l.newsMetadata?.format === chosenFormat,
              );

              return (
                <article
                  key={article.id}
                  className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-5 hover:border-slate-300 transition-colors"
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <span className="font-semibold text-[#0F2342]">{article.sourceName}</span>
                      <span aria-hidden="true">·</span>
                      <time dateTime={article.publishedAt} className="tabular-nums">
                        {formatVerifiedDateVi(article.publishedAt, lang)}
                      </time>
                      <span aria-hidden="true">·</span>
                      <span>{NEWS_TOPIC_LABELS[article.topic][lang]}</span>
                      <span aria-hidden="true">·</span>
                      <span>{article.sourceLanguage === 'ru' ? 'Tiếng Nga' : 'Tiếng Anh'}</span>
                    </div>

                    <h3
                      className={`text-base font-bold text-[#0F2342] leading-snug ${
                        article.sourceLanguage === 'ru' ? 'cyrillic-prose' : ''
                      }`}
                    >
                      {article.title}
                    </h3>

                    {article.summarySnippet && (
                      <p
                        className={`text-xs text-slate-600 leading-relaxed line-clamp-3 ${
                          article.sourceLanguage === 'ru' ? 'cyrillic-prose' : ''
                        }`}
                      >
                        {article.summarySnippet}
                      </p>
                    )}

                    <div className="pt-1">
                      <a
                        href={article.articleUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#1E4178] hover:underline"
                      >
                        <span>Đọc bản tin gốc</span>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      </a>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100 space-y-3">
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold text-slate-600">
                        Chọn mức độ CEFR & định dạng để chuyển thành bài nghe:
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Chọn cấp độ CEFR">
                        {CEFR_LEVELS.map((lvl) => (
                          <button
                            key={lvl}
                            type="button"
                            onClick={() =>
                              setArticleLevels((prev) => ({ ...prev, [article.id]: lvl }))
                            }
                            aria-pressed={chosenLevel === lvl}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                              chosenLevel === lvl
                                ? 'bg-[#0F2342] text-white'
                                : 'bg-slate-100 text-slate-600 hover:text-[#0F2342]'
                            }`}
                          >
                            CEFR {lvl}
                          </button>
                        ))}
                      </div>

                      <div
                        className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs"
                        role="group"
                        aria-label="Chọn định dạng"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setArticleFormats((prev) => ({ ...prev, [article.id]: 'dialogue' }))
                          }
                          aria-pressed={chosenFormat === 'dialogue'}
                          className={`flex-1 py-1.5 px-2 rounded-md font-medium transition-colors ${
                            chosenFormat === 'dialogue'
                              ? 'bg-white text-[#0F2342] shadow-xs'
                              : 'text-slate-600'
                          }`}
                        >
                          Hội thoại + Tóm tắt
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setArticleFormats((prev) => ({ ...prev, [article.id]: 'summary' }))
                          }
                          aria-pressed={chosenFormat === 'summary'}
                          className={`flex-1 py-1.5 px-2 rounded-md font-medium transition-colors ${
                            chosenFormat === 'summary'
                              ? 'bg-white text-[#0F2342] shadow-xs'
                              : 'text-slate-600'
                          }`}
                        >
                          Bản tin tóm tắt
                        </button>
                      </div>
                    </div>

                    <div className="pt-2 flex items-center justify-end">
                      {existingLesson ? (
                        <Link
                          to={`/dictation/${existingLesson.id}`}
                          className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-lg bg-[#1F7A6E] text-white text-xs font-semibold hover:bg-[#165B52] transition-colors whitespace-nowrap"
                        >
                          <Headphones className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Mở bài {existingLesson.level} đã tạo</span>
                        </Link>
                      ) : (
                        <button
                          type="button"
                          disabled={
                            Boolean(generatingArticleId) ||
                            !isOnline ||
                            (capabilities.loaded && !capabilities.geminiConfigured)
                          }
                          onClick={() =>
                            void handleGenerateLessonFromArticle(article, chosenLevel, chosenFormat)
                          }
                          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[48px] rounded-xl bg-[#0F2342] text-white text-xs font-semibold hover:bg-[#163059] disabled:opacity-55 transition-colors shadow-sm"
                        >
                          {isGenerating ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                              <span>Đang tạo bài {chosenLevel} ({chosenFormat === 'dialogue' ? 'Hội thoại' : 'Bản tin'})...</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-4 h-4" aria-hidden="true" />
                              <span>Tạo bài nghe CEFR {chosenLevel} ({chosenFormat === 'dialogue' ? 'Hội thoại' : 'Bản tin'})</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
