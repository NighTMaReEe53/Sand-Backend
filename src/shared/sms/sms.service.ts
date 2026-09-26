import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ISmsService } from './sms.interface';

@Injectable()
export class SmsService implements ISmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly provider: string;

  constructor(private readonly configService: ConfigService) {
    this.provider = this.configService.get<string>('SMS_PROVIDER', 'mock').toLowerCase();
  }

  async sendOtp(phone: string, otp: string): Promise<boolean> {
    const message = `كود التحقق الخاص بك في المنصة التعليمية هو: ${otp} (صالح لمدة دقيقتين)`;

    if (this.provider === 'mock') {
      this.logger.log(`\n=======================================================\n📱 [MOCK SMS GATEWAY]\nTo: ${phone}\nMessage: "${message}"\nOTP Code: [ ${otp} ]\n=======================================================`);
      return true;
    }

    // هنا يمكن إضافة التكامل الفعلي مع بوابات SMS مثل Twilio / Msegat / 4jawaly
    this.logger.warn(`Provider [${this.provider}] is not yet configured with live API credentials. Falling back to mock logger.`);
    this.logger.log(`[SMS ${this.provider}] To: ${phone} | Code: ${otp}`);
    return true;
  }

  async sendSms(phone: string, message: string): Promise<boolean> {
    if (this.provider === 'mock') {
      this.logger.log(`\n=======================================================\n📱 [MOCK SMS GATEWAY - NOTIFICATION]\nTo: ${phone}\nMessage: "${message}"\n=======================================================`);
      return true;
    }

    this.logger.log(`[SMS ${this.provider}] To: ${phone} | Message: ${message}`);
    return true;
  }
}
