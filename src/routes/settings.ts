/**
 * Settings Routes — Global settings only (AI model, score thresholds, email, cron).
 * Per-location config (keywords, filters, AI prompt) is managed via /api/groups.
 */

import { Router, type Request, type Response } from 'express';
import { getDb, type SettingsRow, type SearchGroupRow } from '../db';

const router = Router();

function getGroups(db: ReturnType<typeof getDb>): SearchGroupRow[] {
  return db.prepare('SELECT * FROM search_groups ORDER BY id ASC').all() as SearchGroupRow[];
}

router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as SettingsRow;
  res.render('settings', { settings, groups: getGroups(db), title: 'Settings', saved: false, error: null });
});

router.post('/', (req: Request, res: Response) => {
  const db = getDb();

  try {
    const body = req.body as Record<string, string | string[]>;

    db.prepare(`
      UPDATE settings SET
        ai_model = ?,
        dedup_system_prompt = ?,
        summary_prompt = ?,
        email_recipient = ?,
        apify_api_token = ?,
        openai_api_key = ?,
        resend_api_key = ?,
        email_from = ?,
        email_enabled = ?,
        updated_at = ?
      WHERE id = 1
    `).run(
      String(body.ai_model || 'gpt-5.2'),
      String(body.dedup_system_prompt || ''),
      String(body.summary_prompt || ''),
      String(body.email_recipient || ''),
      String(body.apify_api_token || ''),
      String(body.openai_api_key || ''),
      String(body.resend_api_key || ''),
      String(body.email_from || ''),
      (body.email_enabled === 'on' || body.email_enabled === '1') ? 1 : 0,
      new Date().toISOString(),
    );

    const updated = db.prepare('SELECT * FROM settings WHERE id = 1').get() as SettingsRow;
    res.render('settings', { settings: updated, groups: getGroups(db), title: 'Settings', saved: true, error: null });
  } catch (err) {
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get() as SettingsRow;
    res.status(400).render('settings', {
      settings,
      groups: getGroups(db),
      title: 'Settings',
      saved: false,
      error: (err as Error).message,
    });
  }
});

export { router as settingsRouter };
