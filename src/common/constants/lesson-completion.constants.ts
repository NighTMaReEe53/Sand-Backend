/**
 * Sequential lesson unlocking (Phase 1) — shared configuration.
 * A lesson counts as completed only when the student has watched at least
 * this percentage of the video (mirrors ProgressService's completion rule).
 */
export const LESSON_COMPLETION_THRESHOLD = (() => {
  const raw = Number(process.env.LESSON_COMPLETION_THRESHOLD);
  return Number.isFinite(raw) && raw > 0 && raw <= 100 ? Math.round(raw) : 90;
})();

export type LessonStatus = 'COMPLETED' | 'IN_PROGRESS' | 'AVAILABLE' | 'LOCKED';

export type LessonLockReason =
  | 'NOT_ENROLLED'
  | 'PREVIOUS_LESSON_NOT_COMPLETED'
  | 'PREVIOUS_QUIZ_NOT_COMPLETED'
  | 'PREVIOUS_HOMEWORK_NOT_COMPLETED'
  | null;

export const LESSON_LOCK_MESSAGES: Record<
  Exclude<LessonLockReason, null>,
  string
> = {
  NOT_ENROLLED: 'يجب أن تكون مسجلاً في هذا الكورس.',
  PREVIOUS_LESSON_NOT_COMPLETED: 'أكمل مشاهدة الدرس السابق أولاً.',
  PREVIOUS_QUIZ_NOT_COMPLETED: 'اجتز كويز الدرس السابق أولاً.',
  PREVIOUS_HOMEWORK_NOT_COMPLETED: 'حل واجب الدرس السابق أولاً.',
};

export interface LessonState {
  status: LessonStatus;
  lockReasonCode: LessonLockReason;
  lockMessage: string | null;
  quizCompleted: boolean;
  homeworkCompleted?: boolean;
}
