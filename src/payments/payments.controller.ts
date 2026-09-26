import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';
import { CheckoutDto } from './dtos/checkout.dto';
import { RejectPaymentDto } from './dtos/reject-payment.dto';
import { PaymentQueryDto } from './dtos/payment-query.dto';

@ApiTags('Payments & Subscriptions (Vodafone Cash)')
@ApiBearerAuth('bearer')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Roles(Role.STUDENT)
  @Post('checkout')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 checkouts per minute (anti-abuse)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Initiate checkout for a paid published course (Student Only)',
    description: 'Calculates the course price strictly on the server, generates an order reference and payment instructions.',
  })
  @ApiResponse({ status: 201, description: 'Checkout created successfully.' })
  @ApiResponse({ status: 400, description: 'Course is not published or is free.' })
  @ApiResponse({ status: 404, description: 'Course not found.' })
  @ApiResponse({ status: 409, description: 'Already enrolled or pending enrollment for this course.' })
  async checkout(
    @CurrentUser('id') studentUserId: string,
    @Body() dto: CheckoutDto,
  ) {
    return this.paymentsService.checkout(studentUserId, dto);
  }

  @Roles(Role.STUDENT)
  @Post(':paymentId/submit-receipt')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('receipt'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload Vodafone Cash transfer receipt (Student Only)',
    description: 'Validates receipt image (JPEG/PNG/WebP <= 5MB), checks SHA-256 hash against duplicate reuse, and applies two-tiered rate limiting.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        receipt: {
          type: 'string',
          format: 'binary',
          description: 'Receipt image file (JPEG, PNG, WebP <= 5MB)',
        },
        receiptImageUrl: {
          type: 'string',
          description: 'Alternative direct image URL (optional)',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Receipt submitted successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid image type, file size, or expired payment.' })
  @ApiResponse({ status: 403, description: 'Forbidden. Not the student owner.' })
  @ApiResponse({ status: 409, description: 'Duplicate receipt image detected.' })
  @ApiResponse({ status: 429, description: 'Too many receipt submission attempts.' })
  async submitReceipt(
    @Param('paymentId') paymentId: string,
    @CurrentUser('id') studentUserId: string,
    @UploadedFile() file?: Express.Multer.File,
    @Body('receiptImageUrl') receiptImageUrlFromBody?: string,
  ) {
    return this.paymentsService.submitReceipt(
      paymentId,
      studentUserId,
      file,
      receiptImageUrlFromBody,
    );
  }

  @Roles(Role.STUDENT)
  @Post(':enrollmentId/retry')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Retry payment for a REJECTED enrollment (Student Only)',
    description: 'Generates a fresh Payment record with a new order reference without altering old rejected records.',
  })
  @ApiResponse({ status: 201, description: 'New payment request created for retry.' })
  @ApiResponse({ status: 400, description: 'Only rejected enrollments can be retried.' })
  @ApiResponse({ status: 404, description: 'Enrollment not found.' })
  async retryPayment(
    @Param('enrollmentId') enrollmentId: string,
    @CurrentUser('id') studentUserId: string,
  ) {
    return this.paymentsService.retryPayment(enrollmentId, studentUserId);
  }

  @Roles(Role.STUDENT)
  @Post(':paymentId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a pending checkout before submitting receipt (Student Only)',
  })
  @ApiResponse({ status: 200, description: 'Payment cancelled successfully.' })
  @ApiResponse({ status: 400, description: 'Cannot cancel payment after receipt submission or non-pending.' })
  async cancelPayment(
    @Param('paymentId') paymentId: string,
    @CurrentUser('id') studentUserId: string,
  ) {
    return this.paymentsService.cancelPayment(paymentId, studentUserId);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('teacher')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List payment requests for courses owned by the authenticated teacher (Teacher Only)',
  })
  @ApiResponse({ status: 200, description: 'Payments list returned.' })
  async getTeacherPayments(
    @CurrentUser('id') teacherUserId: string,
    @Query() query: PaymentQueryDto,
  ) {
    return this.paymentsService.getTeacherPayments(teacherUserId, query);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Patch(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept payment and activate student enrollment (Teacher Course Owner Only)',
  })
  @ApiResponse({ status: 200, description: 'Payment accepted and enrollment activated.' })
  @ApiResponse({ status: 403, description: 'Forbidden. Not the course owner.' })
  @ApiResponse({ status: 404, description: 'Payment not found.' })
  @ApiResponse({ status: 409, description: 'Payment already reviewed or not pending.' })
  async acceptPayment(
    @Param('id') paymentId: string,
    @CurrentUser('id') teacherUserId: string,
  ) {
    return this.paymentsService.acceptPayment(paymentId, teacherUserId);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Patch(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject payment with mandatory reason (Teacher Course Owner Only)',
  })
  @ApiResponse({ status: 200, description: 'Payment rejected successfully.' })
  @ApiResponse({ status: 400, description: 'Validation error. Rejection reason required.' })
  @ApiResponse({ status: 403, description: 'Forbidden. Not the course owner.' })
  @ApiResponse({ status: 404, description: 'Payment not found.' })
  @ApiResponse({ status: 409, description: 'Payment already reviewed or not pending.' })
  async rejectPayment(
    @Param('id') paymentId: string,
    @CurrentUser('id') teacherUserId: string,
    @Body() dto: RejectPaymentDto,
  ) {
    return this.paymentsService.rejectPayment(paymentId, teacherUserId, dto);
  }

  @Roles(Role.STUDENT)
  @Get('my-payments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List all payments and receipts submitted by the authenticated student (Student Only)',
  })
  @ApiResponse({ status: 200, description: 'My payments list returned.' })
  async getMyPayments(@CurrentUser('id') studentUserId: string) {
    return this.paymentsService.getMyPayments(studentUserId);
  }
}
