import type {
  DialogueSentence,
  DictationAnalysisReport,
  DictationErrorCategory,
  DictationErrorItem,
  DictationMode,
  DiffToken,
  SentenceComparisonResult,
} from '../types/domain';
import { ERROR_CATEGORY_LABELS } from '../i18n/translations.ts';

const COMBINING_ACUTE = /\u0301/g;

export function stripStressMarks(input: string): string {
  return input.normalize('NFC').replace(COMBINING_ACUTE, '');
}

export function normalizeYoToYe(word: string): string {
  return word.replace(/ё/g, 'е').replace(/Ё/g, 'Е');
}

/**
 * Extracts Russian/Latin/numeric lexical tokens, separating out punctuation.
 * Preserves original casing in `raw`, lowercase normalized in `norm`.
 */
export function tokenizeLexicalWords(text: string): { raw: string; norm: string }[] {
  const clean = stripStressMarks(text).trim();
  if (!clean) return [];
  const matches = clean.match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? [];
  return matches.map((raw) => ({
    raw,
    norm: raw.toLowerCase(),
  }));
}

export function extractPunctuation(text: string): string[] {
  const clean = stripStressMarks(text);
  return clean.match(/[.,!?;:—–\-"«»()]/g) ?? [];
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

function isGenderNumberEndingPair(refEnd: string, learnEnd: string): boolean {
  const adjEndings = new Set([
    'ый', 'ий', 'ой', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ого', 'его', 'ому', 'ему',
    'му', 'е', 'го', 'й', 'я', 'и',
  ]);
  const pastVerbEndings = new Set(['л', 'ла', 'ло', 'ли', '', 'а', 'о', 'и']);
  if (adjEndings.has(refEnd) && adjEndings.has(learnEnd)) return true;
  if (pastVerbEndings.has(refEnd) && pastVerbEndings.has(learnEnd)) return true;
  return false;
}

function isCaseEndingPair(refEnd: string, learnEnd: string): boolean {
  const caseEndings = new Set([
    'а', 'я', 'у', 'ю', 'е', 'и', 'ы', 'о', 'ом', 'ем', 'ой', 'ей', 'ов', 'ев',
    'ам', 'ям', 'ах', 'ях', 'ами', 'ями', 'ую', 'юю', 'му', 'го', 'м', 'х',
  ]);
  return (
    (refEnd === '' || caseEndings.has(refEnd)) &&
    (learnEnd === '' || caseEndings.has(learnEnd)) &&
    refEnd !== learnEnd
  );
}

function looksLikeAspectPair(refNorm: string, learnNorm: string): boolean {
  const aspectPrefixes = ['с', 'по', 'про', 'на', 'за', 'при', 'вы', 'от', 'до', 'пере', 'у', 'о'];
  for (const p of aspectPrefixes) {
    if (refNorm === p + learnNorm || learnNorm === p + refNorm) {
      return true;
    }
  }
  const suffixPairs: [string, string][] = [
    ['ивать', 'ить'],
    ['ывать', 'ать'],
    ['ивал', 'ил'],
    ['ывал', 'ал'],
    ['ать', 'ить'],
    ['ять', 'ить'],
    ['ал', 'ил'],
  ];
  for (const [s1, s2] of suffixPairs) {
    if (
      (refNorm.endsWith(s1) && learnNorm.endsWith(s2) && commonPrefixLength(refNorm, learnNorm) >= 3) ||
      (refNorm.endsWith(s2) && learnNorm.endsWith(s1) && commonPrefixLength(refNorm, learnNorm) >= 3)
    ) {
      return true;
    }
  }
  return false;
}

function isPhoneticMishearing(refNorm: string, learnNorm: string): boolean {
  // Common Russian vowel reduction & consonant voicing/devoicing confusions
  const pairs: [string, string][] = [
    ['о', 'а'],
    ['е', 'и'],
    ['я', 'и'],
    ['т', 'д'],
    ['п', 'б'],
    ['с', 'з'],
    ['к', 'г'],
    ['ф', 'в'],
    ['ш', 'ж'],
    ['ч', 'щ'],
    ['ц', 'тс'],
  ];
  const dist = levenshtein(refNorm, learnNorm);
  if (dist > 3) return false;
  for (const [a, b] of pairs) {
    if (
      (refNorm.includes(a) && learnNorm.includes(b)) ||
      (refNorm.includes(b) && learnNorm.includes(a))
    ) {
      return true;
    }
  }
  return dist >= Math.ceil(Math.max(refNorm.length, learnNorm.length) * 0.45);
}

export function classifyWordSubstitution(
  refWordRaw: string,
  learnWordRaw: string,
): {
  category: DictationErrorCategory;
  explanationVi: string;
  explanationRu: string;
} {
  const ref = normalizeYoToYe(refWordRaw.toLowerCase());
  const learn = normalizeYoToYe(learnWordRaw.toLowerCase());
  const prefix = commonPrefixLength(ref, learn);
  const minLen = Math.min(ref.length, learn.length);
  const dist = levenshtein(ref, learn);

  if (looksLikeAspectPair(ref, learn)) {
    return {
      category: 'aspect',
      explanationVi: `Nhầm thể động từ (СВ/НСВ) giữa «${learnWordRaw}» và «${refWordRaw}». Kiểm tra ý nghĩa hoàn thành hay tiếp diễn.`,
      explanationRu: `Смешение видов глагола (СВ/НСВ): «${learnWordRaw}» вместо «${refWordRaw}». Обратите внимание на завершённость или повторяемость действия.`,
    };
  }

  if (prefix >= 3 && prefix >= Math.floor(minLen * 0.55)) {
    const refEnd = ref.slice(prefix);
    const learnEnd = learn.slice(prefix);

    if (isGenderNumberEndingPair(refEnd, learnEnd)) {
      return {
        category: 'gender_number',
        explanationVi: `Sai hợp giống hoặc số ở đuôi từ: bạn viết «${learnWordRaw}», dạng đúng là «${refWordRaw}».`,
        explanationRu: `Ошибка согласования в роде или числе: «${learnWordRaw}» вместо «${refWordRaw}».`,
      };
    }

    if (isCaseEndingPair(refEnd, learnEnd)) {
      return {
        category: 'case',
        explanationVi: `Sai biến cách (падеж) ở đuôi từ: «${learnWordRaw}» cần chia thành «${refWordRaw}» theo giới từ hoặc động từ đi kèm.`,
        explanationRu: `Падежная ошибка: вместо «${learnWordRaw}» требуется форма «${refWordRaw}» по управлению глагола или предлога.`,
      };
    }

    if (dist <= 2 && refEnd.length > 0 && learnEnd.length > 0) {
      return {
        category: 'word_form',
        explanationVi: `Sai dạng biến đổi của từ: «${learnWordRaw}» → đúng là «${refWordRaw}».`,
        explanationRu: `Неверная словоформа: «${learnWordRaw}» следует заменить на «${refWordRaw}».`,
      };
    }
  }

  if (dist <= 2 && Math.max(ref.length, learn.length) >= 4) {
    if (isPhoneticMishearing(ref, learn) && prefix < Math.floor(minLen * 0.5)) {
      return {
        category: 'listening',
        explanationVi: `Có thể nghe nhầm âm thanh: bạn nghe thành «${learnWordRaw}» thay vì «${refWordRaw}».`,
        explanationRu: `Вероятная ошибка слухового восприятия: услышано «${learnWordRaw}» вместо «${refWordRaw}».`,
      };
    }
    return {
      category: 'spelling',
      explanationVi: `Lỗi chính tả nguyên âm/phụ âm không trọng âm: «${learnWordRaw}» → «${refWordRaw}».`,
      explanationRu: `Орфографическая ошибка: правильно пишется «${refWordRaw}», а не «${learnWordRaw}».`,
    };
  }

  return {
    category: 'listening',
    explanationVi: `Nghe nhầm từ hoặc cụm từ: bạn chép «${learnWordRaw}», bản gốc là «${refWordRaw}».`,
    explanationRu: `Ошибка восприятия слова на слух: написано «${learnWordRaw}» вместо «${refWordRaw}».`,
  };
}

export function compareSentence(
  sentence: DialogueSentence,
  learnerRaw: string,
): SentenceComparisonResult {
  const refText = stripStressMarks(sentence.text).trim();
  const learnText = stripStressMarks(learnerRaw || '').trim();

  const refTokens = tokenizeLexicalWords(refText);
  const learnTokens = tokenizeLexicalWords(learnText);

  if (refTokens.length === 0) {
    return {
      sentenceId: sentence.id,
      order: sentence.order,
      speaker: sentence.speaker,
      referenceText: refText,
      learnerText: learnText,
      correctedText: refText,
      tokens: [],
      errors: [],
      listeningAccuracy: null,
      lexicalAccuracy: null,
      spellingGrammarAccuracy: null,
      punctuationAccuracy: null,
      yoNormalizedNotes: 0,
    };
  }

  // Alignment DP on lexical tokens (allowing yo/ye equivalence for matching)
  const m = refTokens.length;
  const n = learnTokens.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const rNorm = normalizeYoToYe(refTokens[i - 1].norm);
      const lNorm = normalizeYoToYe(learnTokens[j - 1].norm);
      const exact = rNorm === lNorm;
      const closeStem = !exact && levenshtein(rNorm, lNorm) <= 2;
      const subCost = exact ? 0 : closeStem ? 0.9 : 1.4;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + subCost,
      );
    }
  }

  // Backtrack alignment
  const aligned: DiffToken[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const rNorm = normalizeYoToYe(refTokens[i - 1].norm);
      const lNorm = normalizeYoToYe(learnTokens[j - 1].norm);
      const exact = rNorm === lNorm;
      const closeStem = !exact && levenshtein(rNorm, lNorm) <= 2;
      const subCost = exact ? 0 : closeStem ? 0.9 : 1.4;
      if (Math.abs(dp[i][j] - (dp[i - 1][j - 1] + subCost)) < 1e-6) {
        if (exact) {
          aligned.push({
            type: 'match',
            referenceWord: refTokens[i - 1].raw,
            learnerWord: learnTokens[j - 1].raw,
          });
        } else {
          const classified = classifyWordSubstitution(
            refTokens[i - 1].raw,
            learnTokens[j - 1].raw,
          );
          aligned.push({
            type: 'substitute',
            referenceWord: refTokens[i - 1].raw,
            learnerWord: learnTokens[j - 1].raw,
            category: classified.category,
          });
        }
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && Math.abs(dp[i][j] - (dp[i - 1][j] + 1)) < 1e-6) {
      aligned.push({
        type: 'missing',
        referenceWord: refTokens[i - 1].raw,
        category: 'missing',
      });
      i--;
    } else if (j > 0) {
      aligned.push({
        type: 'extra',
        learnerWord: learnTokens[j - 1].raw,
        category: 'extra',
      });
      j--;
    }
  }
  aligned.reverse();

  const errors: DictationErrorItem[] = [];
  let exactMatches = 0;
  let heardCloseMatches = 0;
  let grammaticalOrSpellingCount = 0;

  aligned.forEach((tok, idx) => {
    if (tok.type === 'match') {
      exactMatches += 1;
      heardCloseMatches += 1;
    } else if (tok.type === 'missing') {
      errors.push({
        id: `${sentence.id}-err-${idx}`,
        sentenceId: sentence.id,
        sentenceOrder: sentence.order,
        category: 'missing',
        severity: ERROR_CATEGORY_LABELS.missing.severity,
        referenceSnippet: tok.referenceWord ?? '',
        learnerSnippet: '∅',
        correctedSnippet: tok.referenceWord ?? '',
        explanationVi: `Bạn đã bỏ sót từ «${tok.referenceWord}» khi nghe chép câu này.`,
        explanationRu: `Пропущено слово «${tok.referenceWord}». Переслушайте фрагмент внимательнее.`,
      });
    } else if (tok.type === 'extra') {
      errors.push({
        id: `${sentence.id}-err-${idx}`,
        sentenceId: sentence.id,
        sentenceOrder: sentence.order,
        category: 'extra',
        severity: ERROR_CATEGORY_LABELS.extra.severity,
        referenceSnippet: '∅',
        learnerSnippet: tok.learnerWord ?? '',
        correctedSnippet: '',
        explanationVi: `Từ «${tok.learnerWord}» không có trong hội thoại gốc (có thể do nghe dư hoặc tách từ).`,
        explanationRu: `Лишнее слово «${tok.learnerWord}», которого нет в исходной реплике.`,
      });
    } else if (tok.type === 'substitute') {
      const classified = classifyWordSubstitution(
        tok.referenceWord ?? '',
        tok.learnerWord ?? '',
      );
      if (classified.category !== 'listening') {
        // Learner heard the root word correctly, erred in form/spelling/grammar
        heardCloseMatches += 0.75;
        grammaticalOrSpellingCount += 1;
      } else {
        grammaticalOrSpellingCount += 0.5;
      }
      errors.push({
        id: `${sentence.id}-err-${idx}`,
        sentenceId: sentence.id,
        sentenceOrder: sentence.order,
        category: classified.category,
        severity: ERROR_CATEGORY_LABELS[classified.category].severity,
        referenceSnippet: tok.referenceWord ?? '',
        learnerSnippet: tok.learnerWord ?? '',
        correctedSnippet: tok.referenceWord ?? '',
        explanationVi: classified.explanationVi,
        explanationRu: classified.explanationRu,
      });
    }
  });

  // Separate punctuation comparison so it doesn't distort lexical/listening accuracy
  const refPunct = extractPunctuation(refText);
  const learnPunct = extractPunctuation(learnText);
  let punctuationAccuracy = 100;
  if (refPunct.length > 0) {
    const punctDist = levenshtein(refPunct.join(''), learnPunct.join(''));
    punctuationAccuracy = Math.max(
      0,
      Math.round(((refPunct.length - Math.min(punctDist, refPunct.length)) / refPunct.length) * 100),
    );
    if (punctDist > 0 && learnTokens.length > 0) {
      errors.push({
        id: `${sentence.id}-err-punct`,
        sentenceId: sentence.id,
        sentenceOrder: sentence.order,
        category: 'punctuation',
        severity: 'minor',
        referenceSnippet: refPunct.join(' '),
        learnerSnippet: learnPunct.join(' ') || '(không có dấu câu)',
        correctedSnippet: refPunct.join(' '),
        explanationVi:
          'Khác biệt nhỏ về dấu câu (dấu phẩy, gạch ngang, dấu hỏi). Dấu câu không làm giảm điểm nghe hiểu từ vựng.',
        explanationRu:
          'Незначительное расхождение в пунктуации (запятые, тире, знаки конца предложения).',
      });
    }
  }

  // Count ё->е harmless normalization notes
  let yoNormalizedNotes = 0;
  for (const tok of aligned) {
    if (
      tok.type === 'match' &&
      tok.referenceWord &&
      tok.learnerWord &&
      tok.referenceWord.toLowerCase() !== tok.learnerWord.toLowerCase()
    ) {
      yoNormalizedNotes++;
    }
  }

  const totalRef = refTokens.length;
  const missingCount = aligned.filter((t) => t.type === 'missing').length;
  const extraCount = aligned.filter((t) => t.type === 'extra').length;
  const listeningAccuracy = Math.max(
    0,
    Math.min(100, Math.round((heardCloseMatches / Math.max(totalRef, 1)) * 100)),
  );
  const lexicalAccuracy = Math.max(
    0,
    Math.min(100, Math.round((exactMatches / Math.max(totalRef + extraCount * 0.5, 1)) * 100)),
  );
  const spellingGrammarAccuracy =
    learnTokens.length === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            100,
            Math.round(
              ((totalRef - missingCount - grammaticalOrSpellingCount - extraCount * 0.25) /
                Math.max(totalRef, 1)) *
                100,
            ),
          ),
        );

  return {
    sentenceId: sentence.id,
    order: sentence.order,
    speaker: sentence.speaker,
    referenceText: refText,
    learnerText: learnText,
    correctedText: refText,
    tokens: aligned,
    errors,
    listeningAccuracy,
    lexicalAccuracy,
    spellingGrammarAccuracy,
    punctuationAccuracy,
    yoNormalizedNotes,
  };
}

