import QUnit from 'qunit';
import { basename } from 'node:path';
import { analyzeLatticeGtsSource } from '@cardstack/runtime-common/lattice-gts-analysis';
import {
  linkLatticeGtsDefinition,
  type LatticeGtsLinkInput,
} from '@cardstack/runtime-common/lattice-gts-link';

const { module, test } = QUnit;
const origin = 'https://lattice-link.example/';
const base = '@cardstack/base/card-api';
const imports = `import { CardDef, FieldDef, contains, field, NumberField } from '${base}';`;

function source(path: string, text: string): LatticeGtsLinkInput {
  const analysis = analyzeLatticeGtsSource(new URL(path, origin).href, text);
  // The linker sees serialized file-owned facts, never source or AST objects.
  return JSON.parse(
    JSON.stringify({
      kind: 'source',
      analysis,
      currentSourceRevision: analysis.sourceRevision,
    }),
  );
}

function fixture(entries: Record<string, string>) {
  const files = new Map<string, LatticeGtsLinkInput>([
    [
      base,
      {
        kind: 'trusted',
        fileId: `${origin}base/card-api.gts`,
        revision: 'reviewed-base-v1',
        exports: [
          'CardDef',
          'FieldDef',
          'contains',
          'field',
          'NumberField',
          'linksToMany',
        ],
      },
    ],
    [
      '@cardstack/bxl',
      {
        kind: 'trusted',
        fileId: `${origin}runtime/bxl`,
        revision: 'official-compiler-v1',
        exports: ['bxl'],
      },
    ],
  ]);
  for (const [path, text] of Object.entries(entries))
    files.set(new URL(path, origin).href, source(path, text));
  const reads: string[] = [];
  return {
    files,
    reads,
    link(
      name = 'Counter',
      path = 'counter.gts',
      runtimeRevision = 'runtime-1',
    ) {
      return linkLatticeGtsDefinition({
        root: files.get(new URL(path, origin).href)!,
        name,
        runtimeRevision,
        read: async (specifier, relativeTo) => {
          // Like the code worker: an extensionless module is its .gts file.
          const resolved = specifier.startsWith('@')
            ? specifier
            : new URL(specifier, relativeTo).href;
          const id =
            resolved.startsWith('@') || /\.(gts|ts|js|gjs)$/.test(resolved)
              ? resolved
              : `${resolved}.gts`;
          reads.push(id);
          return files.get(id);
        },
      });
    },
  };
}

