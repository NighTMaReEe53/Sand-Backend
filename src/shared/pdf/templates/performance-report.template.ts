/**
 * Student performance report — full RTL Arabic HTML template rendered by Puppeteer.
 */

export interface PerformanceActivityItem {
  type: 'EXAM' | 'QUIZ';
  title: string;
  score: number;
  isPassed: boolean;
  date?: Date | null;
}

export interface PerformanceTopic {
  lessonTitle: string;
  accuracy: number;
  answersCount: number;
}

export interface PerformanceReportData {
  studentName: string;
  generatedAt: Date;
  overview: {
    examsCompleted: number;
    examsPassed: number;
    avgExamScore: number | null;
    bestExamScore: number | null;
    worstExamScore: number | null;
    quizzesCompleted: number;
    quizzesPassed: number;
    avgQuizScore: number | null;
    coursesEnrolled: number;
    coursesCompleted: number;
    lessonsCompleted: number;
    totalLessonsInEnrolledCourses: number;
  };
  weakTopics: PerformanceTopic[];
  strongTopics: PerformanceTopic[];
  recentActivity: PerformanceActivityItem[];
}

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmtDate = (d: Date): string =>
  new Intl.DateTimeFormat('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);

const pct = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : `${Math.round(v)}%`;

function topicList(topics: PerformanceTopic[], color: string, emptyText: string): string {
  if (!topics.length) return `<p class="empty">${esc(emptyText)}</p>`;
  return topics
    .map(
      (t) => `
      <div class="topic">
        <div class="topic-head">
          <span class="topic-name">${esc(t.lessonTitle)}</span>
          <span class="topic-score" style="color:${color}">${Math.round(t.accuracy)}%</span>
        </div>
        <div class="bar"><div class="bar-fill" style="width:${Math.min(100, Math.max(0, t.accuracy))}%;background:${color}"></div></div>
      </div>`,
    )
    .join('');
}

export function buildPerformanceReportHtml(
  data: PerformanceReportData,
  fontFaceCss: string,
): string {
  const { studentName, generatedAt, overview, weakTopics, strongTopics, recentActivity } = data;

  const rows = recentActivity
    .map((item) => {
      const kind =
        item.type === 'EXAM'
          ? '<span class="chip chip-exam">امتحان</span>'
          : '<span class="chip chip-quiz">اختبار قصير</span>';
      const status = item.isPassed
        ? '<span class="status ok">ناجح</span>'
        : '<span class="status fail">راسب</span>';
      const date = item.date ? fmtDate(new Date(item.date)) : '—';
      return `
        <tr>
          <td>${kind}</td>
          <td class="cell-title">${esc(item.title)}</td>
          <td>${Math.round(item.score)}%</td>
          <td>${status}</td>
          <td class="cell-date">${date}</td>
        </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8" />
<style>
  ${fontFaceCss}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Amiri', 'Segoe UI', Tahoma, sans-serif;
    color: #1f2937;
    font-size: 13px;
    line-height: 1.7;
  }

  .header {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    color: #fff;
    border-radius: 12px;
    padding: 22px 28px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .header .titles h1 { font-size: 24px; color: #d4af37; margin-bottom: 4px; }
  .header .titles p { font-size: 13px; color: #cbd5e1; }
  .header .platform { text-align: left; color: #d4af37; font-size: 15px; font-weight: bold; letter-spacing: 1px; }

  .section-title {
    margin: 22px 0 12px;
    font-size: 17px;
    color: #1a1a2e;
    border-right: 4px solid #d4af37;
    padding-right: 10px;
  }

  /* ── Overview grid ───────────────────────────── */
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .stat {
    border: 1px solid #e5e7eb; border-radius: 10px;
    padding: 12px 14px; text-align: center; background: #fff;
  }
  .stat .v { font-size: 19px; font-weight: bold; color: #1a1a2e; }
  .stat .k { font-size: 11px; color: #6b7280; }
  .stat.green .v { color: #16a34a; }
  .stat.gold .v { color: #b8860b; }
  .stat.blue .v { color: #2563eb; }

  /* ── Topics ──────────────────────────────────── */
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; break-inside: avoid; }
  .panel { border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; background: #fff; }
  .panel h3 { font-size: 13px; color: #374151; margin-bottom: 10px; }
  .topic { margin-bottom: 10px; }
  .topic-head { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 3px; }
  .topic-name { font-weight: bold; color: #111827; }
  .topic-score { font-weight: bold; }
  .bar { height: 6px; border-radius: 999px; background: #ece9e2; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 999px; }
  .empty { font-size: 11px; color: #9ca3af; }

  /* ── Activity table ──────────────────────────── */
  table { width: 100%; border-collapse: collapse; background: #fff; }
  th {
    background: #1a1a2e; color: #d4af37; font-size: 11px;
    padding: 8px 12px; text-align: right;
  }
  td { padding: 9px 12px; font-size: 12px; border-bottom: 1px solid #f0f0ee; vertical-align: middle; }
  tr { page-break-inside: avoid; }
  .cell-title { font-weight: bold; color: #111827; }
  .cell-date { color: #6b7280; font-size: 11px; }
  .chip {
    display: inline-block; padding: 2px 10px; border-radius: 999px;
    font-size: 10px; white-space: nowrap;
  }
  .chip-exam { background: #fbf6ea; color: #b8860b; border: 1px solid #ecd9a0; }
  .chip-quiz { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
  .status { font-size: 10px; padding: 2px 10px; border-radius: 999px; white-space: nowrap; }
  .status.ok { background: #dcfce7; color: #15803d; font-weight: bold; }
  .status.fail { background: #fee2e2; color: #b91c1c; font-weight: bold; }

  .footer {
    margin-top: 26px; padding-top: 12px; border-top: 1px solid #e5e7eb;
    display: flex; justify-content: space-between; font-size: 10px; color: #9ca3af;
  }
</style>
</head>
<body>
  <div class="header">
    <div class="titles">
      <h1>تقرير أداء الطالب</h1>
      <p>ملخص شامل للنتائج والنشاط الدراسي</p>
    </div>
    <div class="platform">المنصة التعليمية</div>
  </div>

  <h2 class="section-title">نظرة عامة</h2>
  <p style="font-size:13px;margin-bottom:10px">الطالب: <strong>${esc(studentName)}</strong></p>
  <div class="grid">
    <div class="stat gold"><div class="v">${overview.examsCompleted}</div><div class="k">امتحانات مكتملة</div></div>
    <div class="stat green"><div class="v">${overview.examsPassed}</div><div class="k">امتحانات ناجحة</div></div>
    <div class="stat"><div class="v">${pct(overview.avgExamScore)}</div><div class="k">متوسط درجات الامتحانات</div></div>
    <div class="stat blue"><div class="v">${overview.quizzesCompleted}</div><div class="k">اختبارات قصيرة</div></div>
    <div class="stat green"><div class="v">${overview.quizzesPassed}</div><div class="k">اختبارات ناجحة</div></div>
    <div class="stat"><div class="v">${pct(overview.avgQuizScore)}</div><div class="k">متوسط درجات الاختبارات</div></div>
    <div class="stat gold"><div class="v">${overview.coursesEnrolled}</div><div class="k">كورسات مسجَّل بها</div></div>
    <div class="stat green"><div class="v">${overview.coursesCompleted}</div><div class="k">كورسات مكتملة</div></div>
    <div class="stat"><div class="v">${overview.lessonsCompleted} / ${overview.totalLessonsInEnrolledCourses}</div><div class="k">دروس مكتملة</div></div>
  </div>

  <h2 class="section-title">نقاط القوة والضعف</h2>
  <div class="cols">
    <div class="panel">
      <h3>أقوى المواضيع</h3>
      ${topicList(strongTopics, '#16a34a', 'لا توجد بيانات كافية بعد.')}
    </div>
    <div class="panel">
      <h3>مواضيع تحتاج تحسينًا</h3>
      ${topicList(weakTopics, '#dc2626', 'لا توجد بيانات كافية بعد.')}
    </div>
  </div>

  <h2 class="section-title">سجل النتائج الأخيرة</h2>
  ${
    recentActivity.length
      ? `<table>
          <thead><tr><th>النوع</th><th>العنوان</th><th>الدرجة</th><th>الحالة</th><th>التاريخ</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
      : '<p class="empty">لم يتم إنهاء أي امتحانات أو اختبارات بعد.</p>'
  }

  <div class="footer">
    <span>تم إنشاء هذا التقرير آليًا بواسطة المنصة التعليمية</span>
    <span>${fmtDate(generatedAt)}</span>
  </div>
</body>
</html>`;
}
