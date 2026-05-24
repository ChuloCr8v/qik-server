import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/auth-user.decorator';
import { PlanGuard } from '../common/guards/plan.guard';
import { AiService } from './ai.service';

@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('agenda')
  @UseGuards(PlanGuard)
  generateAgenda(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.aiService.generateAgenda(user.id, body);
  }
}
