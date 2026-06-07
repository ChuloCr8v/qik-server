import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  BillingCycle,
  MeetingStatus,
  OrgRole,
  PlanStatus,
  PlanType,
  Prisma,
  UsageFeature,
  UserRole,
  UserStatus,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PLAN_LIMITS, PlanName } from "../config/plans";
import { PlatformAdminAccess, getPlatformAdminAccess } from "./platform-admin";
import { AdminAuditQueryDto, AdminListQueryDto } from "./dto/admin-query.dto";
import { UpdateAdminMeetingDto } from "./dto/update-admin-meeting.dto";
import { UpdateAdminUserDto } from "./dto/update-admin-user.dto";

const startOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

type PageQuery = {
  page?: string | number;
  pageSize?: string | number;
};

type PageArgs = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
};

type UserRowSource = Prisma.UserGetPayload<{
  include: {
    billingPlan: true;
    _count: {
      select: {
        meetings: true;
        templates: true;
        usageLogs: true;
      };
    };
  };
}>;

type UserDetailSource = Prisma.UserGetPayload<{
  include: {
    billingPlan: true;
    meetings: {
      include: {
        _count: {
          select: {
            agenda: true;
            participants: true;
            invitations: true;
          };
        };
      };
    };
    templates: true;
    usageLogs: true;
    notifications: true;
    _count: {
      select: {
        meetings: true;
        templates: true;
        usageLogs: true;
        participants: true;
      };
    };
  };
}>;

type AdminUserRow = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  orgRole: OrgRole;
  platformAccess: PlatformAdminAccess;
  isPlatformAdmin: boolean;
  status: UserStatus;
  plan: PlanType | string;
  planStatus?: PlanStatus | string | null;
  createdAt: Date;
  updatedAt: Date;
  counts: {
    meetings: number;
    templates: number;
    usageLogs: number;
  };
};

type AuditJson = Prisma.InputJsonValue | undefined;

