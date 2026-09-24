import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { RequestUser } from '../../common/types/request-user.type';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { MarkDuplicateDto } from './dto/mark-duplicate.dto';
import { ReclassifyTransactionDto } from './dto/reclassify-transaction.dto';
import { UpdateTransactionCategoryDto } from './dto/update-transaction-category.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { TransactionsService } from './transactions.service';

@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Query() query: ListTransactionsDto) {
    return this.transactionsService.list(user, query);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateTransactionDto) {
    return this.transactionsService.create(user, dto);
  }

  @Get(':id')
  findById(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.transactionsService.findById(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateTransactionDto,
  ) {
    return this.transactionsService.update(user, id, dto);
  }

  @Patch(':id/category')
  updateCategory(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateTransactionCategoryDto,
  ) {
    return this.transactionsService.updateCategory(user, id, dto);
  }

  /**
   * Applies the rules now, replacing a manual category if there is one
   * (CLASS-006). The client warns before calling it; the body must be empty.
   */
  @Post(':id/reclassify')
  @HttpCode(200)
  reclassify(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    // Bound only so the ValidationPipe refuses any body property (SEC-004).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Body() _dto: ReclassifyTransactionDto,
  ) {
    return this.transactionsService.reclassify(user, id);
  }

  @Get(':id/category-history')
  categoryHistory(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.transactionsService.categoryHistory(user, id);
  }

  @Patch(':id/duplicate')
  markDuplicate(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: MarkDuplicateDto,
  ) {
    return this.transactionsService.markDuplicate(user, id, dto);
  }

  @Patch(':id/ignore')
  ignore(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.transactionsService.ignore(user, id);
  }

  @Delete(':id')
  delete(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.transactionsService.delete(user, id);
  }
}
