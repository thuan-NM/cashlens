import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestUser } from '../../common/types/request-user.type';
import { CreateEmailListenRuleDto } from './dto/create-email-listen-rule.dto';
import { UpdateEmailListenRuleDto } from './dto/update-email-listen-rule.dto';
import {
  toCreateEmailListenRuleInput,
  toEmailListenRuleResponse,
  toUpdateEmailListenRuleInput,
} from './email-listen-rules.mapper';
import { EmailListenRulesRepository } from './email-listen-rules.repository';

@Injectable()
export class EmailListenRulesService {
  constructor(private readonly repository: EmailListenRulesRepository) {}

  async list(user: RequestUser) {
    return (await this.repository.listByUser(user.id)).map(
      toEmailListenRuleResponse,
    );
  }

  async create(user: RequestUser, dto: CreateEmailListenRuleDto) {
    await this.assertRelations(user.id, dto);
    return toEmailListenRuleResponse(
      await this.repository.create(toCreateEmailListenRuleInput(user.id, dto)),
    );
  }

  async update(
    user: RequestUser,
    id: string,
    dto: UpdateEmailListenRuleDto,
  ) {
    await this.findOwned(user.id, id);
    await this.assertRelations(user.id, dto);
    return toEmailListenRuleResponse(
      await this.repository.update(id, toUpdateEmailListenRuleInput(dto)),
    );
  }

  async remove(user: RequestUser, id: string) {
    await this.findOwned(user.id, id);
    await this.repository.delete(id);
    return { id };
  }

  private async findOwned(userId: string, id: string) {
    const rule = await this.repository.findOwned(userId, id);
    if (!rule) throw new NotFoundException('Email listen rule not found');
    return rule;
  }

  private async assertRelations(
    userId: string,
    dto: {
      emailConnectionId?: string;
      bankProviderId?: string;
    },
  ) {
    if (
      dto.emailConnectionId &&
      !(await this.repository.connectionOwned(userId, dto.emailConnectionId))
    ) {
      throw new NotFoundException('Email connection not found');
    }
    if (
      dto.bankProviderId &&
      !(await this.repository.bankProviderExists(dto.bankProviderId))
    ) {
      throw new NotFoundException('Bank provider not found');
    }
  }
}
