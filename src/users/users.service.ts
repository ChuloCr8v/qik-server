import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getAnimeAvatar } from '../common/avatar';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.ensureAnimeAvatar(await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { billingPlan: true },
    }));
    return this.serializeUser(user);
  }

  async updateMe(userId: string, body: any) {
    const existingUser = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const nextPhotoUrl = this.resolvePhotoUrl(body, existingUser);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        displayName: body.displayName,
        photoUrl: nextPhotoUrl,
        bio: body.bio,
        jobTitle: body.jobTitle,
        plan: body.plan ? String(body.plan).toUpperCase() as any : undefined,
        subscriptionStatus: body.subscriptionStatus,
        subscriptionDate: body.subscriptionDate ? new Date(body.subscriptionDate) : undefined,
        notifyEmail: body.notifications?.email,
        notifyReminders: body.notifications?.reminders,
        notifyAiCoach: body.notifications?.aiCoach,
      },
    });
    return this.serializeUser(user);
  }

  async listUsers() {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
    const hydratedUsers = await Promise.all(users.map(user => this.ensureAnimeAvatar(user)));
    return hydratedUsers.map(user => this.serializeUser(user));
  }

  private resolvePhotoUrl(body: any, user: any) {
    if (body.photoURL === undefined && body.photoUrl === undefined) {
      return undefined;
    }

    const photoUrl = body.photoURL ?? body.photoUrl;
    return photoUrl?.trim() || getAnimeAvatar(user.email || user.id);
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

  private serializeUser(user: any) {
    return {
      uid: user.id,
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoUrl,
      bio: user.bio,
      jobTitle: user.jobTitle,
      role: this.titleCase(user.role),
      status: this.titleCase(user.status),
      plan: user.billingPlan?.type || this.titleCase(user.plan),
      subscriptionStatus: user.subscriptionStatus,
      subscriptionDate: user.subscriptionDate,
      notifications: {
        email: user.notifyEmail,
        reminders: user.notifyReminders,
        aiCoach: user.notifyAiCoach,
      },
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private titleCase(value?: string) {
    return value ? value.charAt(0) + value.slice(1).toLowerCase() : value;
  }
}
