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
import { BudgetsService } from './budgets.service';
import { BudgetMonthQueryDto } from './dto/budget-month-query.dto';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { ListBudgetsDto } from './dto/list-budgets.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';

@Controller('budgets')
@UseGuards(JwtAuthGuard)
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Query() query: ListBudgetsDto) {
    return this.budgetsService.list(user, query);
  }

  @Get('summary')
  summary(
    @CurrentUser() user: RequestUser,
    @Query() query: BudgetMonthQueryDto,
  ) {
    return this.budgetsService.summary(user, query);
  }

  @Get('alerts')
  alerts(
    @CurrentUser() user: RequestUser,
    @Query() query: BudgetMonthQueryDto,
  ) {
    return this.budgetsService.alerts(user, query);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateBudgetDto) {
    return this.budgetsService.create(user, dto);
  }

  @Get(':id')
  findById(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.budgetsService.findById(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateBudgetDto,
  ) {
    return this.budgetsService.update(user, id, dto);
  }

  @Delete(':id')
  archive(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.budgetsService.archive(user, id);
  }
}
