import { PartialType } from '@nestjs/swagger';
import { CreateFinancialAccountDto } from './create-financial-account.dto';

export class UpdateFinancialAccountDto extends PartialType(
  CreateFinancialAccountDto,
) {}
