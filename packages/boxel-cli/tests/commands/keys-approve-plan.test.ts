import { describe, it, expect } from 'vitest';
import { plan } from '../../src/commands/keys/approve.ts';
import type {
  ApprovalBatch,
  BatchOperation,
  BatchSlot,
} from '../../src/lib/key-bindings.ts';

// `boxel keys approve` fills a slot only with a key or share the approval
// batch's `fillers` offer for it, for the use it approves for, as the secure
// window's approve page does.

const KEY = 'key-1';
const OTHER_KEY = 'key-2';
const SHARE = 'share-1';

function slotOf(slot: string, key: BatchSlot['key']): BatchSlot {
  return {
    slot,
    key,
    status: 'new',
    fingerprint: `fp-${slot}`,
    snapshot: {
      placement: 'header',
      placementName: 'authorization',
    } as BatchSlot['snapshot'],
  };
}

function operationOf(
  name: string,
  slots: BatchSlot[],
  status: BatchOperation['status'] = 'new',
): BatchOperation {
  return {
    name,
    label: name,
    method: 'GET',
    path: `/${name}`,
    instance: null,
    status,
    slots,
  };
}

function batchOf(
  fillers: ApprovalBatch['fillers'],
  operations: { host: string; operations: BatchOperation[] }[] = [
    {
      host: 'api.vendor.test',
      operations: [
        operationOf('list', [
          slotOf('userKey', 'userKey'),
          slotOf('apiKey:team', 'apiKey'),
        ]),
      ],
    },
  ],
): ApprovalBatch {
  return {
    realm: { url: 'https://realms.example.test/r/', name: 'R' },
    card: {
      name: 'Service',
      module: 'https://m.test/service',
      exportName: 'S',
    },
    instance: null,
    review: false,
    groups: operations.map(({ host, operations }) => ({
      destination: {
        href: `https://${host}/`,
        host,
        path: '/',
        registrableDomain: host,
      },
      operations,
    })),
    remaining: 0,
    keys: [
      { id: KEY, name: 'mine', kind: 'static', state: 'active', covers: [] },
      {
        id: OTHER_KEY,
        name: 'elsewhere',
        kind: 'oauth-connection',
        state: 'active',
        covers: [],
      },
    ],
    shares: [
      {
        id: SHARE,
        label: 'mine',
        keyId: 'k',
        keyName: 'k',
        covers: [],
        interactive: false,
        dailyBudget: 100,
      },
    ],
    ...(fillers ? { fillers } : {}),
  };
}

describe('boxel keys approve: which slots a named key fills', () => {
  it('fills the slots the batch offers the key and share for', () => {
    let planned = plan(
      batchOf({
        pipelines: { userKey: [KEY, OTHER_KEY], 'apiKey:team': [SHARE] },
        interactive: {},
      }),
      'mine',
      { use: 'pipelines' },
    );
    expect(planned).toHaveLength(1);
    expect(planned[0]!.fills.map((f) => [f.slot, f.id])).toEqual([
      ['userKey', KEY],
      ['apiKey:team', SHARE],
    ]);
  });

  it("refuses a key the batch doesn't offer for its slot, naming the slot and where it sends", () => {
    expect(() =>
      plan(
        batchOf({
          pipelines: { userKey: [KEY], 'apiKey:team': [] },
          interactive: {},
        }),
        'elsewhere',
        { use: 'pipelines' },
      ),
    ).toThrow(
      "elsewhere can't fill the slot userKey of Service: it isn't a kind of key that slot takes, or its credential isn't good at api.vendor.test, where the batch sends it. Name another key or share",
    );
  });

  it('refuses when one of the slots it would fill is not offered, pointing at --slot for the rest', () => {
    expect(() =>
      plan(
        batchOf({
          pipelines: { userKey: [KEY], 'apiKey:team': [] },
          interactive: {},
        }),
        'mine',
        { use: 'pipelines' },
      ),
    ).toThrow(
      "mine can't fill the slot apiKey:team of Service: it isn't a kind of key that slot takes, or its credential isn't good at api.vendor.test, where the batch sends it. Pass --slot userKey to approve only what it fills, or name another key or share",
    );
    let planned = plan(
      batchOf({
        pipelines: { userKey: [KEY], 'apiKey:team': [] },
        interactive: {},
      }),
      'mine',
      { use: 'pipelines', slot: 'userKey' },
    );
    expect(planned[0]!.fills.map((f) => f.slot)).toEqual(['userKey']);
  });

  it('reads the fillers of the use it approves for', () => {
    let fillers = {
      pipelines: { userKey: [KEY] },
      interactive: { userKey: [OTHER_KEY] },
    };
    let batch = batchOf(fillers, [
      {
        host: 'api.vendor.test',
        operations: [operationOf('list', [slotOf('userKey', 'userKey')])],
      },
      {
        host: 'other.vendor.test',
        operations: [
          operationOf(
            'remove',
            [slotOf('userKey', 'userKey')],
            'pipelines-only',
          ),
        ],
      },
    ]);
    expect(
      plan(batch, 'elsewhere', { use: 'interactive' }).map(
        (p) => p.operation.name,
      ),
    ).toEqual(['list', 'remove']);
    // For pipelines, an operation approved for pipelines only isn't one the
    // batch weighs, so its host isn't named.
    expect(() => plan(batch, 'elsewhere', { use: 'pipelines' })).toThrow(
      /isn't good at api\.vendor\.test, where/,
    );
    expect(() => plan(batch, 'mine', { use: 'interactive' })).toThrow(
      /isn't good at api\.vendor\.test, other\.vendor\.test, where/,
    );
  });

  it("fills by type alone from a batch that doesn't name its fillers", () => {
    let planned = plan(batchOf(undefined), 'elsewhere', { use: 'pipelines' });
    expect(planned[0]!.fills.map((f) => [f.slot, f.id])).toEqual([
      ['userKey', OTHER_KEY],
    ]);
  });
});
