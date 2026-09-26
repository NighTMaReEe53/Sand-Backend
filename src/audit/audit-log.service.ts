import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a sensitive operation. Fire-and-forget: never throws into the
   * caller's flow.
   */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          action: entry.action,
          entity: entry.entity ?? null,
          entityId: entry.entityId ?? null,
          metadata: entry.metadata ? (entry.metadata as Prisma.InputJsonValue) : undefined,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ?? null,
        },
      });
    } catch (error) {
      this.logger.error(`audit log failed [${entry.action}]: ${error}`);
    }
  }

  /** Admin viewer: filter by action/entity/user with pagination. */
  async list(query: {
    action?: string;
    entity?: string;
    userId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = Math.min(query.limit && query.limit > 0 ? query.limit : 50, 200);

    const where = {
      ...(query.action && { action: { startsWith: query.action } }),
      ...(query.entity && { entity: query.entity }),
      ...(query.userId && { userId: query.userId }),
    };

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: { email: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      logs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }
}
