import { BadRequestException, Body, Controller, Get, Headers, Post, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { MeetingStatus, PlanType, UsageFeature } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/auth-user.decorator';
import { PlanService } from '../plan/plan.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly planService: PlanService,
    private readonly prisma: PrismaService,
    private readonly usageService: UsageService,
    private readonly billingService: BillingService,
  ) {}

  @Get('plan')
  @UseGuards(JwtAuthGuard)
  getPlan(@CurrentUser() user: AuthUser) {
    return this.planService.getUserPlan(user.id);
  }

  @Get('usage')
  @UseGuards(JwtAuthGuard)
  async getUsage(@CurrentUser() user: AuthUser) {
    const { plan, limits } = await this.planService.getEffectiveLimits(user.id);
    const role = plan.adminUserId === user.id ? 'admin' : 'member';
    const metadata = (plan.metadata as Record<string, unknown> | null) || {};
    const aiGenerationsUsed = await this.usageService.getMonthlyCount(user.id, UsageFeature.AI_GENERATION, new Date());
    const aiLimit = role === 'admin' ? limits.aiGenerations : limits.memberAiGenerations;
    const adminUserId = plan.adminUserId || user.id;
    const teamMembersUsed = await this.prisma.plan.count({
      where: {
        adminUserId,
        userId: { not: adminUserId },
      },
    });

    return {
      plan: plan.type,
      role,
      aiGenerationsUsed,
      aiGenerationsLimit: Number.isFinite(aiLimit) ? aiLimit : null,
      teamMembersUsed,
      teamMembersLimit: limits.teamMembers,
      subscriptionStatus: metadata.stripeSubscriptionStatus,
      renewsAt: metadata.renewsAt,
      cancelAtPeriodEnd: metadata.cancelAtPeriodEnd,
      pendingPlanType: metadata.pendingPlanType,
      pendingChangeEffectiveAt: metadata.pendingChangeEffectiveAt,
    };
  }

  @Get('usage-stats')
  @UseGuards(JwtAuthGuard)
  async getUsageStats(@CurrentUser() user: AuthUser) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const { plan, limits } = await this.planService.getEffectiveLimits(user.id);
    const role = plan.adminUserId === user.id ? 'admin' : 'member';
    const metadata = (plan.metadata as Record<string, unknown> | null) || {};
    const aiLimit = role === 'admin' ? limits.aiGenerations : limits.memberAiGenerations;
    const adminUserId = plan.adminUserId || user.id;

    const [
      aiGenerationsUsed,
      teamMembersUsed,
      usageByFeature,
      recentUsage,
      totalMeetings,
      monthlyMeetings,
      scheduledMeetings,
      completedMeetings,
      activeMeetings,
      archivedMeetings,
    ] = await Promise.all([
      this.usageService.getMonthlyCount(user.id, UsageFeature.AI_GENERATION, now),
      this.prisma.plan.count({
        where: {
          adminUserId,
          userId: { not: adminUserId },
        },
      }),
      this.prisma.usageLog.groupBy({
        by: ['feature'],
        where: {
          userId: user.id,
          createdAt: {
            gte: monthStart,
            lt: nextMonthStart,
          },
        },
        _count: {
          feature: true,
        },
      }),
      this.prisma.usageLog.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          feature: true,
          metadata: true,
          createdAt: true,
        },
      }),
      this.prisma.meeting.count({ where: { ownerId: user.id } }),
      this.prisma.meeting.count({
        where: {
          ownerId: user.id,
          createdAt: {
            gte: monthStart,
            lt: nextMonthStart,
          },
        },
      }),
      this.prisma.meeting.count({ where: { ownerId: user.id, status: MeetingStatus.SCHEDULED } }),
      this.prisma.meeting.count({ where: { ownerId: user.id, status: MeetingStatus.COMPLETED } }),
      this.prisma.meeting.count({ where: { ownerId: user.id, status: MeetingStatus.ACTIVE } }),
      this.prisma.meeting.count({ where: { ownerId: user.id, status: MeetingStatus.ARCHIVED } }),
    ]);

    return {
      period: {
        month: monthStart.toISOString(),
        from: monthStart.toISOString(),
        to: nextMonthStart.toISOString(),
      },
      plan: {
        type: plan.type,
        role,
        status: plan.status,
        subscriptionStatus: metadata.stripeSubscriptionStatus,
        renewsAt: metadata.renewsAt,
        cancelAtPeriodEnd: metadata.cancelAtPeriodEnd,
        pendingPlanType: metadata.pendingPlanType,
        pendingChangeEffectiveAt: metadata.pendingChangeEffectiveAt,
      },
      aiGenerations: {
        used: aiGenerationsUsed,
        limit: Number.isFinite(aiLimit) ? aiLimit : null,
      },
      teamMembers: {
        used: teamMembersUsed,
        limit: limits.teamMembers,
      },
      meetings: {
        total: totalMeetings,
        thisMonth: monthlyMeetings,
        scheduled: scheduledMeetings,
        completed: completedMeetings,
        active: activeMeetings,
        archived: archivedMeetings,
      },
      usageByFeature: usageByFeature.map(item => ({
        feature: item.feature,
        count: item._count.feature,
      })),
      recentUsage,
    };
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  async checkout(@CurrentUser() user: AuthUser, @Body() body: { planType: PlanType }) {
    if (!Object.values(PlanType).includes(body.planType)) {
      throw new BadRequestException('Invalid plan type.');
    }

    return this.billingService.createCheckoutSession(user.id, body.planType);
  }

  @Post('change-plan')
  @UseGuards(JwtAuthGuard)
  async changePlan(@CurrentUser() user: AuthUser, @Body() body: { planType: PlanType }) {
    if (!Object.values(PlanType).includes(body.planType)) {
      throw new BadRequestException('Invalid plan type.');
    }

    return this.billingService.changePlan(user.id, body.planType);
  }

  @Post('cancel')
  @UseGuards(JwtAuthGuard)
  cancel(@CurrentUser() user: AuthUser) {
    return this.billingService.cancelSubscription(user.id);
  }

  @Post('resume')
  @UseGuards(JwtAuthGuard)
  resume(@CurrentUser() user: AuthUser) {
    return this.billingService.resumeSubscription(user.id);
  }

  @Post('portal')
  @UseGuards(JwtAuthGuard)
  portal(@CurrentUser() user: AuthUser) {
    return this.billingService.createPortalSession(user.id);
  }

  @Post('webhook')
  webhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    if (!request.rawBody) {
      throw new BadRequestException('Missing raw webhook body.');
    }

    return this.billingService.handleWebhook(request.rawBody, signature);
  }
}
