import { module, test } from 'qunit';

import type {
  LooseCardResource,
  LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import DirectBoxelRuntime from '@cardstack/host/lib/direct-boxel-runtime';

import type * as CardAPI from '@cardstack/base/card-api';

const resource = {
  id: 'https://realm.example/Card/1',
  type: 'card',
  attributes: {},
  relationships: {},
  meta: {
    adoptsFrom: { module: 'https://realm.example/card', name: 'Card' },
  },
} as unknown as LooseCardResource;

const document = { data: resource } as unknown as LooseSingleCardDocument;

module('Unit | Direct Boxel runtime', function () {
  test("RP-15.3: redeserialize() re-derives the instance under the SAME handle from the identical retained document — the Sandbox child's own Direct runtime uses this for HMR module-identity churn", async function (assert) {
    let created: { resource: unknown; document: unknown }[] = [];
    let currentInstance: { tag: string } = { tag: 'first' };
    let getCardAPI = async () =>
      ({
        createFromSerialized: async (
          res: LooseCardResource,
          doc: LooseSingleCardDocument,
        ) => {
          created.push({ resource: res, document: doc });
          return currentInstance;
        },
        serializeCard: async (instance: { tag: string }) => ({
          data: { id: instance.tag },
        }),
      }) as unknown as typeof CardAPI;
    let runtime = new DirectBoxelRuntime(getCardAPI);

    let handle = await runtime.createFromSerialized(
      resource,
      document,
      undefined,
      'host-display',
    );
    assert.strictEqual(created.length, 1);

    let firstSerialized = await runtime.serializeCard(handle);
    assert.strictEqual(
      (firstSerialized as unknown as { data: { id: string } }).data.id,
      'first',
      'the handle resolves to the instance createFromSerialized produced',
    );

    // Simulate the edited module having been invalidated and re-imported
    // between calls — a genuinely different instance value, standing in
    // for one bound to a freshly re-evaluated class.
    currentInstance = { tag: 'second' };
    await runtime.redeserialize(handle);

    assert.strictEqual(
      created.length,
      2,
      'redeserialize() re-runs createFromSerialized',
    );
    assert.deepEqual(
      created[1],
      { resource, document },
      'against the SAME retained resource/document — data state survives, only module/component identity changes',
    );

    let secondSerialized = await runtime.serializeCard(handle);
    assert.strictEqual(
      (secondSerialized as unknown as { data: { id: string } }).data.id,
      'second',
      'the SAME handle now resolves to the redeserialized instance — every consumer already holding it keeps working unchanged',
    );

    await runtime.dispose(handle);
    await assert.rejects(
      runtime.redeserialize(handle),
      /Cannot redeserialize unknown Boxel instance handle/,
      'a disposed handle cannot be redeserialized — its retained creation args are released alongside the instance',
    );
  });

  test('RP-15.3: redeserialize() rejects a handle it never created', async function (assert) {
    let getCardAPI = async () =>
      ({
        createFromSerialized: async () => ({}),
      }) as unknown as typeof CardAPI;
    let runtime = new DirectBoxelRuntime(getCardAPI);

    await assert.rejects(
      runtime.redeserialize('direct-instance:999' as never),
      /Cannot redeserialize unknown Boxel instance handle/,
    );
  });
});
