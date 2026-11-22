import React, { useMemo, useState } from 'react';
import { Plus, Search, Trash2, Volume2, X } from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import { REVIEW_STATUS_LABELS, t } from '../i18n/translations';
import { russianAudioEngine } from '../services/audioPlayer';
import type { ReviewStatus } from '../types/domain';
import { getRetentionRate } from '../utils/spacedRepetition';

export const VocabularyNotebookPage: React.FC = () => {
  const {
    vocabulary,
    profile,
    capabilities,
    isOnline,
    addCustomVocabulary,
    updateVocabulary,
    deleteVocabulary,
  } = useAppState();
  const lang = profile.interfaceLanguage;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ReviewStatus>('ALL');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  const [newWord, setNewWord] = useState('');
  const [newStressed, setNewStressed] = useState('');
  const [newMeaningVi, setNewMeaningVi] = useState('');
  const [newDefRu, setNewDefRu] = useState('');
  const [newExampleRu, setNewExampleRu] = useState('');
  const [newExampleVi, setNewExampleVi] = useState('');
  const [newPos, setNewPos] = useState('существительное');
  const [newForms, setNewForms] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vocabulary.filter((item) => {
      if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
      if (q) {
        const hay =
          `${item.word} ${item.meaningVi} ${item.definitionRu} ${item.sourceLessonTitle} ${item.notes}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [vocabulary, search, statusFilter]);

  const handleAddWord = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWord.trim() || !newMeaningVi.trim()) {
      setFormError('Vui lòng nhập từ tiếng Nga và nghĩa tiếng Việt.');
      return;
    }
    addCustomVocabulary({
      word: newWord.trim(),
      stressedWord: newStressed.trim() || newWord.trim(),
      partOfSpeech: newPos.trim() || 'слово',
      forms: newForms.trim() || '—',
      meaningVi: newMeaningVi.trim(),
      definitionRu: newDefRu.trim() || newWord.trim(),
      exampleRu: newExampleRu.trim() || newWord.trim(),
      exampleVi: newExampleVi.trim() || newMeaningVi.trim(),
      sourceLessonId: 'manual',
      sourceLessonTitle: 'Thêm thủ công',
      notes: '',
    });
    setNewWord('');
    setNewStressed('');
    setNewMeaningVi('');
    setNewDefRu('');
    setNewExampleRu('');
    setNewExampleVi('');
    setNewForms('');
    setFormError(null);
    setShowAddModal(false);
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F2342]">
            {t(lang, 'navVocabulary')}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Quản lý từ vựng song ngữ Nga–Việt kèm dấu trọng âm, biến cách, ví dụ và ghi chú cá nhân.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-lg bg-[#0F2342] text-white text-sm font-medium hover:bg-[#163059] whitespace-nowrap self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span>Thêm từ mới</span>
        </button>
      </div>

      {/* Search & Status Filter */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="relative flex-1">
          <Search
            className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm từ tiếng Nga, nghĩa tiếng Việt, ghi chú..."
            aria-label="Tìm kiếm từ vựng"
            className="w-full min-h-[44px] pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F2342]/20"
          />
        </div>

        <div className="flex flex-wrap gap-1 p-1 bg-slate-100 rounded-lg">
          {(['ALL', 'new', 'learning', 'reviewing', 'mastered'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-2 min-h-[44px] text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                statusFilter === st
                  ? 'bg-white text-[#0F2342] shadow-sm'
                  : 'text-slate-600 hover:text-[#0F2342]'
              }`}
            >
              {st === 'ALL' ? `Tất cả (${vocabulary.length})` : REVIEW_STATUS_LABELS[st][lang]}
            </button>
          ))}
        </div>
      </div>

      {/* Vocabulary List */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
          Chưa có từ vựng nào khớp với bộ lọc hiện tại.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((item) => {
            const retention = getRetentionRate(item);
            const isEditing = editingNoteId === item.id;
            return (
              <article
                key={item.id}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 flex flex-col justify-between"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-slate-500">
                        {REVIEW_STATUS_LABELS[item.status][lang]} · Nhớ:{' '}
                        <span className="tabular-nums font-medium">{retention}%</span> · Lần ôn kế:{' '}
                        <span className="tabular-nums">
                          {new Date(item.nextReviewAt).toLocaleDateString('vi-VN')}
                        </span>
                      </div>
                      <h2 className="text-xl font-bold text-[#0F2342] cyrillic-prose mt-1">
                        {item.stressedWord}
                      </h2>
                      <div className="text-xs text-slate-500">
                        {item.partOfSpeech} · {item.forms}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          void russianAudioEngine.playSentence({
                            text: item.word,
                            speed: 1,
                            preferServerTts: capabilities.ttsAvailable && isOnline,
                          })
                        }
                        aria-label={`Phát âm ${item.word}`}
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                      >
                        <Volume2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteVocabulary(item.id)}
                        aria-label={`Xóa từ ${item.word}`}
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <div className="text-sm font-semibold text-[#1F7A6E]">
                    {item.meaningVi}
                  </div>
                  <p className="text-xs text-slate-700 cyrillic-prose">
                    {item.definitionRu}
                  </p>

                  <div className="pt-2 border-t border-slate-100 text-xs space-y-1">
                    <p className="text-[#0F2342] cyrillic-prose">{item.exampleRu}</p>
                    <p className="text-slate-600">{item.exampleVi}</p>
                  </div>
                </div>

                {/* Source & Editable Personal Note */}
                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <div className="text-[11px] text-slate-500">
                    Nguồn: {item.sourceLessonTitle}
                  </div>

                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        placeholder="Nhập ghi chú cá nhân..."
                        aria-label={`Ghi chú cho ${item.word}`}
                        className="w-full min-h-[44px] px-3 py-2 text-xs border border-slate-300 rounded-lg"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            updateVocabulary(item.id, { notes: noteDraft.trim() });
                            setEditingNoteId(null);
                          }}
                          className="px-3.5 min-h-[44px] rounded-lg bg-[#0F2342] text-white text-xs font-medium"
                        >
                          Lưu ghi chú
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingNoteId(null)}
                          className="px-3.5 min-h-[44px] rounded-lg border border-slate-200 text-xs text-slate-600"
                        >
                          Hủy
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-600 italic truncate">
                        {item.notes ? `Ghi chú: ${item.notes}` : 'Chưa có ghi chú cá nhân'}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingNoteId(item.id);
                          setNoteDraft(item.notes);
                        }}
                        className="min-h-[44px] px-2 -mr-2 inline-flex items-center text-[#1E4178] font-medium hover:underline shrink-0"
                      >
                        Sửa ghi chú
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Add Word Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 sm:p-6 space-y-4 shadow-xl safe-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#0F2342]">
                Thêm từ vựng vào Sổ tay
              </h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                aria-label="Đóng cửa sổ thêm từ"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddWord} className="space-y-3 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="add-word" className="block text-xs font-medium text-slate-600 mb-1">
                    Từ tiếng Nga *
                  </label>
                  <input
                    id="add-word"
                    type="text"
                    value={newWord}
                    onChange={(e) => setNewWord(e.target.value)}
                    placeholder="собеседование"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg cyrillic-prose"
                  />
                </div>
                <div>
                  <label htmlFor="add-stressed" className="block text-xs font-medium text-slate-600 mb-1">
                    Có dấu trọng âm
                  </label>
                  <input
                    id="add-stressed"
                    type="text"
                    value={newStressed}
                    onChange={(e) => setNewStressed(e.target.value)}
                    placeholder="собесе́дование"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg cyrillic-prose"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="add-vi" className="block text-xs font-medium text-slate-600 mb-1">
                  Nghĩa tiếng Việt *
                </label>
                <input
                  id="add-vi"
                  type="text"
                  value={newMeaningVi}
                  onChange={(e) => setNewMeaningVi(e.target.value)}
                  placeholder="buổi phỏng vấn"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="add-pos" className="block text-xs font-medium text-slate-600 mb-1">
                    Từ loại (tiếng Nga)
                  </label>
                  <input
                    id="add-pos"
                    type="text"
                    value={newPos}
                    onChange={(e) => setNewPos(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="add-forms" className="block text-xs font-medium text-slate-600 mb-1">
                    Dạng ngữ pháp
                  </label>
                  <input
                    id="add-forms"
                    type="text"
                    value={newForms}
                    onChange={(e) => setNewForms(e.target.value)}
                    placeholder="ср. р., -я"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="add-def-ru" className="block text-xs font-medium text-slate-600 mb-1">
                  Định nghĩa tiếng Nga
                </label>
                <input
                  id="add-def-ru"
                  type="text"
                  value={newDefRu}
                  onChange={(e) => setNewDefRu(e.target.value)}
                  placeholder="встреча с работодателем..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg cyrillic-prose"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="add-ex-ru" className="block text-xs font-medium text-slate-600 mb-1">
                    Câu ví dụ tiếng Nga
                  </label>
                  <input
                    id="add-ex-ru"
                    type="text"
                    value={newExampleRu}
                    onChange={(e) => setNewExampleRu(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg cyrillic-prose"
                  />
                </div>
                <div>
                  <label htmlFor="add-ex-vi" className="block text-xs font-medium text-slate-600 mb-1">
                    Dịch ví dụ tiếng Việt
                  </label>
                  <input
                    id="add-ex-vi"
                    type="text"
                    value={newExampleVi}
                    onChange={(e) => setNewExampleVi(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              {formError && <p className="text-xs text-red-600">{formError}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 min-h-[44px] py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 min-h-[44px] py-2 rounded-lg bg-[#0F2342] text-white text-xs font-semibold"
                >
                  Lưu từ vựng
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
