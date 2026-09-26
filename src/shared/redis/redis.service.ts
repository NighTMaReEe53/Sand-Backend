import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

interface MemoryItem {
  value: string;
  expiresAt: number | null; // epoch ms
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isRedisConnected = false;

  // In-memory fallback cache for development when standalone Redis is not active
  private readonly memoryStore = new Map<string, MemoryItem>();

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD', '');

    try {
      this.client = new Redis({
        host,
        port,
        password: password || undefined,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: (times) => {
          if (times > 3) {
            return null; // Stop reconnect spamming, rely on in-memory fallback
          }
          return Math.min(times * 300, 1000);
        },
      });

      this.client.on('connect', () => {
        this.isRedisConnected = true;
        this.logger.log('Connected to Redis server successfully.');
      });

      this.client.on('error', (err) => {
        if (this.isRedisConnected) {
          this.logger.warn(`Redis connection lost: ${err.message}. Using in-memory fallback.`);
        }
        this.isRedisConnected = false;
      });

      this.client.connect().catch(() => {
        this.isRedisConnected = false;
        this.logger.warn(
          `Redis server not reachable at ${host}:${port}. Operating smoothly using In-Memory Storage fallback for OTP and sessions.`,
        );
      });
    } catch {
      this.isRedisConnected = false;
      this.logger.warn('Failed to initialize Redis client. Using In-Memory Storage fallback.');
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        // ignore on shutdown
      }
    }
    this.memoryStore.clear();
  }

  getClient(): Redis | null {
    return this.client;
  }

  async ping(): Promise<boolean> {
    if (this.isRedisConnected && this.client) {
      try {
        const pong = await this.client.ping();
        return pong === 'PONG';
      } catch {
        return false;
      }
    }
    return true; // Memory fallback is healthy
  }

  // --- Core Key-Value operations with Automatic Fallback ---

  async get(key: string): Promise<string | null> {
    if (this.isRedisConnected && this.client) {
      try {
        return await this.client.get(key);
      } catch {
        // fallback to memory
      }
    }

    const item = this.memoryStore.get(key);
    if (!item) return null;

    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.memoryStore.delete(key);
      return null;
    }

    return item.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.isRedisConnected && this.client) {
      try {
        if (ttlSeconds) {
          await this.client.set(key, value, 'EX', ttlSeconds);
        } else {
          await this.client.set(key, value);
        }
        return;
      } catch {
        // fallback to memory
      }
    }

    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.memoryStore.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    if (this.isRedisConnected && this.client) {
      try {
        await this.client.del(key);
      } catch {
        // fallback to memory
      }
    }
    this.memoryStore.delete(key);
  }

  async ttl(key: string): Promise<number> {
    if (this.isRedisConnected && this.client) {
      try {
        return await this.client.ttl(key);
      } catch {
        // fallback to memory
      }
    }

    const item = this.memoryStore.get(key);
    if (!item) return -2;
    if (!item.expiresAt) return -1;

    const remainingMs = item.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.memoryStore.delete(key);
      return -2;
    }

    return Math.ceil(remainingMs / 1000);
  }

  async incr(key: string): Promise<number> {
    if (this.isRedisConnected && this.client) {
      try {
        return await this.client.incr(key);
      } catch {
        // fallback to memory
      }
    }

    const currentStr = await this.get(key);
    let count = currentStr ? parseInt(currentStr, 10) + 1 : 1;
    const currentTtl = await this.ttl(key);
    await this.set(key, count.toString(), currentTtl > 0 ? currentTtl : undefined);
    return count;
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    if (this.isRedisConnected && this.client) {
      try {
        const res = await this.client.expire(key, ttlSeconds);
        return res === 1;
      } catch {
        // fallback to memory
      }
    }

    const item = this.memoryStore.get(key);
    if (!item) return false;
    item.expiresAt = Date.now() + ttlSeconds * 1000;
    return true;
  }

  // --- OTP Specific Key Management ---
  private getOtpKey(phone: string): string {
    return `otp:${phone}`;
  }

  private getOtpAttemptsKey(phone: string): string {
    return `otp:attempts:${phone}`;
  }

  private getOtpLockKey(phone: string): string {
    return `otp:lock:${phone}`;
  }

  /**
   * يخزن كود OTP مع مدة صلاحية دقيقتين
   */
  async setOtp(phone: string, otp: string, ttlSeconds = 120): Promise<void> {
    await this.set(this.getOtpKey(phone), otp, ttlSeconds);
  }

  /**
   * يسترجع كود OTP المخزن لرقم الهاتف
   */
  async getOtp(phone: string): Promise<string | null> {
    return this.get(this.getOtpKey(phone));
  }

  /**
   * يحذف كود OTP بعد التحقق الناجح
   */
  async deleteOtp(phone: string): Promise<void> {
    await this.del(this.getOtpKey(phone));
  }

  /**
   * يفحص هل رقم الهاتف محظور مؤقتاً بسبب 3 محاولات خاطئة
   */
  async isOtpLocked(phone: string): Promise<{ isLocked: boolean; remainingSeconds: number }> {
    const lockTtl = await this.ttl(this.getOtpLockKey(phone));
    if (lockTtl > 0) {
      return { isLocked: true, remainingSeconds: lockTtl };
    }
    return { isLocked: false, remainingSeconds: 0 };
  }

  /**
   * يسجل محاولة OTP خاطئة (قفل 15 دقيقة بعد 3 محاولات)
   */
  async recordFailedOtpAttempt(phone: string): Promise<{ attempts: number; isLocked: boolean; remainingAttempts: number }> {
    const attemptsKey = this.getOtpAttemptsKey(phone);
    const lockKey = this.getOtpLockKey(phone);

    let attempts = 1;
    const currentVal = await this.get(attemptsKey);
    if (currentVal) {
      attempts = parseInt(currentVal, 10) + 1;
    }

    await this.set(attemptsKey, attempts.toString(), 900); // 15 mins window

    if (attempts >= 3) {
      await this.set(lockKey, 'locked', 900); // lock for 15 mins
      await this.del(attemptsKey);
      await this.deleteOtp(phone);
      return { attempts, isLocked: true, remainingAttempts: 0 };
    }

    return { attempts, isLocked: false, remainingAttempts: 3 - attempts };
  }

  /**
   * إعادة ضبط محاولات OTP والقفل بعد نجاح التحقق
   */
  async resetOtpAttempts(phone: string): Promise<void> {
    await this.del(this.getOtpAttemptsKey(phone));
    await this.del(this.getOtpLockKey(phone));
  }
}
