import { module, test } from 'qunit';

import {
  Deferred,
  registerCardReferencePrefix,
  unregisterCardReferencePrefix,
  type SingleCardDocument,
  type SingleFileMetaDocument,
} from '@cardstack/runtime-common';

import { CardStoreWithErrors } from '@cardstack/host/services/render-service';

import type { CardDef } from '@cardstack/base/card-api';
import type { FileDef } from '@cardstack/base/file-api';

const prefix = '@test-prefix/';
const targetRealm = 'http://test-realm/test/';

function fetchInputURL(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof Request) {
    return input.url;
  }
  return input.href;
}

module('Unit | Service | render-service', function (hooks) {
  hooks.beforeEach(function () {
    registerCardReferencePrefix(prefix, targetRealm);
  });

  hooks.afterEach(function () {
    unregisterCardReferencePrefix(prefix);
  });

  test('CardStoreWithErrors resolves registered prefix ids for card and file lookups', function (assert) {
    let store = new CardStoreWithErrors(globalThis.fetch);
    let card = {} as CardDef;
    let file = {} as FileDef;

    store.setCard(`${prefix}Person/hassan`, card);
    store.setFileMeta(`${prefix}hero.png`, file);

    assert.strictEqual(
      store.getCard(`${targetRealm}Person/hassan`),
      card,
      'card lookup shares storage between prefix and resolved ids',
    );
    assert.strictEqual(
      store.getFileMeta(`${targetRealm}hero.png`),
      file,
      'file-meta lookup shares storage between prefix and resolved ids',
    );
  });

  test('CardStoreWithErrors resolves prefix ids before loading card documents', async function (assert) {
    let fetchDeferred = new Deferred<Response>();
    let fetchCalls: string[] = [];
    let fetch = ((input: string | URL | Request) => {
      fetchCalls.push(fetchInputURL(input));
      return fetchDeferred.promise;
    }) as typeof globalThis.fetch;
    let store = new CardStoreWithErrors(fetch);

    let firstLoad = store.loadCardDocument(`${prefix}Person/hassan`);
    let secondLoad = store.loadCardDocument(`${targetRealm}Person/hassan`);

    assert.deepEqual(
      fetchCalls,
      [`${targetRealm}Person/hassan.json?noCache=true`],
      'prefix and resolved ids share one fetch request',
    );

    let doc: SingleCardDocument = {
      data: {
        type: 'card',
        meta: {
          adoptsFrom: {
            module: '@cardstack/base/card-api',
            name: 'CardDef',
          },
        },
      },
    };
    fetchDeferred.fulfill(
      new Response(JSON.stringify(doc), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    let [prefixDoc, resolvedDoc] = await Promise.all([firstLoad, secondLoad]);
    if (!('data' in prefixDoc)) {
      throw new Error('expected prefix load to return a card document');
    }
    if (!('data' in resolvedDoc)) {
      throw new Error('expected resolved load to return a card document');
    }

    assert.strictEqual(
      prefixDoc.data.id,
      `${targetRealm}Person/hassan`,
      'loaded card document is normalized to the resolved URL',
    );
    assert.strictEqual(
      resolvedDoc.data.id,
      `${targetRealm}Person/hassan`,
      'resolved load returns the same normalized card document',
    );
  });

  test('CardStoreWithErrors resolves prefix ids before loading file-meta documents', async function (assert) {
    let fetchDeferred = new Deferred<Response>();
    let fetchCalls: string[] = [];
    let fetch = ((input: string | URL | Request) => {
      fetchCalls.push(fetchInputURL(input));
      return fetchDeferred.promise;
    }) as typeof globalThis.fetch;
    let store = new CardStoreWithErrors(fetch);

    let firstLoad = store.loadFileMetaDocument(`${prefix}hero.png`);
    let secondLoad = store.loadFileMetaDocument(`${targetRealm}hero.png`);

    assert.deepEqual(
      fetchCalls,
      [`${targetRealm}hero.png?noCache=true`],
      'prefix and resolved file-meta ids share one fetch request',
    );

    let doc: SingleFileMetaDocument = {
      data: {
        type: 'file-meta',
        meta: {
          adoptsFrom: {
            module: '@cardstack/base/file-api',
            name: 'FileDef',
          },
        },
      },
    };
    fetchDeferred.fulfill(
      new Response(JSON.stringify(doc), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    let [prefixDoc, resolvedDoc] = await Promise.all([firstLoad, secondLoad]);
    if (!('data' in prefixDoc)) {
      throw new Error('expected prefix load to return a file-meta document');
    }
    if (!('data' in resolvedDoc)) {
      throw new Error('expected resolved load to return a file-meta document');
    }

    assert.strictEqual(
      prefixDoc.data.id,
      `${targetRealm}hero.png`,
      'loaded file-meta document is normalized to the resolved URL',
    );
    assert.strictEqual(
      resolvedDoc.data.id,
      `${targetRealm}hero.png`,
      'resolved load returns the same normalized file-meta document',
    );
  });
});
