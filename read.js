// Combines the per-provider readers into a single usage snapshot, showing each
// provider only when it is both connected and enabled in OpenCode.
export function createRead({ listEnabledProviders, readUsage, readCopilot, readGo }) {
  const hidden = { windows: [], hidden: true };
  return async function read(input) {
    const fresh = input?.fresh === true;
    const enabled = await listEnabledProviders();
    const shown = providerID => enabled === undefined || enabled.has(providerID);
    const [codex, copilot, go] = await Promise.all([
      shown('openai') ? readUsage(fresh) : hidden,
      shown('github-copilot') ? readCopilot(fresh) : hidden,
      shown('opencode') || shown('opencode-go') ? readGo(fresh) : hidden,
    ]);
    return { ...codex, copilot, go };
  };
}
