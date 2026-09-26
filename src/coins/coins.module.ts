import { Global, Module } from '@nestjs/common';
import { CoinsController } from './coins.controller';
import { CoinsService } from './coins.service';
import { PrismaModule } from '../shared/prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [CoinsController],
  providers: [CoinsService],
  exports: [CoinsService],
})
export class CoinsModule {}
