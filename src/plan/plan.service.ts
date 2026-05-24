import { Injectable } from '@nestjs/common';
import { PlanType } from '@prisma/client';
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
    const defaults = PLAN_LIMITS[plan.type as PlanName];

    return {
      plan,
      limits: {
        aiGenerations: plan.aiGenerationsLimit ?? defaults.aiGenerations,
        memberAiGenerations: plan.memberAiGenerationsLimit ?? defaults.memberAiGenerations,
        teamMembers: plan.teamMembersLimit ?? defaults.teamMembers,
        tasksEnabled: plan.tasksEnabled,
        decisionsEnabled: plan.decisionsEnabled,
        dashboardEnabled: plan.dashboardEnabled,
        guestInvites: defaults.guestInvites,
        features: defaults.features,
      },
    };
  }

  async upgradePlan(userId: string, planType: PlanType) {
    const limits = PLAN_LIMITS[planType as PlanName];

    return this.prisma.plan.upsert({
      where: { userId },
      update: {
        type: planType,
        status: 'active',
        billingCycle: 'monthly',
        startDate: new Date(),
        expiresAt: null,
        cancelledAt: null,
        adminUserId: userId,
        aiGenerationsLimit: toStoredLimit(limits.aiGenerations),
        memberAiGenerationsLimit: limits.memberAiGenerations,
        teamMembersLimit: limits.teamMembers,
        tasksEnabled: limits.tasksEnabled,
        decisionsEnabled: limits.decisionsEnabled,
        dashboardEnabled: limits.dashboardEnabled,
      },
      create: {
        userId,
        type: planType,
        status: 'active',
        billingCycle: 'monthly',
        adminUserId: userId,
        aiGenerationsLimit: toStoredLimit(limits.aiGenerations),
        memberAiGenerationsLimit: limits.memberAiGenerations,
        teamMembersLimit: limits.teamMembers,
        tasksEnabled: limits.tasksEnabled,
        decisionsEnabled: limits.decisionsEnabled,
        dashboardEnabled: limits.dashboardEnabled,
      },
    });
  }
}
