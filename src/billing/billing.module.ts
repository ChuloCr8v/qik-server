import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlanModule } from '../plan/plan.module';
import { UsageModule } from '../usage/usage.module';
import { BillingController } from './billing.controller';

@Module({
  imports: [PrismaModule, PlanModule, UsageModule],
  controllers: [BillingController],
})
export class BillingModule {}
