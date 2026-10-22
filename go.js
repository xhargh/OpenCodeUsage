// Account-scoped read-only route used by the OpenCode Console Go page.
const ENDPOINT = 'https://opencode.ai/console/api/go/status';

export function parseGoUsage(status) {
  if (status === null) return { windows: [], error: 'No OpenCode Go subscription found for this account.' };
  if (!status || typeof status !== 'object' || !['go', 'go-plus'].includes(status.product) || !('access' in status)) {
    throw new Error('Unexpected OpenCode Go usage response.');
  }
  if (status.access === null) return { windows: [], error: 'OpenCode Go has no active paid period. Check your subscription in the Console.' };
  const meters = status.access.meters;
  const windows = [['fiveHour', '5h limit'], ['week', 'Weekly limit'], ['month', 'Monthly limit']].map(([key, label]) => {
    const meter = meters?.[key];
    // Console serializes its bigint monetary amounts as decimal strings.
    const amount = value => typeof value === 'number' ? value
      : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
    const limit = amount(meter?.limitMicroCents);
    const used = amount(meter?.usedMicroCents);
    if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(used) || used < 0) {
      throw new Error('Unexpected OpenCode Go usage response.');
    }
    const reset = typeof meter.resetsAt === 'string' ? Date.parse(meter.resetsAt) : NaN;
    return {
      label,
      remaining: Math.round(Math.max(0, Math.min(100, (1 - used / limit) * 100))),
      resetAt: Number.isFinite(reset) ? reset / 1000 : null,
    };
  });
  return { windows };
}

async function responseError(response) {
  let code;
  try {
    code = JSON.parse(await response.text())?.code;
  } catch {}
  if (response.status === 401 || response.status === 403) {
    return code === 'api_key_expired'
      ? 'Your OpenCode API key has expired. Create a new key in OpenCode Console and reconnect with /connect.'
      : 'OpenCode Go usage access denied. Use /connect → OpenCode Console to sign in to your Go workspace, or use a Console key with usage access.';
  }
  return `OpenCode Go usage request failed (HTTP ${response.status}).`;
}

export function createGoReader(integration, fetcher = fetch) {
  let pending;
  let cached;
  let cachedConnection;
  let checked = 0;

  async function loadOne(connection) {
    const credential = await integration.connection.resolve(connection);
    const token = credential?.type === 'oauth' ? credential.access
      : credential?.type === 'key' ? credential.key : undefined;
    if (!token) return { windows: [], error: 'Connect OpenCode Go or OpenCode Console using /connect first.' };
    const server = credential.metadata?.server;
    if (server && !['https://opencode.ai/console', 'https://opencode.ai/console/', 'https://console.opencode.ai'].includes(server)) {
      return { windows: [], error: 'Go usage reporting currently supports the official OpenCode Console only.' };
    }

    const response = await fetcher(ENDPOINT, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'opencode-usage',
        ...(typeof credential.metadata?.orgID === 'string' ? { 'x-org-id': credential.metadata.orgID } : {}),
      },
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (!response.ok) {
      const error = new Error(await responseError(response));
      error.status = response.status;
      throw error;
    }
    return parseGoUsage(await response.json());
  }

  async function load(connections) {
    let firstError;
    for (const connection of connections) {
      let result;
      try {
        result = await loadOne(connection);
      } catch (error) {
        result = {
          windows: [],
          error: /^(Unexpected OpenCode Go|OpenCode Go|Your OpenCode API key has expired)/.test(error?.message)
            ? error.message
            : 'Could not fetch OpenCode Go usage. Check your connection and API key.',
        };
      }
      if (result.windows.length) return result;
      firstError ??= result;
    }
    return firstError ?? { windows: [], error: 'Connect OpenCode Go or OpenCode Console using /connect first.' };
  }

  return async function readGo(force = false) {
    let connections;
    try {
      connections = [
        await integration.connection.active('opencode'),
        await integration.connection.active('opencode-go'),
      ].filter(Boolean);
    } catch {
      return { windows: [], error: 'Could not resolve your OpenCode Go connection.' };
    }
    if (!connections.length) return { windows: [], error: 'Connect OpenCode Go using /connect first.' };
    const key = JSON.stringify(connections);
    if (!force && cached && key === cachedConnection && Date.now() - checked < 15000) return cached;
    if (pending?.key === key) return pending.promise;

    const promise = (async () => {
      const result = await load(connections);
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
