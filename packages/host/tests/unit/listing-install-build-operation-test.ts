import { module, test } from 'qunit';

import { rri } from '@cardstack/runtime-common';
import type { CopyInstanceMeta } from '@cardstack/runtime-common/catalog';

import { buildInstanceOperation } from '@cardstack/host/commands/listing-install';

const realmIdentifier = 'https://localhost:4201/experiments/';

function copyMeta(lid: string): CopyInstanceMeta {
  return {
    sourceCard: { id: `https://localhost:4201/catalog/${lid}` } as any,
    lid,
    targetCodeRef: {
      module: rri('https://localhost:4201/experiments/example'),
      name: 'Example',
    },
  };
}

module('Unit | Catalog | listing-install buildInstanceOperation', function () {
  test('returns undefined for file-meta documents so they do not reach the atomic batch', function (assert) {
    let fileMetaDoc = {
      data: {
        type: 'file-meta',
        id: 'https://localhost:4201/catalog/listing/avatar.jpg',
        attributes: {
          name: 'avatar.jpg',
          contentType: 'image/jpeg',
          contentHash: 'abc123',
          contentSize: 1024,
        },
      },
    };

    let result = buildInstanceOperation(
      fileMetaDoc,
      copyMeta('listing-xyz/avatar.jpg'),
      realmIdentifier,
    );

    assert.strictEqual(
      result,
      undefined,
      'file-meta documents are filtered out',
    );
  });

  test('returns an add operation for card documents', function (assert) {
    let cardDoc = {
      data: {
        type: 'card',
        id: 'https://localhost:4201/catalog/listing/Person/alice',
        attributes: { name: 'Alice' },
        meta: { adoptsFrom: { module: './person', name: 'Person' } },
      },
    };

    let result = buildInstanceOperation(
      cardDoc,
      copyMeta('listing-xyz/Person/alice'),
      realmIdentifier,
    );

    assert.ok(result, 'card document produces an operation');
    assert.strictEqual(result!.op, 'add');
    assert.strictEqual(
      result!.href,
      'https://localhost:4201/experiments/listing-xyz/Person/alice.json',
    );
    assert.strictEqual(
      result!.data.type,
      'card',
      'data.type is preserved as card',
    );
    assert.strictEqual(
      (result!.data as any).id,
      undefined,
      'source id is stripped from the card resource',
    );
  });

  test('strips included resources from the card document before producing the operation', function (assert) {
    let cardDoc = {
      data: {
        type: 'card',
        id: 'https://localhost:4201/catalog/listing/Person/bob',
        attributes: { name: 'Bob' },
        meta: { adoptsFrom: { module: './person', name: 'Person' } },
      },
      included: [{ type: 'card', id: 'irrelevant' }],
    };

    let result = buildInstanceOperation(
      cardDoc,
      copyMeta('listing-xyz/Person/bob'),
      realmIdentifier,
    );

    assert.ok(result);
    assert.strictEqual(
      (cardDoc as any).included,
      undefined,
      'included is stripped',
    );
  });

  test('throws when the document is missing a data property', function (assert) {
    assert.throws(
      () =>
        buildInstanceOperation(
          {} as unknown,
          copyMeta('listing-xyz/something'),
          realmIdentifier,
        ),
      /We are only expecting single documents returned/,
    );
  });
});
