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
import { ApiEnvelopedResponse } from '../../common/swagger/api-envelope';
import { CreateTransactionCategoryDto } from './dto/create-transaction-category.dto';
import { TransactionCategoryResponseDto } from './dto/transaction-category.response';
import { ListTransactionCategoriesDto } from './dto/list-transaction-categories.dto';
import { UpdateTransactionCategoryDto } from './dto/update-transaction-category.dto';
import { TransactionCategoriesService } from './transaction-categories.service';

@Controller('transaction-categories')
@UseGuards(JwtAuthGuard)
export class TransactionCategoriesController {
  constructor(
    private readonly transactionCategoriesService: TransactionCategoriesService,
  ) {}

  @Get()
  @ApiEnvelopedResponse(200, 'Categories visible to the user', {
    arrayOf: TransactionCategoryResponseDto,
  })
  list(
    @CurrentUser() user: RequestUser,
    @Query() query: ListTransactionCategoriesDto,
  ) {
    return this.transactionCategoriesService.list(user, query);
  }

  @Post()
  @ApiEnvelopedResponse(201, 'Created category', {
    model: TransactionCategoryResponseDto,
  })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateTransactionCategoryDto,
  ) {
    return this.transactionCategoriesService.create(user, dto);
  }

  @Get(':id')
  @ApiEnvelopedResponse(200, 'Category', {
    model: TransactionCategoryResponseDto,
  })
  findById(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.transactionCategoriesService.findById(user, id);
  }

  @Patch(':id')
  @ApiEnvelopedResponse(200, 'Updated category', {
    model: TransactionCategoryResponseDto,
  })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateTransactionCategoryDto,
  ) {
    return this.transactionCategoriesService.update(user, id, dto);
  }

  @Delete(':id')
  archive(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.transactionCategoriesService.archive(user, id);
  }
}
