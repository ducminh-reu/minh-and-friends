import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, Sparkles } from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import { TOPIC_LABELS, t } from '../i18n/translations';
import type { CefrLevel, Lesson, TopicCategory } from '../types/domain';

export const AiLessonsPage: React.FC = () => {
  const {
    profile,
    aiLessons,
    adaptiveAssessment,
    capabilities,
    isOnline,
    addAiLesson,
  } = useAppState();

  const lang = profile.interfaceLanguage;

  const [useAdaptive, setUseAdaptive] = useState(true);
  const [selectedLevel, setSelectedLevel] = useState<CefrLevel>(adaptiveAssessment.nextTargetLevel);
  const [topic, setTopic] = useState<TopicCategory>('work');
  const [length, setLength] = useState<'short' | 'standard' | 'extended'>('standard');
  const [speakersCount, setSpeakersCount] = useState<2 | 3>(2);
  const [difficulty, setDifficulty] = useState<'accessible' | 'standard' | 'challenging'>('standard');
  const [vocabFocus, setVocabFocus] = useState('');
  const [grammarFocus, setGrammarFocus] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [generatedLesson, setGeneratedLesson] = useState<Lesson | null>(null);

  const effectiveLevel = useAdaptive ? adaptiveAssessment.nextTargetLevel : selectedLevel;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline) {
      setErrorMsg('Đang ngoại tuyến — Tính năng tạo bài học AI yêu cầu kết nối mạng.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    setGeneratedLesson(null);

    try {
      const resp = await fetch('/api/lessons/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: effectiveLevel,
          topic,
          length,
          speakersCount,
          difficulty,
          vocabFocus: vocabFocus.trim() || undefined,
          grammarFocus: grammarFocus.trim() || undefined,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setErrorMsg(
          data.message || 'Không thể tạo bài học AI. Vui lòng kiểm tra cấu hình máy chủ.',
        );
        return;
      }
      if (data.lesson) {
        addAiLesson(data.lesson);
        setGeneratedLesson(data.lesson);
      }
    } catch {
      setErrorMsg('Lỗi kết nối tới máy chủ tạo bài học AI.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl font-bold tracking-tight text-[#0F2342]">
          {t(lang, 'navAiLessons')}
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Tạo hội thoại tiếng Nga cá nhân hóa bằng Gemini AI, tự động kiểm định ngữ pháp, tính tự nhiên, độ khớp CEFR và lưu tách biệt khỏi kho bài biên tập chuẩn.
        </p>
      </div>

      {capabilities.loaded && !capabilities.geminiConfigured && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 text-xs text-amber-900">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <div className="font-semibold">
              Chế độ Demo: Máy chủ chưa cấu hình GEMINI_API_KEY
            </div>
            <p className="mt-0.5 text-amber-800">
              Tính năng tạo bài học AI thực tế yêu cầu biến môi trường <code className="font-mono">GEMINI_API_KEY</code> trên máy chủ. Toàn bộ kho bài biên tập chuẩn (B1–C2), luyện chép, phân tích lỗi và sổ tay từ vựng SRS vẫn hoạt động đầy đủ.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Generator Form */}
        <form
          onSubmit={handleGenerate}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#0F2342]">
              Cấu hình bài hội thoại
            </h2>
            <span className="text-xs text-slate-500">
              {useAdaptive ? `Thích ứng: ${effectiveLevel}` : `Cố định: ${effectiveLevel}`}
            </span>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2.5 min-h-[44px] text-sm text-[#0F2342] font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={useAdaptive}
                onChange={(e) => setUseAdaptive(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-[#0F2342]"
              />
              <span>Chế độ thích ứng (Adaptive · Đề xuất {adaptiveAssessment.nextTargetLevel})</span>
            </label>

            {!useAdaptive && (
              <div>
                <label htmlFor="ai-level" className="block text-xs font-medium text-slate-600 mb-1">
                  Trình độ CEFR mục tiêu
                </label>
                <select
                  id="ai-level"
                  value={selectedLevel}
                  onChange={(e) => setSelectedLevel(e.target.value as CefrLevel)}
                  className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="B1">CEFR B1 — Trung cấp</option>
                  <option value="B2">CEFR B2 — Trung cao cấp</option>
                  <option value="C1">CEFR C1 — Cao cấp</option>
                  <option value="C2">CEFR C2 — Thành thạo</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="ai-topic" className="block text-xs font-medium text-slate-600 mb-1">
              Chủ đề hội thoại
            </label>
            <select
              id="ai-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value as TopicCategory)}
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              {(Object.keys(TOPIC_LABELS) as TopicCategory[]).map((key) => (
                <option key={key} value={key}>
                  {TOPIC_LABELS[key][lang]} ({TOPIC_LABELS[key].ru})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ai-length" className="block text-xs font-medium text-slate-600 mb-1">
                Độ dài hội thoại
              </label>
              <select
                id="ai-length"
                value={length}
                onChange={(e) => setLength(e.target.value as 'short' | 'standard' | 'extended')}
                className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                <option value="short">Ngắn (~8 câu)</option>
                <option value="standard">Chuẩn (~11 câu)</option>
                <option value="extended">Dài (~14 câu)</option>
              </select>
            </div>

            <div>
              <label htmlFor="ai-speakers" className="block text-xs font-medium text-slate-600 mb-1">
                Số người nói
              </label>
              <select
                id="ai-speakers"
                value={speakersCount}
                onChange={(e) => setSpeakersCount(Number(e.target.value) === 3 ? 3 : 2)}
                className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                <option value={2}>2 người nói</option>
                <option value={3}>3 người nói</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="ai-difficulty" className="block text-xs font-medium text-slate-600 mb-1">
              Sắc thái độ khó
            </label>
            <select
              id="ai-difficulty"
              value={difficulty}
              onChange={(e) =>
                setDifficulty(e.target.value as 'accessible' | 'standard' | 'challenging')
              }
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              <option value="accessible">Dễ tiếp cận, phát âm rõ ràng</option>
              <option value="standard">Chuẩn mực tự nhiên</option>
              <option value="challenging">Thử thách, tốc độ bản ngữ & thành ngữ</option>
            </select>
          </div>

          <div>
            <label htmlFor="ai-vocab" className="block text-xs font-medium text-slate-600 mb-1">
              Trọng tâm từ vựng (tùy chọn)
            </label>
            <input
              id="ai-vocab"
              type="text"
              value={vocabFocus}
              onChange={(e) => setVocabFocus(e.target.value)}
              placeholder="VD: đàm phán hợp đồng, thương mại điện tử..."
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>

          <div>
            <label htmlFor="ai-grammar" className="block text-xs font-medium text-slate-600 mb-1">
              Trọng tâm ngữ pháp (tùy chọn)
            </label>
            <input
              id="ai-grammar"
              type="text"
              value={grammarFocus}
              onChange={(e) => setGrammarFocus(e.target.value)}
              placeholder="VD: thể động từ СВ/НСВ, cách công cụ, phân từ..."
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !isOnline}
            className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#0F2342] text-white text-sm font-semibold hover:bg-[#163059] disabled:opacity-60 transition-colors"
          >
            <Sparkles className="w-4 h-4" aria-hidden="true" />
            <span>
              {!isOnline
                ? 'Cần kết nối mạng để tạo bài AI'
                : loading
                  ? 'Đang tạo & kiểm định bài học...'
                  : 'Tạo bài học AI'}
            </span>
          </button>

          {errorMsg && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              {errorMsg}
            </div>
          )}
        </form>

        {/* Right Panel: Generated Result + Saved AI Lessons */}
        <div className="lg:col-span-7 space-y-6">
          {generatedLesson && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-[#1E4178]">
                  Nội dung do AI tạo (tách biệt với bài biên tập chuẩn)
                </span>
                <span className="text-slate-500">CEFR {generatedLesson.level}</span>
              </div>

              <div>
                <h2 className="text-xl font-bold text-[#0F2342] cyrillic-prose">
                  {generatedLesson.titleRu}
                </h2>
                <p className="text-sm font-medium text-slate-700 mt-0.5">
                  {generatedLesson.titleVi}
                </p>
                {generatedLesson.levelJustificationVi && (
                  <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                    <strong>Lý giải CEFR:</strong> {generatedLesson.levelJustificationVi}
                  </p>
                )}
              </div>

              {generatedLesson.qualityChecks && (
                <div className="p-4 rounded-lg bg-[#F7F9FC] border border-slate-200 space-y-2">
                  <div className="text-xs font-semibold text-[#0F2342]">
                    Kiểm tra chất lượng tự động
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                    {(
                      [
                        ['grammar', 'Ngữ pháp tiếng Nga chuẩn'],
                        ['naturalness', 'Độ tự nhiên của hội thoại'],
                        ['cefrMatch', `Đúng bậc CEFR ${generatedLesson.level}`],
                        ['vocabAppropriate', 'Từ vựng trọng tâm phù hợp'],
                        ['transcriptConsistent', 'Khớp đoạn hội thoại & bản chép'],
                      ] as const
                    ).map(([k, label]) => {
                      const ok = generatedLesson.qualityChecks?.[k];
                      return (
                        <div key={k} className="flex items-center gap-1.5 text-slate-700">
                          <CheckCircle2
                            className={`w-3.5 h-3.5 ${ok ? 'text-[#1F7A6E]' : 'text-amber-600'}`}
                            aria-hidden="true"
                          />
                          <span>{label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <Link
                  to={`/dictation/${generatedLesson.id}`}
                  className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-lg bg-[#0F2342] text-white text-sm font-medium hover:bg-[#163059]"
                >
                  <span>Luyện nghe chép bài này</span>
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </Link>
              </div>
            </section>
          )}

          {/* List of saved AI lessons */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="text-base font-semibold text-[#0F2342]">
              Bài học AI đã tạo ({aiLessons.length})
            </h2>

            {aiLessons.length === 0 ? (
              <p className="text-sm text-slate-500 py-4">
                Chưa có bài học AI nào được tạo trong phiên này. Hãy cấu hình thông số ở cột bên trái để tạo bài mới khi máy chủ có Gemini API key, hoặc luyện các bài chuẩn trong Thư viện.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {aiLessons.map((item) => (
                  <div
                    key={item.id}
                    className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-xs text-slate-500">
                        <span className="font-semibold text-[#1E4178]">AI Generated</span> · CEFR{' '}
                        {item.level} · {TOPIC_LABELS[item.topic][lang]}
                      </div>
                      <div className="text-sm font-semibold text-[#0F2342] cyrillic-prose mt-0.5">
                        {item.titleRu}
                      </div>
                      <div className="text-xs text-slate-600">{item.titleVi}</div>
                    </div>

                    <Link
                      to={`/dictation/${item.id}`}
                      className="inline-flex items-center justify-center px-3.5 py-2 min-h-[44px] rounded-lg border border-slate-200 text-xs font-medium text-[#0F2342] hover:bg-slate-50 whitespace-nowrap self-start sm:self-center"
                    >
                      Luyện ngay
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
