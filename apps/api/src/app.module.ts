import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { FinancialAccountsModule } from './modules/financial-accounts/financial-accounts.module';
import { TransactionCategoriesModule } from './modules/transaction-categories/transaction-categories.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AppLoggerModule } from './common/logging/logger.module';
import { BaseResponseInterceptor } from './common/interceptors/base-response.interceptor';
import { SecurityModule } from './common/security/security.module';
import { BankProvidersModule } from './modules/bank-providers/bank-providers.module';
import { EmailConnectionsModule } from './modules/email-connections/email-connections.module';
import { EmailListenRulesModule } from './modules/email-listen-rules/email-listen-rules.module';
import { EmailIngestionModule } from './modules/email-ingestion/email-ingestion.module';
import { ParserModule } from './modules/parser/parser.module';
import { BudgetsModule } from './modules/budgets/budgets.module';
import { GoalsModule } from './modules/goals/goals.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AppLoggerModule,
    SecurityModule,
    PrismaModule,
    UsersModule,
    AuthModule,
    FinancialAccountsModule,
    TransactionCategoriesModule,
    TransactionsModule,
    AnalyticsModule,
    BankProvidersModule,
    EmailConnectionsModule,
    EmailListenRulesModule,
    EmailIngestionModule,
    ParserModule,
    BudgetsModule,
    GoalsModule,
    AlertsModule,
    DashboardModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: BaseResponseInterceptor,
    },
  ],
})
export class AppModule {}
