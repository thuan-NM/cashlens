import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { User } from '@prisma/client';
import { BaseRepository } from '../../common/repositories/base.repository';
import type { ListQuery } from '../../common/types/list-query-config.type';
import { PrismaService } from '../../prisma/prisma.service';
import { usersListConfig } from './query/users.list-config';

type UserWithPasswordHash = User & {
  passwordHash: string | null;
};

@Injectable()
export class UsersRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  listUsers(query: ListQuery) {
    return this.list(this.prisma.user, query, usersListConfig, {
      where: { deletedAt: null },
    });
  }

  findById(id: string) {
    return super.baseFindOne(this.prisma.user, { id, deletedAt: null });
  }

  findByEmail(email: string) {
    return super.baseFindOne(this.prisma.user, {
      email: email.trim().toLowerCase(),
      deletedAt: null,
    });
  }

  findByEmailForAuth(email: string): Promise<UserWithPasswordHash | null> {
    return super.baseFindOne(this.prisma.user, {
      email: email.trim().toLowerCase(),
      deletedAt: null,
    }) as Promise<UserWithPasswordHash | null>;
  }

  create(data: Prisma.UserCreateInput & { passwordHash?: string | null }) {
    return super.baseCreate(this.prisma.user, data);
  }

  updateById(id: string, data: Prisma.UserUpdateInput) {
    return super.baseUpdateById(this.prisma.user, id, data);
  }

  updateLastLogin(id: string) {
    return super.baseUpdateById(this.prisma.user, id, {
      lastLogin: new Date(),
    });
  }

  deleteById(id: string) {
    return super.baseDeleteById(this.prisma.user, id);
  }

  softDeleteById(id: string) {
    return super.baseSoftDeleteById(this.prisma.user, id);
  }
}
