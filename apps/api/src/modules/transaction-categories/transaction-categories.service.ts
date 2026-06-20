import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestUser } from '../../common/types/request-user.type';
import { CreateTransactionCategoryDto } from './dto/create-transaction-category.dto';
import { ListTransactionCategoriesDto } from './dto/list-transaction-categories.dto';
import { UpdateTransactionCategoryDto } from './dto/update-transaction-category.dto';
import {
  slugifyTransactionCategory,
  toCreateTransactionCategoryInput,
  toTransactionCategoryResponse,
  toUpdateTransactionCategoryInput,
} from './transaction-categories.mapper';
import { TransactionCategoriesRepository } from './transaction-categories.repository';

@Injectable()
export class TransactionCategoriesService {
  constructor(
    private readonly transactionCategoriesRepository: TransactionCategoriesRepository,
  ) {}

  async list(user: RequestUser, query: ListTransactionCategoriesDto) {
    const categories = await this.transactionCategoriesRepository.listByUser(
      user.id,
      query,
    );

    return categories.map(toTransactionCategoryResponse);
  }

  async findById(user: RequestUser, id: string) {
    const category =
      await this.transactionCategoriesRepository.findAccessibleById(user.id, id);

    if (!category) {
      throw new NotFoundException('Transaction category not found');
    }

    return toTransactionCategoryResponse(category);
  }

  async create(user: RequestUser, dto: CreateTransactionCategoryDto) {
    await this.ensureParentAllowed(user, dto.parentId);
    const slug = slugifyTransactionCategory(dto.slug ?? dto.name);
    const existing = await this.transactionCategoriesRepository.findByUserSlug(
      user.id,
      slug,
    );

    if (existing) {
      throw new ConflictException('Category slug already exists');
    }

    const category = await this.transactionCategoriesRepository.create(
      toCreateTransactionCategoryInput(user.id, dto),
    );

    return toTransactionCategoryResponse(category);
  }

  async update(user: RequestUser, id: string, dto: UpdateTransactionCategoryDto) {
    const category = await this.findOwnedById(user, id);
    await this.ensureParentAllowed(user, dto.parentId);

    const slug = dto.slug ?? dto.name;
    if (slug) {
      const normalizedSlug = slugifyTransactionCategory(slug);
      const existing =
        await this.transactionCategoriesRepository.findByUserSlug(
          user.id,
          normalizedSlug,
        );

      if (existing && existing.id !== category.id) {
        throw new ConflictException('Category slug already exists');
      }
    }

    const updatedCategory = await this.transactionCategoriesRepository.updateById(
      id,
      toUpdateTransactionCategoryInput(dto),
    );

    return toTransactionCategoryResponse(updatedCategory);
  }

  async archive(user: RequestUser, id: string) {
    await this.findOwnedById(user, id);

    await this.transactionCategoriesRepository.archiveById(id);

    return { id };
  }

  private async findOwnedById(user: RequestUser, id: string) {
    const category = await this.transactionCategoriesRepository.findOwnedById(
      user.id,
      id,
    );

    if (!category) {
      throw new NotFoundException('Editable transaction category not found');
    }

    return category;
  }

  private async ensureParentAllowed(user: RequestUser, parentId?: string) {
    if (!parentId) {
      return;
    }

    await this.findById(user, parentId);
  }

}
