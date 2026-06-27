import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
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

  @Post('parser-templates')
  createTemplate(@Body() dto: CreateParserTemplateDto) {
    return this.service.createTemplate(dto);
  }

  @Patch('parser-templates/:id')
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
