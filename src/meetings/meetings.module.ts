import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MailService } from '../mail/mail.service';
import { MeetingsController, PublicMeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { MeetingsCronService } from './meetings.cron';

@Module({
  imports: [PrismaModule],
  controllers: [PublicMeetingsController, MeetingsController],
  providers: [MeetingsService, MailService, MeetingsCronService],
  exports: [MeetingsService],
})
export class MeetingsModule {}
