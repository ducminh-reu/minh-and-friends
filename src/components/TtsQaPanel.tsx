import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Play, RefreshCw, Volume2 } from 'lucide-react';

type QaCategory =
  | 'all'
  | 'female_single'
  | 'male_single'
  | 'dialogue_mixed'
  | 'intonation_long'
  | 'stress_proper_nouns';

interface QaSampleItem {
  id: string;
  index: number;
  category: Exclude<QaCategory, 'all'>;
  categoryLabelVi: string;
  titleVi: string;
  kind: 'single' | 'dialogue';
  gender: 'female' | 'male' | 'mixed';
  voiceName?: string;
  text?: string;
  speakers?: { speaker: string; gender: 'male' | 'female'; voiceName: string }[];
  turns?: { speaker: string; text: string }[];
  checkFocusVi: string;
  runtime: {
    status: 'ready' | 'pending' | 'failed';
    audioUrl: string | null;
    model: string | null;
    voiceIds: string[];
    genders: ('male' | 'female')[];
    acoustics: {
      valid: boolean;
      durationSec: number;
      rmsDb: number;
      clippingDetected: boolean;
      sampleRate: number;
    } | null;
    reusedFromCache: boolean;
    generatedAt: string | null;
    error: string | null;
    errorCategory: string;
  };
}

interface QaSummaryResponse {
  samples: QaSampleItem[];
  summary: {
    total: number;
    ready: number;
    pending: number;
  };
  primaryModel: string;
  secondaryModel: string;
  cacheStats?: {
    diskHits: number;
    memoryHits: number;
    upstreamCallsSucceeded: number;
    cacheHitsSaved: number;
    diskEntries: number;
  };
}

const CATEGORY_TABS: { key: QaCategory; label: string }[] = [
  { key: 'all', label: 'Tất cả (35)' },
  { key: 'female_single', label: '10 giọng nữ' },
  { key: 'male_single', label: '10 giọng nam' },
  { key: 'dialogue_mixed', label: '5 hội thoại nam/nữ' },
  { key: 'intonation_long', label: '5 câu hỏi & câu dài' },
  { key: 'stress_proper_nouns', label: '5 từ khó & tên riêng' },
];

