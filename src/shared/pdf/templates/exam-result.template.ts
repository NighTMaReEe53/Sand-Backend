/**
 * Exam result report — full RTL Arabic HTML template rendered by Puppeteer.
 */

export interface ExamResultQuestion {
  index: number;
  text: string;
  marks: number;
  options: string[];
  selectedIndex: number | null;
  correctIndex: number;
  isCorrect: boolean;
  awardedMarks: number;
  explanation?: string | null;
}

export interface ExamResultPdfData {
  studentName: string;
  examTitle: string;
  courseTitle: string;
  submittedAt: Date | null;
  score: number;
  totalMarks: number;
  passingMarks: number;
  percentage: number;
  isPassed: boolean;
  showCorrectAnswers: boolean;
  questions: ExamResultQuestion[];
}

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmtDate = (d: Date | null): string => {
  if (!d) return '—';
  return new Intl.DateTimeFormat('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
};

const ARabicIndic = false; // keep Western digits for clarity in grades

const num = (n: number): string => (ARabicIndic ? n.toLocaleString('ar-EG') : String(n));

export function buildExamResultHtml(
  data: ExamResultPdfData,
  fontFaceCss: string,
): string {
  const {
    studentName,
    examTitle,
    courseTitle,
    submittedAt,
    score,
    totalMarks,
    passingMarks,
    percentage,
    isPassed,
    showCorrectAnswers,
    questions,
  } = data;

  const accent = isPassed ? '#16a34a' : '#dc2626';
  const correctCount = questions.filter((q) => q.isCorrect).length;

  const questionCards = questions
    .map((q) => {
      const optionRows = q.options
        .map((opt, i) => {
          const isSelected = q.selectedIndex === i;
          const isCorrect = q.correctIndex === i;
          let cls = 'opt';
          let marker = '<span class="dot"></span>';
          if (showCorrectAnswers && isCorrect) {
            cls += ' opt-correct';
            marker = '<span class="mark check">✓</span>';
          }
          if (isSelected && !q.isCorrect) {
            cls += ' opt-wrong';
            marker = '<span class="mark cross">✗</span>';
          } else if (isSelected && q.isCorrect) {
            cls += ' opt-selected-ok';
            marker = '<span class="mark check">✓</span>';
          }
          const badge =
            isSelected && !isCorrect && showCorrectAnswers
              ? '<span class="mini-badge wrong">إجابتك</span>'
              : isSelected && isCorrect
                ? '<span class="mini-badge ok">إجابتك الصحيحة</span>'
                : isCorrect && showCorrectAnswers
                  ? '<span class="mini-badge ok-plain">الإجابة الصحيحة</span>'
                  : '';
          return `
            <div class="${cls}">
              <div class="opt-main">${marker}<span>${esc(opt)}</span></div>
              ${badge}
            </div>`;
        })
        .join('');

      return `
        <div class="q-card">
          <div class="q-head">
            <span class="q-num">السؤال ${num(q.index + 1)}</span>
            <span class="q-marks">${num(q.awardedMarks)} / ${num(q.marks)} درجة</span>
          </div>
          <p class="q-text">${esc(q.text)}</p>
          <div class="opts">${optionRows || '<p class="no-opts">لا توجد خيارات لهذا السؤال.</p>'}</div>
          ${
            q.selectedIndex === null
              ? '<p class="unanswered">لم يجب الطالب على هذا السؤال.</p>'
              : ''
          }
          ${
            q.explanation && showCorrectAnswers
              ? `<div class="explain"><strong>توضيح الأستاذ:</strong> ${esc(q.explanation)}</div>`
              : ''
          }
        </div>`;
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

  /* ── Header band ─────────────────────────────── */
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
  .header .platform {
    text-align: left;
    color: #d4af37;
    font-size: 15px;
    font-weight: bold;
    letter-spacing: 1px;
  }

  /* ── Score certificate card ──────────────────── */
  .cert {
    margin-top: 18px;
    border: 1px solid #e5e7eb;
    border-radius: 14px;
    padding: 22px;
    background: #fafaf8;
    position: relative;
    overflow: hidden;
  }
  .cert::before {
    content: '';
    position: absolute;
    top: 0; right: 0; left: 0;
    height: 5px;
    background: linear-gradient(to left, transparent, #d4af37, transparent);
  }
  .cert-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
  }
  .ring-wrap { width: 130px; height: 130px; flex-shrink: 0; }
  .ring { transform: rotate(-90deg); }
  .ring-bg { fill: none; stroke: #ece9e2; stroke-width: 10; }
  .ring-val {
    fill: none;
    stroke: ${accent};
    stroke-width: 10;
    stroke-linecap: round;
    stroke-dasharray: 326.7;
    stroke-dashoffset: ${(326.7 * (1 - Math.min(100, Math.max(0, percentage))) / 100).toFixed(1)};
  }
  .ring-center {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
  }
  .ring-box { position: relative; width: 130px; height: 130px; }
  .ring-pct { font-size: 26px; font-weight: bold; color: #1f2937; }
  .ring-sub { font-size: 11px; color: #6b7280; }

  .status-badge {
    display: inline-block;
    padding: 6px 22px;
    border-radius: 999px;
    color: #fff;
    font-size: 17px;
    font-weight: bold;
    background: ${accent};
    margin-bottom: 8px;
  }
  .info-grid {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 20px;
  }
  .info-item .lbl { font-size: 11px; color: #6b7280; }
  .info-item .val { font-size: 14px; font-weight: bold; color: #111827; }

  /* ── Stats strip ─────────────────────────────── */
  .stats {
    margin-top: 16px;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }
  .stat {
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 10px 12px;
    text-align: center;
    background: #fff;
  }
  .stat .v { font-size: 18px; font-weight: bold; color: #1a1a2e; }
  .stat .k { font-size: 11px; color: #6b7280; }
  .stat.green .v { color: #16a34a; }
  .stat.red .v { color: #dc2626; }
  .stat.gold .v { color: #b8860b; }

  /* ── Section title ───────────────────────────── */
  .section-title {
    margin: 24px 0 12px;
    font-size: 17px;
    color: #1a1a2e;
    border-right: 4px solid #d4af37;
    padding-right: 10px;
  }

  /* ── Question cards ──────────────────────────── */
  .q-card {
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 14px 16px;
    margin-bottom: 12px;
    break-inside: avoid;
    page-break-inside: avoid;
    background: #fff;
  }
  .q-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
  }
  .q-num {
    background: #1a1a2e;
    color: #d4af37;
    font-size: 11px;
    padding: 3px 12px;
    border-radius: 999px;
  }
  .q-marks { font-size: 11px; color: #6b7280; }
  .q-text { font-size: 14px; font-weight: bold; color: #111827; margin-bottom: 8px; }
  .opts { display: flex; flex-direction: column; gap: 6px; }
  .opt {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 7px 12px;
    font-size: 12px;
    background: #fdfdfc;
  }
  .opt-main { display: flex; align-items: center; gap: 8px; }
  .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #d1d5db; flex-shrink: 0;
  }
  .mark {
    width: 16px; height: 16px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 10px; color: #fff; flex-shrink: 0;
  }
  .check { background: #16a34a; }
  .cross { background: #dc2626; }
  .opt-correct { border-color: #86efac; background: #f0fdf4; }
  .opt-wrong { border-color: #fca5a5; background: #fef2f2; }
  .opt-selected-ok { border-color: #86efac; background: #f0fdf4; }
  .mini-badge {
    font-size: 10px;
    padding: 2px 10px;
    border-radius: 999px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .mini-badge.ok { background: #dcfce7; color: #15803d; font-weight: bold; }
  .mini-badge.ok-plain { background: #f0fdf4; color: #16a34a; }
  .mini-badge.wrong { background: #fee2e2; color: #b91c1c; }
  .unanswered { margin-top: 8px; font-size: 11px; color: #dc2626; }
  .no-opts { font-size: 11px; color: #9ca3af; }
  .explain {
    margin-top: 10px;
    background: #fbf6ea;
    border: 1px solid #ecd9a0;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 12px;
    color: #713f12;
  }

  /* ── Footer ──────────────────────────────────── */
  .footer {
    margin-top: 26px;
    padding-top: 12px;
    border-top: 1px solid #e5e7eb;
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    color: #9ca3af;
  }
</style>
</head>
<body>
  <div class="header">
    <div class="titles">
      <h1>نتيجة الامتحان</h1>
      <p>تقرير تفصيلي بمراجعة الإجابات — ${esc(courseTitle)}</p>
    </div>
    <div class="platform">المنصة التعليمية</div>
  </div>

  <div class="cert">
    <div class="cert-row">
      <div class="info-grid">
        <div class="info-item"><div class="lbl">اسم الطالب</div><div class="val">${esc(studentName)}</div></div>
        <div class="info-item"><div class="lbl">حالة النتيجة</div><div class="val"><span class="status-badge">${isPassed ? 'ناجح' : 'راسب'}</span></div></div>
        <div class="info-item"><div class="lbl">الامتحان</div><div class="val">${esc(examTitle)}</div></div>
        <div class="info-item"><div class="lbl">تاريخ التسليم</div><div class="val">${fmtDate(submittedAt)}</div></div>
      </div>
      <div class="ring-box">
        <svg class="ring" viewBox="0 0 120 120">
          <circle class="ring-bg" cx="60" cy="60" r="52"></circle>
          <circle class="ring-val" cx="60" cy="60" r="52"></circle>
        </svg>
        <div class="ring-center">
          <span class="ring-pct">${num(percentage)}%</span>
          <span class="ring-sub">${num(score)} من ${num(totalMarks)}</span>
        </div>
      </div>
    </div>
  </div>

  <div class="stats">
    <div class="stat gold"><div class="v">${num(score)} / ${num(totalMarks)}</div><div class="k">الدرجة النهائية</div></div>
    <div class="stat green"><div class="v">${num(correctCount)}</div><div class="k">إجابات صحيحة</div></div>
    <div class="stat red"><div class="v">${num(questions.length - correctCount)}</div><div class="k">إجابات خاطئة</div></div>
    <div class="stat"><div class="v">${num(passingMarks)}</div><div class="k">درجة النجاح</div></div>
  </div>

  <h2 class="section-title">مراجعة الأسئلة والإجابات</h2>
  ${questionCards || '<p style="color:#6b7280">لا توجد أسئلة مسجلة لهذا الامتحان.</p>'}

  <div class="footer">
    <span>تم إنشاء هذا التقرير آليًا بواسطة المنصة التعليمية</span>
    <span>${fmtDate(new Date())}</span>
  </div>
</body>
</html>`;
}
