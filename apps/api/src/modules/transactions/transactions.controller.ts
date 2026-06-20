import {
  Body,
  Controller,
  Delete,
  Get,
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
