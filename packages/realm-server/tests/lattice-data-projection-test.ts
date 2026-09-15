import QUnit from 'qunit';
import { rri } from '@cardstack/runtime-common/realm-identifiers';
import type { LatticeDataProjection } from '@cardstack/runtime-common/definitions';
import { LatticeDataProjector } from '../lib/lattice-data-projection.ts';
import type { LatticeCardInput } from '../lib/lattice-materialization-inputs.ts';

const { module, test } = QUnit;
const realm = 'https://lattice-projection.example/';
function card(
  name: string,
  attributes: any = {},
  relationships: any = {},
): LatticeCardInput {
  return {
    url: realm + name + '.json',
    generation: 1,
    resource: {
      id: realm + name,
      type: 'card',
      attributes,
      relationships,
      meta: { adoptsFrom: { module: rri('./definition'), name: 'Record' } },
    },
  };
}
const link = (self: string | null) => ({ links: { self } });
const resolve = (ref: string, base: string) => new URL(ref, base).href;

module('Lattice | published data projection', () => {
  test('only declared joins load data; identity references and unrelated links do not', async (assert) => {
    const root = card(
      'root',
      { title: 'Root' },
      {
        'students.1': link('./second'),
        'students.0': link('./first'),
        editor: link('./unloaded-editor'),
        unrelated: link('./unloaded-graph'),
      },
    );
    const first = card('first', { score: 7, nested: { confirmed: true } });
    const second = card('second', { score: 9 });
    const requests: string[][] = [];
    const projector = new LatticeDataProjector(async (urls) => {
      requests.push(urls);
      return [first, second];
    }, resolve);
    const shape = {
      links: {
        students: { many: true, projection: {} },
        editor: { many: false, projection: 'id' as const },
      },
    };
    const [value] = await projector.project([root], shape);
    assert.deepEqual(requests, [[realm + 'first.json', realm + 'second.json']]);
    assert.deepEqual(
      value.students.map((s: any) => s.score),
      [7, 9],
    );
    assert.deepEqual(value.editor, { id: realm + 'unloaded-editor' });
    assert.false(Object.hasOwn(value, 'unrelated'));
    value.students[0].nested.confirmed = false;
    const [again] = await projector.project([root], shape);
    assert.true(
      again.students[0].nested.confirmed,
      'a consumer cannot mutate the resident value',
    );
    assert.strictEqual(
      requests.length,
      1,
      'repeated reads reuse the same input frame',
    );
  });

  test('confirmed missing slots preserve plural positions and stop recursive expansion', async (assert) => {
    const requests: string[][] = [];
    const missing = { url: realm + 'gone.json', generation: 1, resource: null };
    const present = card('here', { title: 'Here' });
    const projector = new LatticeDataProjector(async (urls) => {
      requests.push(urls);
      return [missing, present];
    }, resolve);
    const root = card(
      'root',
      {},
      {
        person: link('./gone'),
        'members.0': link('./gone'),
        'members.1': link('./here'),
      },
    );
    const [value] = await projector.project([root], {
      links: {
        person: {
          many: false,
          projection: { links: { child: { many: false, projection: {} } } },
        },
        members: { many: true, projection: {} },
      },
    });
    assert.strictEqual(value.person, null);
    assert.deepEqual(value.members, [
      null,
      { title: 'Here', id: realm + 'here' },
    ]);
    assert.strictEqual(
      requests.length,
      1,
      'confirmed absence does not trigger recursive work',
    );
    assert.strictEqual(
      projector.residentCardCount,
      3,
      'missing identities remain accounted for',
    );
  });

  test('loaded edges report the actual owner even when a target is already resident', async (assert) => {
    const shared = card('shared', { amount: 4 });
    const nested = card('nested', {}, { person: link('./shared') });
    const root = card(
      'root',
      {},
      {
        nested: link('./nested'),
        person: link('./shared'),
        identity: link('./unloaded'),
      },
    );
    const edges: Array<{ owner: string; field: string; targets: string[] }> =
      [];
    const reads: string[][] = [];
    const projector = new LatticeDataProjector(
      async (urls) => {
        reads.push(urls);
        return [nested];
      },
      resolve,
      async (owner, field, targets) => {
        edges.push({ owner: owner.url, field, targets });
      },
    );
    await projector.project([shared], {});
    await projector.project([root], {
      links: {
        nested: {
          many: false,
          projection: { links: { person: { many: false, projection: {} } } },
        },
        person: { many: false, projection: {} },
        identity: { many: false, projection: 'id' },
      },
    });
    assert.deepEqual(reads, [[realm + 'nested.json']]);
    assert.deepEqual(edges, [
      { owner: root.url, field: 'nested', targets: [realm + 'nested'] },
      { owner: root.url, field: 'person', targets: [realm + 'shared'] },
      { owner: nested.url, field: 'person', targets: [realm + 'shared'] },
    ]);
  });

  test('complete query memberships project as data and partial ones are rejected', async (assert) => {
    const root = card(
      'root',
      {},
      {
        members: {
          links: { self: null },
          data: [{ type: 'card', id: realm + 'first' }],
          meta: { total: 1 },
        },
      },
    );
    const projector = new LatticeDataProjector(
      async () => [card('first', { score: 7 })],
      resolve,
    );
    const shape = { links: { members: { many: true, projection: {} } } };
    assert.strictEqual(
      (await projector.project([root], shape))[0].members[0].score,
      7,
    );
    const incomplete = card(
      'partial',
      {},
      {
        members: {
          links: { self: null },
          data: [{ type: 'card', id: realm + 'first' }],
          meta: { total: 2 },
        },
      },
    );
    await assert.rejects(
      projector.project([incomplete], shape),
      /Incomplete projected membership/,
    );
  });

  test('local identifiers and conflicting membership encodings cannot become confirmed input', async (assert) => {
    const projector = new LatticeDataProjector(async () => [], resolve);
    const shape = { links: { members: { many: true, projection: {} } } };
    await assert.rejects(
      projector.project(
        [
          card(
            'root',
            {},
            {
              members: {
                data: [{ type: 'card', lid: 'not-published' }],
                meta: { total: 1 },
              },
            },
          ),
        ],
        shape,
      ),
      /Missing projected member identity/,
    );
    await assert.rejects(
      projector.project(
        [
          card(
            'root',
            {},
            {
              members: link(null),
              'members.0': link('./first'),
            },
          ),
        ],
        shape,
      ),
      /Ambiguous projected membership/,
    );
  });

  test('declaration edits during a read cannot introduce another graph traversal', async (assert) => {
    let shape: LatticeDataProjection = {
      links: { person: { many: false, projection: {} } },
    };
    const person = card(
      'person',
      { name: 'Synthetic person' },
      { other: link('./unloaded') },
    );
    const projector = new LatticeDataProjector(async () => {
      shape.links!.person.projection = {
        links: { other: { many: false, projection: {} } },
      };
      return [person];
    }, resolve);
    const [value] = await projector.project(
      [card('root', {}, { person: link('./person') })],
      shape,
    );
    assert.deepEqual(value.person, {
      id: realm + 'person',
      name: 'Synthetic person',
    });
  });

  test('cyclic or excessive projection declarations fail before reading records', async (assert) => {
    const projector = new LatticeDataProjector(async () => {
      throw new Error('Unexpected data read');
    }, resolve);
    const recursive: LatticeDataProjection = {};
    recursive.links = { next: { many: false, projection: recursive } };
    await assert.rejects(
      projector.project([card('root')], recursive),
      /oversized Lattice data projection/,
    );
  });
});
