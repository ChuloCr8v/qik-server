import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlanService } from './plan.service';

@Module({
  imports: [PrismaModule],
  providers: [PlanService],
  exports: [PlanService],
})
export class PlanModule {}
