import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/auth-user.decorator';
import { MeetingsService } from './meetings.service';

@Controller('public/meetings')
export class PublicMeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Get(':id')
  getPublicSummary(@Param('id') id: string) {
    return this.meetingsService.publicSummary(id);
  }
}

@UseGuards(JwtAuthGuard)
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.meetingsService.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.meetingsService.create(user.id, body);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.meetingsService.get(user.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.meetingsService.update(user.id, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.meetingsService.remove(user.id, id);
  }

  @Post(':id/start')
  start(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.meetingsService.start(user.id, id);
  }

  @Post(':id/stop')
  stop(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.meetingsService.stop(user.id, id);
  }

  @Post(':id/invite')
  invite(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { email: string }) {
    return this.meetingsService.sendInvite(user.id, id, body);
  }

  @Post(':id/reminders')
  reminders(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.meetingsService.sendReminders(user.id, id);
  }

  @Patch(':id/progress')
  progress(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.meetingsService.updateProgress(user.id, id, body);
  }

  @Post(':id/presence')
  presence(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.meetingsService.updatePresence(user.id, id);
  }

  @Delete(':id/presence')
  leave(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.meetingsService.leave(user.id, id);
  }

  @Get(':id/participants')
  participants(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.meetingsService.participants(user.id, id);
  }
}
