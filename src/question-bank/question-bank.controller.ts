import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { QuestionBankService } from './question-bank.service';
import {
  BulkDeleteBankQuestionsDto,
  CreateBankQuestionDto,
  ListBankQuestionsQueryDto,
  UpdateBankQuestionDto,
} from './dtos/question-bank.dtos';

@ApiTags('Question Bank')
@ApiBearerAuth('bearer')
@Controller()
export class QuestionBankController {
  constructor(private readonly bankService: QuestionBankService) {}

  @Roles(Role.TEACHER, Role.ADMIN)
  @Post('question-bank')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a question in the centralized bank (Teacher).' })
  create(
    @Body() dto: CreateBankQuestionDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.bankService.create(dto, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('question-bank')
  @ApiOperation({
    summary:
      'List/search/filter/sort own bank questions (difficulty, topic, course, lesson, tag, search).',
  })
  list(@Query() query: ListBankQuestionsQueryDto, @CurrentUser() user: { id: string; role: string }) {
    return this.bankService.list(query, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Get('question-bank/topics')
  @ApiOperation({ summary: 'List distinct topics in the teacher question bank.' })
  getTopics(@CurrentUser() user: { id: string; role: string }) {
    return this.bankService.getTopics(user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Patch('question-bank/:id')
  @ApiOperation({ summary: 'Update a bank question (Teacher Owner).' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBankQuestionDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.bankService.update(id, dto, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Delete('question-bank/:id')
  @ApiOperation({ summary: 'Soft-delete a bank question (Teacher Owner).' })
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.bankService.delete(id, user);
  }

  @Roles(Role.TEACHER, Role.ADMIN)
  @Post('question-bank/bulk-delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk soft-delete bank questions by ids (Teacher Owner / Admin).' })
  bulkDelete(
    @Body() dto: BulkDeleteBankQuestionsDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.bankService.bulkDelete(dto.ids, user);
  }
}
