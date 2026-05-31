import { Controller, Get } from '@nestjs/common';

type IntegrationStatus = {
  configured: boolean;
  missing: string[];
};

const placeholders = new Set([
  'YOUR_GOOGLE_OAUTH_CLIENT_ID',
  'YOUR_RESEND_API_KEY',
  'YOUR_STRIPE_SECRET_KEY',
  'YOUR_STRIPE_WEBHOOK_SECRET',
]);

function hasValue(key: string) {
  const value = process.env[key]?.trim();
  return !!value && !placeholders.has(value);
}

function checkEnv(required: string[]): IntegrationStatus {
  const missing = required.filter(key => !hasValue(key));
  return {
    configured: missing.length === 0,
    missing,
  };
}

@Controller('health')
export class HealthController {
  @Get()
  getHealth() {
    const api = checkEnv(['JWT_SECRET', 'CLIENT_URL', 'DATABASE_URL']);
    const google = checkEnv(['GOOGLE_CLIENT_ID']);
    const mail = checkEnv(['RESEND_API_KEY', 'MAIL_FROM']);
    const ai = checkEnv(['GROQ_API_KEY']);
    const stripe = checkEnv([
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_PRICE_INDIVIDUAL',
      'STRIPE_PRICE_ORGANISATION',
      'STRIPE_PRICE_ORGANISATION_PLUS',
    ]);

    const integrations = {
      api,
      google,
      mail,
      ai,
      stripe,
    };

    return {
      ok: true,
      environment: process.env.NODE_ENV || 'development',
      productionReady:
        process.env.NODE_ENV !== 'production' ||
        Object.values(integrations).every(item => item.configured),
      integrations,
    };
  }
}
