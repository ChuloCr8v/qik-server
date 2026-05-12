import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MailService } from '../mail/mail.service';
import { MeetingsController, PublicMeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

@Module({
  imports: [PrismaModule],
  controllers: [PublicMeetingsController, MeetingsController],
  providers: [MeetingsService, MailService],
  exports: [MeetingsService],
})
export class MeetingsModule {}
