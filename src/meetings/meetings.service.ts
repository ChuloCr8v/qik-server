import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MeetingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getAnimeAvatar } from '../common/avatar';
import { MailService } from '../mail/mail.service';

@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async list(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const meetings = await this.prisma.meeting.findMany({
      where: {
        OR: [
          { ownerId: userId },
          { participants: { some: { userId } } },
          ...(user.email ? [{ invitees: { has: user.email } }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    return meetings.map(meeting => this.serializeMeeting(meeting));
  }

  async publicSummary(id: string) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id },
      include: {
        owner: { select: { displayName: true } },
        agenda: { select: { duration: true } },
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
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
        invitees: body.invitees || [],
        isPublic: body.isPublic,
        agenda: template?.items?.length ? {
          create: template.items.map((item: any, index: number) => ({
            title: item.title,
            description: item.description || '',
            duration: Number(item.duration || 5),
            order: index,
          })),
        } : undefined,
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
      where: { id },
      data: {
        title: body.title,
        description: body.description,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
        invitees: body.invitees,
        isPublic: body.isPublic,
      },
    });
    return this.serializeMeeting(meeting);
  }

  async remove(userId: string, id: string) {
    await this.findOwnedMeeting(userId, id);
    await this.prisma.meeting.delete({ where: { id } });
    return { ok: true };
  }

  async start(userId: string, id: string) {
    await this.findOwnedMeeting(userId, id);
    const meeting = await this.prisma.meeting.update({
      where: { id },
      data: { status: MeetingStatus.ACTIVE, isActive: true, isPaused: false, activeItemIndex: 0, startedAt: new Date() },
    });
    return this.serializeMeeting(meeting);
  }

  async stop(userId: string, id: string) {
    await this.findOwnedMeeting(userId, id);
    const meeting = await this.prisma.meeting.update({
      where: { id },
      data: { status: MeetingStatus.COMPLETED, isActive: false, isPaused: false },
    });
    return this.serializeMeeting(meeting);
  }

  async sendInvite(userId: string, id: string, body: { email: string }) {
    const email = body.email?.trim().toLowerCase();
    if (!this.isValidEmail(email)) {
      throw new BadRequestException('A valid invitee email is required.');
    }

    const [owner, currentMeeting] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.findOwnedMeeting(userId, id),
    ]);
    const invitees = Array.from(new Set([...(currentMeeting.invitees || []), email]));
    const meeting = await this.prisma.meeting.update({
      where: { id },
      data: { invitees },
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

    return { ok: true, meeting: this.serializeMeeting(meeting) };
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

    return { ok: true, sent: invitees.length };
  }

  async updateProgress(userId: string, id: string, body: any) {
    await this.findAccessibleMeeting(userId, id);
    const meeting = await this.prisma.meeting.update({
      where: { id },
      data: {
        activeItemIndex: body.activeItemIndex,
        isPaused: body.isPaused,
        startedAt: body.startedAt ? new Date(body.startedAt) : body.startedAt === null ? null : undefined,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
      },
    });
    return this.serializeMeeting(meeting);
  }

  async updatePresence(userId: string, meetingId: string) {
    await this.findAccessibleMeeting(userId, meetingId);
    const user = await this.ensureAnimeAvatar(await this.prisma.user.findUniqueOrThrow({ where: { id: userId } }));
    const participant = await this.prisma.participant.upsert({
      where: { meetingId_userId: { meetingId, userId } },
      update: { lastSeen: new Date(), displayName: user.displayName, photoUrl: user.photoUrl },
      create: { meetingId, userId, displayName: user.displayName, photoUrl: user.photoUrl },
    });
    return this.serializeParticipant(participant);
  }

  async leave(userId: string, meetingId: string) {
    await this.prisma.participant.deleteMany({ where: { meetingId, userId } });
    return { ok: true };
  }

  async participants(userId: string, meetingId: string) {
    await this.findAccessibleMeeting(userId, meetingId);
    const participants = await this.prisma.participant.findMany({ where: { meetingId }, orderBy: { lastSeen: 'desc' } });
    return participants.map(participant => this.serializeParticipant(participant));
  }

  private async findAccessibleMeeting(userId: string, id: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const meeting = await this.prisma.meeting.findFirst({
      where: {
        id,
        OR: [
          { ownerId: userId },
          { participants: { some: { userId } } },
          { isPublic: true },
          ...(user.email ? [{ invitees: { has: user.email } }] : []),
        ],
      },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    return meeting;
  }

  private async findOwnedMeeting(userId: string, id: string) {
    const meeting = await this.prisma.meeting.findFirst({ where: { id, ownerId: userId } });
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
    return this.prisma.notification.create({ data: { userId, title, message, type } });
  }

  private serializeMeeting(meeting: any) {
    return {
      id: meeting.id,
      title: meeting.title,
      description: meeting.description,
      ownerId: meeting.ownerId,
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
      where: { id: user.id },
      data: { photoUrl: getAnimeAvatar(user.email || user.id) },
    });
  }
}
