import { Module } from '@nestjs/common';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { TaxonomyService } from './taxonomy.service';
import { TaxonomyController } from './taxonomy.controller';
import { TaxonomyAdminController } from './taxonomy-admin.controller';

@Module({
  imports: [PrismaModule],
  controllers: [TaxonomyController, TaxonomyAdminController],
  providers: [TaxonomyService],
  exports: [TaxonomyService],
})
export class TaxonomyModule {}
