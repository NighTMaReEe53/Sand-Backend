import { Module } from '@nestjs/common';
import { FramesController } from './frames.controller';
import { FramesService } from './frames.service';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { CoinsModule } from '../coins/coins.module';

@Module({
  imports: [PrismaModule, CoinsModule],
  controllers: [FramesController],
  providers: [FramesService],
  exports: [FramesService],
})
export class FramesModule {}
