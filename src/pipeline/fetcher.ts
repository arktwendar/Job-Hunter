/**
 * LinkedIn Fetcher — Apify HarvestAPI adapter.
 * One actor call returns full job details; no pagination or separate detail fetches needed.
 */

import { ApifyClient } from 'apify-client';

// --- Internal normalized types ---

export interface JobPosting {
  jobId: string;
  title: string;
  company: string;
  location: string;
  workMode: string;
  url: string;          // LinkedIn job URL
  applyUrl: string | null; // External application URL (company site etc.)
  postedDate: string | null;
  postedDateConfidence: 'HIGH' | 'LOW';
  description: string;
}

export interface SearchFilters {
  keywords: string[];
  locations: string[];
  workModes: string[];
  jobType: string;
}

// --- Work mode & job type mappings ---

const WORK_MODE_MAP: Record<string, string> = {
  remote: 'remote',
  hybrid: 'hybrid',
  onsite: 'office',
};

const JOB_TYPE_MAP: Record<string, string> = {
  fullTime: 'full-time',
  partTime: 'part-time',
  contract: 'contract',
  temporary: 'temporary',
  internship: 'internship',
};

// --- HarvestAPI raw item type ---

interface HarvestJobLocation {
  linkedinText?: string;
  parsed?: { city?: string; state?: string; country?: string };
}

interface HarvestJob {
  id?: string;
  jobId?: string;
  title?: string;
  companyName?: string;
  company?: { name?: string } | string;
  location?: HarvestJobLocation | string;
  workplaceType?: string;   // "remote" | "hybrid" | "on_site" in response
  descriptionText?: string;
  description?: string;
  descriptionHtml?: string;
  linkedinUrl?: string;
  applyUrl?: string;
  url?: string;
  postedDate?: string;
  listedAt?: string | number;
}

// --- Utilities ---

function normalizeWorkMode(raw: string | undefined): string {
  const val = (raw || '').toLowerCase().replace(/[_\s-]/g, '');
  if (val.includes('remote')) return 'remote';
  if (val.includes('hybrid')) return 'hybrid';
  return 'onsite';
}

function getCompanyName(item: HarvestJob): string {
  if (item.companyName) return item.companyName;
  if (typeof item.company === 'string') return item.company;
  if (item.company?.name) return item.company.name;
  return 'Unknown Company';
}

function getLocationText(loc: HarvestJobLocation | string | undefined): string {
  if (!loc) return '';
  if (typeof loc === 'string') return loc;
  return loc.linkedinText || loc.parsed?.city || '';
}

function parsePostedDate(raw: string | number | undefined): { date: string | null; confidence: 'HIGH' | 'LOW' } {
  if (!raw) return { date: null, confidence: 'LOW' };
  const ts = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!isNaN(ts) && ts > 1_000_000_000) {
    const ms = ts > 1e12 ? ts : ts * 1000;
    return { date: new Date(ms).toISOString().split('T')[0], confidence: 'HIGH' };
  }
  const d = new Date(String(raw));
  if (!isNaN(d.getTime())) {
    return { date: d.toISOString().split('T')[0], confidence: 'HIGH' };
  }
  return { date: null, confidence: 'LOW' };
}

function mapToJobPosting(item: HarvestJob): JobPosting {
  const jobId = String(item.id || item.jobId || '');
  const rawDate = item.postedDate ?? item.listedAt;
  const parsedDate = parsePostedDate(rawDate);
  const description = item.descriptionHtml || item.descriptionText || item.description || '';
  const url = item.linkedinUrl || item.url
    || (jobId ? `https://www.linkedin.com/jobs/view/${jobId}/` : '');
  // applyUrl is the external company-site URL; only stored if it differs from the LinkedIn URL
  const applyUrl = (item.applyUrl && item.applyUrl !== url) ? item.applyUrl : null;

  return {
    jobId,
    title: item.title || 'Unknown Title',
    company: getCompanyName(item),
    location: getLocationText(item.location),
    workMode: normalizeWorkMode(item.workplaceType),
    url,
    applyUrl,
    postedDate: parsedDate.date,
    postedDateConfidence: parsedDate.confidence,
    description: description.substring(0, 20_000),
  };
}

function filterByTimeWindow(job: JobPosting): boolean {
  if (!job.postedDate) {
    console.warn(`[fetcher] Job ${job.jobId}: missing postedDate, accepting with LOW confidence`);
    return true;
  }
  // Accept jobs posted within the last 48h to avoid edge cases with timezone/time-of-day
  const cutoff = new Date();
  cutoff.setUTCHours(cutoff.getUTCHours() - 48);
  const posted = new Date(job.postedDate);
  return posted >= cutoff;
}

// --- Main export ---

export async function fetchJobs(filters: SearchFilters, apifyToken: string): Promise<JobPosting[]> {
  const client = new ApifyClient({ token: apifyToken });
  const workplaceTypes = filters.workModes
    .map((m) => WORK_MODE_MAP[m])
    .filter(Boolean);

  const employmentType = filters.jobType
    ? [JOB_TYPE_MAP[filters.jobType] || filters.jobType]
    : [];

  const actorInput: Record<string, unknown> = {
    jobTitles: filters.keywords,
    locations: filters.locations,
    postedLimit: '24h',
    sortBy: 'date',
    maxItems: 100,
  };

  // workplaceType and employmentType omitted — letting AI scorer handle
  // these preferences to avoid losing results to overly strict API filtering

  console.log(`[fetcher] Starting Apify actor run — ${filters.keywords.length} keywords × ${filters.locations.length} locations`);

  const run = await client.actor('harvestapi/linkedin-job-search').call(actorInput);

  console.log(`[fetcher] Actor run complete (${run.id}), fetching dataset items…`);

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  console.log(`[fetcher] Raw items from actor: ${items.length}`);

  const jobs = (items as HarvestJob[])
    .map(mapToJobPosting)
    .filter((j) => j.jobId)          // must have a job ID
    .filter(filterByTimeWindow);      // posted within last 48h

  console.log(`[fetcher] Jobs after time-window filter: ${jobs.length}`);

  return jobs;
}
