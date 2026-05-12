import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AgendaService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, meetingId: string) {
    await this.ensureAccessible(userId, meetingId);
    const items = await this.prisma.agendaItem.findMany({ where: { meetingId }, orderBy: { order: 'asc' } });
    return items.map(item => this.serializeItem(item));
  }

  async create(userId: string, meetingId: string, body: any) {
    await this.ensureAccessible(userId, meetingId);
    const item = await this.prisma.agendaItem.create({
      data: {
        meetingId,
        title: body.title,
        description: body.description || '',
        duration: Number(body.duration || 5),
        order: Number(body.order || 0),
      },
    });
    return this.serializeItem(item);
  }

  async update(userId: string, meetingId: string, itemId: string, body: any) {
    await this.ensureAccessible(userId, meetingId);
    const item = await this.prisma.agendaItem.update({
      where: { id: itemId },
      data: {
        title: body.title,
        description: body.description,
        duration: body.duration,
        completed: body.completed,
        order: body.order,
      },
    });
    return this.serializeItem(item);
  }

  async remove(userId: string, meetingId: string, itemId: string) {
    await this.ensureAccessible(userId, meetingId);
    await this.prisma.agendaItem.delete({ where: { id: itemId } });
    return { ok: true };
  }

  async reorder(userId: string, meetingId: string, items: any[]) {
    await this.ensureAccessible(userId, meetingId);
    await this.prisma.$transaction(
      items.map((item, index) => this.prisma.agendaItem.update({
        where: { id: item.id },
        data: { order: index },
      })),
    );
    return this.list(userId, meetingId);
  }

  private async ensureAccessible(userId: string, meetingId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const meeting = await this.prisma.meeting.findFirst({
      where: {
        id: meetingId,
        OR: [
          { ownerId: userId },
          { participants: { some: { userId } } },
          ...(user.email ? [{ invitees: { has: user.email } }] : []),
        ],
      },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
  }

  private serializeItem(item: any) {
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      duration: item.duration,
      order: item.order,
      completed: item.completed,
    };
  }
}
