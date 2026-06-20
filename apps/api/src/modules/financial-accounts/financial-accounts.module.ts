import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FinancialAccountsController } from './financial-accounts.controller';
import { FinancialAccountsRepository } from './financial-accounts.repository';
import { FinancialAccountsService } from './financial-accounts.service';

@Module({
  imports: [PrismaModule],
  controllers: [FinancialAccountsController],
  providers: [FinancialAccountsRepository, FinancialAccountsService],
  exports: [FinancialAccountsService],
})
export class FinancialAccountsModule {}
