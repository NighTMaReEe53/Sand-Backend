import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../shared/prisma/prisma.service';
import { RedisService } from '../shared/redis/redis.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Health check status including Database and Redis connectivity' })
  @ApiResponse({ status: 200, description: 'System is healthy and operational.' })
  async checkHealth() {
    let dbStatus = 'disconnected';
    let redisStatus = 'disconnected';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbStatus = 'connected';
    } catch {
      dbStatus = 'error';
    }

    try {
      const isRedisHealthy = await this.redisService.ping();
      redisStatus = isRedisHealthy ? 'connected' : 'error';
    } catch {
      redisStatus = 'error';
    }

    const isHealthy = dbStatus === 'connected';

    return {
      status: isHealthy ? 'ok' : 'degraded',
      environment: process.env.NODE_ENV || 'development',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus,
        redis: redisStatus,
      },
    };
  }
}
