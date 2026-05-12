import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/auth-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('email/start')
  startEmailSignIn(@Body() body: { email: string }) {
    return this.authService.startEmailSignIn(body);
  }

  @Post('email/verify')
  verifyEmailSignIn(@Body() body: { email: string; code: string }) {
    return this.authService.verifyEmailSignIn(body);
  }

  @Post('google')
  googleSignIn(@Body() body: { credential: string }) {
    return this.authService.googleSignIn(body);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user.id);
  }
}
