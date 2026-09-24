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
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import type { RequestUser } from '../../common/types/request-user.type';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { UpdateUserSettingsDto } from './dto/update-user-settings.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

// Account identity and status management is administrator-only (SEC-002,
// SEC-003); `me` routes stay self-service. RolesGuard runs after the
// class-level JwtAuthGuard, so a missing session is 401 before any 403.
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('list')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  list(@Body() query: ListQueryDto) {
    return this.usersService.list(query);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  create(@CurrentUser() actor: RequestUser, @Body() dto: CreateUserDto) {
    return this.usersService.create(actor, dto);
  }

  @Get('me')
  findMe(@CurrentUser() user: RequestUser) {
    return this.usersService.findMe(user);
  }

  // Declared before `:id` so `me` never reaches the admin route.
  @Patch('me')
  updateMe(@CurrentUser() user: RequestUser, @Body() dto: UpdateMyProfileDto) {
    return this.usersService.updateMe(user, dto);
  }

  @Patch('me/settings')
  updateMySettings(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateUserSettingsDto,
  ) {
    return this.usersService.updateMySettings(user, dto);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  findById(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  updateById(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateById(actor, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  deleteById(@CurrentUser() actor: RequestUser, @Param('id') id: string) {
    return this.usersService.deleteById(actor, id);
  }
}
