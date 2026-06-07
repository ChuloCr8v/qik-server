import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlanService } from '../plan/plan.service';

const FREE_PLANS: PlanType[] = [PlanType.Free];

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planService: PlanService,
  ) {}

  async list(userId: string) {
    const templates = await this.prisma.template.findMany({ where: { ownerId: userId }, orderBy: { createdAt: 'desc' } });
    return templates.map(template => this.serializeTemplate(template));
  }

  async create(userId: string, body: any) {
    const { plan } = await this.planService.getEffectiveLimits(userId);
    if (FREE_PLANS.includes(plan.type)) {
      throw new ForbiddenException('Saving custom templates requires a paid plan. Please upgrade to Individual, Organisation, or OrganisationPlus.');
    }

    const template = await this.prisma.template.create({
      data: {
        ownerId: userId,
        name: body.name,
        description: body.description || '',
        items: body.items || [],
      },
    });
    return this.serializeTemplate(template);
  }

  async update(userId: string, id: string, body: any) {
    await this.ensureOwner(userId, id);
    const template = await this.prisma.template.update({
      where: { id },
      data: { name: body.name, description: body.description, items: body.items },
    });
    return this.serializeTemplate(template);
  }

  async remove(userId: string, id: string) {
    await this.ensureOwner(userId, id);
    await this.prisma.template.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureOwner(userId: string, id: string) {
    const template = await this.prisma.template.findFirst({ where: { id, ownerId: userId } });
    if (!template) throw new NotFoundException('Template not found');
  }

  private serializeTemplate(template: any) {
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      items: template.items,
    };
  }
}
