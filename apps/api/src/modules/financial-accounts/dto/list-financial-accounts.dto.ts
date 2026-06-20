import { AccountStatus, AccountType } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class ListFinancialAccountsDto {
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;

  @IsOptional()
  @IsEnum(AccountType)
  type?: AccountType;
}
