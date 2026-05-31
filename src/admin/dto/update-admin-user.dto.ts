import { BillingCycle, OrgRole, PlanStatus, PlanType, UserRole, UserStatus } from '@prisma/client';

export class UpdateAdminUserDto {
  displayName?: string;
  role?: UserRole;
  orgRole?: OrgRole;
  status?: UserStatus;
  planType?: PlanType;
  planStatus?: PlanStatus;
  billingCycle?: BillingCycle;
  adminUserId?: string | null;
}
