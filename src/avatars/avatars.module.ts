import { Module } from '@nestjs/common';
import { AvatarsController } from './avatars.controller';
import { AvatarsService } from './avatars.service';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { CoinsModule } from '../coins/coins.module';

@Module({
  imports: [PrismaModule, CoinsModule],
  controllers: [AvatarsController],
  providers: [AvatarsService],
  exports: [AvatarsService],
})
export class AvatarsModule {}
