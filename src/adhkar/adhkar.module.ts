import { Module } from '@nestjs/common';
import { AdhkarController } from './adhkar.controller';
import { AdhkarService } from './adhkar.service';
import { PrismaModule } from '../shared/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AdhkarController],
  providers: [AdhkarService],
  exports: [AdhkarService],
})
export class AdhkarModule {}
