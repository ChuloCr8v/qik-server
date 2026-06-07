import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isPlatformSuperAdmin } from '../platform-admin';

@Injectable()
export class PlatformSuperAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const authUser = request.user as { id?: string } | undefined;
    if (!authUser?.id) {
      throw new ForbiddenException('Platform superadmin access requires a signed-in user.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: authUser.id },
      select: { email: true, role: true },
    });

    if (!user || !isPlatformSuperAdmin(user)) {
      throw new ForbiddenException('This admin action requires platform superadmin access.');
    }

    return true;
  }
}
