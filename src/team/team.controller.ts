import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/auth-user.decorator';
import { TeamService } from './team.service';

@UseGuards(JwtAuthGuard)
@Controller('team')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Post('invite')
  invite(@CurrentUser() user: AuthUser, @Body() body: { email: string; role?: string }) {
    return this.teamService.invitePermanentMember(user.id, body);
  }
}
