const fs = require('fs');
const path = require('path');
const { PdfGeneratorService } = require('../dist/shared/pdf/pdf-generator.service');
const {
  buildGuardianPerformanceReportHtml,
} = require('../dist/shared/pdf/templates/guardian-performance-report.template');

async function run() {
  const generator = new PdfGeneratorService();
  const outputDir = path.join(process.cwd(), 'tmp', 'pdfs');
  const outputPath = path.join(outputDir, 'guardian-report-qa.pdf');
  const now = new Date('2026-09-25T10:30:00.000Z');
  const html = buildGuardianPerformanceReportHtml(
    {
      platformName: 'منصة سند التعليمية',
      generatedAt: now,
      referenceCode: 'QA-7F2A91',
      student: {
        fullName: 'كريم محمد أحمد',
        gradeLevel: 'الصف الثالث الثانوي',
        enrolledAt: new Date('2026-08-01T00:00:00.000Z'),
      },
      courseTitle: 'الفصل الأول - أساسيات الكيمياء والصف الثالث الثانوي',
      lessons: Array.from({ length: 14 }, (_, index) => ({
        orderIndex: index + 1,
        title: `المحاضرة ${index + 1}: ${['التركيب الذري', 'الروابط الكيميائية', 'التفاعلات والمعادلات'][index % 3]}`,
        watchedPercentage: index < 8 ? 100 : index < 11 ? 45 : 0,
        isCompleted: index < 8,
        lastWatchedAt: index < 11 ? new Date(`2026-09-${String(10 + index).padStart(2, '0')}T15:00:00.000Z`) : null,
      })),
      latestAssessments: [
        { key: 'QUIZ:1', type: 'QUIZ', title: 'كويز تركيب الذرة', attemptNumber: 2, percentage: 86, isPassed: true, submittedAt: now },
        { key: 'HOMEWORK:1', type: 'HOMEWORK', title: 'واجب المعادلات الكيميائية', attemptNumber: 1, percentage: 58, isPassed: false, submittedAt: new Date('2026-09-23T12:00:00.000Z') },
        { key: 'EXAM:1', type: 'EXAM', title: 'اختبار الوحدة الأولى', attemptNumber: 1, percentage: 74, isPassed: true, submittedAt: new Date('2026-09-21T12:00:00.000Z') },
      ],
      assessmentAttempts: [
        { key: 'QUIZ:1', type: 'QUIZ', title: 'كويز تركيب الذرة', attemptNumber: 1, percentage: 42, isPassed: false, submittedAt: new Date('2026-09-19T10:00:00.000Z') },
        { key: 'QUIZ:1', type: 'QUIZ', title: 'كويز تركيب الذرة', attemptNumber: 2, percentage: 86, isPassed: true, submittedAt: now },
        { key: 'HOMEWORK:1', type: 'HOMEWORK', title: 'واجب المعادلات الكيميائية', attemptNumber: 1, percentage: 58, isPassed: false, submittedAt: new Date('2026-09-23T12:00:00.000Z') },
        { key: 'EXAM:1', type: 'EXAM', title: 'اختبار الوحدة الأولى', attemptNumber: 1, percentage: 74, isPassed: true, submittedAt: new Date('2026-09-21T12:00:00.000Z') },
      ],
      pendingRequirements: [
        { key: 'HOMEWORK:2', type: 'HOMEWORK', title: 'واجب الروابط الكيميائية', lessonTitle: 'الروابط الكيميائية', availableFrom: new Date('2026-09-20T00:00:00.000Z'), dueAt: null, isOverdue: false, statusLabel: 'واجب لم يُسلَّم بعد' },
        { key: 'EXAM:2', type: 'EXAM', title: 'امتحان مراجعة الباب الأول', lessonTitle: null, availableFrom: new Date('2026-09-12T00:00:00.000Z'), dueAt: new Date('2026-09-18T23:59:00.000Z'), isOverdue: true, statusLabel: 'فات موعد الامتحان دون تسليم' },
      ],
      recommendations: [
        'يُرجى تنظيم وقت لاستكمال الدروس غير المكتملة حتى لا يتراكم المحتوى.',
        'يوصى بمراجعة واجب المعادلات الكيميائية لأن آخر نتيجة مسجلة لم تجتز معيار النجاح.',
      ],
      teacherNote: 'نرجو من ولي الأمر تشجيع الطالب على المراجعة الهادئة قبل المحاولة التالية.',
    },
    generator.getEmbeddedFontFace('Amiri', 'Amiri-Regular.ttf'),
  );
  const pdf = await generator.htmlToPdf(html, {
    margin: { top: '12mm', right: '11mm', bottom: '16mm', left: '11mm' },
    footerHtml:
      '<div style="width:100%;padding:0 11mm;font:9px Tahoma;color:#718096;text-align:center;direction:rtl">تقرير متابعة منصة سند - صفحة <span class="pageNumber"></span> من <span class="totalPages"></span></div>',
  });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, pdf);
  await generator.onModuleDestroy();
  process.stdout.write(outputPath);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
