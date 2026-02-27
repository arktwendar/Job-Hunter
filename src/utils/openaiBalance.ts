/**
 * Checks whether an OpenAI API key has more than $1 remaining balance.
 *
 * Tries two endpoints in order:
 *  1. /v1/dashboard/billing/credit_grants  — prepaid/credit accounts
 *  2. /v1/dashboard/billing/subscription + /usage — pay-as-you-go with a spending cap
 *
 * If the key is invalid, returns hasBalance=null with an error message.
 * If the key is valid but billing info is inaccessible (org-level restriction),
 * returns hasBalance=null so the caller can decide how to handle it.
 */

export interface BalanceResult {
  /** true = >$1 remaining, false = ≤$1, null = could not determine */
  hasBalance: boolean | null;
  /** Remaining USD if determinable, otherwise null */
  remaining: number | null;
  error?: string;
}

async function tryFetch(url: string, apiKey: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

export async function checkOpenAiBalance(apiKey: string): Promise<BalanceResult> {
  if (!apiKey || apiKey.trim().length < 10) {
    return { hasBalance: null, remaining: null, error: 'No API key provided' };
  }

  // 1. Verify the key is valid at all
  try {
    await tryFetch('https://api.openai.com/v1/models', apiKey);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('HTTP 401')) {
      return { hasBalance: null, remaining: null, error: 'Invalid API key' };
    }
    return { hasBalance: null, remaining: null, error: 'Could not reach OpenAI API' };
  }

  // 2. Try credit grants endpoint (prepaid / credits accounts)
  try {
    const grants = await tryFetch(
      'https://api.openai.com/v1/dashboard/billing/credit_grants',
      apiKey,
    );
    if (typeof grants.total_available === 'number') {
      const remaining = grants.total_available as number;
      return { hasBalance: remaining > 1, remaining };
    }
  } catch {
    // Not available for this account type — fall through
  }

  // 3. Try subscription + monthly usage (accounts with a monthly spending cap)
  try {
    const sub = await tryFetch(
      'https://api.openai.com/v1/dashboard/billing/subscription',
      apiKey,
    );
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const end = now.toISOString().slice(0, 10);
    const usage = await tryFetch(
      `https://api.openai.com/v1/dashboard/billing/usage?start_date=${start}&end_date=${end}`,
      apiKey,
    );

    const hardLimit = sub.hard_limit_usd;
    const totalUsageCents = usage.total_usage;
    if (typeof hardLimit === 'number' && typeof totalUsageCents === 'number') {
      const remaining = hardLimit - totalUsageCents / 100;
      return { hasBalance: remaining > 1, remaining };
    }
  } catch {
    // Not available for this account type — fall through
  }

  // Key is valid but billing data is not accessible (org restriction or new account type)
  return {
    hasBalance: null,
    remaining: null,
    error: 'API key valid — check balance manually at platform.openai.com/usage',
  };
}
