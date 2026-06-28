import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { RequestUser } from '../../common/types/request-user.type';
import { DashboardService } from './dashboard.service';
import {
  DashboardCashflowQueryDto,
  DashboardMonthQueryDto,
} from './dto/dashboard-query.dto';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  overview(
    @CurrentUser() user: RequestUser,
    @Query() query: DashboardMonthQueryDto,
  ) {
    return this.dashboardService.overview(user, query);
  }

  @Get('cashflow')
  cashflow(
    @CurrentUser() user: RequestUser,
    @Query() query: DashboardCashflowQueryDto,
  ) {
    return this.dashboardService.cashflow(user, query);
  }

  @Get('category-breakdown')
  categoryBreakdown(
    @CurrentUser() user: RequestUser,
    @Query() query: DashboardMonthQueryDto,
  ) {
    return this.dashboardService.categoryBreakdown(user, query);
  }

  @Get('recent-transactions')
  recentTransactions(
    @CurrentUser() user: RequestUser,
    @Query() query: DashboardMonthQueryDto,
  ) {
    return this.dashboardService.recentTransactions(user, query);
  }

  @Get('hot-budgets')
  hotBudgets(
    @CurrentUser() user: RequestUser,
    @Query() query: DashboardMonthQueryDto,
  ) {
    return this.dashboardService.hotBudgets(user, query);
  }

  @Get('insights')
  insights(
    @CurrentUser() user: RequestUser,
    @Query() query: DashboardMonthQueryDto,
  ) {
    return this.dashboardService.insights(user, query);
  }
}
