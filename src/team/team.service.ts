import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { OrgRole, PlanType, UsageFeature } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlanService } from '../plan/plan.service';
import { UsageService } from '../usage/usage.service';
import { isValidEmail, normalizeEmail } from '../common/email';

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planService: PlanService,
    private readonly usageService: UsageService,
  ) {}

  async invitePermanentMember(userId: string, body: { email: string; role?: string }) {
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) {
      throw new BadRequestException('A valid team member email is required.');
    }

    const plan = await this.planService.getUserPlan(userId);
    const { limits } = await this.planService.getEffectiveLimits(userId);
    const adminUserId = plan.adminUserId || userId;

    if (plan.type === PlanType.Free || plan.type === PlanType.Individual || limits.teamMembers <= 0) {
      throw new ForbiddenException('Permanent team members require an Organisation plan.');
    }

    if (plan.adminUserId !== userId) {
      throw new ForbiddenException('Only the billing admin can invite permanent team members.');
    }

    const used = await this.countPermanentMembers(adminUserId);

    if (used >= limits.teamMembers) {
      throw new ForbiddenException('You have reached your team member limit. Please upgrade your plan.');
    }

    const invitedUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { normalizedEmail: email },
          { email: { equals: email, mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (invitedUser && invitedUser.id !== adminUserId) {
      await this.prisma.plan.upsert({
        where: { userId: invitedUser.id },
        update: {
          adminUserId,
          type: plan.type,
          status: plan.status,
          billingCycle: plan.billingCycle,
          aiGenerationsLimit: limits.memberAiGenerations,
          memberAiGenerationsLimit: limits.memberAiGenerations,
          teamMembersLimit: limits.teamMembers,
          tasksEnabled: limits.tasksEnabled,
          decisionsEnabled: limits.decisionsEnabled,
          dashboardEnabled: limits.dashboardEnabled,
        },
        create: {
          userId: invitedUser.id,
          adminUserId,
          type: plan.type,
          status: plan.status,
          billingCycle: plan.billingCycle,
          aiGenerationsLimit: limits.memberAiGenerations,
          memberAiGenerationsLimit: limits.memberAiGenerations,
          teamMembersLimit: limits.teamMembers,
          tasksEnabled: limits.tasksEnabled,
          decisionsEnabled: limits.decisionsEnabled,
          dashboardEnabled: limits.dashboardEnabled,
        },
      });
      await this.prisma.user.update({
        where: { id: invitedUser.id },
        data: { orgRole: body.role === 'Admin' ? OrgRole.ADMIN : OrgRole.MEMBER },
      });
    }

    await this.usageService.logUsage(userId, plan.id, UsageFeature.MEMBER_INVITED, {
      email,
      role: body.role || 'Member',
    });

    return { ok: true, attachedExistingUser: !!invitedUser };
  }

  private countPermanentMembers(adminUserId: string) {
    return this.prisma.plan.count({
      where: {
        adminUserId,
        userId: { not: adminUserId },
      },
    });
  }
}
