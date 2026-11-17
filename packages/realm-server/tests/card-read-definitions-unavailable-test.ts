import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Response } from 'supertest';
import { basename, join } from 'path';
import fsExtra from 'fs-extra';
const { writeFileSync } = fsExtra;
import { rri, type Realm } from '@cardstack/runtime-common';
import { requestDefinitionLookup } from '@cardstack/runtime-common/card-operations';
import { FilterRefersToNonexistentTypeError } from '@cardstack/runtime-common/definition-lookup';
import { DEFINITIONS_UNAVAILABLE_RETRY_AFTER_SECONDS } from '@cardstack/runtime-common/search-bounds';
import {
  setupPermissionedRealmsCached,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';

// A card read whose type's definition cannot be read just now — its module's
// prerender timed out or the prerenderer was unavailable, as happens to every
// first lookup after a realm server restarts — says nothing about the card.
// It is answered as the retryable 503 a search gets (`definitions-unavailable`,
// with `Retry-After`), never as the 404 that says the card has not finished
// indexing. A realm side-loading such a card as a cross-realm link passes the
// 503 on rather than reporting its own card as not found. A link that is
// genuinely missing, and a card that is genuinely unindexed, keep their 404s.

const providerRealmURL = 'http://127.0.0.1:5541/test/';
const consumerRealmURL = 'http://127.0.0.1:5542/test/';

// A card source written straight to disk, so the realm has no index row for it.
const UNINDEXED_MODEL = {
  data: {
    type: 'card',
    attributes: { cardTitle: 'Pending' },
    meta: { adoptsFrom: { module: './model', name: 'Model' } },
  },
};

function adoptsFrom(module: string, name: string) {
  return { adoptsFrom: { module: rri(module), name } };
}

function linking(path: string) {
  return {
    data: {
      attributes: { cardTitle: `links ${path}` },
      relationships: {
        model: { links: { self: `${providerRealmURL}${path}` } },
      },
      meta: adoptsFrom('./holder', 'Holder'),
    },
  };
}

module(basename(import.meta.filename), function (hooks) {
  let provider: Realm;
  let providerPath: string;
  let providerRequest: RealmRequest;
  let consumerRequest: RealmRequest;
  let restore: (() => void) | undefined;

  setupPermissionedRealmsCached(hooks, {
    realms: [
      {
        realmURL: providerRealmURL,
        permissions: {
          '*': ['read', 'write', 'realm-owner'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        fileSystem: {
          'model.gts': `
            import { CardDef, field, contains } from "@cardstack/base/card-api";
            import StringField from "@cardstack/base/string";

            export class Model extends CardDef {
              @field cardTitle = contains(StringField);
            }
          `,
          'model-1.json': {
            data: {
              attributes: { cardTitle: 'Model 1' },
              meta: adoptsFrom('./model', 'Model'),
            },
          },
        },
      },
      {
        realmURL: consumerRealmURL,
        permissions: {
          '*': ['read', 'write', 'realm-owner'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        fileSystem: {
          'holder.gts': `
            import { CardDef, field, contains, linksTo } from "@cardstack/base/card-api";
            import StringField from "@cardstack/base/string";

            export class Holder extends CardDef {
              @field cardTitle = contains(StringField);
              @field model = linksTo(CardDef);
            }
          `,
          'holds-model.json': linking('model-1'),
          'holds-missing.json': linking('no-such-model'),
          'holds-unindexed.json': linking('unindexed-model'),
        },
      },
    ],
    onRealmSetup({ realms }) {
      let [providerFixture, consumerFixture] = realms.slice(-2);
      provider = providerFixture.realm;
      providerPath = providerFixture.realmPath;
      providerRequest = withRealmPath(
        supertest(providerFixture.realmHttpServer),
        new URL(providerRealmURL),
      );
      consumerRequest = withRealmPath(
        supertest(consumerFixture.realmHttpServer),
        new URL(consumerRealmURL),
      );
    },
  });

  hooks.afterEach(function () {
    restore?.();
    restore = undefined;
    resetCatalogRealms();
  });

  // Makes the provider realm's lookups of `Model` fail as the realm's own
  // lookup does when the module's prerender timed out, until the returned
  // `recover` is called. The failure enters beneath the request path's
  // lookup, where the realm's lookup raises it.
  function failModelLookups(): { recover: () => void } {
    // The realm hands its operation core the request path's lookup, which
    // refuses rather than answering undefined.
    let lookup = provider.operationCore.definitionLookup as ReturnType<
      typeof requestDefinitionLookup
    >;
    let original = {
      lookupDefinition: lookup.lookupDefinition,
      lookupDefinitionEntry: lookup.lookupDefinitionEntry,
    };
    let failing = true;
    let fails = (codeRef: { name: string }) =>
      failing && codeRef.name === 'Model';
    let failingLookup = requestDefinitionLookup({
      lookupDefinition: async (codeRef) => {
        if (fails(codeRef)) {
          throw new FilterRefersToNonexistentTypeError(codeRef, {
            transient: true,
          });
        }
        return await original.lookupDefinition.call(lookup, codeRef);
      },
      lookupDefinitionEntry: async (codeRef) => {
        if (fails(codeRef)) {
          throw new FilterRefersToNonexistentTypeError(codeRef, {
            transient: true,
          });
        }
        return await original.lookupDefinitionEntry.call(lookup, codeRef);
      },
    });
    lookup.lookupDefinition = failingLookup.lookupDefinition;
    lookup.lookupDefinitionEntry = failingLookup.lookupDefinitionEntry;
    restore = () => {
      lookup.lookupDefinition = original.lookupDefinition;
      lookup.lookupDefinitionEntry = original.lookupDefinitionEntry;
    };
    return {
      recover: () => {
        failing = false;
      },
    };
  }

  function assertDefinitionsUnavailable(assert: Assert, response: Response) {
    assert.strictEqual(response.status, 503, `HTTP 503: ${response.text}`);
    assert.strictEqual(
      response.headers['retry-after'],
      String(DEFINITIONS_UNAVAILABLE_RETRY_AFTER_SECONDS),
      'says when to retry',
    );
    assert.strictEqual(
      response.body.errors?.[0]?.meta?.code,
      'definitions-unavailable',
    );
    assert.notOk(
      response.body.errors?.[0]?.awaitingIndex,
      'not told the card is awaiting indexing',
    );
  }

  test('a card whose type definition cannot be read just now answers 503, then serves once it can', async function (assert) {
    let { recover } = failModelLookups();
    let refused = await providerRequest
      .get('/model-1')
      .set('Accept', 'application/vnd.card+json');
    assertDefinitionsUnavailable(assert, refused);

    let conditional = await providerRequest
      .get('/model-1')
      .set('Accept', 'application/vnd.card+json')
      .set('If-None-Match', '"stale-etag"');
    assertDefinitionsUnavailable(assert, conditional);

    recover();
    let served = await providerRequest
      .get('/model-1')
      .set('Accept', 'application/vnd.card+json');
    assert.strictEqual(served.status, 200, `HTTP 200: ${served.text}`);
    assert.strictEqual(served.body.data.attributes.cardTitle, 'Model 1');
  });

  test('a card whose cross-realm link cannot be read just now answers 503, not 404', async function (assert) {
    let { recover } = failModelLookups();
    let refused = await consumerRequest
      .get('/holds-model')
      .set('Accept', 'application/vnd.card+json');
    assertDefinitionsUnavailable(assert, refused);

    recover();
    let served = await consumerRequest
      .get('/holds-model')
      .set('Accept', 'application/vnd.card+json');
    assert.strictEqual(served.status, 200, `HTTP 200: ${served.text}`);
    let linked = (served.body.included ?? []).find(
      (resource: { id: string }) =>
        resource.id === `${providerRealmURL}model-1`,
    );
    assert.strictEqual(linked?.attributes?.cardTitle, 'Model 1');
  });

  test('a card that is not there, or not indexed yet, keeps its 404', async function (assert) {
    writeFileSync(
      join(providerPath, 'unindexed-model.json'),
      JSON.stringify(UNINDEXED_MODEL),
    );

    let missing = await providerRequest
      .get('/no-such-model')
      .set('Accept', 'application/vnd.card+json');
    assert.strictEqual(missing.status, 404, `HTTP 404: ${missing.text}`);
    assert.strictEqual(missing.body.errors?.[0]?.awaitingIndex, undefined);

    let unindexed = await providerRequest
      .get('/unindexed-model')
      .set('Accept', 'application/vnd.card+json');
    assert.strictEqual(unindexed.status, 404, `HTTP 404: ${unindexed.text}`);
    assert.true(unindexed.body.errors?.[0]?.awaitingIndex);
  });

  test('a link to a card that is not there, or not indexed yet, is answered as before', async function (assert) {
    writeFileSync(
      join(providerPath, 'unindexed-model.json'),
      JSON.stringify(UNINDEXED_MODEL),
    );
    for (let path of ['/holds-missing', '/holds-unindexed']) {
      let response = await consumerRequest
        .get(path)
        .set('Accept', 'application/vnd.card+json');
      assert.notStrictEqual(
        response.status,
        503,
        `${path} is not told to retry: ${response.status} ${response.text}`,
      );
      assert.strictEqual(
        response.headers['retry-after'],
        undefined,
        `${path} carries no Retry-After`,
      );
    }
  });
});
