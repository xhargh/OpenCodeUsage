export function progressBar(remaining) {
  const value = Number(remaining);
  if (!Number.isFinite(value)) return `[${'░'.repeat(20)}]`;
  const filled = Math.round(Math.max(0, Math.min(100, value)) / 5);
  return `[${'█'.repeat(filled)}${'░'.repeat(20 - filled)}]`;
}

export function resetTime(timestamp) {
  if (!Number.isFinite(timestamp)) return 'unknown';
  const date = new Date(timestamp * 1000);
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  return `${time} on ${date.getDate()} ${month}`;
}

export function formatUsage(usage, provider = 'Codex') {
  if (usage.copilot || usage.go) {
    const sections = [
      !usage.hidden && `Codex usage\n${formatUsage({ windows: usage.windows, error: usage.error })}`,
      usage.copilot && !usage.copilot.hidden && `Copilot usage\n${formatUsage(usage.copilot, 'Copilot')}`,
      usage.go && !usage.go.hidden && `OpenCode Go usage\n${formatUsage(usage.go, 'OpenCode Go')}`,
    ].filter(Boolean);
    return sections.length ? sections.join('\n\n') : 'No connected and enabled usage providers.';
  }
  if (usage.hidden) return '';
  if (usage.error) return `${provider} usage unavailable: ${usage.error}`;
  return usage.windows.map(window =>
    window.unlimited ? `${`${window.label}:`.padEnd(21)}Unlimited`
      : `${`${window.label}:`.padEnd(21)}${progressBar(window.remaining)} ${window.remaining}% left (resets ${resetTime(window.resetAt)})`
  ).join('\n');
}
