import { Injectable } from '@nestjs/common';
import { PlanStatus, PlanType, Prisma } from '@prisma/client';
import { PLAN_LIMITS, PlanName } from '../config/plans';
import { PrismaService } from '../prisma/prisma.service';

const toStoredLimit = (limit: number) => Number.isFinite(limit) ? limit : null;

@Injectable()
export class PlanService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserPlan(userId: string) {
    const existing = await this.prisma.plan.findUnique({ where: { userId } });
    if (existing) return existing;

    const limits = PLAN_LIMITS.Free;
    return this.prisma.plan.create({
      data: {
        userId,
        adminUserId: userId,
        type: PlanType.Free,
        aiGenerationsLimit: limits.aiGenerations,
        memberAiGenerationsLimit: limits.memberAiGenerations,
        teamMembersLimit: limits.teamMembers,
        tasksEnabled: limits.tasksEnabled,
        decisionsEnabled: limits.decisionsEnabled,
        dashboardEnabled: limits.dashboardEnabled,
      },
    });
  }

  async isAdmin(userId: string) {
    const plan = await this.getUserPlan(userId);
    return plan.adminUserId === userId;
  }

  async getEffectiveLimits(userId: string) {
    const plan = await this.getUserPlan(userId);
    const isEntitled = plan.status === 'active' || plan.status === 'trial';
    const effectiveType = isEntitled ? plan.type : PlanType.Free;
    const defaults = PLAN_LIMITS[effectiveType as PlanName];

    return {
      plan,
      limits: {
        aiGenerations: isEntitled ? plan.aiGenerationsLimit ?? defaults.aiGenerations : defaults.aiGenerations,
        memberAiGenerations: isEntitled ? plan.memberAiGenerationsLimit ?? defaults.memberAiGenerations : defaults.memberAiGenerations,
        teamMembers: isEntitled ? plan.teamMembersLimit ?? defaults.teamMembers : defaults.teamMembers,
        tasksEnabled: isEntitled ? plan.tasksEnabled : defaults.tasksEnabled,
        decisionsEnabled: isEntitled ? plan.decisionsEnabled : defaults.decisionsEnabled,
        dashboardEnabled: isEntitled ? plan.dashboardEnabled : defaults.dashboardEnabled,
        guestInvites: defaults.guestInvites,
        features: defaults.features,
      },
    };
  }

  async upgradePlan(userId: string, planType: PlanType) {
    return this.applyPlanToUser(userId, planType, 'active');
  }

  async applyPlanToUser(userId: string, planType: PlanType, status: PlanStatus = 'active', metadata?: Prisma.InputJsonObject) {
    const limits = PLAN_LIMITS[planType as PlanName];

    return this.prisma.plan.upsert({
      where: { userId },
      update: {
        type: planType,
        status,
        billingCycle: 'monthly',
        startDate: new Date(),
        expiresAt: status === 'active' || status === 'trial' ? null : new Date(),
        cancelledAt: status === 'cancelled' ? new Date() : null,
        adminUserId: userId,
        aiGenerationsLimit: toStoredLimit(limits.aiGenerations),
        memberAiGenerationsLimit: limits.memberAiGenerations,
        teamMembersLimit: limits.teamMembers,
        tasksEnabled: limits.tasksEnabled,
        decisionsEnabled: limits.decisionsEnabled,
        dashboardEnabled: limits.dashboardEnabled,
        metadata,
      },
      create: {
        userId,
        type: planType,
        status,
        billingCycle: 'monthly',
        adminUserId: userId,
        aiGenerationsLimit: toStoredLimit(limits.aiGenerations),
        memberAiGenerationsLimit: limits.memberAiGenerations,
        teamMembersLimit: limits.teamMembers,
        tasksEnabled: limits.tasksEnabled,
        decisionsEnabled: limits.decisionsEnabled,
        dashboardEnabled: limits.dashboardEnabled,
        metadata,
      },
    });
  }

  async updatePlanMetadata(userId: string, metadata: Prisma.InputJsonObject) {
    const plan = await this.getUserPlan(userId);
    return this.prisma.plan.update({
      where: { id: plan.id },
      data: {
        metadata: {
          ...((plan.metadata as Record<string, unknown> | null) || {}),
          ...metadata,
        } as Prisma.InputJsonObject,
      },
    });
  }

  async findByStripeCustomer(stripeCustomerId: string) {
    const plans = await this.prisma.plan.findMany();
    return plans.find(plan => (plan.metadata as any)?.stripeCustomerId === stripeCustomerId) || null;
  }

  async findByStripeSubscription(stripeSubscriptionId: string) {
    const plans = await this.prisma.plan.findMany();
    return plans.find(plan => (plan.metadata as any)?.stripeSubscriptionId === stripeSubscriptionId) || null;
  }
}
