import { Injectable, NotFoundException } from '@nestjs/common';
import type { RequestUser } from '../../common/types/request-user.type';
import { CreateFinancialAccountDto } from './dto/create-financial-account.dto';
import { ListFinancialAccountsDto } from './dto/list-financial-accounts.dto';
import { UpdateFinancialAccountDto } from './dto/update-financial-account.dto';
import {
  toCreateFinancialAccountInput,
  toFinancialAccountResponse,
  toUpdateFinancialAccountInput,
} from './financial-accounts.mapper';
import { FinancialAccountsRepository } from './financial-accounts.repository';

@Injectable()
export class FinancialAccountsService {
  constructor(
    private readonly financialAccountsRepository: FinancialAccountsRepository,
  ) {}

  async list(user: RequestUser, query: ListFinancialAccountsDto) {
    const accounts = await this.financialAccountsRepository.listByUser(
      user.id,
      query,
    );

    return accounts.map(toFinancialAccountResponse);
  }

  async findById(user: RequestUser, id: string) {
    const account = await this.financialAccountsRepository.findByIdForUser(
      user.id,
      id,
    );

    if (!account) {
      throw new NotFoundException('Financial account not found');
    }

    return toFinancialAccountResponse(account);
  }

  async create(user: RequestUser, dto: CreateFinancialAccountDto) {
    const data = toCreateFinancialAccountInput(user.id, dto);

    if (dto.isDefault) {
      const account = await this.financialAccountsRepository.createWithDefaultReset(
        user.id,
        data,
      );
      return toFinancialAccountResponse(account);
    }

    const account = await this.financialAccountsRepository.create(data);
    return toFinancialAccountResponse(account);
  }

  async update(user: RequestUser, id: string, dto: UpdateFinancialAccountDto) {
    await this.findById(user, id);
    const data = toUpdateFinancialAccountInput(dto);

    if (dto.isDefault) {
      const account = await this.financialAccountsRepository.updateWithDefaultReset(
        user.id,
        id,
        data,
      );
      return toFinancialAccountResponse(account);
    }

    const account = await this.financialAccountsRepository.updateById(id, data);
    return toFinancialAccountResponse(account);
  }

  async archive(user: RequestUser, id: string) {
    await this.findById(user, id);

    await this.financialAccountsRepository.archiveById(id);

    return { id };
  }

}
