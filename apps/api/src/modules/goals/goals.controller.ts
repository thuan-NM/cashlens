import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiEnvelopedResponse } from '../../common/swagger/api-envelope';
import type { RequestUser } from '../../common/types/request-user.type';
import { CreateGoalDto } from './dto/create-goal.dto';
import { GoalContributionDto } from './dto/goal-contribution.dto';
import { GoalFeasibilityResponseDto } from './dto/goal-feasibility.response';
import { GoalResponseDto } from './dto/goal.response';
import { GoalSimulationQueryDto } from './dto/goal-simulation-query.dto';
import { ListGoalsDto } from './dto/list-goals.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { GoalsService } from './goals.service';

@Controller('goals')
@UseGuards(JwtAuthGuard)
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Get()
  @ApiEnvelopedResponse(200, 'Owner goals', { arrayOf: GoalResponseDto })
  list(@CurrentUser() user: RequestUser, @Query() query: ListGoalsDto) {
    return this.goalsService.list(user, query);
  }

  @Post()
  @ApiEnvelopedResponse(201, 'Created goal', { model: GoalResponseDto })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateGoalDto) {
    return this.goalsService.create(user, dto);
  }

  /** Enveloped `GoalFeasibility`; side-effect free (never touches alerts). */
  @Get(':id/simulation')
  @ApiEnvelopedResponse(200, 'Feasibility or insufficient-data result', {
    model: GoalFeasibilityResponseDto,
  })
  simulate(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Query() query: GoalSimulationQueryDto,
  ) {
    return this.goalsService.simulate(user, id, query);
  }

  @Get(':id')
  @ApiEnvelopedResponse(200, 'Owned goal', { model: GoalResponseDto })
  findById(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.goalsService.findById(user, id);
  }

  @Patch(':id')
  @ApiEnvelopedResponse(200, 'Updated goal', { model: GoalResponseDto })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateGoalDto,
  ) {
    return this.goalsService.update(user, id, dto);
  }

  @Delete(':id')
  archive(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.goalsService.archive(user, id);
  }

  @Post(':id/contribution')
  @ApiEnvelopedResponse(201, 'Goal after the contribution', {
    model: GoalResponseDto,
  })
  contribute(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: GoalContributionDto,
  ) {
    return this.goalsService.contribute(user, id, dto);
  }
}
