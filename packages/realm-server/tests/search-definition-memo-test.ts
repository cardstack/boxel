import QUnit from 'qunit';
import {
  Deferred,
  rri,
  type ModuleDefinitionResult,
} from '@cardstack/runtime-common';
import {
  MAX_SEARCH_DEFINITIONS,
  memoizeSearchDefinitions,
  withSearchDefinitionMemo,
} from '../lib/search-definition-memo.ts';

const { module, test } = QUnit;

function ref(name: string) {
  return { module: rri('https://example.com/person'), name };
}

function fixture() {
  let reads = 0;
  let generation = 0;
  let fail = false;
  let source = {
    async lookupDefinitionEntry(
      codeRef: ReturnType<typeof ref>,
    ): Promise<ModuleDefinitionResult> {
      reads++;
      if (fail) {
        fail = false;
        throw new Error('temporary lookup failure');
      }
      return {
        type: 'definition',
        moduleURL: codeRef.module,
        definition: {
          type: 'card-def',
          codeRef,
          displayName: codeRef.name,
          fields: {},
          fieldDefs: {},
        },
        types: [],
      };
    },
    async lookupDefinition(codeRef: ReturnType<typeof ref>) {
      return (await this.lookupDefinitionEntry(codeRef)).definition;
    },
    definitionGeneration: () => generation,
  };
  return {
    source,
    lookup: memoizeSearchDefinitions(source),
    reads: () => reads,
    invalidate: () => generation++,
    failNext: () => (fail = true),
  };
}

module('search definition memo', function () {
  test('caps entries across realm lookups and reads through at capacity', async function (assert) {
    let { source, lookup, reads } = fixture();
    let otherRealm = memoizeSearchDefinitions(source);
    let finished = new Deferred<void>();
    let lateRead: Promise<unknown> | undefined;
    await withSearchDefinitionMemo(async () => {
      for (let index = 0; index < MAX_SEARCH_DEFINITIONS; index++) {
        let realm = index % 2 === 0 ? lookup : otherRealm;
        await realm.lookupDefinition(ref(String(Math.floor(index / 2))));
      }
      await lookup.lookupDefinition(ref('0'));
      assert.strictEqual(reads(), MAX_SEARCH_DEFINITIONS, 'retained key hits');

      let overflow = ref('overflow');
      let first = await otherRealm.lookupDefinition(overflow);
      let second = await otherRealm.lookupDefinition(overflow);
      assert.deepEqual(first, second, 'overflow still returns the definition');
      assert.strictEqual(
        reads(),
        MAX_SEARCH_DEFINITIONS + 2,
        'overflow is not retained',
      );
      lateRead = finished.promise.then(() => lookup.lookupDefinition(ref('0')));
    });
    finished.fulfill();
    await lateRead;
    assert.strictEqual(reads(), MAX_SEARCH_DEFINITIONS + 3, 'scope has ended');
  });

  test('coalesces pending reads within each concurrent request', async function (assert) {
    let { lookup, reads } = fixture();
    let codeRef = ref('Person');
    await Promise.all(
      Array.from({ length: 2 }, () =>
        withSearchDefinitionMemo(async () => {
          let [definition, entry] = await Promise.all([
            lookup.lookupDefinition(codeRef),
            lookup.lookupDefinitionEntry(codeRef),
          ]);
          assert.strictEqual(definition, entry.definition);
        }),
      ),
    );
    assert.strictEqual(reads(), 2);
  });

  test('a caller joining a memoized read waits through the shared-work hook', async function (assert) {
    let { source, reads } = fixture();
    let waits = 0;
    let lookup = memoizeSearchDefinitions(source, (fn) => {
      waits++;
      return fn();
    });
    let codeRef = ref('Person');
    await withSearchDefinitionMemo(async () => {
      let [first, second] = await Promise.all([
        lookup.lookupDefinitionEntry(codeRef),
        lookup.lookupDefinitionEntry(codeRef),
      ]);
      assert.strictEqual(first, second);
    });
    assert.strictEqual(reads(), 1, 'the second caller joined the first read');
    assert.strictEqual(waits, 1, 'only the joiner is marked as waiting');
  });

  test('retries failures and reads afresh after invalidation', async function (assert) {
    let { lookup, reads, failNext, invalidate } = fixture();
    let codeRef = ref('Person');
    await withSearchDefinitionMemo(async () => {
      failNext();
      await assert.rejects(
        lookup.lookupDefinition(codeRef),
        /temporary lookup failure/,
      );
      let first = await lookup.lookupDefinition(codeRef);
      invalidate();
      let second = await lookup.lookupDefinition(codeRef);
      assert.notStrictEqual(first, second);
      assert.strictEqual(await lookup.lookupDefinition(codeRef), second);
      assert.strictEqual(reads(), 3);
    });
  });
});
