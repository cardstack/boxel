import QUnit from 'qunit';
import { rri } from '@cardstack/runtime-common/realm-identifiers';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';
import {
  parseRenderRouteOptions,
  serializeRenderRouteOptions,
} from '@cardstack/runtime-common';
import {
  createLatticeRenderCheckpoint,
  validateLatticeRenderCheckpoint,
  currentLatticeRenderCheckpoint,
} from '@cardstack/runtime-common/lattice-render-checkpoint';

const { module, test } = QUnit;
const realmURL = 'http://example.com/lattice/';
const id = `${realmURL}Day/one`;
function document(): LooseSingleCardDocument {
  return {
    data: {
      id,
      type: 'card',
      attributes: { count: 7 },
      meta: {
        adoptsFrom: { module: rri('../day'), name: 'Day' },
        publication: {
          version: 1,
          state: 'ready',
          validatedThrough: 1,
          outputRevision: 2,
          definitionRevision: 'code-1',
          computedFields: ['count'],
          queryFields: [],
          watches: [],
        },
      },
    },
  };
}
module('lattice-render-checkpoint', function () {
  test('only an explicit producer route opts in to the checkpoint', function (assert) {
    assert.deepEqual(
      parseRenderRouteOptions(
        serializeRenderRouteOptions({
          cardRender: true,
          latticeRenderCheckpoint: true,
        }),
      ),
      { cardRender: true, latticeRenderCheckpoint: true },
    );
    assert.strictEqual(
      parseRenderRouteOptions('{}').latticeRenderCheckpoint,
      undefined,
    );
    assert.strictEqual(
      parseRenderRouteOptions('{"latticeRenderCheckpoint":"true"}')
        .latticeRenderCheckpoint,
      undefined,
    );
  });
  test('producer input binds document bytes, owner, publication and definition epoch', async function (assert) {
    let checkpoint = await createLatticeRenderCheckpoint(document(), realmURL);
    let receipt = await validateLatticeRenderCheckpoint(checkpoint, {
      id: `${id}.json`,
      realmURL,
      loaderEpoch: 'code-1',
    });
    assert.deepEqual(receipt, {
      version: 1,
      id,
      realmURL,
      documentHash: checkpoint.documentHash,
      publishedGeneration: 2,
      definitionRevision: 'code-1',
    });
    assert.strictEqual(checkpoint.document.data.attributes?.count, 7);
  });
  test('wrong owner, realm, loader timeline and mutated bytes are rejected', async function (assert) {
    let checkpoint = await createLatticeRenderCheckpoint(document(), realmURL);
    for (let expected of [
      { id: `${realmURL}Day/two`, realmURL, loaderEpoch: 'code-1' },
      { id, realmURL: 'http://other.example/', loaderEpoch: 'code-1' },
      { id, realmURL, loaderEpoch: 'code-2' },
      { id, realmURL },
    ])
      await assert.rejects(
        validateLatticeRenderCheckpoint(checkpoint, expected),
      );
    checkpoint.document.data.attributes!.count = 8;
    await assert.rejects(
      validateLatticeRenderCheckpoint(checkpoint, {
        id,
        realmURL,
        loaderEpoch: 'code-1',
      }),
      /digest mismatch/,
    );
  });
  test('pending or authored data cannot become a published checkpoint', async function (assert) {
    let pending = document();
    pending.data.meta.publication!.state = 'pending';
    await assert.rejects(
      createLatticeRenderCheckpoint(pending, realmURL),
      /pending or has invalid provenance/,
    );
    delete pending.data.meta.publication;
    await assert.rejects(
      createLatticeRenderCheckpoint(pending, realmURL),
      /requires a published materialization/,
    );
    await assert.rejects(
      createLatticeRenderCheckpoint(
        document(),
        'http://example.com/elsewhere/',
      ),
      /owner and realm/,
    );
  });
  test('ordinary browser code cannot opt into the producer global', async function (assert) {
    let globals = globalThis as any;
    let priorContext = globals.__boxelRenderContext,
      priorInput = globals.__latticeRenderCheckpoint;
    try {
      globals.__latticeRenderCheckpoint = await createLatticeRenderCheckpoint(
        document(),
        realmURL,
      );
      globals.__boxelRenderContext = false;
      assert.strictEqual(currentLatticeRenderCheckpoint(), undefined);
      globals.__boxelRenderContext = true;
      assert.strictEqual(
        currentLatticeRenderCheckpoint(),
        globals.__latticeRenderCheckpoint,
      );
    } finally {
      globals.__boxelRenderContext = priorContext;
      globals.__latticeRenderCheckpoint = priorInput;
    }
  });
});
