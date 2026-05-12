import { baseEmailTemplate, escapeHtml, paragraph } from './base-email.template';
import { EmailThemeName, getEmailTheme } from './email-theme';

type MeetingInviteTemplateInput = {
  meetingTitle: string;
  inviterName: string;
  inviteLink: string;
  scheduledAt?: Date | null;
  themeName?: EmailThemeName;
};

export function meetingInviteTemplate({
  meetingTitle,
  inviterName,
  inviteLink,
  scheduledAt,
  themeName,
}: MeetingInviteTemplateInput) {
  const theme = getEmailTheme(themeName);
  const subject = `Invitation: ${meetingTitle}`;
  const scheduledText = scheduledAt
    ? `Scheduled for ${scheduledAt.toLocaleString('en', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: process.env.EMAIL_TIME_ZONE || 'UTC',
      })}.`
    : 'The meeting room is ready when you are.';
  const previewText = `${inviterName} invited you to "${meetingTitle}".`;

  const html = baseEmailTemplate({
    title: subject,
    previewText,
    theme,
    children: `
      <div style="display:inline-block;border-radius:999px;background:${theme.accent};color:${theme.primary};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:8px 12px;margin:0 0 18px;">
        Meeting invitation
      </div>
      <h1 style="margin:0 0 12px;font-size:26px;line-height:32px;color:${theme.text};">You're invited to ${escapeHtml(meetingTitle)}</h1>
      ${paragraph(`${inviterName} invited you to join this QikAgenda meeting. ${scheduledText}`, theme.muted)}
      <div style="margin:24px 0;">
        <a href="${escapeHtml(inviteLink)}" style="display:inline-block;border-radius:14px;background:${theme.primary};color:${theme.primaryText};font-size:14px;font-weight:700;text-decoration:none;padding:14px 18px;">
          Open meeting
        </a>
      </div>
      <p style="margin:0;font-size:13px;line-height:20px;color:${theme.muted};">
        Sign in with this email address to access the meeting room.
      </p>
    `,
  });

  return {
    subject,
    html,
    text: `${inviterName} invited you to "${meetingTitle}". ${scheduledText} Join here: ${inviteLink}`,
  };
}
