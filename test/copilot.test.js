import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCopilotReader, parseCopilotUsage } from '../copilot.js';
import { formatUsage } from '../format.js';

const payload = {
  quota_reset_date_utc: '2026-11-01T00:00:00Z',
  quota_snapshots: {
    premium_interactions: { percent_remaining: 62.3, remaining: 187, entitlement: 300, unlimited: false },
    chat: { percent_remaining: 100, remaining: 0, entitlement: 0, unlimited: true },
    completions: { unlimited: true },
  },
};
const credential = { type: 'oauth', refresh: 'github-secret', access: 'model-secret' };
const integration = (value = credential) => ({ connection: {
  active: async id => {
    assert.equal(id, 'github-copilot');
    return { type: 'credential', id: 'account-one' };
  },
  resolve: async () => value,
} });

test('Copilot parses premium requests followed by chat and completions', () => {
  assert.deepEqual(parseCopilotUsage(payload).windows, [
    { label: 'Premium requests', remaining: 62, resetAt: Date.parse(payload.quota_reset_date_utc) / 1000 },
    { label: 'Chat', remaining: null, resetAt: null, unlimited: true },
    { label: 'Completions', remaining: null, resetAt: null, unlimited: true },
  ]);
});

test('Copilot supports finite free-plan quotas and date-only resets', () => {
  const result = parseCopilotUsage({ quota_reset_date: '2026-11-01', quota_snapshots: {
    chat: { remaining: 25, entitlement: 50 },
    completions: { percent_remaining: 15.5 },
  } });
  assert.deepEqual(result.windows.map(w => w.remaining), [50, 16]);
  assert.equal(result.windows[0].resetAt, Date.parse('2026-11-01T00:00:00Z') / 1000);
});

test('Copilot distinguishes unlimited from exhausted and clamps percentages', () => {
  for (const [percent, expected] of [[0, 0], [-5, 0], [120, 100]]) {
    const result = parseCopilotUsage({ quota_snapshots: { premium_interactions: { percent_remaining: percent } } });
    assert.equal(result.windows[0].remaining, expected);
    assert.equal(result.windows[0].resetAt, null);
    assert.ok(!result.windows[0].unlimited);
  }
});

test('Copilot rejects missing and malformed quota data instead of inventing usage', () => {
  for (const body of [null, {}, { quota_snapshots: {} }, { quota_snapshots: { chat: { percent_remaining: '80' } } }]) {
    assert.throws(() => parseCopilotUsage(body));
  }
});

test('Copilot uses the GitHub OAuth token only against the fixed GitHub endpoint', async () => {
  const reader = createCopilotReader(integration(), async (url, options) => {
    assert.equal(url, 'https://api.github.com/copilot_internal/user');
    assert.equal(options.headers.Authorization, 'Bearer github-secret');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    return Response.json(payload);
  });
  const result = await reader();
  assert.equal(result.windows[0].remaining, 62);
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('Copilot accepts GitHub token connections', async () => {
  const reader = createCopilotReader(integration({ type: 'key', key: 'github-key' }), async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer github-key');
    return Response.json(payload);
  });
  assert.equal((await reader()).windows.length, 3);
});

test('Copilot deduplicates, caches and forces refresh', async () => {
  let calls = 0;
  const reader = createCopilotReader(integration(), async () => { calls++; return Response.json(payload); });
  await Promise.all([reader(), reader(), reader()]);
  await reader();
  assert.equal(calls, 1);
  await reader(true);
  assert.equal(calls, 2);
});

test('Copilot account changes and sign-out never reuse another account cache', async () => {
  let id = 'first';
  let calls = 0;
  const source = integration();
  source.connection.active = async () => id ? { type: 'credential', id } : undefined;
  const reader = createCopilotReader(source, async () => { calls++; return Response.json(payload); });
  await reader();
  id = 'second';
  await reader();
  assert.equal(calls, 2);
  id = undefined;
  assert.equal((await reader()).hidden, true);
});

test('Copilot handles auth, network, malformed response and resolver failures safely', async () => {
  for (const fetcher of [
    async () => new Response('sensitive body', { status: 401 }),
    async () => new Response('sensitive body', { status: 403 }),
    async () => new Response('sensitive body', { status: 429 }),
    async () => Response.json({}),
    async () => { throw new Error('sensitive token'); },
  ]) {
    const result = await createCopilotReader(integration(), fetcher)();
    assert.deepEqual(result.windows, []);
    assert.ok(result.error);
    assert.ok(!result.error.includes('sensitive'));
  }
  const source = integration();
  source.connection.resolve = async () => { throw new Error('sensitive credential'); };
  assert.ok(!(await createCopilotReader(source)()).error.includes('sensitive'));
  source.connection.active = async () => { throw new Error('sensitive connection'); };
  assert.ok(!(await createCopilotReader(source)()).error.includes('sensitive'));
});

test('Copilot never sends enterprise credentials to GitHub.com', async () => {
  const reader = createCopilotReader(integration({ ...credential, metadata: { enterpriseUrl: 'company.ghe.com' } }), () => {
    assert.fail('Must not fetch');
  });
  assert.match((await reader()).error, /GitHub.com/);
});

test('/usage prints Copilot below Codex and labels unlimited quotas', () => {
  const usage = {
    windows: [{ label: '5h limit', remaining: 62, resetAt: null }],
    copilot: parseCopilotUsage(payload),
  };
  const text = formatUsage(usage);
  assert.match(text, /Codex usage\n5h limit:/);
  assert.match(text, /\n\nCopilot usage\nPremium requests:/);
  assert.match(text, /Chat: +Unlimited/);
  assert.match(text, /Completions: +Unlimited/);
});

test('provider failures do not hide the other provider in /usage', () => {
  assert.match(formatUsage({ windows: [], error: 'Offline', copilot: parseCopilotUsage(payload) }), /Copilot usage\nPremium requests:/);
  assert.match(formatUsage({ windows: [{ label: '5h limit', remaining: 50, resetAt: null }], copilot: { windows: [], error: 'Offline' } }), /5h limit:.*50% left/);
});
