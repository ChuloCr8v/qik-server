import { EmailTheme } from './email-theme';

type BaseEmailTemplateInput = {
  title: string;
  previewText: string;
  children: string;
  theme: EmailTheme;
};

export function baseEmailTemplate({ title, previewText, children, theme }: BaseEmailTemplateInput) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:${theme.background};font-family:Arial,Helvetica,sans-serif;color:${theme.text};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${escapeHtml(previewText)}
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${theme.background};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;">
            <tr>
              <td style="padding:0 0 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="font-size:18px;font-weight:700;color:${theme.surface === '#ffffff' ? theme.text : theme.surface};">
                      <span style="display:inline-block;width:32px;height:32px;line-height:32px;text-align:center;border-radius:10px;background:${theme.primary};color:${theme.primaryText};margin-right:8px;">Q</span>
                      ${escapeHtml(theme.brand)}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background:${theme.surface};border:1px solid ${theme.border};border-radius:24px;padding:32px;box-shadow:0 24px 60px rgba(15,23,42,0.08);">
                ${children}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 8px 0;text-align:center;font-size:12px;line-height:18px;color:${theme.surface === '#ffffff' ? theme.muted : '#cbd5e1'};">
                You received this email because someone requested access to ${escapeHtml(theme.brand)}.
                <br>
                If this was not you, you can safely ignore it.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function paragraph(content: string, color: string) {
  return `<p style="margin:0 0 18px;font-size:15px;line-height:24px;color:${color};">${escapeHtml(content)}</p>`;
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
