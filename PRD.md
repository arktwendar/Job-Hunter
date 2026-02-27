# PRD — Location Groups

## Problem

The app currently has one global search profile: a single set of keywords, filters, and AI
scoring prompt applied to every location the same way. This prevents tailored strategies per
market — e.g. broader keywords in a competitive market like London, stricter seniority
requirements in a smaller market like Cyprus, or a remote-biased AI prompt for Spain.

## Solution

Replace the flat per-location settings with **Location Groups**. Each group bundles one or more
locations with its own search keywords, filters, and AI system prompt. The pipeline runs all
groups on every execution and aggregates the results.

## Data Model

### New table: `search_groups`

| Column            | Type    | Notes                          |
|-------------------|---------|--------------------------------|
| `id`              | INTEGER | PK, autoincrement              |
| `locations`       | TEXT    | JSON `string[]`                |
| `keywords`        | TEXT    | JSON `string[]`                |
| `job_type`        | TEXT    | `fullTime` / `partTime` / etc. |
| `work_modes`      | TEXT    | JSON `string[]`                |
| `ai_system_prompt`      | TEXT    |                                |
| `score_no_match_max`    | INTEGER | Default 50                     |
| `score_weak_match_max`  | INTEGER | Default 70                     |
| `score_strong_match_min`| INTEGER | Default 71                     |
| `created_at`            | TEXT    | ISO timestamp                  |
| `updated_at`            | TEXT    | ISO timestamp                  |

### Updated table: `jobs`

- New nullable column `group_id INTEGER REFERENCES search_groups(id)`.

### Updated table: `settings` (global fields only)

Per-group fields (`search_keywords`, `search_locations`, `search_work_modes`,
`search_job_type`, `ai_system_prompt`, and score thresholds) are no longer edited through
the settings UI. They remain in the schema for historical reasons but are ignored by the pipeline.
Global fields that stay: `ai_model`, `email_recipient`, `email_send_time`, `cron_schedule`.

### Migration

On first boot after this update, if `search_groups` is empty, a single default group is
seeded from the existing `settings` row (keywords, locations, work modes, job type, AI prompt),
preserving the user's existing configuration.

## Pipeline Behaviour

`runner.ts` loads all groups from `search_groups`. For each group it:

1. Calls the Apify fetcher with the group's `keywords × locations`.
2. Filters out already-stored LinkedIn job IDs (provider dedup).
3. Scores remaining jobs with OpenAI using **the group's** `ai_system_prompt` and score
   thresholds, and the **global** `ai_model`.
4. Runs semantic dedup on strong matches.
5. Stores matched jobs tagged with `group_id`.

Stats (fetched, scored, strong, weak, no-match, duplicates) are **aggregated** across all
groups and logged as a single `search_runs` row — the dashboard display is unchanged.

## Settings UI

### Groups section (top of /settings page)

- Displays the list of existing groups. Each group card shows:
  - Its locations as comma-separated pills (this is the group identifier — no separate name).
  - A keyword count + filter summary line.
  - **Edit** and **Delete** buttons.
- **Add Group** button opens a modal form.
- The last group cannot be deleted.

### Group modal (add / edit)

Fields: Locations (textarea, one per line), Search Keywords (textarea, one per line),
Job Type (select), Work Modes (checkboxes), Score Thresholds (NO_MATCH max, WEAK_MATCH max,
STRONG_MATCH min), AI System Prompt (textarea).

Interactions are handled client-side via the `/api/groups` JSON API. No full page reloads.

### Global settings form

Remaining fields: AI Model, Email, Cron Schedule.

## API

| Method   | Path               | Description                                        |
|----------|--------------------|----------------------------------------------------|
| GET      | `/api/groups`      | Return all groups as JSON                          |
| POST     | `/api/groups`      | Create a new group                                 |
| PUT      | `/api/groups/:id`  | Update a group                                     |
| DELETE   | `/api/groups/:id`  | Delete a group (blocked if it is the last one)     |

## Company Blacklist

### Purpose

A unified, global list of companies the user never wants to see in results. Each entry carries
an optional free-text note (reason for blacklisting). The list is not per-group — it applies
to every group uniformly.

