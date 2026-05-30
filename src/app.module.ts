import {
  Module
} from '@nestjs/common';
import {
  JwtModule
} from '@nestjs/jwt';
import {
  PrismaModule
} from './prisma/prisma.module';
import {
  AuthModule
} from './auth/auth.module';
import {
  UsersModule
} from './users/users.module';
import {
  MeetingsModule
} from './meetings/meetings.module';
import {
  AgendaModule
} from './agenda/agenda.module';
import {
  TemplatesModule
} from './templates/templates.module';
import {
  NotificationsModule
} from './notifications/notifications.module';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai/ai.module';
import { BillingModule } from './billing/billing.module';
import { PlanModule } from './plan/plan.module';
import { TeamModule } from './team/team.module';
import { UsageModule } from './usage/usage.module';
import { getJwtSecret } from './config/env';

@Module( {
  imports: [
    ConfigModule.forRoot({
      isGlobal: true
    }),
    JwtModule.register({
      global: true,
      secret: getJwtSecret(),
      signOptions: {
        expiresIn: '7d'
      },
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    MeetingsModule,
    AgendaModule,
    TemplatesModule,
    NotificationsModule,
    PlanModule,
    UsageModule,
    BillingModule,
    TeamModule,
    AiModule,
  ],
})
export class AppModule {}
