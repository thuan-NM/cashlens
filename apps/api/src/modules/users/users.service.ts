import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestUser } from '../../common/types/request-user.type';
import type { ListQuery } from '../../common/types/list-query-config.type';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserSettingsDto } from './dto/update-user-settings.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  toCreateUserInput,
  toUpdateUserInput,
  toUserResponse,
} from './users.mapper';
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

  async findMe(user: RequestUser) {
    return this.findById(user.id);
  }

  async create(dto: CreateUserDto) {
    const existingUser = await this.usersRepository.findByEmail(dto.email);

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const user = await this.usersRepository.create(toCreateUserInput(dto));
    return toUserResponse(user);
  }

  async updateById(id: string, dto: UpdateUserDto) {
    await this.findById(id);

    const user = await this.usersRepository.updateById(id, toUpdateUserInput(dto));
    return toUserResponse(user);
  }

  async updateMySettings(user: RequestUser, dto: UpdateUserSettingsDto) {
    await this.findById(user.id);

    await this.usersRepository.upsertSettings(user.id, {
      storeRawEmailBody: dto.storeRawEmailBody,
      allowAiInsights: dto.allowAiInsights,
      autoClassificationEnabled: dto.autoClassificationEnabled,
      defaultMonthStartDay: dto.defaultMonthStartDay,
      dataRetentionDays: dto.dataRetentionDays,
      notificationEnabled: dto.notificationEnabled,
      metadata: dto.metadata as Prisma.InputJsonValue | undefined,
    });

    return this.findById(user.id);
  }

  async deleteById(id: string) {
    await this.findById(id);
    await this.usersRepository.softDeleteById(id);

    return { id };
  }
}
