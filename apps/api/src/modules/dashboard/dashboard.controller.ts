import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { RequestUser } from '../../common/types/request-user.type';
import { ApiEnvelopedResponse } from '../../common/swagger/api-envelope';
import { DashboardService } from './dashboard.service';
import {
  DashboardCashflowQueryDto,
  DashboardMonthQueryDto,
} from './dto/dashboard-query.dto';
import {
  CashflowMonthResponseDto,
  CategoryBreakdownRowResponseDto,
  DashboardInsightResponseDto,
  DashboardOverviewResponseDto,
  HotBudgetResponseDto,
} from './dto/dashboard.response';
import { TransactionResponseDto } from '../transactions/dto/transaction.response';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @ApiEnvelopedResponse(200, 'Current user month totals', {
    model: DashboardOverviewResponseDto,
  })
  overview(
    @CurrentUser() user: RequestUser,
    @Query() query: DashboardMonthQueryDto,
  ) {
    return this.dashboardService.overview(user, query);
  }

  @Get('cashflow')
  @ApiEnvelopedResponse(200, 'One row per user month, oldest first', {
    arrayOf: CashflowMonthResponseDto,
  })
  cashflow(
    @CurrentUser() user: RequestUser,
    @Query() query: DashboardCashflowQueryDto,
  ) {
    return this.dashboardService.cashflow(user, query);
  }

  @Get('category-breakdown')
  @ApiEnvelopedResponse(200, 'Expense per category and currency', {
    arrayOf: CategoryBreakdownRowResponseDto,
  })
  categoryBreakdown(
    @CurrentUser() user: RequestUser,
    @Query() query: DashboardMonthQueryDto,
  ) {
    return this.dashboardService.categoryBreakdown(user, query);
  }

  @Get('recent-transactions')
  @ApiEnvelopedResponse(200, 'The five most recent eligible transactions', {
    arrayOf: TransactionResponseDto,
  })
  recentTransactions(
    @CurrentUser() user: RequestUser,
    @Query() query: DashboardMonthQueryDto,
  ) {
    return this.dashboardService.recentTransactions(user, query);
  }

  @Get('hot-budgets')
  @ApiEnvelopedResponse(200, 'Budgets at or over their threshold', {
    arrayOf: HotBudgetResponseDto,
  })
  hotBudgets(
    @CurrentUser() user: RequestUser,
    @Query() query: DashboardMonthQueryDto,
  ) {
    return this.dashboardService.hotBudgets(user, query);
  }

  @Get('insights')
  @ApiEnvelopedResponse(200, 'Deterministic, rule-based insights', {
    arrayOf: DashboardInsightResponseDto,
  })
  insights(
    @CurrentUser() user: RequestUser,
    @Query() query: DashboardMonthQueryDto,
  ) {
    return this.dashboardService.insights(user, query);
  }
}
