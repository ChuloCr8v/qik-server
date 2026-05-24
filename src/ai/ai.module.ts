import { Module } from '@nestjs/common';
import { PlanModule } from '../plan/plan.module';
import { UsageModule } from '../usage/usage.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { PlanGuard } from '../common/guards/plan.guard';

@Module({
  imports: [PlanModule, UsageModule],
  controllers: [AiController],
  providers: [AiService, PlanGuard],
})
export class AiModule {}
