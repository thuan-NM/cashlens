import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditActorType, Prisma, UserStatus } from '@prisma/client';
import type { RequestUser } from '../../common/types/request-user.type';
import type { ListQuery } from '../../common/types/list-query-config.type';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { UpdateUserSettingsDto } from './dto/update-user-settings.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  toAdminUserResponse,
  toCreateUserInput,
  toUpdateMyProfileInput,
  toUpdateUserInput,
  toUserResponse,
} from './users.mapper';
import { AuditEntry, UsersRepository } from './users.repository';

/** Names of the fields a request actually set; values are never recorded. */
const changedFields = (dto: object): string[] =>
  Object.entries(dto)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
    .sort();

/**
 * DATA-001: raw email body retention cannot be enabled in this release; the
 * refusal names the field and changes nothing.
 */
export const rawEmailBodyUnavailable = () =>
  new BadRequestException({
    statusCode: 400,
    message: 'Raw email body retention is unavailable in this release',
    error: 'Bad Request',
    code: 'RAW_EMAIL_BODY_UNAVAILABLE',
    fields: {
      storeRawEmailBody: [
        'Raw email body retention is unavailable in this release',
      ],
    },
  });

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  // --- administrator operations (identity and status only) -------------------

  async list(query: ListQuery) {
    const result = await this.usersRepository.listUsers(query);

    return {
      data: result.data.map(toAdminUserResponse),
      total: result.total,
    };
  }

  async findById(id: string) {
    return toAdminUserResponse(await this.loadActive(id));
  }

  async create(actor: RequestUser, dto: CreateUserDto) {
    const existingUser = await this.usersRepository.findByEmail(dto.email);

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const user = await this.usersRepository.create(toCreateUserInput(dto));
    await this.audit(actor, 'ADMIN_USER_CREATED', user.id, {
      role: user.role,
      status: user.status,
    });
    return toAdminUserResponse(user);
  }

  async updateById(actor: RequestUser, id: string, dto: UpdateUserDto) {
    await this.loadActive(id);

    const user = await this.usersRepository.updateById(
      id,
      toUpdateUserInput(dto),
    );
    // A disabled account keeps no renewable session (AUTH-002, SEC-005).
    if (dto.status && dto.status !== UserStatus.ACTIVE) {
      await this.usersRepository.revokeAllRefreshTokens(id);
    }
    // Privileged change: the new role and status are recorded, other fields by name.
    await this.audit(actor, 'ADMIN_USER_UPDATED', id, {
      fields: changedFields(dto),
      ...(dto.role ? { role: dto.role } : {}),
      ...(dto.status ? { status: dto.status } : {}),
    });
    return toAdminUserResponse(user);
  }

  async deleteById(actor: RequestUser, id: string) {
    await this.loadActive(id);
    await this.usersRepository.softDeleteById(id);
    await this.usersRepository.revokeAllRefreshTokens(id);
    await this.audit(actor, 'ADMIN_USER_DELETED', id);

    return { id };
  }

  // --- self-service (the caller's own account, including settings) -----------

  async findMe(user: RequestUser) {
    return toUserResponse(await this.loadActive(user.id));
  }

  async updateMe(user: RequestUser, dto: UpdateMyProfileDto) {
    await this.loadActive(user.id);
    await this.usersRepository.updateById(user.id, toUpdateMyProfileInput(dto));
    await this.audit(user, 'USER_PROFILE_UPDATED', user.id, {
      fields: changedFields(dto),
    });

    return this.findMe(user);
  }

  async updateMySettings(user: RequestUser, dto: UpdateUserSettingsDto) {
    await this.loadActive(user.id);
    if (dto.storeRawEmailBody === true) {
      throw rawEmailBodyUnavailable();
    }

    await this.usersRepository.upsertSettings(user.id, {
      storeRawEmailBody: dto.storeRawEmailBody,
      allowAiInsights: dto.allowAiInsights,
      autoClassificationEnabled: dto.autoClassificationEnabled,
      defaultMonthStartDay: dto.defaultMonthStartDay,
      dataRetentionDays: dto.dataRetentionDays,
      notificationEnabled: dto.notificationEnabled,
      metadata: dto.metadata as Prisma.InputJsonValue | undefined,
    });
    await this.audit(user, 'USER_SETTINGS_UPDATED', user.id, {
      fields: changedFields(dto),
    });

    return this.findMe(user);
  }

  /** Admin actions are recorded as ADMIN; changes to one's own account as USER. */
  private audit(
    actor: RequestUser,
    action: string,
    targetId: string,
    metadata?: AuditEntry['metadata'],
  ) {
    return this.usersRepository.recordAudit({
      actorType: action.startsWith('ADMIN_')
        ? AuditActorType.ADMIN
        : AuditActorType.USER,
      actorId: actor.id,
      action,
      resourceType: 'user',
      resourceId: targetId,
      metadata,
    });
  }

  private async loadActive(id: string) {
    const user = await this.usersRepository.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }
}
