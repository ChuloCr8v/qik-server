import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { getPlatformAdminAccess } from '../platform-admin';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const authUser = request.user as { id?: string; email?: string } | undefined;
    if (!authUser?.id) {
      throw new ForbiddenException('Admin access requires a signed-in user.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: authUser.id },
      select: { email: true, role: true },
    });

    if (!user) {
      throw new ForbiddenException('Admin user not found.');
    }

    const access = getPlatformAdminAccess(user);

    if (access === 'none') {
      throw new ForbiddenException(
        'Platform admin access is not enabled for this account. Use SUPERADMIN, or use ADMIN with the email in PLATFORM_ADMIN_EMAILS.',
      );
    }

    request.platformAdmin = { access };
    return true;
  }
}
