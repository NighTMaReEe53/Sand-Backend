export interface ISmsService {
  /**
   * إرسال رمز التحقق OTP لرقم الهاتف
   */
  sendOtp(phone: string, otp: string): Promise<boolean>;

  /**
   * إرسال رسالة نصية عامة
   */
  sendSms(phone: string, message: string): Promise<boolean>;
}
