import { ForbiddenException, Injectable } from '@nestjs/common';
import { UsageFeature } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlanService } from '../plan/plan.service';
import { UsageService } from '../usage/usage.service';

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planService: PlanService,
    private readonly usageService: UsageService,
  ) {}

  async invitePermanentMember(userId: string, body: { email: string; role?: string }) {
    const plan = await this.planService.getUserPlan(userId);
    const { limits } = await this.planService.getEffectiveLimits(userId);
    const used = await this.countPermanentMembers(plan.adminUserId || userId);

    if (used >= limits.teamMembers) {
      throw new ForbiddenException('You have reached your team member limit. Please upgrade your plan.');
    }

    await this.usageService.logUsage(userId, plan.id, UsageFeature.MEMBER_INVITED, {
      email: body.email,
      role: body.role || 'Member',
    });

    return { ok: true };
  }

  private countPermanentMembers(adminUserId: string) {
    return this.prisma.user.count({
      where: {
        id: {
          not: adminUserId,
        },
      },
    });
  }
}