### Pipeline integration (two layers)

1. **Hard filter** — immediately after fetching, jobs whose `company` field matches a
   blacklisted name (case-insensitive, exact) are removed. They are never scored, stored, or
   counted in run stats. This avoids wasting AI API calls.
2. **AI prompt injection** — the blacklist (names + notes) is appended to every group's
   AI system prompt so the model can also catch slight name variations
   (e.g. "Google LLC" matching a "Google" blacklist entry).

### Data model

New table `blacklisted_companies`:

| Column         | Type    | Notes              |
|----------------|---------|--------------------|
| `id`           | INTEGER | PK, autoincrement  |
| `company_name` | TEXT    | UNIQUE, NOT NULL   |
| `notes`        | TEXT    | Default `''`       |
| `created_at`   | TEXT    | ISO timestamp      |

### API

| Method | Path                   | Description            |
|--------|------------------------|------------------------|
| GET    | `/api/blacklist`       | List all entries       |
| POST   | `/api/blacklist`       | Add an entry           |
| PUT    | `/api/blacklist/:id`   | Update name or notes   |
| DELETE | `/api/blacklist/:id`   | Remove an entry        |

### Settings UI

A **Blacklisted Companies** section sits between Search Groups and the global settings form.
Each entry shows company name (prominent) and notes (muted). Inline Add/Edit/Remove with the
same modal + inline-confirm-delete pattern used by Search Groups.

## Run Reports (`/reports`)

Full audit log of every pipeline run, accessible via a new left-nav tab.

### What is logged

A new `run_job_logs` table stores every job touched in a run:
- Jobs removed by the blacklist hard filter (verdict `BLACKLISTED`)
- All AI-scored jobs (`STRONG_MATCH`, `WEAK_MATCH`, `NO_MATCH`)

Provider-deduplicated jobs (already in DB from a previous run) are not re-logged — they
are not new and were visible in an earlier run's report.

### Run timing change

`search_runs` is now inserted at **start** with `status = 'running'`, giving a stable `run_id`
to use as FK in `run_job_logs`. At pipeline completion the row is updated with final stats and
`status = 'success' | 'partial_error' | 'failed'`. Runs that crashed mid-flight remain in
`status = 'running'`; old runs (before this feature) have no associated logs.

### `run_job_logs` table

| Column               | Notes                                              |
|----------------------|----------------------------------------------------|
| `id`                 | PK                                                 |
| `run_id`             | FK → `search_runs.id`                              |
| `group_id`           | FK → `search_groups.id`, nullable                  |
| `linkedin_job_id`    | string                                             |
| `title`              | string                                             |
| `company`            | string                                             |
| `location`           | string, nullable                                   |
| `url`                | string, nullable                                   |
| `ai_score`           | integer, null for BLACKLISTED                      |
| `ai_verdict`         | `STRONG_MATCH / WEAK_MATCH / NO_MATCH / BLACKLISTED` |
| `ai_rationale`       | string, null for BLACKLISTED                       |
| `rejection_category` | `NO_VISA_SPONSORSHIP / PROFILE_MISMATCH / OTHER / NONE` |
| `logged_at`          | ISO timestamp                                      |

### AI scorer change

The JSON schema output gains a `rejection_category` field (always present, required by
strict mode). Values: `NO_VISA_SPONSORSHIP`, `PROFILE_MISMATCH`, `OTHER` (use when verdict
is `NO_MATCH`); `NONE` otherwise.

### UI — collapsible run list

Each pipeline run is a collapsible card. Collapsed state shows:
`date · time · status badge · stats (fetched / strong / weak / no match / blacklisted)`

Expanded state shows all jobs from that run grouped by **country** (extracted as the last
comma-separated segment of the `location` field; jobs with no location or "Remote" go under
"Remote / Unknown").

Each job row: **date** (yyyy-mm-dd) · **time** (hh:mm 24h) · **company** · **job title**
(links to `/job/:id`) · **link** (external LinkedIn link hidden behind "link" text) ·
**resolution chip**:

