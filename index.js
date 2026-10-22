import { Plugin } from '@opencode/plugin';
import { enabledProviderIDs } from './availability.js';
import { createUsageReader } from './codex.js';
import { createCopilotReader } from './copilot.js';
import { createGoReader } from './go.js';
import { Usage } from './protocol.js';
import { createRead } from './read.js';

export default Plugin.define({
  id: 'usage',
  async setup(ctx) {
    const read = createRead({
      listEnabledProviders: () => enabledProviderIDs(ctx.provider),
      readUsage: createUsageReader(ctx.integration),
      readCopilot: createCopilotReader(ctx.integration),
      readGo: createGoReader(ctx.integration),
    });
    await ctx.rpc.register(Usage, { read });
  },
});
