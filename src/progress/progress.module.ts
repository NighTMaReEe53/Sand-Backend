import { Module } from '@nestjs/common';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { CertificatesModule } from '../certificates/certificates.module';
import { LessonsModule } from '../lessons/lessons.module';

@Module({
  imports: [PrismaModule, CertificatesModule, LessonsModule],
  controllers: [ProgressController],
  providers: [ProgressService],
  exports: [ProgressService],
})
export class ProgressModule {}
