import { Module } from '@nestjs/common';
import { QuestionBankController } from './question-bank.controller';
import { QuestionBankService } from './question-bank.service';
import { PrismaModule } from '../shared/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [QuestionBankController],
  providers: [QuestionBankService],
  exports: [QuestionBankService],
})
export class QuestionBankModule {}
