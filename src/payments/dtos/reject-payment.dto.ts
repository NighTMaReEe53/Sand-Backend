import { IsNotEmpty, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectPaymentDto {
  @ApiProperty({
    example: 'صورة الإيصال غير واضحة ورقم التحويل غير ظاهر. يرجى إعادة رفع إيصال واضح.',
    description: 'Mandatory reason for rejecting payment (minimum 5 characters)',
  })
  @IsString({ message: 'rejectionReason must be a string' })
  @IsNotEmpty({ message: 'rejectionReason is required' })
  @Length(5, 500, { message: 'rejectionReason must be between 5 and 500 characters' })
  rejectionReason: string;
}
