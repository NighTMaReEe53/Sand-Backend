import { Module } from '@nestjs/common';
import { QuizzesController } from './quizzes.controller';
import { QuizzesService } from './quizzes.service';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { PdfModule } from '../shared/pdf/pdf.module';

@Module({
  imports: [PrismaModule, PdfModule],
  controllers: [QuizzesController],
  providers: [QuizzesService],
  exports: [QuizzesService],
})
export class QuizzesModule {}
