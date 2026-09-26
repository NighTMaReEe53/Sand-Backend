import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = 'حدث خطأ في الخادم الداخلي';
    let errors: any = null;
    // Optional machine-readable code (e.g. LESSON_LOCKED) forwarded as-is
    let code: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resObj = exceptionResponse as Record<string, any>;
        if (Array.isArray(resObj.message)) {
          errors = resObj.message;
          message = resObj.message.join(' | ');
        } else {
          message = resObj.message || exception.message;
          if (resObj.error) {
            errors = resObj.error;
          }
        }
        if (typeof resObj.code === 'string') {
          code = resObj.code;
        }
      }
    } else if (exception instanceof Error) {
      this.logger.error(`Unhandled Exception: ${exception.message}`, exception.stack);
      message = process.env.NODE_ENV === 'production' ? 'حدث خطأ في الخادم الداخلي' : exception.message;
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      errors,
      ...(code && { code }),
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
