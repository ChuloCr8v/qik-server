import { baseEmailTemplate, escapeHtml, paragraph } from './base-email.template';
import { EmailThemeName, getEmailTheme } from './email-theme';

type SignInCodeTemplateInput = {
  code: string;
  expiresInMinutes: number;
  themeName?: EmailThemeName;
};

export function signInCodeTemplate({ code, expiresInMinutes, themeName }: SignInCodeTemplateInput) {
  const theme = getEmailTheme(themeName);
  const subject = 'Your QikAgenda sign-in code';
  const previewText = `Your sign-in code is ${code}. It expires in ${expiresInMinutes} minutes.`;
  const html = baseEmailTemplate({
    title: subject,
    previewText,
    theme,
    children: `
      <div style="display:inline-block;border-radius:999px;background:${theme.accent};color:${theme.primary};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:8px 12px;margin:0 0 18px;">
        Secure sign-in
      </div>
      <h1 style="margin:0 0 12px;font-size:26px;line-height:32px;color:${theme.text};">Your sign-in code</h1>
      ${paragraph('Use this one-time code to finish signing in to your QikAgenda workspace.', theme.muted)}
      <div style="margin:24px 0;padding:22px;border-radius:18px;background:${theme.accent};border:1px solid ${theme.border};text-align:center;">
        <div style="font-family:Consolas,Monaco,monospace;font-size:34px;line-height:40px;font-weight:800;letter-spacing:10px;color:${theme.text};">${escapeHtml(code)}</div>
      </div>
      <p style="margin:0;font-size:13px;line-height:20px;color:${theme.muted};">
        This code expires in <strong style="color:${theme.text};">${expiresInMinutes} minutes</strong>.
      </p>
    `,
  });

  return {
    subject,
    html,
    text: `Your QikAgenda sign-in code is ${code}. It expires in ${expiresInMinutes} minutes. If this was not you, you can safely ignore this email.`,
  };
}
