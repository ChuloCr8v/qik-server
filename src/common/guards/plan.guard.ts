import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { UsageFeature } from '@prisma/client';
import { UsageService } from '../../usage/usage.service';

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(private readonly usageService: UsageService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    const result = await this.usageService.canUseFeature(user.id, UsageFeature.AI_GENERATION);
    if (!result.allowed) {
      throw new ForbiddenException('You have reached your monthly AI generation limit. Please upgrade.');
    }

    return true;
  }
}
