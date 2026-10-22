import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountID, createUsageReader, parseUsage } from '../codex.js';
import { formatUsage, progressBar, resetTime } from '../format.js';

const payload = { rate_limit: {
  primary_window: { used_percent: 38, limit_window_seconds: 18000, reset_at: 1792710480 },
  secondary_window: { used_percent: 6, limit_window_seconds: 604800, reset_at: 1793297280 },
} };
const credential = { type: 'oauth', access: 'test-access', metadata: { accountID: 'test-account' } };
const integration = (value = credential) => ({ connection: {
  active: async () => ({ type: 'credential', id: 'test' }),
  resolve: async () => value,
} });

test('parses used percentages into remaining 5-hour and weekly limits', () => {
  assert.deepEqual(parseUsage(payload).windows.map(({ label, remaining }) => ({ label, remaining })), [
    { label: '5h limit', remaining: 62 }, { label: 'Weekly limit', remaining: 94 },
  ]);
  assert.equal(progressBar(62), '[████████████░░░░░░░░]');
  assert.equal(progressBar(94), '[███████████████████░]');
  assert.equal(progressBar(0), `[${'░'.repeat(20)}]`);
  assert.equal(progressBar(100), `[${'█'.repeat(20)}]`);
});

test('formats aligned rows and reset times in the local timezone', () => {
  const date = new Date(2026, 9, 23, 0, 8);
  const usage = { windows: [{ label: '5h limit', remaining: 62, resetAt: date.getTime() / 1000 }] };
  assert.equal(resetTime(date.getTime() / 1000), '12:08 AM on 23 Oct');
  assert.equal(formatUsage(usage), '5h limit:            [████████████░░░░░░░░] 62% left (resets 12:08 AM on 23 Oct)');
  assert.equal(resetTime(null), 'unknown');
});

test('does not invent limits when the response is missing or malformed', () => {
  for (const body of [{}, null, { rate_limit: { primary_window: { used_percent: '38' } } }]) {
    assert.throws(() => parseUsage(body));
  }
});

test('handles nonstandard durations, clamping and relative reset timestamps', () => {
  const result = parseUsage({ rate_limit: { primary_window: {
    used_percent: 110, limit_window_seconds: 3600, reset_after_seconds: 60,
  } } }, 100000);
  assert.deepEqual(result.windows, [{ label: '1h limit', remaining: 0, resetAt: 160 }]);
});

test('resolves OAuth credentials server-side and only sends them to ChatGPT', async () => {
  const reader = createUsageReader(integration(), async (url, options) => {
    assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage');
    assert.equal(options.headers.Authorization, 'Bearer test-access');
    assert.equal(options.headers['ChatGPT-Account-Id'], 'test-account');
    assert.equal(options.redirect, 'error');
    return Response.json(payload);
  });
  const result = await reader();
  assert.equal(result.windows[0].remaining, 62);
  assert.ok(!JSON.stringify(result).includes('test-access'));
});

test('deduplicates concurrent requests, caches briefly, and allows forced refresh', async () => {
  let calls = 0;
  const reader = createUsageReader(integration(), async () => { calls++; return Response.json(payload); });
  await Promise.all([reader(), reader(), reader()]);
  assert.equal(calls, 1);
  await reader();
  assert.equal(calls, 1);
  await reader(true);
  assert.equal(calls, 2);
});

test('account switching invalidates cached usage', async () => {
  let id = 'first';
  let calls = 0;
  const source = integration();
  source.connection.active = async () => ({ type: 'credential', id });
  const reader = createUsageReader(source, async () => { calls++; return Response.json(payload); });
  await reader();
  id = 'second';
  await reader();
  assert.equal(calls, 2);
});

test('reports missing sign-in and API keys without fetching', async () => {
  const noFetch = () => { throw new Error('Should not fetch'); };
  const source = integration();
  source.connection.active = async () => undefined;
  assert.match((await createUsageReader(source, noFetch)()).error, /Sign in/);
  assert.match((await createUsageReader(integration({ type: 'key', key: 'secret' }), noFetch)()).error, /OAuth/);
});

test('HTTP and network failures are safe, readable, and never leak response bodies', async () => {
  for (const status of [401, 403, 429, 500]) {
    const reader = createUsageReader(integration(), async () => new Response('sensitive body', { status }));
    const result = await reader();
    assert.ok(result.error);
    assert.deepEqual(result.windows, []);
    assert.ok(!JSON.stringify(result).includes('sensitive'));
  }
  const reader = createUsageReader(integration(), async () => { throw new Error('secret test-access'); });
  assert.ok(!(await reader()).error.includes('test-access'));
});

test('reads account IDs from metadata or token-sharing JWT claims', () => {
  assert.equal(accountID(credential), 'test-account');
  const claims = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'jwt-account' } })).toString('base64url');
  assert.equal(accountID({ access: `header.${claims}.signature` }), 'jwt-account');
  assert.equal(accountID({ access: 'invalid' }), undefined);
});
