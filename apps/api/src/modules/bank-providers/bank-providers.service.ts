import { Injectable } from '@nestjs/common';
import { toBankProviderResponse } from './bank-providers.mapper';
import { BankProvidersRepository } from './bank-providers.repository';

@Injectable()
export class BankProvidersService {
  constructor(private readonly repository: BankProvidersRepository) {}

  async list() {
    return (await this.repository.listActive()).map(toBankProviderResponse);
  }
}
