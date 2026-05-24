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

@Module( {
  imports: [
    ConfigModule.forRoot({
      isGlobal: true
    }),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'dev-secret',
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
  ],
})
export class AppModule {}