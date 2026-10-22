// OpenCode omits disabled providers from its available-provider list, while
// still listing explicitly enabled providers that have no connection yet.
export async function enabledProviderIDs(provider) {
  try {
    const result = await provider.list();
    return new Set(result.data.map(entry => entry.id));
  } catch {
    // If provider state cannot be read, prefer showing a connected provider's
    // usage over hiding it silently.
    return undefined;
  }
}
