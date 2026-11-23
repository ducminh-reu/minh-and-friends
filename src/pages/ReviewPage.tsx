import React, { useMemo, useState } from 'react';
import { CheckCircle2, RotateCcw, Volume2, XCircle } from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import { REVIEW_FORMAT_LABELS, t } from '../i18n/translations';
import { russianAudioEngine } from '../services/audioPlayer';
import type { ReviewFormat } from '../types/domain';
import {
  buildReviewPrompt,
  checkTypedAnswer,
  getRetentionRate,
  selectReviewQueue,
} from '../utils/spacedRepetition';
import { getDefaultRussianNarratorSpeaker } from '../utils/voiceRegistry';

const ALL_FORMATS: ReviewFormat[] = [
  'ru_to_vi',
  'vi_to_ru',
  'fill_blank',
  'choose_word',
  'complete_sentence',
  'listen_identify',
];

export const ReviewPage: React.FC = () => {
  const { vocabulary, reviewLogs, profile, capabilities, isOnline, submitReviewOutcome } =
    useAppState();
  const lang = profile.interfaceLanguage;

  const [formatMode, setFormatMode] = useState<'mixed' | ReviewFormat>('mixed');
  const [queueIndex, setQueueIndex] = useState(0);
  const [typedInput, setTypedInput] = useState('');
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [answerCorrect, setAnswerCorrect] = useState<boolean | null>(null);
  const [sessionStats, setSessionStats] = useState({ reviewed: 0, correct: 0 });
  const [audioNotice, setAudioNotice] = useState<string | null>(null);

  const queue = useMemo(() => selectReviewQueue(vocabulary, new Date().toISOString(), 20), [vocabulary]);
  const dueCount = useMemo(
    () => vocabulary.filter((v) => new Date(v.nextReviewAt).getTime() <= Date.now()).length,
    [vocabulary],
  );

  const currentRecord = queue[queueIndex % Math.max(1, queue.length)];
  const activeFormat: ReviewFormat =
    formatMode === 'mixed'
      ? ALL_FORMATS[queueIndex % ALL_FORMATS.length]
      : formatMode;

  const prompt = useMemo(() => {
    if (!currentRecord) return null;
    return buildReviewPrompt(currentRecord, vocabulary, activeFormat);
  }, [currentRecord, vocabulary, activeFormat]);

  const handleCheckTyped = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt) return;
    const isOk = checkTypedAnswer(typedInput, prompt.expectedAnswer);
    setAnswerCorrect(isOk);
    setRevealed(true);
  };

  const handlePickChoice = (choice: string) => {
    if (!prompt || revealed) return;
    setSelectedChoice(choice);
    const isOk = checkTypedAnswer(choice, prompt.expectedAnswer);
    setAnswerCorrect(isOk);
    setRevealed(true);
  };

  const handleRate = (quality: 0 | 3 | 4 | 5) => {
    if (!currentRecord) return;
    submitReviewOutcome(currentRecord.id, activeFormat, quality);
    setSessionStats((prev) => ({
      reviewed: prev.reviewed + 1,
      correct: prev.correct + (quality >= 3 ? 1 : 0),
    }));
    setTypedInput('');
    setSelectedChoice(null);
    setRevealed(false);
    setAnswerCorrect(null);
    setQueueIndex((i) => i + 1);
  };

  if (vocabulary.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
        <h1 className="text-xl font-bold text-[#0F2342]">{t(lang, 'navReview')}</h1>
        <p className="text-sm text-slate-600">
          Sổ tay từ vựng hiện đang trống. Hãy lưu từ vựng từ bài học để bắt đầu ôn tập SRS.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F2342]">
            {t(lang, 'navReview')}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Hệ thống lặp lại ngắt quãng ưu tiên các từ đến hạn và từ bạn hay trả lời sai.
          </p>
        </div>

        <div className="text-xs text-slate-600 tabular-nums">
          Đến hạn: <strong className="text-[#0F2342]">{dueCount}</strong> · Đã ôn phiên này:{' '}
          <strong className="text-[#1F7A6E]">{sessionStats.reviewed}</strong> · Tổng lượt:{' '}
          <strong>{reviewLogs.length}</strong>
        </div>
      </div>

      {/* Format Selector */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setFormatMode('mixed');
            setRevealed(false);
            setSelectedChoice(null);
            setTypedInput('');
          }}
          className={`px-3 py-2 min-h-[44px] text-xs font-semibold rounded-md transition-colors ${
            formatMode === 'mixed'
              ? 'bg-[#0F2342] text-white'
              : 'bg-slate-100 text-slate-600 hover:text-[#0F2342]'
          }`}
        >
          Tự động xen kẽ (6 dạng)
        </button>

        {ALL_FORMATS.map((fmt) => (
          <button
            key={fmt}
            type="button"
            onClick={() => {
              setFormatMode(fmt);
              setRevealed(false);
              setSelectedChoice(null);
              setTypedInput('');
            }}
            className={`px-3 py-2 min-h-[44px] text-xs font-medium rounded-md transition-colors ${
              formatMode === fmt
                ? 'bg-[#0F2342] text-white'
                : 'bg-slate-100 text-slate-600 hover:text-[#0F2342]'
            }`}
          >
            {REVIEW_FORMAT_LABELS[fmt][lang]}
          </button>
        ))}
      </div>

      {/* Active Review Card */}
      {prompt && currentRecord && (
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-8 max-w-2xl mx-auto space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span className="font-semibold text-[#0F2342]">
              {REVIEW_FORMAT_LABELS[activeFormat][lang]}
            </span>
            <span className="tabular-nums">
              Tỷ lệ nhớ: {getRetentionRate(currentRecord)}% · Sai {currentRecord.lapses} lần
            </span>
          </div>

          {/* Prompt Display */}
          <div className="space-y-2 py-2">
            {activeFormat === 'listen_identify' ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  Nhấn nghe phát âm tiếng Nga rồi chọn từ chính xác:
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setAudioNotice(null);
                    void russianAudioEngine.playSentence({
                      text: currentRecord.word,
                      speaker: getDefaultRussianNarratorSpeaker('female'),
                      speed: 1,
                      preferServerTts:
                        profile.ttsPreference === 'auto' && capabilities.ttsAvailable && isOnline,
                      onError: (msg) => setAudioNotice(msg),
                    });
                  }}
                  className="inline-flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-lg bg-[#0F2342] text-white text-sm font-medium hover:bg-[#163059]"
                >
                  <Volume2 className="w-4 h-4" aria-hidden="true" />
                  <span>Nghe từ vựng</span>
                </button>
                {audioNotice && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    {audioNotice}
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="text-2xl font-bold text-[#0F2342] cyrillic-prose">
                  {prompt.promptText}
                </div>
                {prompt.subPromptText && (
                  <p className="text-sm text-slate-600">{prompt.subPromptText}</p>
                )}
              </>
            )}
          </div>

          {/* Interactive Answer Input or Multiple Choice */}
          {prompt.choices ? (
            <div className="space-y-2">
              {prompt.choices.map((choice) => {
                const isSelected = selectedChoice === choice;
                const isRight = checkTypedAnswer(choice, prompt.expectedAnswer);
                return (
                  <button
                    key={choice}
                    type="button"
                    disabled={revealed}
                    onClick={() => handlePickChoice(choice)}
                    className={`w-full min-h-[44px] text-left px-4 py-3 rounded-lg border text-sm transition-colors ${
                      !revealed
                        ? 'border-slate-200 hover:bg-slate-50'
                        : isRight
                          ? 'border-[#1F7A6E] bg-[#E6F3F1] text-[#165B52] font-semibold'
                          : isSelected
                            ? 'border-red-300 bg-red-50 text-red-800'
                            : 'border-slate-200 text-slate-400'
                    }`}
                  >
                    {choice}
                  </button>
                );
              })}
            </div>
          ) : (
            <form onSubmit={handleCheckTyped} className="space-y-3">
              <label htmlFor="review-type-input" className="block text-xs font-medium text-slate-600">
                Gõ đáp án tiếng Nga:
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="review-type-input"
                  type="text"
                  lang="ru"
                  value={typedInput}
                  disabled={revealed}
                  onFocus={(e) => {
                    if (window.innerWidth < 1024) {
                      const el = e.currentTarget;
                      window.setTimeout(
                        () => el.scrollIntoView({ behavior: 'smooth', block: 'center' }),
                        160,
                      );
                    }
                  }}
                  onChange={(e) => setTypedInput(e.target.value)}
                  placeholder="Nhập từ tiếng Nga..."
                  className="flex-1 min-h-[44px] scroll-mb-36 px-3.5 py-2.5 border border-slate-200 rounded-lg text-base cyrillic-prose"
                />
                {!revealed && (
                  <button
                    type="submit"
                    className="px-4 min-h-[44px] py-2.5 rounded-lg bg-[#0F2342] text-white text-sm font-medium whitespace-nowrap"
                  >
                    Kiểm tra
                  </button>
                )}
              </div>
            </form>
          )}

          {!revealed && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className="min-h-[44px] px-2 text-xs font-medium text-[#1E4178] hover:underline"
              >
                Hiện đáp án
              </button>
            </div>
          )}

          {/* Answer Reveal & SRS Quality Rating */}
          {revealed && (
            <div className="pt-4 border-t border-slate-200 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  {answerCorrect !== null && (
                    <div
                      className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                        answerCorrect ? 'text-[#165B52]' : 'text-red-700'
                      }`}
                    >
                      {answerCorrect ? (
                        <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                      ) : (
                        <XCircle className="w-4 h-4" aria-hidden="true" />
                      )}
                      <span>{answerCorrect ? 'Chính xác!' : 'Chưa khớp đáp án chuẩn'}</span>
                    </div>
                  )}

                  <div className="text-lg font-bold text-[#0F2342] cyrillic-prose">
                    {currentRecord.stressedWord} — {currentRecord.meaningVi}
                  </div>
                  <p className="text-xs text-slate-600 cyrillic-prose">
                    {currentRecord.exampleRu}
                  </p>
                  <p className="text-xs text-slate-500">{currentRecord.exampleVi}</p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setAudioNotice(null);
                    void russianAudioEngine.playSentence({
                      text: currentRecord.word,
                      speaker: getDefaultRussianNarratorSpeaker('female'),
                      speed: 1,
                      preferServerTts:
                        profile.ttsPreference === 'auto' && capabilities.ttsAvailable && isOnline,
                      onError: (msg) => setAudioNotice(msg),
                    });
                  }}
                  aria-label="Phát âm đáp án"
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 shrink-0"
                >
                  <Volume2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-600">
                  Đánh giá mức độ ghi nhớ để xếp lịch SRS:
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => handleRate(0)}
                    className="px-3 py-2.5 min-h-[44px] rounded-lg border border-red-200 bg-red-50 text-red-800 text-xs font-semibold hover:bg-red-100"
                  >
                    Quên (Ôn lại sớm)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRate(3)}
                    className="px-3 py-2.5 min-h-[44px] rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-xs font-semibold hover:bg-amber-100"
                  >
                    Khó
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRate(4)}
                    className="px-3 py-2.5 min-h-[44px] rounded-lg border border-[#1F7A6E]/30 bg-[#E6F3F1] text-[#165B52] text-xs font-semibold hover:bg-[#d7ede9]"
                  >
                    Nhớ tốt
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRate(5)}
                    className="px-3 py-2.5 min-h-[44px] rounded-lg bg-[#0F2342] text-white text-xs font-semibold hover:bg-[#163059]"
                  >
                    Rất dễ
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Session Reset Footer */}
      {sessionStats.reviewed > 0 && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => {
              setQueueIndex(0);
              setSessionStats({ reviewed: 0, correct: 0 });
            }}
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-[#0F2342]"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Bắt đầu lượt ôn tập mới</span>
          </button>
        </div>
      )}
    </div>
  );
};
