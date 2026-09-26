import { Global, Module } from '@nestjs/common';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';
import { PrismaModule } from '../shared/prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
