import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditActorType, TransactionStatus } from '@prisma/client';
import type { RequestUser } from '../../common/types/request-user.type';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { MarkDuplicateDto } from './dto/mark-duplicate.dto';
import { UpdateTransactionCategoryDto } from './dto/update-transaction-category.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import {
  toCreateTransactionInput,
  toTransactionResponse,
  toUpdateTransactionInput,
} from './transactions.mapper';
import { UsersRepository } from '../users/users.repository';
import { TransactionsRepository } from './transactions.repository';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly transactionsRepository: TransactionsRepository,
    private readonly users: UsersRepository,
  ) {}

  async list(user: RequestUser, query: ListTransactionsDto) {
    const { data, total, page, limit } =
      await this.transactionsRepository.listByUser(user.id, query);

    return { data: data.map(toTransactionResponse), total, page, limit };
  }

  async findById(user: RequestUser, id: string) {
    const transaction = await this.transactionsRepository.findByIdForUser(
      user.id,
      id,
    );

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return toTransactionResponse(transaction);
  }

  async create(user: RequestUser, dto: CreateTransactionDto) {
    await this.assertRelatedEntities(user.id, {
      financialAccountId: dto.financialAccountId,
      categoryId: dto.categoryId,
      duplicateOfTransactionId: dto.duplicateOfTransactionId,
    });

    const transaction = await this.transactionsRepository.create(
      toCreateTransactionInput(user.id, dto),
    );

    return toTransactionResponse(transaction);
  }

  async update(user: RequestUser, id: string, dto: UpdateTransactionDto) {
    const before = await this.findById(user, id);
    await this.assertRelatedEntities(user.id, {
      financialAccountId: dto.financialAccountId,
      categoryId: dto.categoryId,
      duplicateOfTransactionId: dto.duplicateOfTransactionId,
    });

    const transaction = this.found(
      await this.transactionsRepository.updateById(
        user.id,
        id,
        toUpdateTransactionInput(dto),
      ),
    );
    if (dto.categoryId !== undefined) {
      await this.auditCategoryChange(user, before.categoryId, transaction);
    }

    return toTransactionResponse(transaction);
  }

  async updateCategory(
    user: RequestUser,
    id: string,
    dto: UpdateTransactionCategoryDto,
  ) {
    const before = await this.findById(user, id);

    if (dto.categoryId) {
      await this.assertCategoryAllowed(user.id, dto.categoryId);
    }

    const transaction = this.found(
      await this.transactionsRepository.updateCategory(
        user.id,
        id,
        dto.categoryId,
      ),
    );
    await this.auditCategoryChange(user, before.categoryId, transaction);

    return toTransactionResponse(transaction);
  }

  async markDuplicate(user: RequestUser, id: string, dto: MarkDuplicateDto) {
    await this.findById(user, id);

    if (dto.duplicateOfTransactionId === id) {
      throw new BadRequestException('Transaction cannot duplicate itself');
    }

    if (dto.duplicateOfTransactionId) {
      await this.assertTransactionOwned(user.id, dto.duplicateOfTransactionId);
    }

    const transaction = this.found(
      await this.transactionsRepository.markDuplicate(
        user.id,
        id,
        dto.duplicateOfTransactionId,
      ),
    );

    return toTransactionResponse(transaction);
  }

  async ignore(user: RequestUser, id: string) {
    await this.findById(user, id);

    const transaction = this.found(
      await this.transactionsRepository.updateStatus(
        user.id,
        id,
        TransactionStatus.IGNORED,
      ),
    );

    return toTransactionResponse(transaction);
  }

  async delete(user: RequestUser, id: string) {
    await this.findById(user, id);

    this.found(
      await this.transactionsRepository.updateStatus(
        user.id,
        id,
        TransactionStatus.DELETED,
      ),
    );
    await this.users.recordAudit({
      actorType: AuditActorType.USER,
      actorId: user.id,
      action: 'TRANSACTION_DELETED',
      resourceType: 'transaction',
      resourceId: id,
    });

    return { id };
  }

  /** Category corrections are audited with category ids only (SEC-006). */
  private async auditCategoryChange(
    user: RequestUser,
    fromCategoryId: string | null,
    transaction: { id: string; categoryId: string | null },
  ) {
    if (fromCategoryId === transaction.categoryId) {
      return;
    }
    await this.users.recordAudit({
      actorType: AuditActorType.USER,
      actorId: user.id,
      action: 'TRANSACTION_CATEGORY_CORRECTED',
      resourceType: 'transaction',
      resourceId: transaction.id,
      metadata: { fromCategoryId, toCategoryId: transaction.categoryId },
    });
  }

  private found<T>(transaction: T | null): T {
    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }
    return transaction;
  }

  private async assertRelatedEntities(
    userId: string,
    ids: {
      financialAccountId?: string;
      categoryId?: string;
      duplicateOfTransactionId?: string | null;
    },
  ) {
    if (ids.financialAccountId) {
      const accountExists =
        await this.transactionsRepository.financialAccountExists(
          userId,
          ids.financialAccountId,
        );

      if (!accountExists) {
        throw new NotFoundException('Financial account not found');
      }
    }

    if (ids.categoryId) {
      await this.assertCategoryAllowed(userId, ids.categoryId);
    }

    if (ids.duplicateOfTransactionId) {
      await this.assertTransactionOwned(userId, ids.duplicateOfTransactionId);
    }
  }

  private async assertCategoryAllowed(userId: string, categoryId: string) {
    const categoryExists =
      await this.transactionsRepository.categoryExistsForUser(
        userId,
        categoryId,
      );

    if (!categoryExists) {
      throw new NotFoundException('Transaction category not found');
    }
  }

  private async assertTransactionOwned(userId: string, transactionId: string) {
    const transactionExists =
      await this.transactionsRepository.transactionExistsForUser(
        userId,
        transactionId,
      );

    if (!transactionExists) {
      throw new NotFoundException('Related transaction not found');
    }
  }
}
