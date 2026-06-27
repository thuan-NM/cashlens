import { Module } from '@nestjs/common';
import { BankProvidersController } from './bank-providers.controller';
import { BankProvidersRepository } from './bank-providers.repository';
import { BankProvidersService } from './bank-providers.service';

@Module({
  controllers: [BankProvidersController],
  providers: [BankProvidersRepository, BankProvidersService],
})
export class BankProvidersModule {}
