// This endpoint is used by Codex, not the metered OpenAI API.
const ENDPOINT = 'https://chatgpt.com/backend-api/wham/usage';

// `reset_at` is undocumented; accept unix seconds (number or numeric string)
// or an ISO date string, otherwise fall back to a relative reset.
function resetTimestamp(value) {
  if (Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed / 1000;
  }
  return null;
}

export function parseUsage(body, now = Date.now()) {
  const limits = body?.rate_limit;
  const windows = [limits?.primary_window, limits?.secondary_window]
    .filter(Boolean)
    .map(window => {
      if (!Number.isFinite(window.used_percent) || !Number.isFinite(window.limit_window_seconds)) {
        throw new Error('Unexpected Codex usage response.');
      }
      const seconds = window.limit_window_seconds;
      const label = seconds === 18000 ? '5h limit'
        : seconds === 604800 ? 'Weekly limit'
        : seconds % 3600 === 0 ? `${seconds / 3600}h limit` : `${seconds / 60}m limit`;
      const resetAt = resetTimestamp(window.reset_at)
        ?? (Number.isFinite(window.reset_after_seconds) ? Math.floor(now / 1000) + window.reset_after_seconds : null);
      return { label, remaining: Math.round(Math.max(0, Math.min(100, 100 - window.used_percent))), resetAt };
    });
  if (!windows.length) throw new Error('No Codex usage limits returned for this account.');
  return { windows };
}

export function accountID(credential) {
  if (typeof credential.metadata?.accountID === 'string') return credential.metadata.accountID;
  // Token-sharing credentials may carry the account only in the access token.
  try {
    const claims = JSON.parse(Buffer.from(credential.access.split('.')[1], 'base64url').toString());
    return claims['https://api.openai.com/auth']?.chatgpt_account_id ?? claims.chatgpt_account_id;
  } catch {
    return undefined;
  }
}

export function createUsageReader(integration, fetcher = fetch) {
  let pending;
  let cached;
  let cachedConnection;
  let checked = 0;

  return async function readUsage(force = false) {
    let connection;
    try {
      connection = await integration.connection.active('openai');
    } catch {
      return { windows: [], error: 'Could not resolve your ChatGPT connection.' };
    }
    if (!connection) return { windows: [], hidden: true };
    const key = JSON.stringify(connection);
    if (!force && cached && key === cachedConnection && Date.now() - checked < 15000) return cached;
    if (pending?.key === key) return pending.promise;

    const promise = (async () => {
      let result;
      try {
        // Let OpenCode resolve/refresh credentials; never read or copy its auth database.
        const credential = await integration.connection.resolve(connection);
        if (credential?.type !== 'oauth' || !credential.access) {
          return { windows: [], error: 'Codex limits require a ChatGPT OAuth sign-in, not an API key.' };
        }
        const id = accountID(credential);
        const response = await fetcher(ENDPOINT, {
          headers: {
            Authorization: `Bearer ${credential.access}`,
            Accept: 'application/json',
            ...(id ? { 'ChatGPT-Account-Id': id } : {}),
          },
          signal: AbortSignal.timeout(10000),
          redirect: 'error',
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(response.status === 401 || response.status === 403
            ? 'ChatGPT rejected the request. Try signing in again with /connect.'
            : `Codex usage request failed (HTTP ${response.status}).`);
        }
        result = parseUsage(await response.json());
      } catch (error) {
        // Do not expose response bodies, tokens, or arbitrary credential resolver errors.
        result = { windows: [], error: /^(Unexpected Codex|No Codex|ChatGPT rejected|Codex usage request failed)/.test(error?.message)
          ? error.message : 'Could not fetch Codex usage. Check your connection and ChatGPT sign-in.' };
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