const pageArgs = (query: PageQuery = {}): PageArgs => {
  const page = Math.max(Number(query?.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(query?.pageSize || 25), 1), 100);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
};

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async adminMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        billingPlan: true,
        _count: {
          select: {
            meetings: true,
            templates: true,
            usageLogs: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException("Admin user not found.");
    return this.serializeUserRow(user);
  }

  async overview() {
    const monthStart = startOfMonth();
    const [
      totalUsers,
      usersThisMonth,
      totalMeetings,
      meetingsThisMonth,
      activeMeetings,
      completedMeetings,
      aiGenerationsThisMonth,
      teamInvitesThisMonth,
      planRows,
      recentUsage,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: monthStart } } }),
      this.prisma.meeting.count(),
      this.prisma.meeting.count({ where: { createdAt: { gte: monthStart } } }),
      this.prisma.meeting.count({ where: { status: MeetingStatus.ACTIVE } }),
      this.prisma.meeting.count({ where: { status: MeetingStatus.COMPLETED } }),
      this.prisma.usageLog.count({
        where: {
          feature: UsageFeature.AI_GENERATION,
          createdAt: { gte: monthStart },
        },
      }),
      this.prisma.usageLog.count({
        where: {
          feature: UsageFeature.MEMBER_INVITED,
          createdAt: { gte: monthStart },
        },
      }),
      this.prisma.plan.groupBy({ by: ["type"], _count: { type: true } }),
      this.prisma.usageLog.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, email: true, displayName: true } },
        },
      }),
    ]);

    return {
      metrics: {
        totalUsers,
        usersThisMonth,
        totalMeetings,
        meetingsThisMonth,
        activeMeetings,
        completedMeetings,
        aiGenerationsThisMonth,
        teamInvitesThisMonth,
      },
      planDistribution: this.planDistribution(planRows),
      recentUsage: recentUsage.map((item) => ({
        id: item.id,
        feature: item.feature,
        metadata: item.metadata,
        createdAt: item.createdAt,
        user: item.user,
      })),
    };
  }

  async users(query: AdminListQueryDto = {}) {
    try {
      const { page, pageSize, skip, take } = pageArgs(query);
      const search = String(query.search || "").trim();
      const where: Prisma.UserWhereInput = search
        ? {
            OR: [
              { email: { contains: search, mode: "insensitive" as const } },
              {
                displayName: { contains: search, mode: "insensitive" as const },
              },
            ],
          }
        : {};
      const [users, total] = await Promise.all([
        this.prisma.user.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take,
          include: {
            billingPlan: true,
            _count: {
              select: {
                meetings: true,
                templates: true,
                usageLogs: true,
              },
            },
          },
        }),
        this.prisma.user.count({ where }),
      ]);

      return {
        data: users.map((user) => this.serializeUserRow(user)),
        page,
        pageSize,
        total,
      };
    } catch (error) {
      console.error("Error in users:", error);
      throw error;
    }
  }

  async userDetail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        billingPlan: true,
        meetings: {
          take: 25,
          orderBy: { createdAt: "desc" },
          include: {
            _count: {
              select: { agenda: true, participants: true, invitations: true },
            },
          },
        },
        templates: { take: 25, orderBy: { createdAt: "desc" } },
        usageLogs: { take: 50, orderBy: { createdAt: "desc" } },
        notifications: { take: 25, orderBy: { createdAt: "desc" } },
        _count: {
          select: {
            meetings: true,
            templates: true,
            usageLogs: true,
            participants: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException("User not found.");
    return {
      ...this.serializeUserRow(user),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      counts: user._count,
      billingPlan: user.billingPlan,
      meetings: user.meetings.map((meeting) => ({
        id: meeting.id,
        title: meeting.title,
        status: meeting.status,
        scheduledAt: meeting.scheduledAt,
        createdAt: meeting.createdAt,
        updatedAt: meeting.updatedAt,
        inviteeCount: meeting.invitees.length,
        isPublic: meeting.isPublic,
        counts: meeting._count,
      })),
      templates: user.templates,
      usageLogs: user.usageLogs,
      notifications: user.notifications,
    };
  }

  async updateUser(actorId: string, id: string, body: UpdateAdminUserDto) {
    if (actorId === id && body.status === UserStatus.INACTIVE) {
      throw new BadRequestException(
        "Admins cannot deactivate their own account.",
      );
    }
    const before = await this.prisma.user.findUnique({
      where: { id },
      include: { billingPlan: true },
    });
    if (!before) throw new NotFoundException("User not found.");

    const data: Prisma.UserUpdateInput = {};
    if (body.role) data.role = this.enumValue(UserRole, body.role, "role");
    if (body.orgRole)
      data.orgRole = this.enumValue(OrgRole, body.orgRole, "orgRole");
    if (body.status)
      data.status = this.enumValue(UserStatus, body.status, "status");
    if (typeof body.displayName === "string")
      data.displayName = body.displayName.trim() || before.displayName;

    const user = await this.prisma.user.update({ where: { id }, data });

    if (body.planType || body.planStatus || body.billingCycle) {
      const planType = body.planType
        ? this.enumValue(PlanType, body.planType, "planType")
        : before.billingPlan?.type || PlanType.Free;
      const limits = PLAN_LIMITS[planType as PlanName];
      await this.prisma.plan.upsert({
        where: { userId: id },
        update: {
          type: planType,
          status: body.planStatus
            ? this.enumValue(PlanStatus, body.planStatus, "planStatus")
            : undefined,
          billingCycle: body.billingCycle
            ? this.enumValue(BillingCycle, body.billingCycle, "billingCycle")
            : undefined,
          adminUserId:
            body.adminUserId === null ? null : body.adminUserId || undefined,
          aiGenerationsLimit: Number.isFinite(limits.aiGenerations)
            ? limits.aiGenerations
            : null,
          memberAiGenerationsLimit: Number.isFinite(limits.memberAiGenerations)
            ? limits.memberAiGenerations
            : null,
          teamMembersLimit: Number.isFinite(limits.teamMembers)
            ? limits.teamMembers
            : null,
          metadata: {
            ...((before.billingPlan?.metadata as object) || {}),
            adminOverrideAt: new Date().toISOString(),
          },
        },
        create: {
          userId: id,
          type: planType,
          status: body.planStatus
            ? this.enumValue(PlanStatus, body.planStatus, "planStatus")
            : PlanStatus.active,
          billingCycle: body.billingCycle
            ? this.enumValue(BillingCycle, body.billingCycle, "billingCycle")
            : BillingCycle.monthly,
          adminUserId:
            body.adminUserId === null ? null : body.adminUserId || id,
          aiGenerationsLimit: Number.isFinite(limits.aiGenerations)
            ? limits.aiGenerations
            : null,
          memberAiGenerationsLimit: Number.isFinite(limits.memberAiGenerations)
            ? limits.memberAiGenerations
            : null,
          teamMembersLimit: Number.isFinite(limits.teamMembers)
            ? limits.teamMembers
            : null,
          metadata: { adminOverrideAt: new Date().toISOString() },
        },
      });
    }

    const after = await this.prisma.user.findUnique({
      where: { id },
      include: { billingPlan: true },
    });
    await this.audit(actorId, "USER_UPDATED", "User", id, before, after, {
      fields: Object.keys(body || {}),
    });
    return after || user;
  }

  async meetings(query: AdminListQueryDto = {}) {
    const { page, pageSize, skip, take } = pageArgs(query);
    const search = String(query.search || "").trim();
    const where: Prisma.MeetingWhereInput = search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" as const } },
            {
              owner: {
                email: { contains: search, mode: "insensitive" as const },
              },
            },
            {
              owner: {
                displayName: { contains: search, mode: "insensitive" as const },
              },
            },
          ],
        }
      : {};
    const [meetings, total] = await Promise.all([
      this.prisma.meeting.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          owner: { select: { id: true, email: true, displayName: true } },
          _count: {
            select: { agenda: true, participants: true, invitations: true },
          },
        },
      }),
      this.prisma.meeting.count({ where }),
    ]);

    return {
      data: meetings.map((meeting) => ({
        id: meeting.id,
        title: meeting.title,
        status: meeting.status,
        scheduledAt: meeting.scheduledAt,
        createdAt: meeting.createdAt,
        updatedAt: meeting.updatedAt,
        inviteeCount: meeting.invitees.length,
        isPublic: meeting.isPublic,
        owner: meeting.owner,
        counts: meeting._count,
      })),
      page,
      pageSize,
      total,
    };
  }

  async meetingDetail(id: string) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, email: true, displayName: true } },
        agenda: { orderBy: { order: "asc" } },
        participants: {
          orderBy: { lastSeen: "desc" },
          include: {
            user: { select: { id: true, email: true, displayName: true } },
          },
        },
        invitations: {
          orderBy: { createdAt: "desc" },
          include: {
            sender: { select: { id: true, email: true, displayName: true } },
          },
        },
      },
    });
    if (!meeting) throw new NotFoundException("Meeting not found.");
    return {
      id: meeting.id,
      title: meeting.title,
      description: meeting.description,
      status: meeting.status,
      scheduledAt: meeting.scheduledAt,
      createdAt: meeting.createdAt,
      updatedAt: meeting.updatedAt,
      inviteeCount: meeting.invitees.length,
      isPublic: meeting.isPublic,
      owner: meeting.owner,
      counts: {
        agenda: meeting.agenda.length,
        participants: meeting.participants.length,
        invitations: meeting.invitations.length,
      },
      agenda: meeting.agenda,
      participants: meeting.participants,
      invitations: meeting.invitations,
    };
  }

  async updateMeeting(actorId: string, id: string, body: UpdateAdminMeetingDto) {
    const before = await this.prisma.meeting.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Meeting not found.");
    const status = body.status
      ? this.enumValue(MeetingStatus, body.status, "status")
      : undefined;
    const after = await this.prisma.meeting.update({
      where: { id },
      data: {
        title:
          typeof body.title === "string"
            ? body.title.trim() || before.title
            : undefined,
        description:
          typeof body.description === "string" ? body.description : undefined,
        status,
        isActive: status ? status === MeetingStatus.ACTIVE : undefined,
        isPaused: status && status !== MeetingStatus.ACTIVE ? false : undefined,
        isPublic:
          typeof body.isPublic === "boolean" ? body.isPublic : undefined,
      },
    });
    await this.audit(actorId, "MEETING_UPDATED", "Meeting", id, before, after, {
      fields: Object.keys(body || {}),
    });
    return after;
  }

  async deleteMeeting(actorId: string, id: string) {
    const before = await this.prisma.meeting.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("Meeting not found.");
    await this.prisma.meeting.delete({ where: { id } });
    await this.audit(actorId, "MEETING_DELETED", "Meeting", id, before, null);
    return { ok: true };
  }

  async billing() {
    const [plans, planRows] = await Promise.all([
      this.prisma.plan.findMany({
        orderBy: { updatedAt: "desc" },
        take: 250,
        include: {
          user: { select: { id: true, email: true, displayName: true } },
        },
      }),
      this.prisma.plan.groupBy({ by: ["type"], _count: { type: true } }),
    ]);

    return {
      planDistribution: this.planDistribution(planRows),
      subscriptions: plans.map((plan) => ({
        id: plan.id,
        user: plan.user,
        type: plan.type,
        status: plan.status,
        billingCycle: plan.billingCycle,
        adminUserId: plan.adminUserId,
        teamMembersLimit: plan.teamMembersLimit,
        aiGenerationsLimit: plan.aiGenerationsLimit,
        metadata: plan.metadata,
        updatedAt: plan.updatedAt,
      })),
    };
  }

  async usage() {
    const monthStart = startOfMonth();
    const [usageByFeature, usageByDay, recentUsage] = await Promise.all([
      this.prisma.usageLog.groupBy({
        by: ["feature"],
        where: { createdAt: { gte: monthStart } },
        _count: { feature: true },
      }),
      this.prisma.usageLog.findMany({
        where: { createdAt: { gte: monthStart } },
        orderBy: { createdAt: "asc" },
        select: { feature: true, createdAt: true },
      }),
      this.prisma.usageLog.findMany({
        take: 100,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, email: true, displayName: true } },
        },
      }),
    ]);

    return {
      usageByFeature: usageByFeature.map((item) => ({
        feature: item.feature,
        count: item._count.feature,
      })),
      usageByDay: this.groupUsageByDay(usageByDay),
      recentUsage,
    };
  }

  async syncBilling(actorId: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { billingPlan: true },
    });
    if (!user) throw new NotFoundException("User not found.");
    const before = user.billingPlan;
    const plan = await this.prisma.plan.upsert({
      where: { userId },
      update: {
        metadata: {
          ...((before?.metadata as object) || {}),
          lastAdminSyncAt: new Date().toISOString(),
        },
      },
      create: {
        userId,
        type: PlanType.Free,
        adminUserId: userId,
        metadata: { lastAdminSyncAt: new Date().toISOString() },
      },
    });
    await this.audit(actorId, "BILLING_SYNCED", "User", userId, before, plan);
    return { ok: true, plan };
  }

  async auditLogs(query: AdminAuditQueryDto = {}) {
    const { page, pageSize, skip, take } = pageArgs(query);
    const [data, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: {
          actor: { select: { id: true, email: true, displayName: true } },
        },
      }),
      this.prisma.adminAuditLog.count(),
    ]);
    return { data, page, pageSize, total };
  }

  systemHealth() {
    const check = (keys: string[]) => {
      const missing = keys.filter((key) => !process.env[key]?.trim());
      return { configured: missing.length === 0, missing };
    };

    const integrations = {
      api: check(["JWT_SECRET", "CLIENT_URL", "DATABASE_URL"]),
      google: check(["GOOGLE_CLIENT_ID"]),
      mail: check(["RESEND_API_KEY", "MAIL_FROM"]),
      ai: check(["GROQ_API_KEY"]),
      stripe: check([
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "STRIPE_PRICE_INDIVIDUAL",
        "STRIPE_PRICE_ORGANISATION",
        "STRIPE_PRICE_ORGANISATION_PLUS",
      ]),
    };

    return {
      ok: true,
      environment: process.env.NODE_ENV || "development",
      productionReady:
        process.env.NODE_ENV !== "production" ||
        Object.values(integrations).every((item) => item.configured),
      integrations,
    };
  }

  private planDistribution(
    rows: Array<{ type: PlanType; _count: { type: number } }>,
  ) {
    const counts = Object.fromEntries(
      Object.values(PlanType).map((type) => [type, 0]),
    );
    rows.forEach((row) => {
      counts[row.type] = row._count.type;
    });
    return counts;
  }

  private groupUsageByDay(
    items: Array<{ feature: UsageFeature; createdAt: Date }>,
  ) {
    const grouped = new Map<string, Record<string, number | string>>();
    items.forEach((item) => {
      const day = item.createdAt.toISOString().slice(0, 10);
      const current = grouped.get(day) || { date: day };
      current[item.feature] = Number(current[item.feature] || 0) + 1;
      grouped.set(day, current);
    });
    return Array.from(grouped.values());
  }

  private enumValue<T extends Record<string, string>>(
    values: T,
    value: string,
    field: string,
  ) {
    if (!Object.values(values).includes(value)) {
      throw new BadRequestException(`Invalid ${field}.`);
    }
    return value as T[keyof T];
  }

  private serializeUserRow(user: UserRowSource | UserDetailSource): AdminUserRow {
    const platformAccess = getPlatformAdminAccess(user);
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      orgRole: user.orgRole,
      platformAccess,
      isPlatformAdmin: platformAccess !== "none",
      status: user.status,
      plan: user.billingPlan?.type || user.plan,
      planStatus: user.billingPlan?.status || user.subscriptionStatus,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      counts: user._count,
    };
  }

  private audit(
    actorId: string,
    action: string,
    targetType: string,
    targetId: string,
    before?: unknown,
    after?: unknown,
    metadata?: unknown,
  ) {
    const toJson = (value: unknown): AuditJson =>
      value === undefined || value === null
        ? undefined
        : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
    return this.prisma.adminAuditLog.create({
      data: {
        actorId,
        action,
        targetType,
        targetId,
        before: toJson(before),
        after: toJson(after),
        metadata: toJson(metadata),
      },
    });
  }
}
