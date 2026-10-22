import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRead } from '../read.js';

test('reads only providers that are enabled', async () => {
  const called = [];
  const read = createRead({
    listEnabledProviders: async () => new Set(['openai']),
    readUsage: async () => { called.push('codex'); return { windows: [{ label: '5h limit', remaining: 62, resetAt: null }] }; },
    readCopilot: async () => { called.push('copilot'); return { windows: [] }; },
    readGo: async () => { called.push('go'); return { windows: [] }; },
  });
  const result = await read({});
  assert.deepEqual(called, ['codex']);
  assert.equal(result.copilot.hidden, true);
  assert.equal(result.go.hidden, true);
});

test('shows Go when only the opencode-go API key provider is enabled', async () => {
  let goCalled = false;
  const read = createRead({
    listEnabledProviders: async () => new Set(['opencode-go']),
    readUsage: async () => ({ windows: [], hidden: true }),
    readCopilot: async () => ({ windows: [], hidden: true }),
    readGo: async () => { goCalled = true; return { windows: [{ label: '5h limit', remaining: 50, resetAt: null }] }; },
  });
  const result = await read({});
  assert.equal(goCalled, true);
  assert.equal(result.go.windows[0].remaining, 50);
  assert.equal(result.hidden, true);
  assert.equal(result.copilot.hidden, true);
});

test('fails open when provider availability cannot be read', async () => {
  let codex = false;
  let copilot = false;
  let go = false;
  const read = createRead({
    listEnabledProviders: async () => undefined,
    readUsage: async () => { codex = true; return { windows: [], hidden: true }; },
    readCopilot: async () => { copilot = true; return { windows: [], hidden: true }; },
    readGo: async () => { go = true; return { windows: [], hidden: true }; },
  });
  await read({});
  assert.ok(codex && copilot && go);
});

test('passes the fresh flag through to every enabled reader', async () => {
  const flags = [];
  const read = createRead({
    listEnabledProviders: async () => new Set(['openai', 'github-copilot', 'opencode']),
    readUsage: async fresh => { flags.push(['codex', fresh]); return { windows: [] }; },
    readCopilot: async fresh => { flags.push(['copilot', fresh]); return { windows: [] }; },
    readGo: async fresh => { flags.push(['go', fresh]); return { windows: [] }; },
  });
  await read({ fresh: true });
  assert.deepEqual(flags, [['codex', true], ['copilot', true], ['go', true]]);
});
