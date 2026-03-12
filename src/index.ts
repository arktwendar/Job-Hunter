import * as path from 'path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { config } from './config';
import { getDb } from './db';
import { dashboardRouter } from './routes/dashboard';
import { settingsRouter } from './routes/settings';
import { apiRouter } from './routes/api';
import { reportsRouter } from './routes/reports';
import { jobsRouter } from './routes/jobs';
import { analyticsRouter } from './routes/analytics';
import { runPipeline } from './pipeline/runner';
import { startSchedule, stopSchedule, getScheduleStatus } from './pipeline/scheduler';

// --- Express App ---

const app = express();

// Template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body parsing (before middleware that reads req.body)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Profile middleware — reads active_profile_id cookie, attaches req.profile + res.locals.activeProfile
const PROFILES: Record<number, string> = { 1: 'Mikhail', 2: 'Arina' };

app.use((req: Request, res: Response, next: NextFunction) => {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)active_profile_id=(\d+)/);
  const rawId = match ? parseInt(match[1], 10) : 1;
  const profileId = (rawId === 1 || rawId === 2) ? rawId : 1;
  req.profile = { id: profileId, name: PROFILES[profileId] };
  res.locals.activeProfile = req.profile;
  next();
});

// Profile switch endpoint (must be before routers)
app.post('/api/profile/switch', (req: Request, res: Response) => {
  const rawId = parseInt(String((req.body as Record<string, unknown>).profile_id || '1'), 10);
  const profileId = (rawId === 1 || rawId === 2) ? rawId : 1;
  const redirectTo = req.headers.referer || '/';
  res.setHeader(
    'Set-Cookie',
    `active_profile_id=${profileId}; Path=/; HttpOnly; SameSite=Lax`,
  );
  res.redirect(redirectTo);
});

// EJS layout helper — wraps views in layout.ejs
app.use((req, res, next) => {
  const originalRender = res.render.bind(res);
  res.render = function (view: string, locals?: object) {
    originalRender(view, locals, (err: Error, html: string) => {
      if (err) return next(err);
      originalRender('layout', { ...locals, body: html }, (err2: Error, layoutHtml: string) => {
        if (err2) return next(err2);
        res.send(layoutHtml);
      });
    });
  };
  next();
});

// Routes
app.use('/', dashboardRouter);
app.use('/settings', settingsRouter);
app.use('/api', apiRouter);
app.use('/reports', reportsRouter);
app.use('/jobs', jobsRouter);
app.use('/analytics', analyticsRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).render('layout', { body: '<div class="py-20 text-center text-gray-400">Page not found.</div>', title: '404' });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[express] Unhandled error:', err);
  res.status(500).render('layout', {
    body: `<div class="py-20 text-center"><p class="text-red-600 font-medium">${err.message}</p></div>`,
    title: 'Error',
  });
});

// --- Process-level error guards ---

process.on('unhandledRejection', (reason) => {
  console.error('[process] Unhandled rejection (server kept alive):', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[process] Uncaught exception (server kept alive):', err);
});

// --- Bootstrap ---

async function start(): Promise<void> {
  // Initialize DB (schema + seed)
  const db = getDb();
  console.log(`[db] SQLite ready at ${config.dbPath}`);

  // Cron scheduler starts paused — enable via the dashboard "Run by Schedule" button

  // Start web server
  app.listen(config.port, () => {
    console.log(`[server] Dashboard running at http://localhost:${config.port}`);
    console.log(`[server] Auth: ${config.dashboardUser} / ***`);
  });
}

start().catch((err) => {
  console.error('[startup] Fatal error:', err);
  process.exit(1);
});

export { startSchedule, stopSchedule, getScheduleStatus };
