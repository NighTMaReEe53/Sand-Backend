import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsBoolean, IsOptional } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dtos/review.dtos';

class ModerateQueryDto {
  @IsBoolean()
  @IsOptional()
  hide?: boolean;
}

@ApiTags('Course Reviews')
@ApiBearerAuth('bearer')
@Controller()
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Roles(Role.STUDENT)
  @Post('courses/:courseId/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create or update own course review (active enrollment required).' })
  upsertReview(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviewsService.upsertReview(courseId, userId, dto);
  }

  @Roles(Role.STUDENT)
  @Delete('courses/:courseId/review')
  @ApiOperation({ summary: 'Delete own review.' })
  deleteOwn(@Param('courseId', ParseUUIDPipe) courseId: string, @CurrentUser('id') userId: string) {
    return this.reviewsService.deleteOwnReview(courseId, userId);
  }

  @Public()
  @Get('courses/:courseId/reviews')
  @ApiOperation({ summary: 'Public visible reviews for a course with aggregate rating.' })
  getCourseReviews(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Query() query: { page?: number; limit?: number },
  ) {
    return this.reviewsService.getCourseReviews(courseId, query);
  }

  @Roles(Role.STUDENT)
  @Get('reviews/my-reviews')
  @ApiOperation({ summary: 'List own reviews across courses.' })
  getMyReviews(@CurrentUser('id') userId: string) {
    return this.reviewsService.getMyReviews(userId);
  }

  @Public()
  @Get('testimonials')
  @ApiOperation({
    summary:
      'Curated testimonials: real reviews from actively-enrolled students only, top-rated with variety across courses.',
  })
  getTestimonials(@Query('limit') limit?: string) {
    return this.reviewsService.getTestimonials(limit ? parseInt(limit, 10) : 6);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Post('reviews/:id/moderate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hide/restore a review (Teacher Owner / Admin). Send {"hide": true|false}.' })
  moderate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ModerateQueryDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.reviewsService.moderate(id, body.hide ?? true, user);
  }
}
