import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { RequestUser } from '../../common/types/request-user.type';
import { ClassificationService } from './classification.service';
import {
  CreateClassificationRuleDto,
  UpdateClassificationRuleDto,
} from './dto/classification-rule.dto';

/**
 * The caller's classification rules (CLASS-001). System rules are listed
 * read-only; any other rule, and a system rule on write, answers the
 * owner-safe 404 (SEC-005). Administrators get no bypass (SEC-008).
 */
@Controller('classification-rules')
@UseGuards(JwtAuthGuard)
export class ClassificationRulesController {
  constructor(private readonly classification: ClassificationService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.classification.listRules(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateClassificationRuleDto,
  ) {
    return this.classification.createRule(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateClassificationRuleDto,
  ) {
    return this.classification.updateRule(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.classification.deleteRule(user.id, id);
  }
}
