import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const notifications = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return notifications.map(notification => this.serializeNotification(notification));
  }

  async create(body: any) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: body.userId,
        title: body.title,
        message: body.message,
        type: this.parseType(body.type),
      },
    });
    return this.serializeNotification(notification);
  }

  async markAsRead(userId: string, id: string) {
    const notification = await this.prisma.notification.update({
      where: { id },
      data: { read: true },
    });
    return notification.userId === userId ? this.serializeNotification(notification) : { ok: false };
  }

  private parseType(type?: string): NotificationType {
    if (type === 'success') return NotificationType.SUCCESS;
    if (type === 'invite') return NotificationType.INVITE;
    return NotificationType.INFO;
  }

  private serializeNotification(notification: any) {
    return {
      id: notification.id,
      userId: notification.userId,
      title: notification.title,
      message: notification.message,
      type: notification.type.toLowerCase(),
      read: notification.read,
      createdAt: notification.createdAt,
    };
  }
}
