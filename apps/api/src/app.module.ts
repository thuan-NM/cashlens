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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AppLoggerModule,
    PrismaModule,
    UsersModule,
    AuthModule,
    FinancialAccountsModule,
    TransactionCategoriesModule,
    TransactionsModule,
    AnalyticsModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: BaseResponseInterceptor,
    },
  ],
})
export class AppModule {}
