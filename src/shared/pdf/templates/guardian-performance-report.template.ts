/**
 * A parent-friendly, Arabic RTL report rendered by Chromium.
 *
 * Keep this template deliberately data-led: every displayed number comes from
 * an explicit lesson or the latest submitted attempt for an assessment.
 */
export type GuardianAssessmentType = 'QUIZ' | 'EXAM' | 'HOMEWORK';

export interface GuardianReportLesson {
  orderIndex: number;
  title: string;
  watchedPercentage: number;
  isCompleted: boolean;
  lastWatchedAt: Date | null;
}

export interface GuardianReportAssessment {
  key: string;
  type: GuardianAssessmentType;
  title: string;
  attemptNumber: number;
  percentage: number;
  isPassed: boolean | null;
  submittedAt: Date | null;
}

export interface GuardianPendingRequirement {
  key: string;
  type: GuardianAssessmentType;
  title: string;
  lessonTitle: string | null;
  availableFrom: Date | null;
  dueAt: Date | null;
  isOverdue: boolean;
  statusLabel: string;
}

export interface GuardianPerformanceReportData {
  platformName: string;
  generatedAt: Date;
  referenceCode: string;
  student: {
    fullName: string;
    gradeLevel: string | null;
    enrolledAt: Date;
  };
  courseTitle: string;
  lessons: GuardianReportLesson[];
  assessmentAttempts: GuardianReportAssessment[];
  latestAssessments: GuardianReportAssessment[];
  pendingRequirements: GuardianPendingRequirement[];
  recommendations: string[];
  teacherNote?: string | null;
}

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const formatDate = (value: Date | null): string => {
  if (!value) return 'لا توجد مشاهدة مسجلة';
  return new Intl.DateTimeFormat('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(value);
};

const assessmentTypeLabel = (type: GuardianAssessmentType): string => {
  if (type === 'EXAM') return 'امتحان';
  if (type === 'HOMEWORK') return 'واجب';
  return 'اختبار قصير';
};

const assessmentTypeClass = (type: GuardianAssessmentType): string => {
  if (type === 'EXAM') return 'exam';
  if (type === 'HOMEWORK') return 'homework';
  return 'quiz';
};

export function buildGuardianPerformanceReportHtml(
  data: GuardianPerformanceReportData,
  fontFaceCss: string,
): string {
  const completedLessons = data.lessons.filter((lesson) => lesson.isCompleted).length;
  const remainingLessons = Math.max(0, data.lessons.length - completedLessons);
  const completionPercentage =
    data.lessons.length > 0 ? Math.round((completedLessons / data.lessons.length) * 100) : 0;
  const scoredAssessments = data.latestAssessments.filter(
    (assessment) => Number.isFinite(assessment.percentage),
  );
  const averageAssessmentScore =
    scoredAssessments.length > 0
      ? Math.round(
          scoredAssessments.reduce((sum, assessment) => sum + assessment.percentage, 0) /
            scoredAssessments.length,
        )
      : null;
  const passedAssessments = data.latestAssessments.filter(
    (assessment) => assessment.isPassed === true,
  ).length;

  const lessonRows = data.lessons
    .map((lesson) => {
      const watch = Math.max(0, Math.min(100, Math.round(lesson.watchedPercentage)));
      const state = lesson.isCompleted
        ? '<span class="status status-good">مكتمل</span>'
        : watch > 0
          ? '<span class="status status-warn">متابعة جزئية</span>'
          : '<span class="status status-muted">لم يبدأ</span>';
      return `
        <tr>
          <td class="number">${lesson.orderIndex}</td>
          <td class="title-cell">${escapeHtml(lesson.title)}</td>
          <td>
            <div class="progress-cell"><span>${watch}%</span><div class="progress"><i style="width:${watch}%"></i></div></div>
          </td>
          <td>${state}</td>
          <td class="date-cell">${formatDate(lesson.lastWatchedAt)}</td>
        </tr>`;
    })
    .join('');

  const assessmentRows = data.assessmentAttempts
    .map((assessment) => {
      const status =
        assessment.isPassed === true
          ? '<span class="status status-good">مجتاز</span>'
          : assessment.isPassed === false
            ? '<span class="status status-risk">يحتاج مراجعة</span>'
            : '<span class="status status-muted">قيد التقييم</span>';
      return `
        <tr>
          <td><span class="type ${assessmentTypeClass(assessment.type)}">${assessmentTypeLabel(assessment.type)}</span></td>
          <td class="title-cell">${escapeHtml(assessment.title)}</td>
          <td class="number">${assessment.attemptNumber}</td>
          <td class="number">${assessment.percentage}%</td>
          <td>${status}</td>
          <td class="date-cell">${formatDate(assessment.submittedAt)}</td>
        </tr>`;
    })
    .join('');

  const pendingRows = data.pendingRequirements
    .map((requirement) => {
      const schedule = requirement.dueAt
        ? `الموعد: ${formatDate(requirement.dueAt)}`
        : requirement.availableFrom
          ? `متاح منذ: ${formatDate(requirement.availableFrom)}`
          : 'متاح ضمن محتوى الكورس';
      return `
        <tr>
          <td><span class="type ${assessmentTypeClass(requirement.type)}">${assessmentTypeLabel(requirement.type)}</span></td>
          <td class="title-cell">${escapeHtml(requirement.title)}${requirement.lessonTitle ? `<small>${escapeHtml(requirement.lessonTitle)}</small>` : ''}</td>
          <td>${requirement.isOverdue ? '<span class="status status-risk">متأخر</span>' : '<span class="status status-warn">مطلوب إتمامه</span>'}</td>
          <td class="date-cell">${escapeHtml(requirement.statusLabel)}<br />${schedule}</td>
        </tr>`;
    })
    .join('');

  const recommendations = data.recommendations.length
    ? data.recommendations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
    : '<li>لا توجد بيانات كافية لتقديم توصية دقيقة في الوقت الحالي.</li>';

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <style>
    ${fontFaceCss}
    * { box-sizing: border-box; }
    @page { size: A4; margin: 12mm 11mm 16mm; }
    body { margin: 0; color: #172033; background: #fff; font-family: 'Amiri', Tahoma, 'Segoe UI', sans-serif; font-size: 12px; line-height: 1.65; }
    .report { width: 100%; }
    .header { background: #16233d; color: #fff; padding: 18px 20px; border-radius: 12px; border: 1px solid #223653; }
    .brand-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    .brand { color: #f6c453; font-size: 22px; font-weight: 700; letter-spacing: .2px; }
    h1 { margin: 3px 0 0; color: #fff; font-size: 20px; line-height: 1.35; }
    .subtitle { margin: 3px 0 0; color: #d6deec; font-size: 12px; }
    .reference { text-align: left; color: #e7edf7; font-size: 10px; white-space: nowrap; }
    .reference b { display: block; color: #f6c453; font-size: 12px; }
    .identity { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 12px 0 2px; }
    .identity div { border-right: 2px solid #f6c453; padding-right: 8px; }
    .identity span { display: block; color: #b7c3d6; font-size: 10px; }
    .identity strong { display: block; color: #fff; font-size: 12px; margin-top: 1px; }
    .section { margin-top: 19px; }
    .section-title { font-size: 15px; font-weight: 700; color: #16233d; border-right: 4px solid #e6ae32; padding-right: 8px; margin: 0 0 9px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; }
    .metric { border: 1px solid #dce3ed; border-radius: 9px; padding: 8px; background: #fbfcfe; text-align: center; min-height: 65px; }
    .metric strong { display: block; color: #152a4c; font-size: 18px; line-height: 1.1; }
    .metric span { display: block; margin-top: 5px; color: #56647a; font-size: 10px; line-height: 1.35; }
    .metric.gold strong { color: #a56d05; }
    .metric.good strong { color: #137a52; }
    .metric.muted strong { color: #607087; }
    table { width: 100%; border-collapse: collapse; border: 1px solid #dbe3ed; border-radius: 9px; overflow: hidden; }
    thead { display: table-header-group; }
    th { padding: 8px 7px; background: #edf2f8; color: #263852; font-size: 10px; text-align: right; border-bottom: 1px solid #d5dfeb; }
    td { padding: 8px 7px; border-bottom: 1px solid #e7edf3; vertical-align: middle; font-size: 10.5px; }
    tbody tr:last-child td { border-bottom: 0; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    .number { font-family: Tahoma, sans-serif; text-align: center; direction: ltr; white-space: nowrap; }
    .title-cell { font-weight: 700; color: #1d2b42; max-width: 250px; overflow-wrap: anywhere; }
    .title-cell small { display: block; margin-top: 2px; color: #708097; font-size: 9px; font-weight: 400; }
    .date-cell { color: #617087; white-space: nowrap; font-size: 9.5px; }
    .progress-cell { display: flex; align-items: center; gap: 5px; direction: ltr; white-space: nowrap; }
    .progress { width: 55px; height: 5px; overflow: hidden; border-radius: 8px; background: #e3eaf2; }
    .progress i { display: block; height: 100%; background: #2d8a68; border-radius: 8px; }
    .status, .type { display: inline-block; padding: 2px 7px; border-radius: 999px; white-space: nowrap; font-size: 9.5px; font-weight: 700; }
    .status-good { background: #e1f6ed; color: #116744; }
    .status-warn { background: #fff3d7; color: #875800; }
    .status-risk { background: #fde7e7; color: #a83131; }
    .status-muted { background: #edf1f5; color: #58687d; }
    .type.quiz { background: #eaf2ff; color: #1e58a6; }
    .type.exam { background: #f8edcf; color: #856000; }
    .type.homework { background: #f0eafe; color: #6a3ca8; }
    .empty { padding: 13px; border: 1px dashed #cfd9e5; color: #637289; background: #fbfcfe; border-radius: 9px; text-align: center; }
    .pending-box { background: #fff8ed; border: 1px solid #efd7a5; border-radius: 10px; padding: 9px; }
    .pending-box table { background: #fff; }
    .recommendations { background: #fffaf0; border: 1px solid #eedcb1; border-radius: 10px; padding: 11px 14px; }
    .recommendations ul { margin: 0; padding: 0 18px 0 0; }
    .recommendations li { margin: 3px 0; }
    .teacher-note { margin-top: 9px; border-right: 3px solid #1d7b59; background: #f0faf5; padding: 9px 11px; border-radius: 7px; }
    .teacher-note b { color: #176243; }
    .footer { margin-top: 15px; padding-top: 8px; border-top: 1px solid #dae2ec; color: #78869a; display: flex; justify-content: space-between; font-size: 9px; }
  </style>
</head>
<body>
  <main class="report">
    <header class="header">
      <div class="brand-row">
        <div><div class="brand">${escapeHtml(data.platformName)}</div><h1>تقرير متابعة الأداء الأكاديمي</h1><p class="subtitle">ملخص واضح لمتابعة ولي الأمر</p></div>
        <div class="reference">تاريخ الإصدار<b>${formatDate(data.generatedAt)}</b>الرقم المرجعي: ${escapeHtml(data.referenceCode)}</div>
      </div>
      <div class="identity">
        <div><span>اسم الطالب</span><strong>${escapeHtml(data.student.fullName)}</strong></div>
        <div><span>المادة / الكورس</span><strong>${escapeHtml(data.courseTitle)}</strong></div>
        <div><span>المرحلة الدراسية</span><strong>${escapeHtml(data.student.gradeLevel || 'غير مسجلة')}</strong></div>
      </div>
    </header>

    <section class="section">
      <h2 class="section-title">ملخص موثوق للأداء</h2>
      <div class="summary">
        <div class="metric gold"><strong>${completionPercentage}%</strong><span>نسبة إكمال الدروس</span></div>
        <div class="metric good"><strong>${completedLessons} / ${data.lessons.length}</strong><span>دروس مكتملة</span></div>
        <div class="metric ${averageAssessmentScore === null ? 'muted' : 'gold'}"><strong>${averageAssessmentScore === null ? '—' : `${averageAssessmentScore}%`}</strong><span>متوسط آخر نتائج التقييمات</span></div>
        <div class="metric good"><strong>${passedAssessments} / ${data.latestAssessments.length}</strong><span>تقييمات مجتازة (آخر نتيجة)</span></div>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">المهام والتقييمات المطلوب استكمالها</h2>
      ${data.pendingRequirements.length ? `<div class="pending-box"><table><thead><tr><th>النوع</th><th>المطلوب</th><th>الحالة</th><th>التفاصيل</th></tr></thead><tbody>${pendingRows}</tbody></table></div>` : '<div class="empty">لا توجد واجبات أو اختبارات أو امتحانات منشورة لم يكتمل تسليمها.</div>'}
    </section>

    <section class="section">
      <h2 class="section-title">حالة الدروس والمحاضرات</h2>
      ${data.lessons.length ? `<table><thead><tr><th>#</th><th>اسم الدرس</th><th>المشاهدة</th><th>الحالة</th><th>آخر نشاط</th></tr></thead><tbody>${lessonRows}</tbody></table>` : '<div class="empty">لا توجد دروس منشورة في هذا الكورس حتى الآن.</div>'}
    </section>

    <section class="section">
      <h2 class="section-title">نتائج التقييمات الحالية</h2>
      ${data.assessmentAttempts.length ? `<table><thead><tr><th>النوع</th><th>اسم التقييم</th><th>المحاولة</th><th>النتيجة</th><th>الحالة</th><th>تاريخ التسليم</th></tr></thead><tbody>${assessmentRows}</tbody></table>` : '<div class="empty">لم تُسجّل نتائج مكتملة حتى الآن، لذلك لا توجد درجة أو توصية مرتبطة بتقييم.</div>'}
    </section>

    <section class="section">
      <h2 class="section-title">التوصيات التالية</h2>
      <div class="recommendations"><ul>${recommendations}</ul></div>
      ${data.teacherNote?.trim() ? `<div class="teacher-note"><b>ملاحظة معلم المادة:</b> ${escapeHtml(data.teacherNote.trim())}</div>` : ''}
    </section>

    <footer class="footer"><span>هذا التقرير يعتمد على نشاط الطالب المسجل في المنصة حتى وقت الإصدار.</span><span>الدروس المتبقية: ${remainingLessons} - عناصر مطلوبة: ${data.pendingRequirements.length}</span></footer>
  </main>
</body>
</html>`;
}
