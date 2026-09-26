import { ApiProperty, ApiSchema } from '@nestjs/swagger';

/**
 * OpenAPI description of `CurrencyTotals` (financial-period-policy): the
 * eligible totals of one currency. Money is never summed across currencies.
 */
@ApiSchema({ name: 'CurrencyTotals' })
export class CurrencyTotalsResponseDto {
  @ApiProperty()
  currency!: string;

  @ApiProperty()
  income!: number;

  @ApiProperty()
  expense!: number;

  @ApiProperty()
  netCashflow!: number;

  @ApiProperty({
    description: 'Eligible records of every direction, transfers included',
  })
  transactionCount!: number;
}

/**
 * OpenAPI description of `TotalsSummary` (financial-summary.query): the
 * base-currency totals plus every currency group.
 */
@ApiSchema({ name: 'TotalsSummary' })
export class TotalsSummaryResponseDto extends CurrencyTotalsResponseDto {
  @ApiProperty({
    type: [CurrencyTotalsResponseDto],
    description:
      'Every currency group, sorted by code; empty when nothing is eligible',
  })
  currencies!: CurrencyTotalsResponseDto[];
}
