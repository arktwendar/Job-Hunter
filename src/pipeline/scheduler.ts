/**
 * Cron Scheduler — start/stop the scheduled pipeline run.
 * Singleton module so state persists across API requests.
 */

import cron from 'node-cron';
import { runPipeline } from './runner';

let cronJob: ReturnType<typeof cron.schedule> | null = null;
let activeExpression: string | null = null;
let activeTimezone: string | null = null;

export function startSchedule(expression: string, timezone: string): void {
  stopSchedule();

  if (!cron.validate(expression)) {
    console.warn(`[cron] Invalid expression: "${expression}" — using fallback "0 7 * * *"`);
    expression = '0 7 * * *';
  }

  cronJob = cron.schedule(expression, () => {
    console.log(`[cron] Triggered at ${new Date().toISOString()}`);
    runPipeline('scheduled').catch((err) => console.error('[cron] Pipeline failed:', err));
  }, { timezone });

  activeExpression = expression;
  activeTimezone = timezone;
  console.log(`[cron] Schedule started: "${expression}" (${timezone})`);
}

export function stopSchedule(): void {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    activeExpression = null;
    activeTimezone = null;
    console.log('[cron] Schedule stopped.');
  }
}

export function getScheduleStatus(): { active: boolean; expression: string | null; timezone: string | null } {
  return { active: cronJob !== null, expression: activeExpression, timezone: activeTimezone };
}
