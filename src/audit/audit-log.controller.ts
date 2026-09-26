import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditLogService } from './audit-log.service';

export class ListAuditLogsQueryDto {
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsString() entity?: string;
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

@ApiTags('Audit Logs')
@ApiBearerAuth('bearer')
@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Roles(Role.ADMIN)
  @Get()
  @ApiOperation({ summary: 'Admin audit log viewer (filter by action/entity/user).' })
  list(@Query() query: ListAuditLogsQueryDto) {
    return this.auditLogService.list(query);
  }
}
