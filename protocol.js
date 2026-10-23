import { Rpc } from '@opencode/plugin/rpc';

const credits = {
  type: 'object',
  properties: {
    used: { type: 'number' },
    total: { type: 'number' },
  },
  required: ['used', 'total'],
  additionalProperties: false,
};

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
    credits,
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
