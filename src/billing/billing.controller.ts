import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { PlanType, UsageFeature } from '@prisma/client';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/auth-user.decorator';
import { PlanService } from '../plan/plan.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';

@UseGuards(JwtAuthGuard)
@Controller('billing')
export class BillingController {
  constructor(
    private readonly planService: PlanService,
    private readonly prisma: PrismaService,
    private readonly usageService: UsageService,
  ) {}

  @Get('plan')
  getPlan(@CurrentUser() user: AuthUser) {
    return this.planService.getUserPlan(user.id);
  }

  @Get('usage')
  async getUsage(@CurrentUser() user: AuthUser) {
    const { plan, limits } = await this.planService.getEffectiveLimits(user.id);
    const role = plan.adminUserId === user.id ? 'admin' : 'member';
    const aiGenerationsUsed = await this.usageService.getMonthlyCount(user.id, UsageFeature.AI_GENERATION, new Date());
    const aiLimit = role === 'admin' ? limits.aiGenerations : limits.memberAiGenerations;
    const teamMembersUsed = await this.prisma.user.count({ where: { id: { not: plan.adminUserId || user.id } } });

    return {
      plan: plan.type,
      role,
      aiGenerationsUsed,
      aiGenerationsLimit: Number.isFinite(aiLimit) ? aiLimit : null,
      teamMembersUsed,
      teamMembersLimit: limits.teamMembers,
    };
  }

  @Post('upgrade')
  async upgrade(@CurrentUser() user: AuthUser, @Body() body: { planType: PlanType }) {
    if (!Object.values(PlanType).includes(body.planType)) {
      throw new BadRequestException('Invalid plan type.');
    }

    // TODO: Stripe - stub payment, just update DB for now.
    return this.planService.upgradePlan(user.id, body.planType);
  }
}
