import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { BankProvidersService } from './bank-providers.service';

@Controller('bank-providers')
@UseGuards(JwtAuthGuard)
export class BankProvidersController {
  constructor(private readonly service: BankProvidersService) {}

  @Get()
  list() {
    return this.service.list();
  }
}
