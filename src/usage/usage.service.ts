import { Injectable } from '@nestjs/common';
import { Prisma, UsageFeature } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlanService } from '../plan/plan.service';

@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planService: PlanService,
  ) {}

  async logUsage(userId: string, planId: string | null, feature: UsageFeature, metadata?: Prisma.InputJsonObject) {
    return this.prisma.usageLog.create({
      data: {
        userId,
        planId: planId ?? undefined,
        feature,
        metadata: metadata || undefined,
      },
    });
  }

  async getMonthlyCount(userId: string, feature: UsageFeature, month: Date) {
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 1);

    return this.prisma.usageLog.count({
      where: {
        userId,
        feature,
        createdAt: {
          gte: start,
          lt: end,
        },
      },
    });
  }

  async canUseFeature(userId: string, feature: UsageFeature) {
    const { plan, limits } = await this.planService.getEffectiveLimits(userId);
    const used = await this.getMonthlyCount(userId, feature, new Date());

    if (feature === UsageFeature.AI_GENERATION) {
      const admin = plan.adminUserId === userId;
      const limit = admin ? limits.aiGenerations : limits.memberAiGenerations;
      return {
        allowed: limit === null || !Number.isFinite(limit) || used < limit,
        used,
        limit,
      };
    }

    return {
      allowed: true,
      used,
      limit: Number.POSITIVE_INFINITY,
    };
  }
}
