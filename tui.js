import { Plugin } from 'opentui:runtime-module:%40opencode%2Fplugin%2Ftui';
import { For, Show, createSignal } from 'opentui:runtime-module:solid-js';
import { jsx, jsxs } from 'opentui:runtime-module:%40opentui%2Fsolid%2Fjsx-runtime';
import { formatCredits, formatUsage, progressBar, resetTime } from './format.js';
import { Usage } from './protocol.js';

export default Plugin.define({
  id: 'usage',
  setup(context) {
    const [usage, setUsage] = createSignal({ windows: [], error: 'Loading…' });
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
            });
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
        });
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
    const sections = () => {
      const visible = (title, snapshot) =>
        snapshot && !snapshot.hidden ? [{ title, snapshot }] : [];
      return [
        ...visible('Codex usage', usage()),
        ...visible('Copilot usage', usage().copilot),
        ...visible('OpenCode Go usage', usage().go),
      ];
    };
    const removeSlot = context.ui.slot({
      append: 'sidebar.content',
      render: () => jsx('box', {
        flexDirection: 'column',
        gap: 1,
        paddingTop: 1,
        children: jsx(For, {
          get each() { return sections(); },
          children: section => jsxs('box', {
            flexDirection: 'column',
            gap: 1,
            children: [
              jsx('text', {
                get fg() { return context.theme.text.base; },
                children: jsx('b', { get children() { return section.title; } }),
              }),
              jsx(Show, {
                get when() { return section.snapshot.credits; },
                keyed: true,
                children: credits => jsx('text', {
                  get fg() { return context.theme.text.base; },
                  children: `AI credits: ${formatCredits(credits)}`,
                }),
              }),
              jsx(Show, {
                get when() { return !section.snapshot.error; },
                fallback: jsx('text', {
                  get fg() { return context.theme.text.weak; },
                  get children() { return section.snapshot.error; },
                }),
                children: jsx(For, {
                  get each() { return section.snapshot.windows; },
                  children: window => jsxs('box', {
                    flexDirection: 'column',
                    children: [
                      jsx('text', {
                        get fg() { return context.theme.text.base; },
                        get children() { return `${window.label}: ${window.unlimited ? 'Unlimited' : `${window.remaining}% left`}`; },
                      }),
                      jsx(Show, {
                        get when() { return !window.unlimited; },
                        children: [
                          jsx('text', {
                            get fg() { return context.theme.text.base; },
                            get children() { return progressBar(window.remaining); },
                          }),
                          jsx('text', {
                            get fg() { return context.theme.text.weak; },
                            get children() { return `resets ${resetTime(window.resetAt)}`; },
                          }),
                        ],
                      }),
                    ],
                  }),
                }),
              }),
            ],
          }),
        }),
      }),
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
