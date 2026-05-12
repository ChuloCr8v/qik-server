import { baseEmailTemplate, escapeHtml, paragraph } from './base-email.template';
import { EmailThemeName, getEmailTheme } from './email-theme';

type MeetingReminderTemplateInput = {
  meetingTitle: string;
  inviteLink: string;
  scheduledAt?: Date | null;
  themeName?: EmailThemeName;
};

export function meetingReminderTemplate({
  meetingTitle,
  inviteLink,
  scheduledAt,
  themeName,
}: MeetingReminderTemplateInput) {
  const theme = getEmailTheme(themeName);
  const subject = `Meeting Reminder: ${meetingTitle}`;
  const scheduledText = scheduledAt
    ? `Scheduled for ${scheduledAt.toLocaleString('en', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: process.env.EMAIL_TIME_ZONE || 'UTC',
      })}.`
    : 'This meeting is ready to join.';
  const previewText = `Reminder for "${meetingTitle}".`;

  const html = baseEmailTemplate({
    title: subject,
    previewText,
    theme,
    children: `
      <div style="display:inline-block;border-radius:999px;background:${theme.accent};color:${theme.primary};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:8px 12px;margin:0 0 18px;">
        Meeting reminder
      </div>
      <h1 style="margin:0 0 12px;font-size:26px;line-height:32px;color:${theme.text};">${escapeHtml(meetingTitle)}</h1>
      ${paragraph(`A quick reminder for your QikAgenda meeting. ${scheduledText}`, theme.muted)}
      <div style="margin:24px 0;">
        <a href="${escapeHtml(inviteLink)}" style="display:inline-block;border-radius:14px;background:${theme.primary};color:${theme.primaryText};font-size:14px;font-weight:700;text-decoration:none;padding:14px 18px;">
          Join meeting
        </a>
      </div>
    `,
  });

  return {
    subject,
    html,
    text: `Reminder for "${meetingTitle}". ${scheduledText} Join here: ${inviteLink}`,
  };
}
