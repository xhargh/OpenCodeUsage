import { Plugin } from '@opencode/plugin';
import { createUsageReader } from './codex.js';
import { createCopilotReader } from './copilot.js';
import { createGoReader } from './go.js';
import { Usage } from './protocol.js';

export default Plugin.define({
  id: 'usage',
  async setup(ctx) {
    const readUsage = createUsageReader(ctx.integration);
    const readCopilot = createCopilotReader(ctx.integration);
    const readGo = createGoReader(ctx.integration);
    await ctx.rpc.register(Usage, {
      async read(input) {
        const fresh = input?.fresh === true;
        const [codex, copilot, go] = await Promise.all([
          readUsage(fresh).catch(() => ({ windows: [], error: 'Could not fetch Codex usage.' })),
          readCopilot(fresh),
          readGo(fresh),
        ]);
        return { ...codex, copilot, go };
      },
    });
  },
});
