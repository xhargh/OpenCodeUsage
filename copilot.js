const ENDPOINT = 'https://api.github.com/copilot_internal/user';

export function parseCopilotUsage(body) {
  const reset = Date.parse(body?.quota_reset_date_utc ?? body?.quota_reset_date);
  const resetAt = Number.isFinite(reset) ? reset / 1000 : null;
  const windows = [
    ['premium_interactions', 'Premium requests'],
    ['chat', 'Chat'],
    ['completions', 'Completions'],
  ].flatMap(([key, label]) => {
    const quota = body?.quota_snapshots?.[key];
    if (!quota) return [];
    if (quota.unlimited === true) return [{ label, remaining: null, resetAt: null, unlimited: true }];
    const percent = Number.isFinite(quota.percent_remaining) ? quota.percent_remaining
      : Number.isFinite(quota.remaining) && Number.isFinite(quota.entitlement) && quota.entitlement > 0
        ? quota.remaining / quota.entitlement * 100 : null;
    if (percent === null) throw new Error('Unexpected Copilot usage response.');
    return [{ label, remaining: Math.round(Math.max(0, Math.min(100, percent))), resetAt }];
  });
  if (!windows.length) throw new Error('No Copilot usage quotas returned for this account.');
  return { windows };
}

export function createCopilotReader(integration, fetcher = fetch) {
  let pending;
  let cached;
  let cachedConnection;
  let checked = 0;

  return async function readCopilot(force = false) {
    let connection;
    try {
      connection = await integration.connection.active('github-copilot');
    } catch {
      return { windows: [], error: 'Could not resolve your Copilot connection.' };
    }
    if (!connection) return { windows: [], error: 'Sign in with GitHub Copilot using /connect first.' };
    const key = JSON.stringify(connection);
    if (!force && cached && key === cachedConnection && Date.now() - checked < 15000) return cached;
    if (pending?.key === key) return pending.promise;

    const promise = (async () => {
      let result;
      try {
        const credential = await integration.connection.resolve(connection);
        // Copilot OAuth's refresh field contains the GitHub token, not a model API token.
        const token = credential?.type === 'oauth' ? credential.refresh || credential.access
          : credential?.type === 'key' ? credential.key : undefined;
        if (!token) return { windows: [], error: 'Sign in with GitHub Copilot using /connect first.' };
        if (credential.metadata?.enterpriseUrl) {
          return { windows: [], error: 'Usage reporting currently supports GitHub.com accounts only.' };
        }
        const response = await fetcher(ENDPOINT, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'User-Agent': 'opencode-usage',
            'X-GitHub-Api-Version': '2025-04-01',
          },
          signal: AbortSignal.timeout(10000),
          redirect: 'error',
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(response.status === 401 || response.status === 403
            ? 'GitHub rejected the request. Try signing in again with /connect.'
            : `Copilot usage request failed (HTTP ${response.status}).`);
        }
        result = parseCopilotUsage(await response.json());
      } catch (error) {
        result = { windows: [], error: /^(Unexpected Copilot|No Copilot|GitHub rejected|Copilot usage request failed)/.test(error?.message)
          ? error.message : 'Could not fetch Copilot usage. Check your connection and GitHub sign-in.' };
      }
      cached = result;
      cachedConnection = key;
      checked = Date.now();
      return result;
    })();
    pending = { key, promise };
    try { return await promise; }
    finally { if (pending?.promise === promise) pending = undefined; }
  };
}
