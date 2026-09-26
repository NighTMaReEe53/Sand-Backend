/**
 * Quiz result report — full RTL Arabic HTML template rendered by Puppeteer.
 * Shares the visual identity of exam-result.template.ts.
 */

export interface QuizResultQuestion {
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

export interface QuizResultPdfData {
  studentName: string;
  quizTitle: string;
  courseTitle: string;
  lessonTitle?: string | null;
  submittedAt: Date | null;
  score: number;
  totalMarks: number;
  passingPercentage: number;
  percentage: number;
  isPassed: boolean;
  showCorrectAnswers: boolean;
  questions: QuizResultQuestion[];
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

const num = (n: number): string => String(n);

export function buildQuizResultHtml(
  data: QuizResultPdfData,
  fontFaceCss: string,
): string {
  const {
    studentName,
    quizTitle,
    courseTitle,
    lessonTitle,
    submittedAt,
    score,
    totalMarks,
    passingPercentage,
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
          const isCorrectOpt = q.correctIndex === i;
          let cls = 'opt';
          let marker = '<span class="dot"></span>';
          if (showCorrectAnswers && isCorrectOpt) {
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
            isSelected && !isCorrectOpt && showCorrectAnswers
              ? '<span class="mini-badge wrong">إجابتك</span>'
              : isSelected && isCorrectOpt
                ? '<span class="mini-badge ok">إجابتك الصحيحة</span>'
                : isCorrectOpt && showCorrectAnswers
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
          ${q.selectedIndex === null ? '<p class="unanswered">لم يجب الطالب على هذا السؤال.</p>' : ''}
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
  .cert-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
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
  .ring-box { position: relative; width: 130px; height: 130px; }
  .ring-center {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
  }
  .ring-pct { font-size: 26px; font-weight: bold; color: #1f2937; }
  .ring-sub { font-size: 11px; color: #6b7280; }

  .status-badge {
    display: inline-block;
    padding: 6px 18px;
    border-radius: 999px;
    color: #fff;
    background: ${accent};
    font-weight: bold;
    font-size: 15px;
  }
  .meta-grid {
    margin-top: 16px;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }
  .meta-cell {
    background: #fff;
    border: 1px solid #ece9e2;
    border-radius: 10px;
    padding: 10px 12px;
    text-align: center;
  }
  .meta-label { font-size: 11px; color: #6b7280; margin-bottom: 3px; }
  .meta-value { font-size: 15px; font-weight: bold; }

  .section-title {
    margin: 26px 0 12px;
    font-size: 17px;
    color: #b8912c;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-title::after { content: ''; flex: 1; height: 1px; background: #ece9e2; }

  .q-card {
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 14px 16px;
    margin-bottom: 12px;
    background: #fff;
    page-break-inside: avoid;
  }
  .q-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .q-num { font-weight: bold; color: #16213e; font-size: 13px; }
  .q-marks { font-size: 11px; color: #6b7280; background: #fafaf8; border: 1px solid #ece9e2; padding: 2px 10px; border-radius: 999px; }
  .q-text { font-size: 13.5px; font-weight: bold; margin-bottom: 8px; }
  .opts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .opt {
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 7px 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    background: #fdfdfc;
  }
  .opt-correct { border-color: #86efac; background: #f0fdf4; }
  .opt-wrong { border-color: #fca5a5; background: #fef2f2; }
  .opt-selected-ok { border-color: #86efac; background: #f0fdf4; }
  .opt-main { display: flex; align-items: center; gap: 8px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; border: 2px solid #cbd5e1; flex-shrink: 0; }
  .mark { width: 20px; height: 20px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; color: #fff; flex-shrink: 0; }
  .mark.check { background: #16a34a; }
  .mark.cross { background: #dc2626; }
  .mini-badge { font-size: 9.5px; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
  .mini-badge.ok { background: #dcfce7; color: #15803d; }
  .mini-badge.wrong { background: #fee2e2; color: #b91c1c; }
  .mini-badge.ok-plain { background: #f1f5f9; color: #475569; }
  .unanswered { margin-top: 6px; font-size: 11px; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 5px 10px; display: inline-block; }
  .explain {
    margin-top: 8px;
    background: #eff6ff;
    border-right: 3px solid #3b82f6;
    border-radius: 6px;
    padding: 7px 12px;
    font-size: 12px;
    color: #1e40af;
  }
  .footer-note {
    margin-top: 26px;
    text-align: center;
    color: #9ca3af;
    font-size: 11px;
    border-top: 1px dashed #e5e7eb;
    padding-top: 12px;
  }
</style>
</head>
<body>
  <div class="header">
    <div class="titles">
      <h1>نتيجة الكويز</h1>
      <p>${esc(courseTitle)}${lessonTitle ? ` — ${esc(lessonTitle)}` : ''}</p>
    </div>
    <div class="platform">أ. يوسف عادل</div>
  </div>

  <div class="cert">
    <div class="cert-row">
      <div style="flex:1;">
        <p style="font-size:15px; margin-bottom:2px;"><strong>${esc(studentName)}</strong></p>
        <p style="color:#6b7280; font-size:12px;">${esc(quizTitle)}</p>
        <p style="margin-top:10px;"><span class="status-badge">${isPassed ? 'مبروك، نجحت!' : 'لم تجتز الكويز'}</span></p>
      </div>
      <div class="ring-box ring-wrap">
        <svg class="ring" width="130" height="130">
          <circle class="ring-bg" cx="65" cy="65" r="52"></circle>
          <circle class="ring-val" cx="65" cy="65" r="52"></circle>
        </svg>
        <div class="ring-center">
          <span class="ring-pct">${num(percentage)}%</span>
          <span class="ring-sub">النسبة المئوية</span>
        </div>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-cell"><p class="meta-label">الدرجة</p><p class="meta-value">${num(score)} / ${num(totalMarks)}</p></div>
      <div class="meta-cell"><p class="meta-label">إجابات صحيحة</p><p class="meta-value">${num(correctCount)} / ${num(questions.length)}</p></div>
      <div class="meta-cell"><p class="meta-label">درجة النجاح</p><p class="meta-value">${num(passingPercentage)}%</p></div>
      <div class="meta-cell"><p class="meta-label">التاريخ</p><p class="meta-value" style="font-size:12px;">${fmtDate(submittedAt)}</p></div>
    </div>
  </div>

  <h2 class="section-title">تفاصيل الإجابات</h2>
  ${questionCards || '<p>لا توجد أسئلة مسجلة لهذه المحاولة.</p>'}

  <p class="footer-note">تم إنشاء هذا التقرير آلياً من منصة أ. يوسف عادل التعليمية.</p>
</body>
</html>`;
}
