import { Module } from '@nestjs/common';
import { BundlesController } from './bundles.controller';
import { BundlesService } from './bundles.service';
import { PrismaModule } from '../shared/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BundlesController],
  providers: [BundlesService],
  exports: [BundlesService],
})
export class BundlesModule {}
