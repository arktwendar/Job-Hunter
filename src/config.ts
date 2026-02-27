import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const config = {
  apifyApiToken: process.env.APIFY_API_TOKEN || '',
  openAiKey: process.env.OPENAI_API_KEY || '',
  resendApiKey: process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || '',
  dashboardUser: process.env.DASHBOARD_USER || 'admin',
  dashboardPass: process.env.DASHBOARD_PASS || '',
  port: parseInt(process.env.PORT || '3000', 10),
  dbPath: process.env.DATABASE_PATH || './data/jobs.db',
} as const;

// API keys can also be stored in DB settings (preferred). These env vars serve as fallbacks.
if (!config.dashboardPass) {
  console.warn(`[config] WARNING: dashboardPass (DASHBOARD_PASS) is not set in .env`);
}