/**
 * Splits a full dialogue learner submission across reference sentences using proportional
 * or line-break alignment when the learner wrote in Full Dialogue mode.
 */
export function alignFullDialogueToSentences(
  sentences: DialogueSentence[],
  fullText: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = fullText
    .split(/\n+/)
    .map((l) => l.replace(/^[^:\n]{1,24}:\s*/u, '').trim())
    .filter(Boolean);

  if (lines.length === sentences.length) {
    sentences.forEach((s, idx) => {
      result[s.id] = lines[idx];
    });
    return result;
  }

  // Fallback: split by Russian sentence-ending punctuation or proportional token slice
  const bySentenceEnd = fullText
    .replace(/^[^:\n]{1,24}:\s*/gmu, '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (bySentenceEnd.length === sentences.length) {
    sentences.forEach((s, idx) => {
      result[s.id] = bySentenceEnd[idx];
    });
    return result;
  }

  const allWords = fullText
    .replace(/^[^:\n]{1,24}:\s*/gmu, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const totalRefWords = sentences.reduce(
    (sum, s) => sum + Math.max(1, tokenizeLexicalWords(s.text).length),
    0,
  );
  let cursor = 0;
  sentences.forEach((s, idx) => {
    if (idx === sentences.length - 1) {
      result[s.id] = allWords.slice(cursor).join(' ');
    } else {
      const refLen = Math.max(1, tokenizeLexicalWords(s.text).length);
      const take = Math.round((refLen / Math.max(1, totalRefWords)) * allWords.length);
      result[s.id] = allWords.slice(cursor, cursor + take).join(' ');
      cursor += take;
    }
  });
  return result;
}

export function analyzeDictationSubmission(
  lessonId: string,
  sentences: DialogueSentence[],
  mode: DictationMode,
  sentenceInputs: Record<string, string>,
  fullInput?: string,
): DictationAnalysisReport {
  const validReferenceSentences = sentences.filter(
    (s) => tokenizeLexicalWords(s.text).length > 0,
  );

  // Guard: never claim listening accuracy when no reference transcript is available
  if (validReferenceSentences.length === 0) {
    return {
      lessonId,
      mode,
      referenceAvailable: false,
      listeningAccuracy: null,
      lexicalAccuracy: null,
      spellingGrammarAccuracy: null,
      punctuationAccuracy: null,
      totalReferenceWords: 0,
      matchedWords: 0,
      sentences: [],
      errors: [],
      errorCountsByCategory: {
        listening: 0,
        missing: 0,
        extra: 0,
        word_form: 0,
        spelling: 0,
        grammar: 0,
        case: 0,
        gender_number: 0,
        aspect: 0,
        punctuation: 0,
      },
      recommendationsVi: [
        'Không có bản chép mẫu tham chiếu để đối chiếu độ chính xác nghe.',
      ],
    };
  }

  const effectiveInputs =
    mode === 'full' && fullInput !== undefined
      ? alignFullDialogueToSentences(sentences, fullInput)
      : sentenceInputs;

  const sentenceResults = sentences.map((s) =>
    compareSentence(s, effectiveInputs[s.id] ?? ''),
  );

  const errorCountsByCategory: Record<DictationErrorCategory, number> = {
    listening: 0,
    missing: 0,
    extra: 0,
    word_form: 0,
    spelling: 0,
    grammar: 0,
    case: 0,
    gender_number: 0,
    aspect: 0,
    punctuation: 0,
  };

  const allErrors: DictationErrorItem[] = [];
  let totalRefWords = 0;
  let matchedWords = 0;
  let weightedListening = 0;
  let weightedLexical = 0;
  let weightedSpellingGrammar = 0;
  let weightedPunct = 0;

  for (const res of sentenceResults) {
    const refWordCount = tokenizeLexicalWords(res.referenceText).length;
    totalRefWords += refWordCount;
    matchedWords += res.tokens.filter((t) => t.type === 'match').length;
    weightedListening += (res.listeningAccuracy ?? 0) * refWordCount;
    weightedLexical += (res.lexicalAccuracy ?? 0) * refWordCount;
    weightedSpellingGrammar += (res.spellingGrammarAccuracy ?? 0) * refWordCount;
    weightedPunct += (res.punctuationAccuracy ?? 100) * refWordCount;

    for (const err of res.errors) {
      allErrors.push(err);
      errorCountsByCategory[err.category] += 1;
    }
  }

  const listeningAccuracy = Math.round(weightedListening / Math.max(totalRefWords, 1));
  const lexicalAccuracy = Math.round(weightedLexical / Math.max(totalRefWords, 1));
  const spellingGrammarAccuracy = Math.round(
    weightedSpellingGrammar / Math.max(totalRefWords, 1),
  );
  const punctuationAccuracy = Math.round(weightedPunct / Math.max(totalRefWords, 1));

  const recommendationsVi: string[] = [];
  if (errorCountsByCategory.case > 0) {
    recommendationsVi.push(
      'Ôn lại hệ thống 6 cách tiếng Nga (đặc biệt cách sinh, cách tặng và cách giới từ sau động từ/giới từ).',
    );
  }
  if (errorCountsByCategory.aspect > 0) {
    recommendationsVi.push(
      'Chú ý phân biệt cặp động từ thể chưa hoàn thành (НСВ) và hoàn thành (СВ) qua tiền tố và hậu tố.',
    );
  }
  if (errorCountsByCategory.gender_number > 0) {
    recommendationsVi.push(
      'Kiểm tra sự hòa hợp giữa tính từ, đại từ sở hữu và động từ quá khứ theo giống/số của danh từ chủ ngữ.',
    );
  }
  if (errorCountsByCategory.listening + errorCountsByCategory.missing > 2) {
    recommendationsVi.push(
      'Nghe lại ở tốc độ 0.85x theo từng câu để bắt rõ các giới từ ngắn và từ nối không mang trọng âm.',
    );
  }
  if (errorCountsByCategory.spelling > 0) {
    recommendationsVi.push(
      'Lưu ý quy tắc nhược hóa nguyên âm «о/а» và «е/и» ở âm tiết không mang trọng âm.',
    );
  }
  if (recommendationsVi.length === 0) {
    recommendationsVi.push(
      'Kết quả rất vững! Hãy lưu các cụm từ hay vào Sổ tay từ vựng và thử sức với tốc độ 1.15x ở bài tiếp theo.',
    );
  }

  return {
    lessonId,
    mode,
    referenceAvailable: true,
    listeningAccuracy,
    lexicalAccuracy,
    spellingGrammarAccuracy,
    punctuationAccuracy,
    totalReferenceWords: totalRefWords,
    matchedWords,
    sentences: sentenceResults,
    errors: allErrors,
    errorCountsByCategory,
    recommendationsVi,
  };
}
