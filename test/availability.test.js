import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enabledProviderIDs } from '../availability.js';

test('reads enabled providers from the available-provider list', async () => {
  const ids = await enabledProviderIDs({
    list: async () => ({ data: [{ id: 'openai' }, { id: 'opencode' }] }),
  });
  assert.ok(ids.has('openai'));
  assert.ok(ids.has('opencode'));
  assert.ok(!ids.has('github-copilot'));
});

test('fails open when provider availability cannot be read', async () => {
  const ids = await enabledProviderIDs({
    list: async () => { throw new Error('offline'); },
  });
  assert.equal(ids, undefined);
});
