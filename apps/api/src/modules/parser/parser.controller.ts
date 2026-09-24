import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { RequestUser } from '../../common/types/request-user.type';
import { CreateParserTemplateDto } from './dto/create-parser-template.dto';
import { UpdateParserTemplateDto } from './dto/update-parser-template.dto';
import { ParserService } from './parser.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class ParserController {
  constructor(private readonly service: ParserService) {}

  @Get('parser-templates')
  listTemplates() {
    return this.service.listTemplates();
  }

  // Parser templates are global system configuration: writes are admin-only
  // (SEC-003); reads and a user's own parse runs stay available to users.
  @Post('parser-templates')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  createTemplate(@Body() dto: CreateParserTemplateDto) {
    return this.service.createTemplate(dto);
  }

  @Patch('parser-templates/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  updateTemplate(
    @Param('id') id: string,
    @Body() dto: UpdateParserTemplateDto,
  ) {
    return this.service.updateTemplate(id, dto);
  }

  @Post('email-messages/:id/parse')
  parse(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.parseMessage(user, id);
  }

  @Get('email-messages/:id/parser-runs')
  listRuns(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.listRuns(user, id);
  }
}
