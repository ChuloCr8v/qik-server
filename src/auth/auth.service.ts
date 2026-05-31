import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma } from "@prisma/client";
import { createHash, randomInt } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { getAnimeAvatar } from "../common/avatar";
import { getJwtSecret } from "../config/env";
import { isValidEmail, normalizeEmail } from "../common/email";

type GoogleTokenInfo = {
  aud?: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
  picture?: string;
  sub?: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  async startEmailSignIn(input: { email: string }) {
    try {
      const email = normalizeEmail(input.email);
      if (!isValidEmail(email)) {
        throw new BadRequestException("A valid email address is required.");
      }

      await this.cleanupLoginCodes(email);

      const expiresInMinutes = 10;
      const code = randomInt(100000, 1000000).toString();
      const codeHash = this.hashCode(email, code);
      const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

      await this.prisma.loginCode.create({
        data: {
          email,
          codeHash,
          expiresAt,
        },
      });

      // await this.mailService.sendSignInCode({ to: email, code, expiresInMinutes });

      return {
        ok: true,
        message: "Sign-in code sent.",
        ...(this.shouldExposeDevCode() ? { devCode: code } : {}),
      };
    } catch (error) {
      console.error(error);
      throw new BadRequestException("Failed to send sign-in code.");
    }
  }

  async verifyEmailSignIn(input: { email: string; code: string }) {
    const email = normalizeEmail(input.email);
    const code = input.code?.trim();
    if (!isValidEmail(email) || !code) {
      throw new BadRequestException("Email and sign-in code are required.");
    }

    const loginCode = await this.prisma.loginCode.findUnique({
      where: { codeHash: this.hashCode(email, code) },
    });
    if (
      !loginCode ||
      loginCode.email !== email ||
      loginCode.usedAt ||
      loginCode.expiresAt < new Date()
    ) {
      throw new UnauthorizedException("Invalid or expired sign-in code.");
    }

    await this.prisma.loginCode.update({
      where: { id: loginCode.id },
      data: { usedAt: new Date() },
    });
    await this.cleanupLoginCodes(email);

    const user = await this.findOrCreateEmailUser({
      email,
      update: { emailVerified: true },
      create: {
        email,
        normalizedEmail: email,
        emailVerified: true,
        displayName: this.defaultDisplayName(email),
        photoUrl: getAnimeAvatar(email),
      },
    });

    return this.authResponse(await this.ensureAnimeAvatar(user));
  }

  async googleSignIn(input: { credential: string }) {
    const credential = input.credential?.trim();
    if (!credential) {
      throw new BadRequestException("Google credential is required.");
    }

    const profile = await this.verifyGoogleCredential(credential);
    if (!profile.email || !profile.sub) {
      throw new UnauthorizedException("Google account could not be verified.");
    }

    const email = normalizeEmail(profile.email);
    const user = await this.findOrCreateEmailUser({
      email,
      update: {
        normalizedEmail: email,
        googleId: profile.sub,
        emailVerified: true,
        displayName: profile.name || this.defaultDisplayName(email),
      },
      create: {
        email,
        normalizedEmail: email,
        googleId: profile.sub,
        emailVerified: true,
        displayName: profile.name || this.defaultDisplayName(email),
        photoUrl: getAnimeAvatar(email),
      },
    });
    return this.authResponse(await this.ensureAnimeAvatar(user));
  }

  async me(userId: string) {
    const user = await this.ensureAnimeAvatar(
      await this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    );
    return this.serializeUser(user);
  }

  private authResponse(user: any) {
    const token = this.jwtService.sign({ id: user.id, email: user.email });
    return { token, user: this.serializeUser(user) };
  }

  private serializeUser(user: any) {
    return {
      uid: user.id,
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      displayName: user.displayName,
      photoURL: user.photoUrl,
      bio: user.bio,
      jobTitle: user.jobTitle,
      role: this.titleCase(user.role),
      orgRole: this.titleCase(user.orgRole),
      status: this.titleCase(user.status),
      plan: this.titleCase(user.plan),
      subscriptionStatus: user.subscriptionStatus,
      subscriptionDate: user.subscriptionDate,
      notifications: {
        email: user.notifyEmail,
        reminders: user.notifyReminders,
        aiCoach: user.notifyAiCoach,
      },
    };
  }

  private titleCase(value?: string) {
    return value ? value.charAt(0) + value.slice(1).toLowerCase() : value;
  }

  private hashCode(email: string, code: string) {
    const secret = getJwtSecret();
    return createHash("sha256")
      .update(`${email}:${code}:${secret}`)
      .digest("hex");
  }

  private defaultDisplayName(email: string) {
    return email.split("@")[0];
  }

  private async ensureAnimeAvatar(user: any) {
    if (user.photoUrl) {
      return user;
    }

    return this.prisma.user.update({
      where: { id: user.id },
      data: { photoUrl: getAnimeAvatar(user.email || user.id) },
    });
  }

  private shouldExposeDevCode() {
    return (
      process.env.NODE_ENV !== "production" &&
      process.env.AUTH_EXPOSE_DEV_CODE !== "false"
    );
  }

  private async cleanupLoginCodes(email?: string) {
    await this.prisma.loginCode.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { usedAt: { not: null } },
          ...(email ? [{ email, usedAt: null }] : []),
        ],
      },
    });
  }

  private async findOrCreateEmailUser(input: {
    email: string;
    update: Prisma.UserUpdateInput;
    create: Prisma.UserCreateInput;
  }) {
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [
          { normalizedEmail: input.email },
          { email: { equals: input.email, mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    if (existing) {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          ...input.update,
          email: input.email,
          normalizedEmail: input.email,
        },
      });
    }

    return this.prisma.user.create({ data: input.create });
  }

  private async verifyGoogleCredential(credential: string) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId || clientId === "YOUR_GOOGLE_OAUTH_CLIENT_ID") {
      throw new BadRequestException("Google sign-in is not configured.");
    }

    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
    );
    if (!response.ok) {
      throw new UnauthorizedException("Invalid Google credential.");
    }

    const profile = (await response.json()) as GoogleTokenInfo;
    if (
      profile.aud !== clientId ||
      profile.email_verified === false ||
      profile.email_verified === "false"
    ) {
      throw new UnauthorizedException("Google account could not be verified.");
    }

    return profile;
  }
}
