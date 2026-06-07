import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlanModule } from '../plan/plan.module';
import { UsageModule } from '../usage/usage.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [PrismaModule, PlanModule, UsageModule],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
