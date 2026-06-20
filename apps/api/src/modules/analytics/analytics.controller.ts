import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { RequestUser } from '../../common/types/request-user.type';
import {
  MonthlyAnalyticsQueryDto,
  RangeAnalyticsQueryDto,
} from './dto/analytics-query.dto';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('monthly-summary')
  monthlySummary(
    @CurrentUser() user: RequestUser,
    @Query() query: MonthlyAnalyticsQueryDto,
  ) {
    return this.analyticsService.monthlySummary(user, query);
  }

  @Get('category-breakdown')
  categoryBreakdown(
    @CurrentUser() user: RequestUser,
    @Query() query: MonthlyAnalyticsQueryDto,
  ) {
    return this.analyticsService.categoryBreakdown(user, query);
  }

  @Get('cashflow')
  cashflow(
    @CurrentUser() user: RequestUser,
    @Query() query: RangeAnalyticsQueryDto,
  ) {
    return this.analyticsService.cashflow(user, query);
  }
}
