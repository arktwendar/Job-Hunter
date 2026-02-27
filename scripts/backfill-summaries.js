/**
 * Backfill / regenerate AI product summaries (gpt-5.2) for all STRONG_MATCH
 * non-duplicate jobs. Run from project root:
 *   node scripts/backfill-summaries.js
 */

require('dotenv').config();
const { DatabaseSync } = require('node:sqlite');
const OpenAI = require('openai').default;
const path = require('path');

const DB_PATH = path.resolve(__dirname, '../data/jobs.db');
const db = new DatabaseSync(DB_PATH);
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateSummary(description) {
  const response = await client.responses.create({
    model: 'gpt-5.2',
    input: [
      {
        role: 'user',
        content:
          `Analyze the job description and write a 1-line summary of what's the product this role owns:\n\n` +
          description.substring(0, 3_000),
      },
    ],
    max_output_tokens: 60,
    temperature: 0.3,
  });
  return (response.output_text || '').trim() || null;
}

async function main() {
  const jobs = db
    .prepare(
      `SELECT id, company, title, description
       FROM jobs
       WHERE ai_verdict = 'STRONG_MATCH' AND is_duplicate = 0
       ORDER BY id`,
    )
    .all();

  console.log(`Regenerating summaries for ${jobs.length} job(s).\n`);
  if (jobs.length === 0) { console.log('Nothing to do.'); return; }

  const update = db.prepare(`UPDATE jobs SET ai_summary = ? WHERE id = ?`);
  let ok = 0, failed = 0;

  for (const job of jobs) {
    process.stdout.write(`[${job.id}] ${job.company} — ${job.title}\n  → `);
    try {
      const summary = await generateSummary(job.description);
      if (summary) {
        update.run(summary, job.id);
        console.log(summary);
        ok++;
      } else {
        console.log('(empty response — skipped)');
        failed++;
      }
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${ok} updated, ${failed} failed.`);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
