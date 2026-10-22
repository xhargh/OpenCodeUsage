import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoReader, parseGoUsage } from '../go.js';
import { formatUsage } from '../format.js';

// Shape from the deployed Console Go status route: access.meters contains
// bigint decimal-string monetary values and ISO reset timestamps.
const payload = {
  product: 'go',
  access: { meters: {
    fiveHour: { usedMicroCents: '380000000', limitMicroCents: '1000000000', resetsAt: '2026-10-23T00:08:00Z' },
    week: { usedMicroCents: '600000000', limitMicroCents: '10000000000', resetsAt: '2026-10-29T18:08:00Z' },
    month: { usedMicroCents: '1000000000', limitMicroCents: '20000000000', resetsAt: '2026-11-01T00:00:00Z' },
  } },
};
const ENDPOINT = 'https://opencode.ai/console/api/go/status';
const integration = (credential = { type: 'key', key: 'go-secret' }) => ({ connection: {
  active: async id => id === 'opencode-go' ? { type: 'credential', id: 'go-account' } : undefined,
  resolve: async () => credential,
} });
const respond = (body = payload, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

test('Go reads 5-hour, weekly and monthly remaining percentages', () => {
  const result = parseGoUsage(payload);
  assert.deepEqual(result.windows.map(w => [w.label, w.remaining]), [
    ['5h limit', 62], ['Weekly limit', 94], ['Monthly limit', 95],
  ]);
  assert.equal(result.windows[0].resetAt, Date.parse('2026-10-23T00:08:00Z') / 1000);
  assert.deepEqual(parseGoUsage({ ...payload, product: 'go-plus' }), result);
});

test('Go accepts a numeric reset timestamp in unix seconds', () => {
  const status = structuredClone(payload);
  status.access.meters.fiveHour.resetsAt = 1792710480;
  assert.equal(parseGoUsage(status).windows[0].resetAt, 1792710480);
});

test('Go handles idle windows and exhausted allowances without inventing reset dates', () => {
  const status = structuredClone(payload);
  status.access.meters.fiveHour.resetsAt = null;
  status.access.meters.fiveHour.usedMicroCents = '0';
  status.access.meters.week.usedMicroCents = '20000000000';
  const result = parseGoUsage(status);
  assert.equal(result.windows[0].remaining, 100);
  assert.equal(result.windows[0].resetAt, null);
  assert.equal(result.windows[1].remaining, 0);
});

test('Go distinguishes no subscription and no active paid period from malformed data', () => {
  assert.match(parseGoUsage(null).error, /No OpenCode Go subscription/);
  assert.match(parseGoUsage({ product: 'go', access: null }).error, /no active paid period/);
  for (const status of [{}, undefined, { product: 'go', access: {} }]) assert.throws(() => parseGoUsage(status));
  for (const amount of ['', null, -1, 'invalid', Infinity]) {
    const status = structuredClone(payload);
    status.access.meters.month.usedMicroCents = amount;
    assert.throws(() => parseGoUsage(status));
  }
});

test('Go uses the API key against the fixed account-scoped Console endpoint', async () => {
  let calls = 0;
  const reader = createGoReader(integration(), async (url, options) => {
    calls++;
    assert.equal(url, ENDPOINT);
    assert.equal(options.headers.Authorization, 'Bearer go-secret');
    assert.equal(options.redirect, 'error');
    return respond();
  });
  const result = await reader();
  assert.equal(calls, 1);
  assert.equal(result.windows.length, 3);
  assert.ok(!JSON.stringify(result).includes('go-secret'));
});

test('Go prefers a Console account and includes its selected workspace header', async () => {
  const source = integration();
  source.connection.active = async id => ({
    type: 'credential', id: id === 'opencode' ? 'console-account' : 'go-account',
  });
  const resolved = [];
  source.connection.resolve = async connection => {
    resolved.push(connection.id);
    return { type: 'oauth', access: 'console-secret', metadata: { orgID: 'wrk_go', server: 'https://opencode.ai/console' } };
  };
  const reader = createGoReader(source, async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer console-secret');
    assert.equal(options.headers['x-org-id'], 'wrk_go');
    return respond();
  });
  assert.equal((await reader()).windows.length, 3);
  assert.deepEqual(resolved, ['console-account']);
});

