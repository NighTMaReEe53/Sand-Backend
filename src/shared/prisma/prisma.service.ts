import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Connected to PostgreSQL database successfully via Prisma.');
    } catch (error) {
      this.logger.error('Failed to connect to PostgreSQL database:', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Disconnected from PostgreSQL database.');
  }

  async cleanDatabase() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('cleanDatabase is strictly prohibited in production!');
    }
    const models = Reflect.ownKeys(this).filter((key) => typeof key === 'string' && !key.startsWith('_') && !key.startsWith('$'));
    return Promise.all(models.map((modelKey) => (this as any)[modelKey]?.deleteMany?.()));
  }
}
