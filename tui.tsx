import { Plugin } from '@opencode/plugin/tui';
import { For, Show, createSignal } from 'solid-js';
import { formatUsage, progressBar, resetTime } from './format.js';
import { Usage } from './protocol.js';

type Snapshot = {
  windows: { label: string; remaining: number | null; resetAt: number | null; unlimited?: boolean }[];
  error?: string;
  copilot?: Snapshot;
  go?: Snapshot;
};

export default Plugin.define({
  id: 'usage',
  setup(context) {
    const [usage, setUsage] = createSignal<Snapshot>({ windows: [], error: 'Loading…' });
    const rpc = context.client.rpc(Usage);
    let pending = false;
    let stopped = false;
    context.keymap.layer(() => ({
      mode: 'global',
      commands: [{
        id: 'usage.show',
        title: 'Show Codex, Copilot and OpenCode Go usage',
        group: 'Usage',
        palette: true,
        slash: { name: 'usage' },
        async run() {
          try {
            const result = await rpc.read({ fresh: true }, {
              location: context.location ?? context.data.location.default(),
            }) as Snapshot;
            if (!stopped) setUsage(result);
            // A dialog shows the report once. A shell message would also render
            // the command itself, duplicating every line in the transcript.
            void context.ui.dialog.alert({
              title: 'Usage',
              message: formatUsage(result),
            });
            // The alert mounts on the next tick; resize it afterwards so long
            // reset times do not wrap in the default medium-width dialog.
            setTimeout(() => {
              if (!stopped) context.ui.dialog.set({ size: 'xlarge', centered: true });
            }, 0);
          } catch {
            context.ui.toast.show({ message: 'Could not load usage. Please try again.', variant: 'error' });
          }
        },
      }],
    }));
    async function refresh() {
      if (pending || stopped) return;
      pending = true;
      try {
        const result = await rpc.read({}, {
          location: context.location ?? context.data.location.default(),
        }) as Snapshot;
        if (!stopped) setUsage(result);
      } catch {
        if (!stopped) setUsage({
          windows: [], error: 'Usage unavailable. Run /usage to retry.',
          copilot: { windows: [], error: 'Usage unavailable. Run /usage to retry.' },
          go: { windows: [], error: 'Usage unavailable. Run /usage to retry.' },
        });
      } finally {
        pending = false;
      }
    }
    const removeSlot = context.ui.slot({
      append: 'sidebar.content',
      render: () => (
        <box flexDirection="column" gap={1} paddingTop={1}>
          <For each={[
            { title: 'Codex usage', snapshot: usage() },
            { title: 'Copilot usage', snapshot: usage().copilot ?? { windows: [], error: 'Loading…' } },
            { title: 'OpenCode Go usage', snapshot: usage().go ?? { windows: [], error: 'Loading…' } },
          ]}>{section => (
            <box flexDirection="column" gap={1}>
              <text fg={context.theme.text.base}><b>{section.title}</b></text>
              <Show when={!section.snapshot.error} fallback={<text fg={context.theme.text.weak}>{section.snapshot.error}</text>}>
                <For each={section.snapshot.windows}>{window => (
                  <box flexDirection="column">
                    <text fg={context.theme.text.base}>{window.label}: {window.unlimited ? 'Unlimited' : `${window.remaining}% left`}</text>
                    <Show when={!window.unlimited}>
                      <text fg={context.theme.text.base}>{progressBar(window.remaining)}</text>
                      <text fg={context.theme.text.weak}>resets {resetTime(window.resetAt)}</text>
                    </Show>
                  </box>
                )}</For>
              </Show>
            </box>
          )}</For>
        </box>
      ),
    });
    void refresh();
    const timer = setInterval(() => void refresh(), 60000);
    const unsubscribe = context.data.on('session.execution.succeeded', () => void refresh());
    return () => {
      stopped = true;
      clearInterval(timer);
      unsubscribe();
      removeSlot();
    };
  },
});