| Verdict | Chip |
|---------|------|
| STRONG_MATCH | ✅ Strong fit |
| WEAK_MATCH | ⚠️ Weak fit |
| NO_MATCH + NO_VISA_SPONSORSHIP | ❌ No visa support |
| NO_MATCH + PROFILE_MISMATCH | ❌ Profile mismatch |
| NO_MATCH + OTHER | ❌ No fit |
| BLACKLISTED | 🚫 Blacklisted |

---

## Jobs Match (`/jobs`) — formerly "All Jobs"

Left-nav tab. A paginated list of **all stored curated jobs** (STRONG_MATCH, non-duplicate),
newest first. 50 per page.

### Grouping by country

Jobs are grouped by **country** and rendered as collapsible sections
(using `<details>/<summary>`), open by default, sorted alphabetically with
"Remote / Unknown" last.

Country is extracted from the `location` field with the following rules (applied in order):

1. If location is empty or "Remote" → group "Remote / Unknown".
2. If the whole location string is a known regional aggregate (EMEA, European Union,
   European Economic Area, EEA, APAC, LATAM, MENA, DACH, Benelux, CEE, Worldwide,
   Global, International, ANZ) → use that string as-is.
3. Split by comma; take the last segment.
4. If last segment is a known regional aggregate → use it.
5. If the full location (1-part, no comma) matches a known sub-national region or metro area
   (e.g. "Greater Barcelona Metropolitan Area" → "Spain") → map to the country.
6. Otherwise use the last comma-segment (which is typically the country for
   LinkedIn's "City, Region, Country" format).

### Row layout

Each job row (not a card — a compact table row inside a location section) shows:

| Field | Notes |
|-------|-------|
| Company name | plain text |
| Job title | link to `/job/:id` |
| 1-line AI product summary | concise description of what the product/company does (see below) |
| Score | colored score badge (e.g. `87%`) |
| Date fetched | `yyyy-mm-dd` |
| LinkedIn link | external link, shown as "↗" or "link" |

No seen/dupe badges. No rationale snippet.

### AI product summary

A new `ai_summary` TEXT column (nullable) is added to the `jobs` table. During the scoring
pipeline, after a job is assigned STRONG_MATCH, a second short OpenAI call generates a
one-sentence description of what the company's product does, stored in `ai_summary`.
The prompt is: *"In one sentence (max 20 words), describe what [company]'s product or service does, based on this job posting."*
Uses model `gpt-5.2` (hardcoded, not the global `ai_model` setting) and the existing OpenAI key.

Jobs stored before this feature was added will have `ai_summary = NULL`; those rows display
an empty summary cell rather than triggering a retroactive generation.

---

## Navigation changes

Left sidebar order (top to bottom):
1. Dashboard → `/`
2. **Jobs Match** → `/jobs`
3. **Job History** → `/history`
4. **Run Reports** → `/reports`
5. Settings → `/settings`

(Jobs Match and Job History swapped relative to the previous order.)

---

## Job History (`/history`) — UI fixes

### 1. Remove "Status" filter, show verdict in job rows

The "Status" (seen / unseen) dropdown is removed from the filter bar — it is not useful
for evaluating matches. The filter bar now contains: **Verdict**, **Company**,
**Score range**, **Date range**, **Filter** button, **Clear** button.

In each job row, the **verdict chip** (STRONG_MATCH / WEAK_MATCH / NO_MATCH) replaces
the "SEEN" badge as the primary classification indicator. The seen/unseen state is not
shown in the list.

### 2. Fix filter bar overflow

The "Date range" end input and the "Filter" / "Clear" buttons were overflowing off-screen
on standard viewport widths, causing the end-date field to be hidden behind the Filter
button. Fix: the filter bar wraps to two rows on narrower viewports (`flex-wrap`), with
each field given a sensible min-width so all inputs remain visible.

---

## Out of Scope

- Per-group email recipients or schedules.
- Enabling / disabling individual groups without deleting.
- Running a single specific group manually from the dashboard.
- Overlap validation (same location in two groups).
- Re-logging provider-deduplicated jobs in run reports.
