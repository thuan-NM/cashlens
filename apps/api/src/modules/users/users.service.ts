import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ListQuery } from '../../common/types/list-query-config.type';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { toUserResponse } from './users.mapper';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async list(query: ListQuery) {
    const result = await this.usersRepository.listUsers(query);

    return {
      data: result.data.map(toUserResponse),
      total: result.total,
    };
  }

  async findById(id: string) {
    const user = await this.usersRepository.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return toUserResponse(user);
  }

  async create(dto: CreateUserDto) {
    const existingUser = await this.usersRepository.findByEmail(dto.email);

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const user = await this.usersRepository.create(this.toCreateInput(dto));
    return toUserResponse(user);
  }

  async updateById(id: string, dto: UpdateUserDto) {
    await this.findById(id);

    const user = await this.usersRepository.updateById(id, this.toUpdateInput(dto));
    return toUserResponse(user);
  }

  async deleteById(id: string) {
    await this.findById(id);
    await this.usersRepository.softDeleteById(id);

    return { id };
  }

  private toCreateInput(dto: CreateUserDto): Prisma.UserCreateInput {
    return {
      email: dto.email,
      fullName: dto.fullName,
      timezone: dto.timezone,
      locale: dto.locale,
      baseCurrency: dto.baseCurrency,
      status: dto.status,
      metadata: dto.metadata as Prisma.InputJsonValue | undefined,
    };
  }

  private toUpdateInput(dto: UpdateUserDto): Prisma.UserUpdateInput {
    return {
      fullName: dto.fullName,
      timezone: dto.timezone,
      locale: dto.locale,
      baseCurrency: dto.baseCurrency,
      status: dto.status,
      metadata: dto.metadata as Prisma.InputJsonValue | undefined,
    };
  }
}
