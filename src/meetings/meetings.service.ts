import {
  BadRequestException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import {
  MeetingStatus
} from '@prisma/client';
import {
  PrismaService
} from '../prisma/prisma.service';
import {
  getAnimeAvatar
} from '../common/avatar';
import {
  MailService
} from '../mail/mail.service';
import { PLAN_LIMITS, PlanName } from '../config/plans';

@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async list(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: {
        id: userId
      }
    });
    const meetings = await this.prisma.meeting.findMany({
      where: {
        OR: [{
          ownerId: userId
        },
          {
            participants: {
              some: {
                userId
              }
            }
          },
          ...(user.email ? [{
            invitees: {
              has: user.email
            }
          }]: []),
        ],
      },
      orderBy: {
        createdAt: 'desc'
      },
    });
    return meetings.map(meeting => this.serializeMeeting(meeting));
  }

  async publicSummary(id: string) {
    const meeting = await this.prisma.meeting.findUnique({
      where: {
        id
      },
      include: {
        owner: {
          select: {
            displayName: true
          }
        },
        agenda: {
          select: {
            duration: true
          }
        },
      },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');

    return {
      id: meeting.id,
      title: meeting.title,
      description: meeting.description,
      scheduledAt: meeting.scheduledAt?.toISOString(),
      status: meeting.status.toLowerCase(),
      ownerName: meeting.owner?.displayName,
      agendaCount: meeting.agenda.length,
      totalDuration: meeting.agenda.reduce((total, item) => total + item.duration, 0),
      inviteeCount: meeting.invitees.length,
      isPublic: meeting.isPublic,
    };
  }

  async create(userId: string, body: any) {
    const template = body.template;
    const meeting = await this.prisma.meeting.create({
      data: {
        title: body.title || template?.name || 'Untitled Meeting',
        description: body.description || template?.description || '',
        ownerId: userId,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt): undefined,
        invitees: body.invitees || [],
        isPublic: body.isPublic,
        agenda: template?.items?.length ? {
          create: template.items.map((item: any, index: number) => ({
            title: item.title,
            description: item.description || '',
            duration: Number(item.duration || 5),
            order: index,
          })),
        }: undefined,
      },
    });
    await this.createNotification(userId, 'Meeting Created', `Your meeting "${meeting.title}" is ready.`, 'SUCCESS');
    return this.serializeMeeting(meeting);
  }

  async get(userId: string, id: string) {
    const meeting = await this.findAccessibleMeeting(userId, id);
    return this.serializeMeeting(meeting);
  }

  async update(userId: string, id: string, body: any) {
    await this.findAccessibleMeeting(userId, id);
    const meeting = await this.prisma.meeting.update({
      where: {
        id
      },
      data: {
        title: body.title,
        description: body.description,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt): undefined,
        invitees: body.invitees,
        isPublic: body.isPublic,
      },
    });
    return this.serializeMeeting(meeting);
  }

  async remove(userId: string, id: string) {
    await this.findOwnedMeeting(userId, id);
    await this.prisma.meeting.delete({
      where: {
        id
      }
    });
    return {
      ok: true
    };
  }

  async start(userId: string, id: string) {
    await this.findOwnedMeeting(userId, id);
    const meeting = await this.prisma.meeting.update({
      where: {
        id
      },
      data: {
        status: MeetingStatus.ACTIVE, isActive: true, isPaused: false, activeItemIndex: 0, startedAt: new Date()
      },
    });
    return this.serializeMeeting(meeting);
  }

  async stop(userId: string, id: string) {
    await this.findOwnedMeeting(userId, id);
    const meeting = await this.prisma.meeting.update({
      where: {
        id
      },
      data: {
        status: MeetingStatus.COMPLETED, isActive: false, isPaused: false
      },
    });
    return this.serializeMeeting(meeting);
  }

  async sendInvite(userId: string, id: string, body: {
    email: string
  }) {
    const email = body.email?.trim().toLowerCase();
    if (!this.isValidEmail(email)) {
      throw new BadRequestException('A valid invitee email is required.');
    }

    const [owner,
      currentMeeting] = await Promise.all([
        this.prisma.user.findUniqueOrThrow({
          where: {
            id: userId
          }
        }),
        this.findOwnedMeeting(userId, id),
      ]);
    const invitees = Array.from(new Set([...(currentMeeting.invitees || []), email]));
    const meeting = await this.prisma.meeting.update({
      where: {
        id
      },
      data: {
        invitees
      },
    });

    await this.prisma.invitation.create({
      data: {
        email,
        meetingId: id,
        invitedBy: userId,
      },
    });

    await this.mailService.sendMeetingInvite({
      to: email,
      meetingTitle: meeting.title,
      inviterName: owner.displayName || owner.email,
      inviteLink: this.meetingLink(id),
      scheduledAt: meeting.scheduledAt,
    });

    return {
      ok: true,
      meeting: this.serializeMeeting(meeting)
    };
  }

  async sendReminders(userId: string, id: string) {
    const meeting = await this.findOwnedMeeting(userId, id);
    const invitees = (meeting.invitees || []).filter((email: string) => this.isValidEmail(email));
    if (!invitees.length) {
      throw new BadRequestException('No invitees found for this meeting.');
    }

    await Promise.all(
      invitees.map((email: string) =>
        this.mailService.sendMeetingReminder({
          to: email,
          meetingTitle: meeting.title,
          inviteLink: this.meetingLink(id),
          scheduledAt: meeting.scheduledAt,
        }),
      ),
    );

    return {
      ok: true,
      sent: invitees.length
    };
  }

  async updateProgress(userId: string, id: string, body: any) {
    await this.findAccessibleMeeting(userId, id);
    const meeting = await this.prisma.meeting.update({
      where: {
        id
      },
      data: {
        activeItemIndex: body.activeItemIndex,
        isPaused: body.isPaused,
        startedAt: body.startedAt ? new Date(body.startedAt): body.startedAt === null ? null: undefined,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt): undefined,
      },
    });
    return this.serializeMeeting(meeting);
  }

  async updatePresence(userId: string, meetingId: string) {
    await this.findAccessibleMeeting(userId, meetingId);
    const user = await this.ensureAnimeAvatar(await this.prisma.user.findUniqueOrThrow({
      where: {
        id: userId
      }
    }));
    const participant = await this.prisma.participant.upsert({
      where: {
        meetingId_userId: {
          meetingId, userId
        }
      },
      update: {
        lastSeen: new Date(), displayName: user.displayName, photoUrl: user.photoUrl
      },
      create: {
        meetingId, userId, displayName: user.displayName, photoUrl: user.photoUrl
      },
    });
    return this.serializeParticipant(participant);
  }

  async leave(userId: string, meetingId: string) {
    await this.prisma.participant.deleteMany({
      where: {
        meetingId, userId
      }
    });
    return {
      ok: true
    };
  }

  async participants(userId: string, meetingId: string) {
    await this.findAccessibleMeeting(userId, meetingId);
    const participants = await this.prisma.participant.findMany({
      where: {
        meetingId
      }, orderBy: {
        lastSeen: 'desc'
      }
    });
    return participants.map(participant => this.serializeParticipant(participant));
  }

  private async findAccessibleMeeting(userId: string, id: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: {
        id: userId
      }
    });
    const meeting = await this.prisma.meeting.findFirst({
      where: {
        id,
        OR: [{
          ownerId: userId
        },
          {
            participants: {
              some: {
                userId
              }
            }
          },
          {
            isPublic: true
          },
          ...(user.email ? [{
            invitees: {
              has: user.email
            }
          }]: []),
        ],
      },
      include: {
        owner: true
      }
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    return meeting;
  }

  private async findOwnedMeeting(userId: string, id: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: {
        id, ownerId: userId
      }
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    return meeting;
  }

  private meetingLink(meetingId: string) {
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    const url = new URL(clientUrl);
    url.searchParams.set('m', meetingId);
    return url.toString();
  }

  private isValidEmail(email?: string) {
    return !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  private createNotification(userId: string, title: string, message: string, type: any) {
    return this.prisma.notification.create({
      data: {
        userId, title, message, type
      }
    });
  }

  async dashboardStats(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    const whereClause = {
      OR: [
        { ownerId: userId },
        { participants: { some: { userId } } },
        ...(user.email ? [{ invitees: { has: user.email } }] : []),
      ],
    };

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // 1. Stats Cards Calculations
    const totalMeetings = await this.prisma.meeting.count({ where: whereClause });
    const thisMonth = await this.prisma.meeting.count({
      where: {
        ...whereClause,
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
    });

    // Resolve plan and team admin
    const userPlan = await this.prisma.plan.findUnique({ where: { userId } });
    const adminUserId = userPlan?.adminUserId || userId;

    const teamMembers = await this.prisma.plan.count({
      where: {
        adminUserId,
        userId: { not: adminUserId },
      },
    });

    const aiGenerations = await this.prisma.usageLog.count({
      where: {
        userId,
        feature: 'AI_GENERATION',
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
    });

    // 2. Weekly Activities (Monday to Sunday of current week)
    const currentDay = now.getDay();
    const distanceToMon = currentDay === 0 ? -6 : 1 - currentDay;
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() + distanceToMon);
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);

    const weeklyMeetings = await this.prisma.meeting.findMany({
      where: {
        ...whereClause,
        scheduledAt: {
          gte: startOfWeek,
          lt: endOfWeek,
        },
      },
      select: {
        scheduledAt: true,
      },
    });

    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const weeklyCounts = dayNames.map(day => ({ day, meetings: 0 }));

    for (const m of weeklyMeetings) {
      if (m.scheduledAt) {
        const dayIndex = (m.scheduledAt.getDay() + 6) % 7; // Mon=0, Sun=6
        weeklyCounts[dayIndex].meetings += 1;
      }
    }

    // 3. Greeting Details & Streaks
    let streak = 0;
    const streakCheckDate = new Date(startOfWeek);
    while (true) {
      const startOfCheckWeek = new Date(streakCheckDate);
      const endOfCheckWeek = new Date(startOfCheckWeek);
      endOfCheckWeek.setDate(startOfCheckWeek.getDate() + 7);

      const count = await this.prisma.meeting.count({
        where: {
          ownerId: userId,
          createdAt: {
            gte: startOfCheckWeek,
            lt: endOfCheckWeek,
          },
        },
      });

      if (count > 0) {
        streak += 1;
        streakCheckDate.setDate(streakCheckDate.getDate() - 7);
      } else {
        if (streak === 0 && streakCheckDate.getTime() === startOfWeek.getTime()) {
          streakCheckDate.setDate(streakCheckDate.getDate() - 7);
          continue;
        }
        break;
      }
    }

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(startOfToday.getDate() + 1);

    const meetingsToday = await this.prisma.meeting.count({
      where: {
        ...whereClause,
        scheduledAt: {
          gte: startOfToday,
          lt: endOfToday,
        },
      },
    });

    const nextMeetingRecord = await this.prisma.meeting.findFirst({
      where: {
        ...whereClause,
        status: 'SCHEDULED',
        scheduledAt: {
          gte: now,
        },
      },
      orderBy: {
        scheduledAt: 'asc',
      },
      select: {
        id: true,
        title: true,
        scheduledAt: true,
      },
    });

    let nextMeeting: { id: string; title: string; time: string } | null = null;
    if (nextMeetingRecord && nextMeetingRecord.scheduledAt) {
      const timeStr = nextMeetingRecord.scheduledAt.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      nextMeeting = {
        id: nextMeetingRecord.id,
        title: nextMeetingRecord.title,
        time: timeStr,
      };
    }

    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const monthlyMeetings = await this.prisma.meeting.count({
      where: {
        ...whereClause,
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
    });

    const lastMonthMeetings = await this.prisma.meeting.count({
      where: {
        ...whereClause,
        createdAt: {
          gte: startOfLastMonth,
          lte: endOfLastMonth,
        },
      },
    });

    // 4. Meeting Status Distribution
    const completedCount = await this.prisma.meeting.count({ where: { ...whereClause, status: 'COMPLETED' } });
    const scheduledCount = await this.prisma.meeting.count({ where: { ...whereClause, status: 'SCHEDULED' } });
    const activeCount = await this.prisma.meeting.count({ where: { ...whereClause, status: 'ACTIVE' } });
    const archivedCount = await this.prisma.meeting.count({ where: { ...whereClause, status: 'ARCHIVED' } });

    // 5. Weekly Trends (Last 4 weeks)
    const weeklyTrends: { week: string; meetings: number }[] = [];
    for (let i = 3; i >= 0; i--) {
      const start = new Date(startOfWeek);
      start.setDate(start.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 7);

      const count = await this.prisma.meeting.count({
        where: {
          ...whereClause,
          createdAt: {
            gte: start,
            lt: end,
          },
        },
      });

      weeklyTrends.push({
        week: `Wk ${4 - i}`,
        meetings: count,
      });
    }

    // 6. Top Meeting Types
    const allUserMeetings = await this.prisma.meeting.findMany({
      where: whereClause,
      select: { title: true },
    });

    const countsMap: Record<string, number> = {};
    for (const m of allUserMeetings) {
      let type = 'Other';
      const titleLower = m.title.toLowerCase();
      if (titleLower.includes('standup') || titleLower.includes('daily')) type = 'Standup';
      else if (titleLower.includes('planning') || titleLower.includes('sprint')) type = 'Planning';
      else if (titleLower.includes('retro') || titleLower.includes('review')) type = 'Retro';
      else if (titleLower.includes('sync') || titleLower.includes('meeting')) type = 'Sync';
      else if (titleLower.includes('1:1') || titleLower.includes('one on one')) type = '1:1';

      countsMap[type] = (countsMap[type] || 0) + 1;
    }

    const sortedTypes = Object.entries(countsMap)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    const defaultTypes = ['Standup', 'Planning', 'Retro'];
    while (sortedTypes.length < 3) {
      const missingType = defaultTypes.find(dt => !sortedTypes.some(st => st.type === dt)) || 'Other';
      sortedTypes.push({ type: missingType, count: 0 });
    }

    // 7. Agenda Quality Calculations
    const completedMeetingsList = await this.prisma.meeting.findMany({
      where: {
        ...whereClause,
        status: 'COMPLETED',
      },
      select: { id: true },
    });

    const completedMeetingIds = completedMeetingsList.map(m => m.id);
    let agendaCompletedCount = 0;
    let agendaSkippedCount = 0;

    if (completedMeetingIds.length > 0) {
      agendaCompletedCount = await this.prisma.agendaItem.count({
        where: {
          meetingId: { in: completedMeetingIds },
          completed: true,
        },
      });

      agendaSkippedCount = await this.prisma.agendaItem.count({
        where: {
          meetingId: { in: completedMeetingIds },
          completed: false,
        },
      });
    }

    // 8. Team AI Usage Rings
    const teamMembersList = await this.prisma.user.findMany({
      where: {
        OR: [
          { id: adminUserId },
          { billingPlan: { adminUserId } },
        ],
      },
      select: {
        id: true,
        displayName: true,
      },
    });

    const teamAiUsage: { name: string; used: number; limit: number | null }[] = [];
    const planLimits = PLAN_LIMITS[userPlan?.type as PlanName || 'Free'];

    for (const member of teamMembersList) {
      const usageCount = await this.prisma.usageLog.count({
        where: {
          userId: member.id,
          feature: 'AI_GENERATION',
          createdAt: {
            gte: startOfMonth,
            lte: endOfMonth,
          },
        },
      });

      const limit = member.id === adminUserId ? planLimits.aiGenerations : planLimits.memberAiGenerations;

      teamAiUsage.push({
        name: member.displayName,
        used: usageCount,
        limit: limit === Number.POSITIVE_INFINITY ? null : limit,
      });
    }

    return {
      statsCards: {
        totalMeetings,
        thisMonth,
        teamMembers,
        aiGenerations,
      },
      weeklyActivities: weeklyCounts,
      greeting: {
        streak,
        meetingsToday,
        nextMeeting,
        monthlyMeetings,
        lastMonthMeetings,
      },
      statusDistribution: {
        completed: completedCount,
        scheduled: scheduledCount,
        draft: activeCount,
        cancelled: archivedCount,
      },
      weeklyTrends,
      topMeetingTypes: sortedTypes,
      agendaQuality: {
        completed: agendaCompletedCount,
        skipped: agendaSkippedCount,
      },
      teamAiUsage,
    };
  }

  private serializeMeeting(meeting: any) {
    return {
      id: meeting.id,
      title: meeting.title,
      description: meeting.description,
      ownerId: meeting.ownerId,
      owner: meeting.owner,
      scheduledAt: meeting.scheduledAt?.toISOString(),
      invitees: meeting.invitees,
      isPublic: meeting.isPublic,
      status: meeting.status.toLowerCase(),
      isActive: meeting.isActive,
      activeItemIndex: meeting.activeItemIndex,
      isPaused: meeting.isPaused,
      startedAt: meeting.startedAt?.toISOString(),
      createdAt: meeting.createdAt?.toISOString(),
    };
  }

  private serializeParticipant(participant: any) {
    return {
      id: participant.id,
      uid: participant.userId,
      displayName: participant.displayName,
      photoURL: participant.photoUrl,
      lastSeen: participant.lastSeen,
    };
  }

  private async ensureAnimeAvatar(user: any) {
    if (user.photoUrl) {
      return user;
    }

    return this.prisma.user.update({
      where: {
        id: user.id
      },
      data: {
        photoUrl: getAnimeAvatar(user.email || user.id)
      },
    });
  }
}
