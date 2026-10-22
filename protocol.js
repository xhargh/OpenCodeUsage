import { Rpc } from '@opencode/plugin/rpc';

const snapshot = {
  type: 'object',
  properties: {
    windows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          remaining: { type: ['number', 'null'] },
          resetAt: { type: ['number', 'null'] },
          unlimited: { type: 'boolean' },
        },
        required: ['label', 'remaining', 'resetAt'],
        additionalProperties: false,
      },
    },
    error: { type: 'string' },
    hidden: { type: 'boolean' },
  },
  required: ['windows'],
  additionalProperties: false,
};

export const Usage = Rpc.define({
  id: 'usage',
  events: {},
  methods: {
    read: {
      input: {
        type: 'object',
        properties: { fresh: { type: 'boolean' } },
        additionalProperties: false,
      },
      errors: {},
      output: {
        ...snapshot,
        properties: {
          ...snapshot.properties,
          copilot: snapshot,
          go: snapshot,
        },
      },
    },
  },
});
