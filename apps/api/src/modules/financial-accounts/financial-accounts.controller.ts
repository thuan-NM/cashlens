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
import { CreateFinancialAccountDto } from './dto/create-financial-account.dto';
import { ListFinancialAccountsDto } from './dto/list-financial-accounts.dto';
import { UpdateFinancialAccountDto } from './dto/update-financial-account.dto';
import { FinancialAccountsService } from './financial-accounts.service';

@Controller('financial-accounts')
@UseGuards(JwtAuthGuard)
export class FinancialAccountsController {
  constructor(
    private readonly financialAccountsService: FinancialAccountsService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query() query: ListFinancialAccountsDto,
  ) {
    return this.financialAccountsService.list(user, query);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateFinancialAccountDto,
  ) {
    return this.financialAccountsService.create(user, dto);
  }

  @Get(':id')
  findById(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.financialAccountsService.findById(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateFinancialAccountDto,
  ) {
    return this.financialAccountsService.update(user, id, dto);
  }

  @Delete(':id')
  archive(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.financialAccountsService.archive(user, id);
  }
}
