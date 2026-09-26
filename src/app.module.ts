import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './shared/prisma/prisma.module';
import { RedisModule } from './shared/redis/redis.module';
import { SmsModule } from './shared/sms/sms.module';
import { StorageModule } from './shared/storage/storage.module';
import { CleanupModule } from './shared/cleanup/cleanup.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CoursesModule } from './courses/courses.module';
import { LessonsModule } from './lessons/lessons.module';
import { PaymentsModule } from './payments/payments.module';
import { ExamsModule } from './exams/exams.module';
import { QuizzesModule } from './quizzes/quizzes.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { NotesModule } from './notes/notes.module';
import { LessonQaModule } from './qa/lesson-qa.module';
import { NotificationsModule } from './notifications/notifications.module';
import { QuestionBankModule } from './question-bank/question-bank.module';
import { GamificationModule } from './gamification/gamification.module';
import { StudyPlannerModule } from './study-planner/study-planner.module';
import { ReviewsModule } from './reviews/reviews.module';
import { CouponsModule } from './coupons/coupons.module';
import { BundlesModule } from './bundles/bundles.module';
import { CertificatesModule } from './certificates/certificates.module';
import { AuditModule } from './audit/audit.module';
import { ProgressModule } from './progress/progress.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { MaterialsModule } from './materials/materials.module';
import { HealthModule } from './health/health.module';
import { SectionsModule } from './sections/sections.module';
import { VideosModule } from './videos/videos.module';
import { LiveLecturesModule } from './live-lectures/live-lectures.module';
import { TaxonomyModule } from './taxonomy/taxonomy.module';
import { BacklogModule } from './backlog/backlog.module';
import { ChallengesModule } from './challenges/challenges.module';
import { HomeworksModule } from './homeworks/homeworks.module';
import { CoinsModule } from './coins/coins.module';
import { AvatarsModule } from './avatars/avatars.module';
import { FramesModule } from './frames/frames.module';
import { AdhkarModule } from './adhkar/adhkar.module';
import { ParentModule } from './parent/parent.module';
import { ReactionsModule } from './reactions/reactions.module';
import { CourseQaModule } from './course-qa/course-qa.module';
import { SummariesModule } from './summaries/summaries.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { ThrottlerBehindProxyGuard } from './common/guards/throttler-behind-proxy.guard';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Global Rate Limiting — 3 tiers (no Redis needed, uses in-memory storage)
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: () => [
        {
          name: 'default',
          ttl: 60_000, // 1 دقيقة
          limit: 60,   // 60 request في الدقيقة — الحد العام
        },
        {
          name: 'burst',
          ttl: 1_000,  // 1 ثانية
          limit: 10,   // حماية من الـ burst المفاجئ (10 requests/sec max)
        },
        {
          name: 'heavy',
          ttl: 60_000, // 1 دقيقة
          limit: 20,   // الـ endpoints الثقيلة (analytics, challenges, exams)
        },
      ],
    }),

    // Shared Core Modules
    PrismaModule,
    RedisModule,
    SmsModule,
    StorageModule,
    CleanupModule,

    // Feature Modules
    AuthModule,
    UsersModule,
    CoursesModule,
    LessonsModule,
    PaymentsModule,
    ExamsModule,
    QuizzesModule,
    AnalyticsModule,
    NotesModule,
    LessonQaModule,
    NotificationsModule,
    QuestionBankModule,
    GamificationModule,
    StudyPlannerModule,
    ReviewsModule,
    CouponsModule,
    BundlesModule,
    CertificatesModule,
    AuditModule,
    ProgressModule,
    DashboardModule,
    MaterialsModule,
    HealthModule,
    SectionsModule,
    VideosModule,
    LiveLecturesModule,
    TaxonomyModule,
    BacklogModule,
    HomeworksModule,
    ChallengesModule,
    CoinsModule,
    AvatarsModule,
    FramesModule,
    AdhkarModule,
    ParentModule,
    ReactionsModule,
    CourseQaModule,
    SummariesModule,
  ],
  providers: [
    // Global Exception Filter
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    // Global Response Transformer
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    // Global HTTP Logging
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    // Global JWT Authentication Guard (Bypassed with @Public())
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Global RBAC Roles Guard (Checks @Roles(...))
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    // Global Throttler Guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerBehindProxyGuard,
    },
  ],
})
export class AppModule {}
