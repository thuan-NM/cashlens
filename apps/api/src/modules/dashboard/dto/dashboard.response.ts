import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { TransactionCategory } from '@prisma/client';
import { TotalsSummaryResponseDto } from '../../../common/finance/finance-totals.response';
import { TransactionCategoryResponseDto } from '../../transaction-categories/dto/transaction-category.response';

/**
 * OpenAPI descriptions of the dashboard responses (DASH-001 to DASH-004).
 * Each is the declared return type of its DashboardService method, so the
 * documentation cannot drift from the runtime shape.
 */
@ApiSchema({ name: 'DashboardOverview' })
export class DashboardOverviewResponseDto extends TotalsSummaryResponseDto {
  @ApiProperty({ description: 'The user month, YYYY-MM', example: '2026-09' })
  month!: string;

  @ApiProperty({
    description:
      'Base-currency net / income × 100, rounded half up to a whole percent; 0 without income',
  })
  savingRate!: number;

  @ApiProperty({ description: 'Unread CRITICAL alerts' })
  unreadAlerts!: number;

  @ApiProperty({ format: 'date-time' })
  periodStart!: string;

  @ApiProperty({ format: 'date-time' })
  periodEnd!: string;

  @ApiProperty({ description: 'The account IANA time zone' })
  timeZone!: string;
}

@ApiSchema({ name: 'CashflowMonth' })
export class CashflowMonthResponseDto {
  @ApiProperty({ description: 'The user month, YYYY-MM' })
  month!: string;

  @ApiProperty({ description: 'The base currency' })
  currency!: string;

  @ApiProperty()
  income!: number;

  @ApiProperty()
  expense!: number;

  @ApiProperty()
  netCashflow!: number;
}

@ApiSchema({ name: 'CategoryBreakdownRow' })
export class CategoryBreakdownRowResponseDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'null groups uncategorized records',
  })
  categoryId!: string | null;

  @ApiProperty({
    type: () => TransactionCategoryResponseDto,
    nullable: true,
    description: 'Categories flagged excludeFromAnalytics never appear',
  })
  category!: TransactionCategory | null;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  amount!: number;

  @ApiProperty()
  count!: number;
}

/** A budget at or over its threshold in the month (read-only projection). */
@ApiSchema({ name: 'HotBudget' })
export class HotBudgetResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  categoryId!: string | null;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  amount!: number;

  @ApiProperty()
  spent!: number;

  @ApiProperty({ minimum: 0 })
  remaining!: number;

  @ApiProperty({ minimum: 0 })
  percentUsed!: number;

  @ApiProperty()
  thresholdPercent!: number;

  @ApiProperty({ type: () => TransactionCategoryResponseDto, nullable: true })
  category!: TransactionCategory | null;
}

/**
 * A deterministic, rule-based dashboard insight (not an AI-generated one):
 * POSITIVE_CASHFLOW / NEGATIVE_CASHFLOW, and HOT_BUDGET for the top budgets.
 */
@ApiSchema({ name: 'DashboardInsight' })
export class DashboardInsightResponseDto {
  @ApiProperty({
    description: 'POSITIVE_CASHFLOW, NEGATIVE_CASHFLOW, or HOT_BUDGET',
  })
  type!: string;

  @ApiProperty({ description: 'INFO, WARNING, or CRITICAL' })
  severity!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  message!: string;
}
