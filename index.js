import { Plugin } from '@opencode/plugin';
import { enabledProviderIDs } from './availability.js';
import { createUsageReader } from './codex.js';
import { createCopilotReader } from './copilot.js';
import { createGoReader } from './go.js';
import { Usage } from './protocol.js';

const hidden = { windows: [], hidden: true };

export default Plugin.define({
  id: 'usage',
  async setup(ctx) {
    const readUsage = createUsageReader(ctx.integration);
    const readCopilot = createCopilotReader(ctx.integration);
    const readGo = createGoReader(ctx.integration);
    await ctx.rpc.register(Usage, {
      async read(input) {
        const fresh = input?.fresh === true;
        const enabled = await enabledProviderIDs(ctx.provider);
        const shown = providerID => enabled === undefined || enabled.has(providerID);
        const [codex, copilot, go] = await Promise.all([
          shown('openai')
            ? readUsage(fresh).catch(() => ({ windows: [], error: 'Could not fetch Codex usage.' }))
            : hidden,
          shown('github-copilot') ? readCopilot(fresh) : hidden,
          shown('opencode') ? readGo(fresh) : hidden,
        ]);
        return { ...codex, copilot, go };
      },
    });
  },
});