test('Go falls back to the Go key when the Console account cannot report usage', async () => {
  const source = integration();
  source.connection.active = async id => ({
    type: 'credential', id: id === 'opencode' ? 'console-account' : 'go-account',
  });
  source.connection.resolve = async connection => connection.id === 'console-account'
    ? { type: 'oauth', access: 'console-secret', metadata: { orgID: 'wrk_go' } }
    : { type: 'key', key: 'go-secret' };
  const reader = createGoReader(source, async (_url, options) => {
    if (options.headers.Authorization === 'Bearer console-secret') return respond({}, 403);
    return respond();
  });
  assert.equal((await reader()).windows.length, 3);
});

test('Go falls back to the Go key when the Console workspace has no Go plan', async () => {
  const source = integration();
  source.connection.active = async id => ({
    type: 'credential', id: id === 'opencode' ? 'console-account' : 'go-account',
  });
  source.connection.resolve = async connection => connection.id === 'console-account'
    ? { type: 'oauth', access: 'console-secret', metadata: { orgID: 'wrk_go' } }
    : { type: 'key', key: 'go-secret' };
  const reader = createGoReader(source, async (_url, options) =>
    options.headers.Authorization === 'Bearer console-secret' ? respond(null) : respond());
  assert.equal((await reader()).windows.length, 3);
});

test('Go caches, deduplicates concurrent reads and supports forced refresh', async () => {
  let calls = 0;
  const reader = createGoReader(integration(), async () => { calls++; return respond(); });
  await Promise.all([reader(), reader(), reader()]);
  await reader();
  assert.equal(calls, 1);
  await reader(true);
  assert.equal(calls, 2);
});

test('Go account switching and sign-out invalidate previous usage', async () => {
  let id = 'first';
  let calls = 0;
  const source = integration();
  source.connection.active = async name => name === 'opencode-go' && id ? { type: 'credential', id } : undefined;
  const reader = createGoReader(source, async () => { calls++; return respond(); });
  await reader();
  id = 'second';
  await reader();
  assert.equal(calls, 2);
  id = undefined;
  assert.equal((await reader()).hidden, true);
});

test('Go reports denied access without exposing bodies or credentials', async () => {
  for (const status of [401, 403, 429, 500]) {
    const result = await createGoReader(integration(), async () => new Response('sensitive body', { status }))();
    assert.deepEqual(result.windows, []);
    assert.ok(result.error);
    assert.ok(!result.error.includes('sensitive'));
    if (status === 401 || status === 403) assert.match(result.error, /OpenCode Console/);
  }
});

test('Go reports expired API keys with an actionable message', async () => {
  const result = await createGoReader(integration(), async () =>
    respond({ code: 'api_key_expired' }, 401))();
  assert.match(result.error, /API key has expired.*Create a new key/);
});

test('Go safely handles invalid JSON, network and credential resolver errors', async () => {
  for (const fetcher of [async () => new Response('not JSON'), async () => { throw new Error('go-secret'); }]) {
    const result = await createGoReader(integration(), fetcher)();
    assert.ok(result.error);
    assert.ok(!result.error.includes('go-secret'));
  }
  const source = integration();
  source.connection.resolve = async () => { throw new Error('secret'); };
  assert.ok(!(await createGoReader(source)()).error.includes('secret'));
  source.connection.active = async () => { throw new Error('secret'); };
  assert.ok(!(await createGoReader(source)()).error.includes('secret'));
});

test('Go never forwards custom-server credentials to the public Console', async () => {
  const source = integration({ type: 'oauth', access: 'private-secret', metadata: { server: 'https://private.example/console' } });
  const reader = createGoReader(source, () => assert.fail('Must not fetch'));
  assert.match((await reader()).error, /official OpenCode Console/);
});

test('/usage prints Go after Codex and Copilot, including all three windows', () => {
  const usage = { windows: [], copilot: { windows: [] }, go: parseGoUsage(payload) };
  const text = formatUsage(usage);
  assert.ok(text.indexOf('Codex usage') < text.indexOf('Copilot usage'));
  assert.ok(text.indexOf('Copilot usage') < text.indexOf('OpenCode Go usage'));
  assert.match(text, /Monthly limit:.*95% left/);
});

test('Go access errors do not hide other provider usage', () => {
  const text = formatUsage({ windows: [{ label: '5h limit', remaining: 62, resetAt: null }], go: { windows: [], error: 'Access denied' } });
  assert.match(text, /5h limit:.*62% left/);
  assert.match(text, /OpenCode Go usage unavailable: Access denied/);
});
