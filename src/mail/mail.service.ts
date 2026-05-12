import { BadRequestException, Injectable } from '@nestjs/common';
import { EmailThemeName, meetingInviteTemplate, meetingReminderTemplate, signInCodeTemplate } from './templates';

type ResendResponse = {
  id?: string;
  message?: string;
  error?: string;
};

@Injectable()
export class MailService {
  async sendSignInCode(input: { to: string; code: string; expiresInMinutes: number }) {
    const email = signInCodeTemplate({
      code: input.code,
      expiresInMinutes: input.expiresInMinutes,
      themeName: process.env.MAIL_THEME as EmailThemeName | undefined,
    });

    await this.sendEmail({
      to: input.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      devLog: `[mail] Sign-in code for ${input.to}: ${input.code}`,
      errorMessage: 'Failed to send sign-in email.',
    });
  }

  async sendMeetingInvite(input: {
    to: string;
    meetingTitle: string;
    inviterName: string;
    inviteLink: string;
    scheduledAt?: Date | null;
  }) {
    const email = meetingInviteTemplate({
      meetingTitle: input.meetingTitle,
      inviterName: input.inviterName,
      inviteLink: input.inviteLink,
      scheduledAt: input.scheduledAt,
      themeName: process.env.MAIL_THEME as EmailThemeName | undefined,
    });

    await this.sendEmail({
      to: input.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      devLog: `[mail] Meeting invite for ${input.to}: ${input.inviteLink}`,
      errorMessage: 'Failed to send meeting invite.',
    });
  }

  async sendMeetingReminder(input: {
    to: string;
    meetingTitle: string;
    inviteLink: string;
    scheduledAt?: Date | null;
  }) {
    const email = meetingReminderTemplate({
      meetingTitle: input.meetingTitle,
      inviteLink: input.inviteLink,
      scheduledAt: input.scheduledAt,
      themeName: process.env.MAIL_THEME as EmailThemeName | undefined,
    });

    await this.sendEmail({
      to: input.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      devLog: `[mail] Meeting reminder for ${input.to}: ${input.inviteLink}`,
      errorMessage: 'Failed to send meeting reminder.',
    });
  }

  private async sendEmail(input: {
    to: string | string[];
    subject: string;
    html: string;
    text: string;
    devLog: string;
    errorMessage: string;
  }) {
    const resendApiKey = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM || 'QikAgenda <onboarding@resend.dev>';

    if (!resendApiKey || resendApiKey === 'YOUR_RESEND_API_KEY') {
      if (process.env.NODE_ENV === 'production') {
        throw new BadRequestException('Email delivery is not configured.');
      }

      console.log(input.devLog);
      return;
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as ResendResponse;
      throw new BadRequestException(error.message || error.error || input.errorMessage);
    }
  }
}
