/**
 * Layer 1 Deduplicator — Provider-level dedup by LinkedIn job ID.
 * Checks the database before any AI calls. Zero API cost.
 */

import { getDb } from '../db';
import type { JobPosting } from './fetcher';

/**
 * Filters out jobs whose linkedin_job_id already exists in the DB.
 * Returns new (unseen) jobs and the provider-level duplicates separately.
 */
export function filterNewJobs(jobs: JobPosting[]): { newJobs: JobPosting[]; providerDupes: JobPosting[] } {
  if (jobs.length === 0) return { newJobs: [], providerDupes: [] };

  const db = getDb();
  const existingIds = new Set<string>();

  // Batch check using IN clause for efficiency
  const placeholders = jobs.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT linkedin_job_id FROM jobs WHERE linkedin_job_id IN (${placeholders})`)
    .all(...jobs.map((j) => j.jobId)) as Array<{ linkedin_job_id: string }>;

  for (const row of rows) {
    existingIds.add(row.linkedin_job_id);
  }

  const newJobs = jobs.filter((j) => !existingIds.has(j.jobId));
  const providerDupes = jobs.filter((j) => existingIds.has(j.jobId));

  if (providerDupes.length > 0) {
    console.log(`[deduplicator] Skipped ${providerDupes.length} already-stored jobs (provider-level dedup).`);
  }

  return { newJobs, providerDupes };
}
