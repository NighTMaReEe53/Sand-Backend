import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import * as express from 'express';
import * as path from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  const port = configService.get<number>('PORT', 3000);
  const apiPrefix = configService.get<string>('API_PREFIX', 'api/v1');
  const cookieSecret = configService.get<string>('COOKIE_SECRET', 'secret_cookie_key');
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');

  // 1. Security Headers (Helmet) with Cross-Origin Resource Policy for uploaded assets
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Serve static uploads
  app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

  // 2. Cookie Parser
  app.use(cookieParser(cookieSecret));

  // 3. CORS Configuration
  const corsOriginsRaw = configService.get<string>(
    'CORS_ORIGINS',
    'http://localhost:3000,http://localhost:5173,http://localhost:4200',
  );
  const allowedOrigins = corsOriginsRaw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, Postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || nodeEnv === 'development') {
        return callback(null, true);
      }
      return callback(new Error(`CORS error: Origin ${origin} not allowed.`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'x-exam-session'],
  });

  // 4. Global API Prefix
  app.setGlobalPrefix(apiPrefix);

  // 5. Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      exceptionFactory: (validationErrors) => {
        const messages = validationErrors.flatMap((error) =>
          Object.values(error.constraints || {}).filter(
            (message): message is string => typeof message === 'string',
          ),
        );
        return new BadRequestException(
          messages.length ? messages : ['البيانات المُدخلة غير صحيحة.'],
        );
      },
    }),
  );

  // 6. Swagger / OpenAPI Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('E-Learning Platform API')
    .setDescription('Enterprise E-Learning Platform Backend API Documentation')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT Access Token',
        in: 'header',
      },
      'bearer',
    )
    .addCookieAuth(
      'refreshToken',
      {
        type: 'apiKey',
        in: 'cookie',
        name: 'refreshToken',
        description: 'HttpOnly Secure Refresh Token Cookie',
      },
      'cookie',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  // 7. Start Server
  try {
    await app.listen(port, "0.0.0.0");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'EADDRINUSE') {
      logger.error(
        `Port ${port} is already in use. Stop the existing backend process or set a different PORT in Backend/.env.`,
      );
      await app.close();
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  logger.log(`=======================================================`);
  logger.log(`🚀 Application is running on: http://localhost:${port}/${apiPrefix}`);
  logger.log(`📚 Swagger Documentation is available at: http://localhost:${port}/api/docs`);
  logger.log(`=======================================================`);
}

bootstrap();
