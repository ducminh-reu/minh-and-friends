import type {
  AdaptiveAssessment,
  CefrLevel,
  DictationAttempt,
  DictationErrorCategory,
  Lesson,
  VocabularyRecord,
} from '../types/domain';
import { getRetentionRate } from './spacedRepetition';

const CEFR_ORDER: CefrLevel[] = ['B1', 'B2', 'C1', 'C2'];

export function nextCefrLevel(level: CefrLevel): CefrLevel {
  const idx = CEFR_ORDER.indexOf(level);
  return idx < CEFR_ORDER.length - 1 ? CEFR_ORDER[idx + 1] : level;
}

export function prevCefrLevel(level: CefrLevel): CefrLevel {
  const idx = CEFR_ORDER.indexOf(level);
  return idx > 0 ? CEFR_ORDER[idx - 1] : level;
}

/**
 * Evaluates learner performance over multiple completed exercises (never promotes on a single result).
 * Thresholds:
 * - < 70%: reinforce current difficulty
 * - 70–84%: continue at current difficulty
 * - 85–94%: gradually introduce more complex content
 * - 95–100%: test slightly more advanced content
 */
export function evaluateAdaptiveProgress(
  currentEstimatedLevel: CefrLevel,
  verifiedLevel: CefrLevel | null,
  attempts: DictationAttempt[],
  vocabulary: VocabularyRecord[],
): AdaptiveAssessment {
  const validAttempts = attempts.filter(
    (a) => a.listeningAccuracy !== null && a.spellingGrammarAccuracy !== null,
  );
  const recent = validAttempts.slice(0, 6);

  const avg = (vals: number[]) =>
    vals.length === 0 ? 0 : Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);

  const listeningAverage = avg(recent.map((a) => a.listeningAccuracy ?? 0));
  const lexicalAverage = avg(recent.map((a) => a.lexicalAccuracy ?? a.listeningAccuracy ?? 0));
  const spellingGrammarAverage = avg(recent.map((a) => a.spellingGrammarAccuracy ?? 0));

  const reviewedVocab = vocabulary.filter((v) => v.correctCount + v.incorrectCount > 0);
  const retentionAverage =
    reviewedVocab.length > 0
      ? avg(reviewedVocab.map((v) => getRetentionRate(v)))
      : 100;

  const compositeScore =
    recent.length === 0
      ? 0
      : reviewedVocab.length > 0
        ? Math.round(
            listeningAverage * 0.35 +
              lexicalAverage * 0.25 +
              spellingGrammarAverage * 0.25 +
              retentionAverage * 0.15,
          )
        : Math.round(
            (listeningAverage * 0.35 +
              lexicalAverage * 0.25 +
              spellingGrammarAverage * 0.25) /
              0.85,
          );

  const categoryTotals: Partial<Record<DictationErrorCategory, number>> = {};
  for (const att of validAttempts) {
    for (const [cat, count] of Object.entries(att.errorCounts) as [
      DictationErrorCategory,
      number,
    ][]) {
      if (cat === 'punctuation') continue;
      if (count > 0) {
        categoryTotals[cat] = (categoryTotals[cat] ?? 0) + count;
      }
    }
  }

  const weakCategories = Object.entries(categoryTotals)
    .map(([category, count]) => ({
      category: category as DictationErrorCategory,
      count: count ?? 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  // Never promote solely because of 1 perfect dictation: require >= 3 attempts at current or higher level
  const attemptsAtOrAboveCurrent = recent.filter(
    (a) => CEFR_ORDER.indexOf(a.lessonLevel) >= CEFR_ORDER.indexOf(currentEstimatedLevel),
  );

  let estimatedLevel = currentEstimatedLevel;
  let action: AdaptiveAssessment['action'] = 'continue';
  let actionLabelVi = 'Tiếp tục củng cố trình độ hiện tại';
  let actionDescriptionVi =
    'Duy trì luyện nghe chép ở trình độ hiện tại để giữ độ chính xác ổn định.';
  let nextTargetLevel: CefrLevel = currentEstimatedLevel;

  if (recent.length === 0) {
    action = 'continue';
    actionLabelVi = 'Bắt đầu đánh giá nền tảng';
    actionDescriptionVi =
      'Hoàn thành tối thiểu 2–3 bài nghe chép để hệ thống ước tính trình độ CEFR chính xác.';
  } else if (compositeScore < 70) {
    action = 'reinforce';
    actionLabelVi = 'Củng cố trình độ hiện tại (< 70%)';
    actionDescriptionVi =
      'Nghe lại ở tốc độ 0.85x, luyện từng câu và ôn các cấu trúc ngữ pháp còn yếu trước khi tăng độ khó.';
    nextTargetLevel = currentEstimatedLevel;
  } else if (compositeScore <= 84) {
    action = 'continue';
    actionLabelVi = 'Tiếp tục ở mức độ hiện tại (70–84%)';
    actionDescriptionVi =
      'Kết quả đang tiến triển tốt. Hãy luyện thêm 2–3 bài cùng trình độ để đạt ngưỡng 85%+.';
    nextTargetLevel = currentEstimatedLevel;
  } else if (compositeScore <= 94) {
    action = 'advance_gradually';
    actionLabelVi = 'Dần mở rộng nội dung phức tạp hơn (85–94%)';
    if (attemptsAtOrAboveCurrent.length >= 3) {
      nextTargetLevel = nextCefrLevel(currentEstimatedLevel);
      if (compositeScore >= 88 && attemptsAtOrAboveCurrent.length >= 4) {
        estimatedLevel = nextCefrLevel(currentEstimatedLevel);
      }
      actionDescriptionVi = `Hiệu suất ổn định qua ${attemptsAtOrAboveCurrent.length} bài gần nhất. Đề xuất bắt đầu làm quen bài ${nextTargetLevel}.`;
    } else {
      nextTargetLevel = currentEstimatedLevel;
      actionDescriptionVi =
        'Độ chính xác cao, cần thêm tối thiểu 3 bài ở trình độ hiện tại trước khi nâng mức CEFR ước tính.';
    }
  } else {
    action = 'test_higher';
    actionLabelVi = 'Thử sức nội dung nâng cao hơn (95–100%)';
    if (attemptsAtOrAboveCurrent.length >= 3) {
      nextTargetLevel = nextCefrLevel(currentEstimatedLevel);
      estimatedLevel = nextCefrLevel(currentEstimatedLevel);
      actionDescriptionVi = `Bạn duy trì độ chính xác xuất sắc qua nhiều bài liên tiếp. Thử thách tiếp theo ở bậc ${nextTargetLevel}.`;
    } else {
      nextTargetLevel = nextCefrLevel(currentEstimatedLevel);
      actionDescriptionVi =
        'Kết quả rất cao, tuy nhiên hệ thống không nâng cấp CEFR chỉ sau một bài. Hãy thử thêm bài kiểm tra ở mức kế tiếp.';
    }
  }

  return {
    estimatedLevel,
    verifiedLevel,
    compositeScore,
    listeningAverage,
    lexicalAverage,
    spellingGrammarAverage,
    retentionAverage,
    action,
    actionLabelVi,
    actionDescriptionVi,
    nextTargetLevel,
    sampleSize: recent.length,
    weakCategories,
  };
}

export function recommendNextLesson(
  lessons: Lesson[],
  attempts: DictationAttempt[],
  assessment: AdaptiveAssessment,
): Lesson | null {
  if (lessons.length === 0) return null;
  const completedIds = new Set(attempts.map((a) => a.lessonId));

  // 1. Prefer uncompleted lesson matching nextTargetLevel
  const targetUncompleted = lessons.find(
    (l) => l.level === assessment.nextTargetLevel && !completedIds.has(l.id),
  );
  if (targetUncompleted) return targetUncompleted;

  // 2. Prefer uncompleted lesson at current estimated level
  const currentUncompleted = lessons.find(
    (l) => l.level === assessment.estimatedLevel && !completedIds.has(l.id),
  );
  if (currentUncompleted) return currentUncompleted;

  // 3. Revisit lowest-scoring completed lesson at target/current level before jumping 2+ levels
  const sortedAtLevel = [...attempts]
    .filter(
      (a) =>
        a.lessonLevel === assessment.nextTargetLevel ||
        a.lessonLevel === assessment.estimatedLevel,
    )
    .sort((a, b) => (a.listeningAccuracy ?? 100) - (b.listeningAccuracy ?? 100));
  if (sortedAtLevel.length > 0) {
    const revisit = lessons.find((l) => l.id === sortedAtLevel[0].lessonId);
    if (revisit) return revisit;
  }

  // 4. Otherwise allow at most one level above nextTargetLevel
  const oneAbove = nextCefrLevel(assessment.nextTargetLevel);
  const oneAboveUncompleted = lessons.find(
    (l) => l.level === oneAbove && !completedIds.has(l.id),
  );
  if (oneAboveUncompleted) return oneAboveUncompleted;

  return lessons[0];
}
