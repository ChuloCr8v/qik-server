import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MeetingsCronService {
  private readonly logger = new Logger(MeetingsCronService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Run every 10 seconds to auto-transition agendas
  @Cron('*/10 * * * * *')
  async handleAutoTransitions() {
    try {
      const activeMeetings = await this.prisma.meeting.findMany({
        where: {
          status: 'ACTIVE',
          isActive: true,
          isPaused: false,
        },
        include: {
          agenda: {
            orderBy: { order: 'asc' },
          },
        },
      });

      for (const meeting of activeMeetings) {
        if (meeting.activeItemIndex === null || meeting.activeItemIndex === undefined) continue;
        
        const currentItem = meeting.agenda[meeting.activeItemIndex];
        if (!currentItem || !meeting.startedAt) continue;

        const durationMs = currentItem.duration * 60 * 1000;
        const startedTime = new Date(meeting.startedAt).getTime();
        const elapsed = Date.now() - startedTime;

        // Give a 10-second buffer so the active frontend can transition fluidly without race conditions
        if (elapsed > durationMs + 10000) {
          this.logger.log(`Auto-transitioning meeting ${meeting.id} from item ${meeting.activeItemIndex}`);

          const isLastItem = meeting.activeItemIndex >= meeting.agenda.length - 1;

          // Complete the current item
          await this.prisma.agendaItem.update({
            where: { id: currentItem.id },
            data: { completed: true },
          });

          if (isLastItem) {
            // End meeting
            await this.prisma.meeting.update({
              where: { id: meeting.id },
              data: {
                status: 'COMPLETED',
                isActive: false,
                isPaused: false,
              },
            });
            this.logger.log(`Meeting ${meeting.id} automatically COMPLETED.`);
          } else {
            // Next item
            await this.prisma.meeting.update({
              where: { id: meeting.id },
              data: {
                activeItemIndex: meeting.activeItemIndex + 1,
                startedAt: new Date(),
              },
            });
          }
        }
      }
    } catch (error) {
      this.logger.error('Error during auto transitions', error);
    }
  }

  // Run every 10 minutes to clean up stale meetings
  @Cron('*/10 * * * *')
  async handleStaleMeetings() {
    try {
      // 12 hours ago
      const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);

      const staleMeetings = await this.prisma.meeting.findMany({
        where: {
          status: 'ACTIVE',
          updatedAt: {
            lt: twelveHoursAgo,
          },
        },
      });

      if (staleMeetings.length > 0) {
        this.logger.log(`Found ${staleMeetings.length} stale meetings to auto-complete.`);
        
        for (const meeting of staleMeetings) {
          await this.prisma.meeting.update({
            where: { id: meeting.id },
            data: {
              status: 'COMPLETED',
              isActive: false,
              isPaused: false,
            },
          });
        }
      }
    } catch (error) {
      this.logger.error('Error cleaning up stale meetings', error);
    }
  }
}
