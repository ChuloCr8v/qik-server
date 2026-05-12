import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/auth-user.decorator';
import { AgendaService } from './agenda.service';

@UseGuards(JwtAuthGuard)
@Controller('meetings/:meetingId/agenda')
export class AgendaController {
  constructor(private readonly agendaService: AgendaService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('meetingId') meetingId: string) {
    return this.agendaService.list(user.id, meetingId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Param('meetingId') meetingId: string, @Body() body: any) {
    return this.agendaService.create(user.id, meetingId, body);
  }

  @Patch('reorder')
  reorder(@CurrentUser() user: AuthUser, @Param('meetingId') meetingId: string, @Body() body: any) {
    return this.agendaService.reorder(user.id, meetingId, body.items || []);
  }

  @Patch(':itemId')
  update(@CurrentUser() user: AuthUser, @Param('meetingId') meetingId: string, @Param('itemId') itemId: string, @Body() body: any) {
    return this.agendaService.update(user.id, meetingId, itemId, body);
  }

  @Delete(':itemId')
  remove(@CurrentUser() user: AuthUser, @Param('meetingId') meetingId: string, @Param('itemId') itemId: string) {
    return this.agendaService.remove(user.id, meetingId, itemId);
  }
}
