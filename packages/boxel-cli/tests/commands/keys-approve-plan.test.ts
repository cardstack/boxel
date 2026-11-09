import { describe, it, expect } from 'vitest';
import { plan } from '../../src/commands/keys/approve.ts';
import {
  approvalBatch,
  type ApprovalBatch,
  type BatchOperation,
  type BatchSlot,
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
      {
        id: KEY,
        name: 'mine',
        kind: 'static',
        state: 'active',
        covers: ['https://api.vendor.test/'],
      },
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

  it('refuses when one of the slots it would fill is not offered, pointing at --slot for the rest its grants cover', () => {
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

  it("doesn't point at --slot when what it fills needs a new grant, which the secure window approves with every slot", () => {
    let batch = batchOf({
      pipelines: { userKey: [KEY], 'apiKey:team': [] },
      interactive: {},
    });
    batch.keys[0]!.covers = [];
    expect(() => plan(batch, 'mine', { use: 'pipelines' })).toThrow(
      /where the batch sends it\. Name another key or share$/,
    );
  });

  it('names the hosts of only the operations its fillers weigh', () => {
    let batch = batchOf({ pipelines: { userKey: [] }, interactive: {} }, [
      {
        host: 'api.vendor.test',
        operations: [operationOf('list', [slotOf('userKey', 'userKey')])],
      },
      {
        host: 'other.vendor.test',
        operations: [operationOf('remove', [slotOf('userKey', 'userKey')])],
      },
    ]);
    expect(() => plan(batch, 'elsewhere', { use: 'pipelines' })).toThrow(
      "elsewhere can't fill the slot userKey of Service: it isn't a kind of key that slot takes, or its credential isn't good at every one of api.vendor.test, other.vendor.test, where the batch sends it. Name another key or share",
    );
    // Weighed by only the operation approved.
    expect(() =>
      plan({ ...batch, fillersFor: ['remove'] }, 'elsewhere', {
        use: 'pipelines',
        operation: 'remove',
      }),
    ).toThrow(
      "elsewhere can't fill the slot userKey of Service: it isn't a kind of key that slot takes, or its credential isn't good at other.vendor.test, where the operations approved send it. Name another key or share",
    );
    // Weighed by every operation, though only one is approved.
    expect(() =>
      plan(batch, 'elsewhere', { use: 'pipelines', operation: 'remove' }),
    ).toThrow(
      'where the batch sends it. This realm server offers a key for a slot by every operation of Service that sends it, not only remove. Name another key or share',
    );
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
      /isn't good at every one of api\.vendor\.test, other\.vendor\.test, where/,
    );
  });

  it("fills by type alone from a batch that doesn't name its fillers", () => {
    let planned = plan(batchOf(undefined), 'elsewhere', { use: 'pipelines' });
    expect(planned[0]!.fills.map((f) => [f.slot, f.id])).toEqual([
      ['userKey', OTHER_KEY],
    ]);
  });
});

describe('boxel keys approve: asking for the batch an approval covers', () => {
  const target = { kind: 'instance' as const, url: 'https://r.test/card' };
  function answering(statuses: { status: number; body: unknown }[]) {
    let asked: Record<string, unknown>[] = [];
    let fetchFn = (async (_url: string, init: RequestInit) => {
      asked.push(JSON.parse(String(init.body)).data.attributes);
      let { status, body } = statuses.shift()!;
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { asked, fetchFn };
  }
  const answer = {
    status: 200,
    body: { data: { attributes: { groups: [], keys: [], shares: [] } } },
  };

  it('asks with the operations it covers, and records that its fillers weigh only those', async () => {
    let { asked, fetchFn } = answering([answer]);
    let batch = await approvalBatch(
      'https://realms.example.test/',
      'token',
      { target, operations: ['list'] },
      fetchFn,
    );
    expect(asked).toEqual([{ target, review: false, operations: ['list'] }]);
    expect(batch.fillersFor).toEqual(['list']);
  });

  it("asks again without them of a realm server that doesn't take them", async () => {
    let { asked, fetchFn } = answering([
      {
        status: 400,
        body: { errors: ["'operations' can't be asked about here"] },
      },
      answer,
    ]);
    let batch = await approvalBatch(
      'https://realms.example.test/',
      'token',
      { target, operations: ['list'] },
      fetchFn,
    );
    expect(asked.map((a) => a.operations)).toEqual([['list'], undefined]);
    expect(batch.fillersFor).toBeUndefined();
  });

  it('passes on any other refusal', async () => {
    let { fetchFn } = answering([
      {
        status: 400,
        body: { errors: ['operations is a list of operation names'] },
      },
    ]);
    await expect(
      approvalBatch(
        'https://realms.example.test/',
        'token',
        { target, operations: ['list'] },
        fetchFn,
      ),
    ).rejects.toThrow('operations is a list of operation names');
  });
});
