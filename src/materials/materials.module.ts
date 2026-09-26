import { Module } from '@nestjs/common';
import { MaterialsController } from './materials.controller';
import { MaterialsService } from './materials.service';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { StorageModule } from '../shared/storage/storage.module';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [MaterialsController],
  providers: [MaterialsService],
  exports: [MaterialsService],
})
export class MaterialsModule {}