module(basename(import.meta.filename), function () {
  test('data identity survives a current template edit while source fences still reject stale analysis', async function (assert) {
    const text = `${imports}
import { bxl } from '@cardstack/bxl';
export class Counter extends CardDef {
  @field amount = contains(NumberField);
  @field doubled = contains(NumberField, {computeVia: bxl('.amount * 2', {readableSyntax: false})});
  static isolated = <template><div>{{@model.doubled}}</div></template>;
}`;
    const lab = fixture({ 'counter.gts': text });
    const before = await lab.link();
    const edited = source(
      'counter.gts',
      text.replace(
        '<div>{{@model.doubled}}</div>',
        '<h1>{{@model.doubled}}</h1><style scoped>h1 { color: red; }</style>',
      ),
    );
    lab.files.set(`${origin}counter.gts`, edited);
    const after = await lab.link();
    assert.strictEqual(after.state, 'requires-admission');
    assert.strictEqual(
      after.fingerprint,
      before.fingerprint,
      'materialized data identity is retained',
    );
    assert.notDeepEqual(
      after.files,
      before.files,
      'rendering and byte provenance see the new source',
    );
    if (edited.kind !== 'source') throw new Error('expected analyzed source');
    edited.currentSourceRevision = {
      ...edited.currentSourceRevision,
      digest: 'newer-bytes',
    };
    assert.strictEqual(
      (await lab.link()).state,
      'blocked',
      'semantic equality never bypasses source freshness',
    );
    lab.files.set(
      `${origin}counter.gts`,
      source('counter.gts', text.replace('.amount * 2', '.amount * 3')),
    );
    assert.notStrictEqual(
      (await lab.link()).fingerprint,
      before.fingerprint,
      'changed computation invalidates data',
    );
  });

  test('unknown JavaScript retains byte invalidation even for a template edit', async function (assert) {
    const text = `${imports}
export class Counter extends CardDef {
  @field amount = contains(NumberField, {computeVia: function () { return this.constructor.isolated.toString().length; }});
  static isolated = <template>old</template>;
}`;
    const lab = fixture({ 'counter.gts': text });
    const before = await lab.link();
    assert.strictEqual(before.state, 'chrome-data');
    lab.files.set(
      `${origin}counter.gts`,
      source('counter.gts', text.replace('>old<', '>changed<')),
    );
    assert.notStrictEqual(
      (await lab.link()).fingerprint,
      before.fingerprint,
      'unknown code can inspect its template',
    );
  });

  test('one source receipt is reusable by instances and unaffected by unrelated files', async function (assert) {
    const lab = fixture({
      'counter.gts': `${imports}
import { bxl } from '@cardstack/bxl';
export class Counter extends CardDef {
  @field amount = contains(NumberField);
  @field doubled = contains(NumberField, {computeVia: bxl('.amount * 2', {readableSyntax: false})});
  static isolated = <template>{{@model.doubled}}</template>;
}`,
      'unrelated.gts': 'throw new Error("never execute me");',
    });
    const receipt = await lab.link();
    assert.strictEqual(
      receipt.state,
      'requires-admission',
      JSON.stringify(receipt.diagnostics),
    );
    assert.strictEqual(receipt.files.length, 3);
    assert.false(lab.reads.includes(`${origin}unrelated.gts`));
    lab.files.set(
      `${origin}unrelated.gts`,
      source('unrelated.gts', 'throw new Error("edited");'),
    );
    assert.deepEqual(
      await lab.link(),
      receipt,
      'unrelated edits do not change the exported definition receipt',
    );
    assert.notStrictEqual(
      (await lab.link('Counter', 'counter.gts', 'runtime-2')).fingerprint,
      receipt.fingerprint,
    );
    assert.deepEqual(JSON.parse(JSON.stringify(receipt)), receipt);
  });

  test('resolves inherited and contained definitions through aliases, default and star barrels', async function (assert) {
    const lab = fixture({
      'counter.gts': `${imports}
import Parent from './barrel.gts';
import { Value } from './barrel.gts';
export class Counter extends Parent { @field value = contains(Value); }`,
      'barrel.gts': `export { Parent as default } from './parent.gts'; export * from './values.gts';`,
      'parent.gts': `${imports} export class Parent extends CardDef { @field total = contains(NumberField); }`,
      'values.gts': `${imports} class Local extends FieldDef { @field score = contains(NumberField); } export { Local as Value };`,
    });
    const before = await lab.link();
    assert.strictEqual(
      before.state,
      'requires-admission',
      JSON.stringify(before.diagnostics),
    );
    assert.true(
      before.definitions.some((item) => item.fileId.endsWith('/values.gts')),
    );
    assert.strictEqual(before.files.length, 5);
    lab.files.set(
      `${origin}values.gts`,
      source(
        'values.gts',
        `${imports} class Local extends FieldDef { @field score = contains(NumberField); @field extra = contains(NumberField); } export { Local as Value };`,
      ),
    );
    const after = await lab.link();
    assert.notStrictEqual(
      before.fingerprint,
      after.fingerprint,
      'a leaf definition edit changes its consumers receipt',
    );
    lab.files.set(
      `${origin}parent.gts`,
      source(
        'parent.gts',
        `${imports} export class Parent extends CardDef { constructor() { throw new Error('Chrome owns this'); } }`,
      ),
    );
    const incompatible = await lab.link();
    assert.strictEqual(
      incompatible.state,
      'chrome-data',
      JSON.stringify(incompatible.diagnostics),
    );
    assert.true(
      incompatible.diagnostics.some(
        (item) =>
          item.code === 'custom-class-behavior' &&
          item.fileId.endsWith('/parent.gts'),
      ),
    );
  });

  test('retains side-effect imports but prunes erased type-only imports', async function (assert) {
    const lab = fixture({
      'counter.gts': `${imports}
import { type Ignore } from './types.gts';
export type { AlsoIgnore } from './missing-types.gts';
import './registration.gts';
export class Counter extends CardDef {}`,
      'registration.gts': `export { NumberField } from '${base}'; throw new Error('must never execute');`,
    });
    const receipt = await lab.link();
    assert.strictEqual(
      receipt.state,
      'chrome-data',
      JSON.stringify(receipt.diagnostics),
    );
    assert.false(lab.reads.some((item) => item.endsWith('types.gts')));
    assert.true(
      receipt.diagnostics.some(
        (item) =>
          item.fileId.endsWith('registration.gts') &&
          item.code === 'module-runtime-initialization',
      ),
    );
  });

  test('a mixed module preserves per-export classification', async function (assert) {
    const lab = fixture({
      'counter.gts': `${imports}
export class Counter extends CardDef {}
export class Custom extends CardDef { @field amount = contains(NumberField, {computeVia: function () { return Math.random(); }}); }`,
    });
    assert.strictEqual((await lab.link()).state, 'requires-admission');
    assert.strictEqual((await lab.link('Custom')).state, 'chrome-data');
  });

  test('missing, stale, blocked and old analyzer artifacts cannot produce a current receipt', async function (assert) {
    const lab = fixture({
      'counter.gts': `import { Parent } from './parent.gts'; export class Counter extends Parent {}`,
      'parent.gts': `${imports} export class Parent extends CardDef {}`,
    });
    const current = lab.files.get(`${origin}parent.gts`)!;
    if (current.kind !== 'source') throw new Error('expected source');
    lab.files.delete(`${origin}parent.gts`);
    assert.strictEqual((await lab.link()).state, 'blocked');
    lab.files.set(`${origin}parent.gts`, {
      ...current,
      currentSourceRevision: {
        ...current.currentSourceRevision,
        digest: 'new-source',
      },
    });
    assert.true(
      (await lab.link()).diagnostics.some(
        (item) => item.code === 'stale-analysis',
      ),
    );
    lab.files.set(`${origin}parent.gts`, {
      ...current,
      analysis: {
        ...current.analysis,
        analyzerRevision: 'lattice-gts-source-v1',
      },
    });
    assert.true(
      (await lab.link()).diagnostics.some(
        (item) => item.code === 'analysis-version',
      ),
    );
    lab.files.set(
      `${origin}parent.gts`,
      source('parent.gts', 'export class Broken extends {'),
    );
    assert.true(
      (await lab.link()).diagnostics.some(
        (item) => item.code === 'blocked-analysis',
      ),
    );
  });

  test('star re-exports follow ESM ambiguity and default rules without recursive expansion', async function (assert) {
    const lab = fixture({
      'counter.gts': `export * from './left.gts'; export * from './right.gts';`,
      'left.gts': `export * from './leaf.gts'; export * from './counter.gts';`,
      'right.gts': `export { Counter } from './leaf.gts';`,
      'leaf.gts': `${imports} export class Counter extends CardDef {} export default Counter;`,
    });
    assert.strictEqual(
      (await lab.link()).state,
      'requires-admission',
      'diamond paths to the same original binding are not ambiguous',
    );
    assert.strictEqual(
      (await lab.link('default')).state,
      'blocked',
      'stars never forward default',
    );
    lab.files.set(
      `${origin}right.gts`,
      source('right.gts', `${imports} export class Counter extends CardDef {}`),
    );
    assert.true(
      (await lab.link()).diagnostics.some(
        (item) => item.code === 'ambiguous-export',
      ),
    );
  });

  test('recursive card relationships are bounded by definition identity', async function (assert) {
    const lab = fixture({
      'counter.gts': `${imports} import { Other } from './other.gts'; export class Counter extends CardDef { @field other = contains(Other); }`,
      'other.gts': `${imports} import { Counter } from './counter.gts'; export class Other extends CardDef { @field counter = contains(Counter); }`,
    });
    const receipt = await lab.link();
    assert.strictEqual(
      receipt.state,
      'requires-admission',
      JSON.stringify(receipt.diagnostics),
    );
    assert.strictEqual(receipt.files.length, 3);
    assert.strictEqual(
      receipt.definitions.filter((item) => !item.fileId.includes('/base/'))
        .length,
      2,
    );
  });

  test('unbounded imports and cancelled work cannot produce usable receipts', async function (assert) {
    const entries: Record<string, string> = {};
    for (let i = 0; i < 65; i++)
      entries[`${i}.gts`] = `import './${i + 1}.gts';`;
    const lab = fixture(entries);
    const result = await lab.link('Counter', '0.gts');
    assert.strictEqual(result.state, 'blocked');
    assert.true(
      result.diagnostics.some((item) => item.message.includes('64 files')),
    );
    const abort = new AbortController();
    abort.abort(new Error('obsolete revision'));
    await assert.rejects(
      linkLatticeGtsDefinition({
        root: source('root.gts', imports),
        name: 'Card',
        runtimeRevision: '1',
        read: async () => undefined,
        signal: abort.signal,
      }),
      /obsolete revision/,
    );
  });

  test('URL aliases cannot join conflicting source snapshots into a receipt', async function (assert) {
    const root = source(
      'counter.gts',
      `import './alias-one'; import './alias-two'; ${imports} export class Counter extends CardDef {}`,
    );
    const before = source('shared.gts', 'export const version = 1;');
    const after = source('shared.gts', 'export const version = 2;');
    const lab = fixture({});
    const result = await linkLatticeGtsDefinition({
      root,
      name: 'Counter',
      runtimeRevision: '1',
      read: async (specifier) =>
        specifier === './alias-one'
          ? before
          : specifier === './alias-two'
            ? after
            : lab.files.get(specifier),
    });
    assert.strictEqual(result.state, 'blocked');
    assert.true(
      result.diagnostics.some((item) => item.code === 'conflicting-receipts'),
    );
  });
  test('a type named only by a literal query is part of the closure and its fingerprint', async function (assert) {
    const post = `import { CardDef, contains, field, NumberField } from '${base}';
export class Post extends CardDef {
  @field likes = contains(NumberField);
  static isolated = <template><div>{{@model.likes}}</div></template>;
}`;
    const board = `import { CardDef, field, linksToMany } from '${base}';
export class Board extends CardDef {
  @field top = linksToMany(CardDef, {
    query: {
      filter: { type: { module: './post', name: 'Post' } },
      sort: [{ by: 'likes', on: { module: './post', name: 'Post' }, direction: 'desc' }],
    },
  });
}`;
    const lab = fixture({ 'post.gts': post, 'board.gts': board });
    const before = await lab.link('Board', 'board.gts');
    assert.strictEqual(
      before.state,
      'requires-admission',
      JSON.stringify(before.diagnostics),
    );
    assert.true(
      before.definitions.some(
        (d) => d.name === 'Post' && d.fileId === `${origin}post.gts`,
      ),
      'the queried type is linked even though board.gts never imports it',
    );
    lab.files.set(
      `${origin}post.gts`,
      source(
        'post.gts',
        post.replace('<div>', '<h1>').replace('</div>', '</h1>'),
      ),
    );
    assert.strictEqual(
      (await lab.link('Board', 'board.gts')).fingerprint,
      before.fingerprint,
      'a template edit to the queried type keeps the querying definition current',
    );
    lab.files.set(
      `${origin}post.gts`,
      source('post.gts', post.replace('@field likes', '@field hearts')),
    );
    assert.notStrictEqual(
      (await lab.link('Board', 'board.gts')).fingerprint,
      before.fingerprint,
      'a data-model change to the queried type changes the querying fingerprint',
    );
  });
});
