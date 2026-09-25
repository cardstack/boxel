import { module, test } from 'qunit';

import { takesFileDeleteRoute } from '@cardstack/host/lib/stack-item';

import type { CardDef, FileDef } from '@cardstack/base/card-api';

// A store stub whose only job is to say which ids it holds a file-meta row for.
function storeHolding(...fileMetaIds: string[]) {
  return {
    peek(id: string, opts?: { type?: 'card' | 'file-meta' }) {
      if (opts?.type === 'file-meta' && fileMetaIds.includes(id)) {
        return {} as FileDef;
      }
      return undefined;
    },
    peekError() {
      return undefined;
    },
  } as unknown as Parameters<typeof takesFileDeleteRoute>[2];
}

module('Unit | delete route', function () {
  test('a file id takes the file route', function (assert) {
    let id = 'http://test-realm/test/notes.txt';
    assert.true(takesFileDeleteRoute(undefined, id, storeHolding(id)));
  });

  test('a `.json` id keeps the card route even when the store holds it as a file', function (assert) {
    // `…/Person/1.json` is a card's own storage as readily as it is a standalone
    // file. The source DELETE the file route issues would remove the bytes the
    // card lives in while none of the card cleanup runs.
    let id = 'http://test-realm/test/Person/1.json';
    assert.false(takesFileDeleteRoute(undefined, id, storeHolding(id)));
  });

  test('a card id takes the card route', function (assert) {
    let id = 'http://test-realm/test/Person/1';
    assert.false(takesFileDeleteRoute(undefined, id, storeHolding()));
  });

  test('a card instance takes the card route whatever its id looks like', function (assert) {
    let instance = { id: 'http://test-realm/test/Person/1' } as CardDef;
    assert.false(
      takesFileDeleteRoute(instance, instance.id, storeHolding(instance.id!)),
    );
  });
});
