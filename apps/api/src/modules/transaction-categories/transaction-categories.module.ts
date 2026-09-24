import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { TransactionCategoriesController } from './transaction-categories.controller';
import { TransactionCategoriesRepository } from './transaction-categories.repository';
import { TransactionCategoriesService } from './transaction-categories.service';

@Module({
  imports: [PrismaModule, UsersModule],
  controllers: [TransactionCategoriesController],
  providers: [TransactionCategoriesRepository, TransactionCategoriesService],
  exports: [TransactionCategoriesService],
})
export class TransactionCategoriesModule {}
