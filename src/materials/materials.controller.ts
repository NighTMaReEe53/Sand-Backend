import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UploadedFile,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
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
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { MaterialsService } from './materials.service';
import { CreateCourseMaterialDto, DownloadMaterialResponseDto } from './dtos/create-material.dto';

@ApiTags('Course Materials')
@ApiBearerAuth('bearer')
@Controller()
export class MaterialsController {
  constructor(private readonly materialsService: MaterialsService) {}

  @Roles(Role.TEACHER)
  @Post('courses/:courseId/materials')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 3600000 } }) // 10 uploads per hour per teacher
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB Max File Size
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload course material file (PDF, PPTX, DOCX, <= 50MB) (Teacher Owner Only)',
    description:
      'Validates file magic bytes against executable disguise, checks size (max 50MB), uploads to storage and creates record without returning raw direct link.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'title'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Document file (.pdf, .doc, .docx, .ppt, .pptx <= 50MB)',
        },
        title: {
          type: 'string',
          example: 'ملخص الباب الأول - بيولوجيا',
        },
        description: {
          type: 'string',
          example: 'مذكرة شرح تفصيلية مع أهم الأسئلة المتوقعة',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Course material uploaded successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid file type, fake extension, or missing data.' })
  @ApiResponse({ status: 403, description: 'Forbidden. Not the course owner.' })
  @ApiResponse({ status: 413, description: 'Payload Too Large. File exceeds 50MB limit.' })
  async uploadMaterial(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCourseMaterialDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.materialsService.uploadMaterial(courseId, user, dto, file);
  }

  @Roles(Role.STUDENT)
  @Get('materials/my')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Student materials library — all files across every actively-enrolled course',
    description:
      'Returns every non-deleted course material (with course + section info) for all courses where the student has an ACTIVE enrollment. Powers the unified materials library page.',
  })
  @ApiResponse({ status: 200, description: 'Materials returned successfully (possibly empty).' })
  @ApiResponse({ status: 403, description: 'Forbidden. Students only.' })
  async getMyMaterials(@CurrentUser() user: AuthenticatedUser) {
    return this.materialsService.getMyMaterials(user);
  }

  @Get('courses/:courseId/materials')
  @ApiOperation({
    summary: 'Get all course materials without raw URLs (Teacher Owner or Active Student Only)',
  })
  @ApiResponse({ status: 200, description: 'List of materials returned successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden. Active enrollment or course ownership required.' })
  @ApiResponse({ status: 404, description: 'Course not found.' })
  async getCourseMaterials(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.materialsService.getCourseMaterials(courseId, user);
  }

  @Get('materials/:id/download')
  @ApiOperation({
    summary: 'Generate temporary Signed Download URL (5 mins) for course material',
    description:
      'Verifies Teacher ownership or Student ACTIVE enrollment before generating a short-lived signed download URL.',
  })
  @ApiResponse({
    status: 200,
    description: 'Signed download URL generated successfully.',
    type: DownloadMaterialResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Forbidden. Active enrollment or ownership required.' })
  @ApiResponse({ status: 404, description: 'Material not found or soft-deleted.' })
  async getSecureDownloadUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DownloadMaterialResponseDto> {
    return this.materialsService.getSecureDownloadUrl(id, user);
  }

  @Roles(Role.TEACHER)
  @Delete('materials/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete course material (Teacher Owner Only)' })
  @ApiResponse({ status: 200, description: 'Material soft-deleted successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden. Not the course owner.' })
  @ApiResponse({ status: 404, description: 'Material not found.' })
  async deleteMaterial(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.materialsService.deleteMaterial(id, user);
  }
}