export const TtsQaPanel: React.FC<{ ttsAvailable: boolean; isOnline: boolean }> = ({
  ttsAvailable,
  isOnline,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<QaSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [category, setCategory] = useState<QaCategory>('all');
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadSamples = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const resp = await fetch('/api/tts/qa/samples');
      if (!resp.ok) {
        throw new Error('Không tải được danh sách mẫu kiểm thử giọng đọc.');
      }
      const json = (await resp.json()) as QaSummaryResponse;
      setData(json);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi tải danh sách mẫu giọng đọc.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (expanded && !data && !loading) {
      void loadSamples();
    }
  }, [expanded, data, loading, loadSamples]);

  const handleGenerate = async (sampleIds?: string[]) => {
    if (!ttsAvailable || !isOnline || generatingId) return;
    setGeneratingId(sampleIds ? sampleIds.join(',') : 'ALL');
    setErrorMsg(null);
    setNotice(null);
    try {
      const resp = await fetch('/api/tts/qa/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sampleIds ? { sampleIds } : {}),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setErrorMsg(json.message || 'Không thể tạo mẫu âm thanh lúc này.');
        return;
      }
      if (json.qa) {
        setData((prev) => ({
          samples: json.qa.samples,
          summary: json.qa.summary,
          primaryModel: prev?.primaryModel ?? 'gemini-3.8-flash-lite-tts',
          secondaryModel: prev?.secondaryModel ?? 'gemini-3.8-flash-tts',
          cacheStats: json.cacheStats ?? prev?.cacheStats,
        }));
      } else {
        await loadSamples();
      }
      if (json.stoppedDueToQuota) {
        setErrorMsg(
          json.quotaMessage ||
            'Đã tạm dừng do hết hạn mức miễn phí (Free Tier) Gemini TTS. Các mẫu đã tạo vẫn được lưu để nghe lại.',
        );
      } else {
        setNotice(
          `Hoàn tất: tạo mới ${json.generated ?? 0} mẫu, tái sử dụng từ ổ đĩa ${json.reusedFromDisk ?? 0} mẫu (0 lượt gọi API thừa).`,
        );
      }
    } catch {
      setErrorMsg('Không kết nối được tới máy chủ để tạo mẫu kiểm thử.');
    } finally {
      setGeneratingId(null);
    }
  };

  const filteredSamples = useMemo(() => {
    if (!data) return [];
    if (category === 'all') return data.samples;
    return data.samples.filter((s) => s.category === category);
  }, [data, category]);

  return (
    <div className="border-t border-slate-100 pt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[#0F2342] flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-[#1F7A6E]" aria-hidden="true" />
            <span>Kiểm thử giọng đọc tiếng Nga (35 mẫu WAV thực tế)</span>
          </div>
          <p className="text-xs text-slate-600 mt-0.5">
            Nghe trực tiếp mẫu giọng nam/nữ, hội thoại đa nhân vật và tái sử dụng tệp đã lưu không tốn quota.
          </p>
        </div>

        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-lg border border-slate-200 text-xs font-semibold text-[#0F2342] hover:bg-slate-50"
        >
          <span>{expanded ? 'Thu gọn bộ kiểm thử' : 'Mở 35 mẫu nghe thử'}</span>
          {expanded ? (
            <ChevronUp className="w-4 h-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-4 h-4" aria-hidden="true" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="space-y-4 pt-2">
          {loading && !data ? (
            <div className="flex items-center gap-2 text-xs text-slate-600 py-4">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              <span>Đang tải danh sách 35 mẫu kiểm thử...</span>
            </div>
          ) : data ? (
            <>
              {/* Summary Bar */}
              <div className="p-3.5 rounded-xl bg-[#FAFCFF] border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="space-y-0.5">
                  <div className="font-semibold text-[#0F2342] tabular-nums">
                    Sẵn sàng: {data.summary.ready}/{data.summary.total} mẫu WAV · Model miễn phí:{' '}
                    {data.primaryModel}
                  </div>
                  {data.cacheStats && (
                    <div className="text-slate-600 tabular-nums">
                      Bộ nhớ đệm máy chủ: {data.cacheStats.diskEntries} tệp WAV · Đã tiết kiệm{' '}
                      <strong>{data.cacheStats.cacheHitsSaved}</strong> lượt gọi TTS API
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void loadSamples()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Làm mới</span>
                  </button>

                  {data.summary.pending > 0 && (
                    <button
                      type="button"
                      disabled={!ttsAvailable || !isOnline || generatingId !== null}
                      onClick={() => void handleGenerate()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-lg bg-[#0F2342] text-white text-xs font-semibold hover:bg-[#163059] disabled:opacity-50"
                    >
                      {generatingId === 'ALL' ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                          <span>Đang tạo mẫu còn thiếu...</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Tạo {data.summary.pending} mẫu còn thiếu</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {notice && (
                <div className="p-3 rounded-lg bg-[#F2F9F8] border border-[#1F7A6E]/30 text-xs text-[#165B52]">
                  {notice}
                </div>
              )}

              {errorMsg && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  {errorMsg}
                </div>
              )}

              {/* Category Filter */}
              <div className="flex flex-wrap gap-1 p-1 bg-slate-100 rounded-lg">
                {CATEGORY_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setCategory(tab.key)}
                    className={`px-3 py-1.5 min-h-[40px] text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      category === tab.key
                        ? 'bg-white text-[#0F2342] font-semibold shadow-sm'
                        : 'text-slate-600 hover:text-[#0F2342]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Sample Cards */}
              <div className="space-y-2.5 max-h-[540px] overflow-y-auto pr-1">
                {filteredSamples.map((sample) => {
                  const isReady = sample.runtime.status === 'ready' && Boolean(sample.runtime.audioUrl);
                  const isBusy = generatingId === sample.id || generatingId === 'ALL';
                  return (
                    <div
                      key={sample.id}
                      className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 space-y-0.5">
                          <div className="text-xs font-semibold text-[#0F2342]">
                            #{sample.index} · {sample.titleVi}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Giọng: {sample.runtime.voiceIds.join(', ')} (
                            {sample.runtime.genders
                              .map((g) => (g === 'female' ? 'Nữ' : 'Nam'))
                              .join(' / ')}
                            )
                            {sample.runtime.model ? ` · ${sample.runtime.model}` : ''}
                            {sample.runtime.acoustics
                              ? ` · ${sample.runtime.acoustics.durationSec}s · ${sample.runtime.acoustics.rmsDb} dB`
                              : ''}
                          </div>
                        </div>

                        {!isReady && (
                          <button
                            type="button"
                            disabled={!ttsAvailable || !isOnline || generatingId !== null}
                            onClick={() => void handleGenerate([sample.id])}
                            className="inline-flex items-center gap-1 px-3 py-1.5 min-h-[38px] rounded-lg border border-slate-200 text-xs font-semibold text-[#0F2342] hover:bg-slate-50 disabled:opacity-50 shrink-0"
                          >
                            {isBusy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <Play className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                            <span>Tạo mẫu này</span>
                          </button>
                        )}
                      </div>

                      {sample.kind === 'single' && sample.text ? (
                        <p className="text-sm text-[#0F2342] cyrillic-prose leading-relaxed">
                          {sample.text}
                        </p>
                      ) : sample.turns ? (
                        <div className="space-y-1 text-xs text-[#0F2342] cyrillic-prose">
                          {sample.turns.map((turn, tIdx) => (
                            <p key={tIdx}>
                              <strong>{turn.speaker}:</strong> {turn.text}
                            </p>
                          ))}
                        </div>
                      ) : null}

                      <div className="text-[11px] text-slate-500">{sample.checkFocusVi}</div>

                      {isReady && sample.runtime.audioUrl && (
                        <audio
                          controls
                          preload="none"
                          src={sample.runtime.audioUrl}
                          className="w-full h-9"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : errorMsg ? (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
              {errorMsg}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
