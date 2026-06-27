import { PartialType } from '@nestjs/swagger';
import { CreateEmailListenRuleDto } from './create-email-listen-rule.dto';

export class UpdateEmailListenRuleDto extends PartialType(
  CreateEmailListenRuleDto,
) {}
