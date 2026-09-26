import { Global, Module } from '@nestjs/common';
import { GamificationController } from './gamification.controller';
import { GamificationService } from './gamification.service';
import { PrismaModule } from '../shared/prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [GamificationController],
  providers: [GamificationService],
  exports: [GamificationService],
})
export class GamificationModule {}
