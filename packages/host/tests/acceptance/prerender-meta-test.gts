import { visit, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  baseRealmRRI,
  diffDoc,
  type FileExtractResponse,
  type FusedIndexMeta,
  type PrerenderMeta,
  type RenderRouteOptions,
  rri,
} from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  testRRI,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  capturePrerenderResult,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

// The prerender meta route generates the search doc via the searchable-driven
// generator: every relationship is present (an unset link is `null`, a set one
// expands per its `searchable` annotation), and every card carries its base-card
// fields (`cardTheme`, `cardInfo.cardThumbnail`). The expected doc is the exact
// generator output; `diffDoc(..., false)` reports any deviation as a readable
// path-level diff.
function expectMetaSearchDoc(
  assert: Assert,
  actual: Record<string, any> | null | undefined,
  expected: Record<string, any>,
  message?: string,
) {
  assert.deepEqual(
    diffDoc(expected, actual ?? {}, false),
    [],
    message ?? 'search doc is correct',
  );
}

module('Acceptance | prerender | meta', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });

  const DEFAULT_RENDER_OPTIONS_SEGMENT = encodeURIComponent(
    JSON.stringify({ clearCache: true } as RenderRouteOptions),
  );
  const renderPath = (url: string, suffix: string, nonce = 0) =>
    `/render/${encodeURIComponent(
      url,
    )}/${nonce}/${DEFAULT_RENDER_OPTIONS_SEGMENT}${suffix}`;
  const customRenderPath = (
    url: string,
    renderOptions: RenderRouteOptions,
    nonce: number,
  ) =>
    `/render/${encodeURIComponent(url)}/${nonce}/${encodeURIComponent(
      JSON.stringify(renderOptions),
    )}`;

  async function captureFileExtractResult(): Promise<FileExtractResponse> {
    await waitUntil(
      () => {
        let status = document
          .querySelector('[data-prerender-file-extract]')
          ?.getAttribute('data-prerender-file-extract-status');
        return status === 'ready' || status === 'error';
      },
      { timeout: 5000 },
    );
    let text =
      document
        .querySelector('[data-prerender-file-extract] pre')
        ?.textContent?.trim() ?? '';
    return JSON.parse(text) as FileExtractResponse;
  }

  hooks.beforeEach(async function () {
    let loader = getService('loader-service').loader;
    let cardApi: typeof import('@cardstack/base/card-api');
    cardApi = await loader.import('@cardstack/base/card-api');

    let {
      field,
      contains,
      containsMany,
      linksTo,
      linksToMany,
      CardDef,
      FieldDef,
      StringField,
      Component,
    } = cardApi;

    class EmergencyContact extends FieldDef {
      @field phone = contains(StringField);
      @field contact = linksTo(() => Person);
      static embedded = class Embedded extends Component<
        typeof EmergencyContact
      > {
        <template>
          <@fields.contact />
          <@fields.phone />
        </template>
      };
    }

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia(this: Pet) {
          return `${this.name}`;
        },
      });
    }

    class Cat extends Pet {
      static displayName = 'Cat';
      @field aliases = containsMany(StringField);
      @field emergencyContacts = containsMany(EmergencyContact, {
        searchable: 'contact',
      });
    }

    class Person extends CardDef {
      static displayName = 'Person';
      @field name = contains(StringField);
      @field pets = linksToMany(() => Pet, { searchable: true });
      @field friend = linksTo(() => Person, { searchable: true });
      @field cardTitle = contains(StringField, {
        computeVia(this: Person) {
          return this.name;
        },
      });
      @field numOfPets = contains(StringField, {
        computeVia(this: Person) {
          return String(Array.isArray(this.pets) ? this.pets.length : 0);
        },
      });
    }

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'person.gts': { Person },
        'pet.gts': { Pet },
        'cat.gts': { Cat },
        'Pet/mango.json': {
          data: {
            attributes: { name: 'Mango' },
            meta: {
              adoptsFrom: {
                module: '../pet',
                name: 'Pet',
              },
            },
          },
        },
        'Pet/vangogh.json': {
          data: {
            attributes: { name: 'Van Gogh' },
            meta: {
              adoptsFrom: {
                module: '../pet',
                name: 'Pet',
              },
            },
          },
        },
        'Pet/paper.json': {
          data: {
            attributes: {
              name: 'Paper',
              aliases: ['Satan', "Satan's Mistress"],
            },
            meta: {
              adoptsFrom: {
                module: '../cat',
                name: 'Cat',
              },
            },
          },
        },
        'Pet/broken.json': {
          data: {
            attributes: {
              name: 'Bad Serialization',
            },
            meta: {
              adoptsFrom: {
                module: '../cat',
                // intentionally missing "name" prop
              },
            },
          },
        },
        'Pet/molly.json': {
          data: {
            attributes: {
              name: 'Molly',
              emergencyContacts: [{ phone: '01234' }, { phone: '56789' }],
            },
            relationships: {
              'emergencyContacts.0.contact': {
                links: {
                  self: '../Person/jade',
                },
              },
              'emergencyContacts.1.contact': {
                links: {
                  self: '../Person/hassan',
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: '../cat',
                name: 'Cat',
              },
            },
          },
        },
        'Person/hassan.json': {
          data: {
            attributes: {
              name: 'Hassan',
            },
            relationships: {
              'pets.0': {
                links: {
                  self: '../Pet/mango',
                },
              },
              'pets.1': {
                links: {
                  self: '../Pet/vangogh',
                },
              },
              'pets.2': {
                links: {
                  self: '../Pet/paper',
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: '../person',
                name: 'Person',
              },
            },
          },
        },
        'Person/jade.json': {
          data: {
            attributes: {
              name: 'Jade',
            },
            relationships: {
              friend: {
                links: {
                  self: './hassan',
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: '../person',
                name: 'Person',
              },
            },
          },
        },
      },
    });
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__boxelRenderContext;
    // No test leaves a card-source stash behind for the next one: the render
    // route honors it whenever it names the card being rendered.
    delete (globalThis as any).__boxelCardRenderData;
  });

  test('can generate serialized instance', async function (assert) {
    let url = `${testRealmURL}Person/hassan.json`;
    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);
    assert.deepEqual(
      meta.serialized,
      {
        data: {
          type: 'card',
          id: testRRI('Person/hassan'),
          attributes: {
            name: 'Hassan',
            cardTitle: 'Hassan',
            cardInfo: {
              name: null,
              summary: null,
              cardThumbnailURL: null,
              notes: null,
            },
            cardDescription: null,
            cardThumbnailURL: null,
            numOfPets: '3',
          },
          relationships: {
            'pets.0': {
              links: {
                self: '../Pet/mango',
              },
            },
            'pets.1': {
              links: {
                self: '../Pet/vangogh',
              },
            },
            'pets.2': {
              links: {
                self: '../Pet/paper',
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: rri('../person'),
              name: 'Person',
            },
            realmURL: testRealmURL,
          },
        },
      },
      'serialized instance is correct',
    );
  });

  test('a serialized instance stops at its own resource, however deep the resident graph', async function (assert) {
    // Jade links to Hassan, who links to three pets. The searchable settle
    // leaves that whole graph resident, so this is the case where walking it
    // would cost the most and contribute the least: a link target is a
    // reference here, and its own links are not the card's to carry.
    let url = `${testRealmURL}Person/jade.json`;
    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);
    assert.deepEqual(
      meta.serialized,
      {
        data: {
          type: 'card',
          id: testRRI('Person/jade'),
          attributes: {
            name: 'Jade',
            cardTitle: 'Jade',
            cardInfo: {
              name: null,
              summary: null,
              cardThumbnailURL: null,
              notes: null,
            },
            cardDescription: null,
            cardThumbnailURL: null,
            numOfPets: '0',
          },
          relationships: {
            friend: {
              links: {
                self: './hassan',
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: rri('../person'),
              name: 'Person',
            },
            realmURL: testRealmURL,
          },
        },
      },
      'the link target is a reference, and neither it nor its own links ride along',
    );
  });

  test('can generate display name', async function (assert) {
    let url = `${testRealmURL}Pet/paper.json`;
    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);
    assert.deepEqual(
      meta.displayNames,
      ['Cat', 'Pet', 'Card'],
      'display names are correct',
    );
  });

  test('can generate deps', async function (assert) {
    let url = `${testRealmURL}Pet/paper.json`;
    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);
    let hasLocalModuleDependency =
      meta.deps?.includes('http://test-realm/test/cat') === true;
    assert.true(
      hasLocalModuleDependency,
      'deps include local module dependency',
    );
  });

  test('can generate type hierarchy', async function (assert) {
    let url = `${testRealmURL}Pet/paper.json`;
    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);
    assert.deepEqual(
      meta.types,
      [
        `${testRealmURL}cat/Cat`,
        `${testRealmURL}pet/Pet`,
        `${baseRealmRRI}card-api/CardDef`,
        `${baseRealmRRI}card-api/BaseDef`,
      ],
      'types are correct',
    );
  });

  test('can generate search doc that includes contains field', async function (assert) {
    let url = `${testRealmURL}Pet/mango.json`;
    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);
    expectMetaSearchDoc(
      assert,
      meta.searchDoc,
      {
        id: `${testRealmURL}Pet/mango`,
        _cardType: 'Pet',
        cardTheme: null,
        cardInfo: { cardThumbnail: null, theme: null },
        name: 'Mango',
        cardTitle: 'Mango',
      },
      'search doc is correct',
    );
  });

  test('can generate search doc that includes containsMany field', async function (assert) {
    let url = `${testRealmURL}Pet/paper.json`;
    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);
    expectMetaSearchDoc(
      assert,
      meta.searchDoc,
      {
        id: `${testRealmURL}Pet/paper`,
        _cardType: 'Cat',
        cardTheme: null,
        cardInfo: { cardThumbnail: null, theme: null },
        name: 'Paper',
        cardTitle: 'Paper',
        aliases: ['Satan', "Satan's Mistress"],
        emergencyContacts: null,
      },
      'search doc is correct',
    );
  });

  test('can generate search doc that includes linksTo field', async function (assert) {
    let url = `${testRealmURL}Person/jade.json`;
    // note that you need to visit the html route first which will pull on all the linked fields
    await visit(renderPath(url, '/html/isolated/0'));
    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);
    expectMetaSearchDoc(
      assert,
      meta.searchDoc,
      {
        id: `${testRealmURL}Person/jade`,
        _cardType: 'Person',
        cardTheme: null,
        cardInfo: { cardThumbnail: null, theme: null },
        name: 'Jade',
        cardTitle: 'Jade',
        pets: null,
        numOfPets: '0',
        friend: {
          id: `${testRealmURL}Person/hassan`,
          cardTheme: null,
          cardInfo: { cardThumbnail: null, theme: null },
          name: 'Hassan',
          cardTitle: 'Hassan',
          numOfPets: '3',
          friend: null,
          pets: [
            {
              id: `${testRealmURL}Pet/mango`,
            },
            {
              id: `${testRealmURL}Pet/vangogh`,
            },
            {
              id: `${testRealmURL}Pet/paper`,
            },
          ],
        },
      },
      'search doc is correct',
    );
  });

  test('can generate search doc that includes linksToMany field', async function (assert) {
    let url = `${testRealmURL}Person/hassan.json`;
    await visit(renderPath(url, '/html/isolated/0'));
    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);
    expectMetaSearchDoc(
      assert,
      meta.searchDoc,
      {
        id: `${testRealmURL}Person/hassan`,
        _cardType: 'Person',
        cardTheme: null,
        cardInfo: { cardThumbnail: null, theme: null },
        name: 'Hassan',
        cardTitle: 'Hassan',
        friend: null,
        numOfPets: '3',
        pets: [
          {
            id: `${testRealmURL}Pet/mango`,
            name: 'Mango',
            cardTitle: 'Mango',
            cardTheme: null,
            cardInfo: { cardThumbnail: null, theme: null },
          },
          {
            id: `${testRealmURL}Pet/vangogh`,
            name: 'Van Gogh',
            cardTitle: 'Van Gogh',
            cardTheme: null,
            cardInfo: { cardThumbnail: null, theme: null },
          },
          {
            id: `${testRealmURL}Pet/paper`,
            name: 'Paper',
            cardTitle: 'Paper',
            cardTheme: null,
            cardInfo: { cardThumbnail: null, theme: null },
          },
        ],
      },
      'search doc is correct',
    );
  });

  test('can generate search doc that includes compound field', async function (assert) {
    let url = `${testRealmURL}Pet/molly.json`;
    await visit(renderPath(url, '/html/isolated/0'));
    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);
    expectMetaSearchDoc(
      assert,
      meta.searchDoc,
      {
        _cardType: 'Cat',
        aliases: null,
        cardTheme: null,
        cardInfo: { cardThumbnail: null, theme: null },
        emergencyContacts: [
          {
            phone: '01234',
            contact: {
              id: `${testRealmURL}Person/jade`,
              name: 'Jade',
              cardTitle: 'Jade',
              numOfPets: '0',
              pets: null,
              cardTheme: null,
              cardInfo: { cardThumbnail: null, theme: null },
              friend: {
                id: `${testRealmURL}Person/hassan`,
              },
            },
          },
          {
            phone: '56789',
            contact: {
              id: `${testRealmURL}Person/hassan`,
              name: 'Hassan',
              cardTitle: 'Hassan',
              cardTheme: null,
              cardInfo: { cardThumbnail: null, theme: null },
              numOfPets: '3',
              friend: null,
              pets: [
                {
                  id: `${testRealmURL}Pet/mango`,
                },
                {
                  id: `${testRealmURL}Pet/vangogh`,
                },
                {
                  id: `${testRealmURL}Pet/paper`,
                },
              ],
            },
          },
        ],
        id: `${testRealmURL}Pet/molly`,
        name: 'Molly',
        cardTitle: 'Molly',
      },
      'search doc is correct',
    );
  });

  test("the meta payload carries the parent route's model-build breakdown", async function (assert) {
    // The model build runs in the parent `render` route, inside the same
    // transition the prerender runner times as this visit's `meta` route
    // step — so without these stages on the payload, the dominant part of
    // that step's wall-clock has no breakdown at all. `clearCache` forces a
    // cold build so `deriveType` covers a real module-graph load rather
    // than a warm-tab no-op.
    let url = `${testRealmURL}Person/hassan.json`;
    await visit(customRenderPath(url, { clearCache: true }, 1) + '/meta');
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);

    let buildModelMs = meta.diagnostics?.buildModelMs;
    assert.ok(buildModelMs, 'the model build breakdown rides the payload');
    for (let stage of [
      'fetchSource',
      'deriveType',
      'hydrate',
      'storeSettle',
    ] as const) {
      let ms = buildModelMs?.[stage];
      assert.strictEqual(
        typeof ms,
        'number',
        `buildModelMs.${stage} is measured, got: ${JSON.stringify(ms)}`,
      );
      assert.ok(
        (ms as number) >= 0,
        `buildModelMs.${stage} is a non-negative span`,
      );
    }

    // The three waits the meta route itself performs before any of its own
    // work: the two per-loader-cached base-module loads and the parent's
    // ready settle. All are serial phases of the `meta` route step, so
    // leaving them out would put the gap back in the bucket this breakdown
    // exists to close.
    for (let phase of [
      'cardApiLoadMs',
      'readySettleMs',
      'searchableLoadMs',
    ] as const) {
      assert.strictEqual(
        typeof meta.diagnostics?.[phase],
        'number',
        `${phase} is measured, got: ${JSON.stringify(meta.diagnostics?.[phase])}`,
      );
    }

    // The uncapped module-evaluation totals. These are what distinguishes
    // "the graph was already warm" from "the itemized list lost the
    // slowest-N race", so a reader must always be able to get them — the
    // bounded list below can legitimately be empty either way.
    //
    // Only their presence is asserted, not a non-zero count: this realm's
    // modules are registered as objects, which the test adapter installs
    // via `shimModule`, and a shimmed module is evaluated by definition
    // rather than through `Loader.evaluate()`. A count of zero here is the
    // harness, not the card.
    for (let field of [
      'moduleEvaluationCount',
      'moduleEvaluationTotalMs',
    ] as const) {
      assert.strictEqual(
        typeof meta.diagnostics?.[field],
        'number',
        `${field} is measured, got: ${JSON.stringify(meta.diagnostics?.[field])}`,
      );
    }

    // The per-stage detail blocks are bounded to the slowest entries at or
    // over a floor, so a small fixture card legitimately records none of
    // them. What must hold is that anything recorded is well-formed —
    // a malformed entry would only surface in production otherwise.
    for (let evaluation of meta.diagnostics?.moduleEvaluationsMs ?? []) {
      assert.strictEqual(
        typeof evaluation.url,
        'string',
        'a module evaluation entry names its module',
      );
      assert.strictEqual(typeof evaluation.ms, 'number');
    }
    for (let wait of meta.diagnostics?.storeSettleWaits ?? []) {
      assert.ok(
        ['card', 'file', 'query'].includes(wait.kind),
        `a settle wait carries a known kind, got: ${wait.kind}`,
      );
      assert.strictEqual(typeof wait.target, 'string');
      assert.strictEqual(typeof wait.ms, 'number');
    }
    for (let [path, ms] of Object.entries(
      meta.diagnostics?.hydrateFieldsMs ?? {},
    )) {
      assert.ok(path.length > 0, 'a hydration entry is keyed by field path');
      assert.strictEqual(typeof ms, 'number');
    }
  });

  test('a render carrying both cardRender and fileExtract returns the file extract alongside the meta payload', async function (assert) {
    let url = `${testRealmURL}Pet/paper.json`;

    // The standalone file-extract route's payload for the same file is the
    // reference the fused payload must reproduce.
    await visit(
      customRenderPath(url, { clearCache: true, fileExtract: true }, 1) +
        '/file-extract',
    );
    let standalone = await captureFileExtractResult();

    await visit(
      customRenderPath(
        url,
        { clearCache: true, cardRender: true, fileExtract: true },
        2,
      ) + '/meta',
    );
    let { value } = await capturePrerenderResult('textContent');
    let fused: FusedIndexMeta = JSON.parse(value);

    assert.deepEqual(
      fused.types,
      [
        `${testRealmURL}cat/Cat`,
        `${testRealmURL}pet/Pet`,
        `${baseRealmRRI}card-api/CardDef`,
        `${baseRealmRRI}card-api/BaseDef`,
      ],
      'card meta types are present on the fused payload',
    );
    assert.ok(fused.serialized, 'card meta serialized doc is present');
    assert.ok(fused.searchDoc, 'card meta search doc is present');
    assert.strictEqual(
      typeof fused.diagnostics?.fileExtractMs,
      'number',
      'the extract share of the transition is itemized in diagnostics',
    );

    let fileExtract = fused.fileExtract!;
    assert.ok(fileExtract, 'file extract rides the meta payload');
    // The nonce is per-visit and the deps have no ordering contract; every
    // other field must match the standalone route byte for byte.
    let { deps: fusedDeps, nonce: _fusedNonce, ...fusedRest } = fileExtract;
    let {
      deps: standaloneDeps,
      nonce: _standaloneNonce,
      ...standaloneRest
    } = standalone;
    assert.deepEqual(
      fusedRest,
      standaloneRest,
      'fused extract payload matches the standalone file-extract route',
    );
    // The card side of the payload owns the hydration graph; the file side
    // carries only the extract's own dependencies, so any hydration module
    // leaking into the fused extract breaks this set-equality.
    assert.deepEqual(
      [...(fusedDeps ?? [])].sort(),
      [...(standaloneDeps ?? [])].sort(),
      'fused extract deps are set-equal to the standalone extract deps',
    );
  });

  // The card branch of the render route builds its model from a caller-supplied
  // stash when there is one, instead of fetching the instance's source for
  // itself. Each of these stashes bytes that differ from the realm's copy, so
  // the rendered card names which read it was built from — 'Stashed Hassan'
  // could only have come from the stash, and 'Hassan' only from a fetch.
  const STASHED_HASSAN = JSON.stringify({
    data: {
      attributes: { name: 'Stashed Hassan' },
      meta: { adoptsFrom: { module: '../person', name: 'Person' } },
    },
  });

  test('a card render builds its model from the stashed source rather than fetching', async function (assert) {
    let url = `${testRealmURL}Person/hassan.json`;
    (globalThis as any).__boxelCardRenderData = {
      url,
      source: STASHED_HASSAN,
      realmURL: testRealmURL,
      lastModified: Date.parse('2026-01-02T03:04:05Z'),
    };

    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);

    assert.strictEqual(
      (meta.serialized as any)?.data?.attributes?.name,
      'Stashed Hassan',
      'the model was built from the stashed source',
    );
    // The serialized name proves the bytes came from the stash; this proves
    // the render knows it, which is what a production row can be read for.
    assert.strictEqual(
      meta.diagnostics?.cardSourceFrom,
      'stash',
      'the build reports that it took the stashed path',
    );
    // The realm URL and the card's own identity still come out right: the
    // stash supplies what the card branch otherwise reads off the response
    // headers, and the route keys the model on the route's id either way.
    assert.strictEqual(
      (meta.serialized as any)?.data?.meta?.realmURL,
      testRealmURL,
      'the realm the stash names is the realm the instance is serialized into',
    );
    assert.strictEqual(
      (meta.serialized as any)?.data?.id,
      testRRI('Person/hassan'),
      'the rendered card is the one the route names',
    );
  });

  test('a stash naming a different card is ignored and the render fetches', async function (assert) {
    let url = `${testRealmURL}Person/hassan.json`;
    // A prerender tab serves many cards. A stash left over from another card's
    // visit must never become this card's document.
    (globalThis as any).__boxelCardRenderData = {
      url: `${testRealmURL}Person/jade.json`,
      source: STASHED_HASSAN,
      realmURL: testRealmURL,
      lastModified: Date.parse('2026-01-02T03:04:05Z'),
    };

    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);

    assert.strictEqual(
      (meta.serialized as any)?.data?.attributes?.name,
      'Hassan',
      "the realm's bytes were used, not the stash's",
    );
    assert.strictEqual(
      meta.diagnostics?.cardSourceFrom,
      'fetch',
      'the build reports that it fell back to fetching',
    );
  });

  test('a stash that parses to something other than a card document is ignored', async function (assert) {
    // `JSON.parse` succeeds for `null`, a number and an array, and the build
    // goes on to test `'errors' in doc` — which throws for the first two and
    // would latch a render error on the card. Falling back to the fetch is the
    // whole point of validating the stash, so it has to cover what the source
    // parses TO, not merely that it parsed.
    let url = `${testRealmURL}Person/hassan.json`;
    for (let source of ['null', '42', '[]', '{"notData":true}']) {
      (globalThis as any).__boxelCardRenderData = {
        url,
        source,
        realmURL: testRealmURL,
        lastModified: Date.parse('2026-01-02T03:04:05Z'),
      };

      await visit(renderPath(url, '/meta'));
      let { value } = await capturePrerenderResult('textContent');
      let meta: PrerenderMeta = JSON.parse(value);

      assert.strictEqual(
        (meta.serialized as any)?.data?.attributes?.name,
        'Hassan',
        `source ${source} fell back to the realm's bytes`,
      );
      assert.strictEqual(
        meta.diagnostics?.cardSourceFrom,
        'fetch',
        `source ${source} is reported as a fetch`,
      );
    }
  });

  test('a stash missing the values the card branch reads off the response is ignored', async function (assert) {
    let url = `${testRealmURL}Person/hassan.json`;
    // Without a realm URL there is nothing to serialize the instance into, and
    // the fetch the stash replaces is the only other source for it. Falling
    // back costs a round-trip; trusting a partial stash would cost correctness.
    (globalThis as any).__boxelCardRenderData = {
      url,
      source: STASHED_HASSAN,
      lastModified: Date.parse('2026-01-02T03:04:05Z'),
    };

    await visit(renderPath(url, '/meta'));
    let { value } = await capturePrerenderResult('textContent');
    let meta: PrerenderMeta = JSON.parse(value);

    assert.strictEqual(
      (meta.serialized as any)?.data?.attributes?.name,
      'Hassan',
      "the realm's bytes were used, not the incomplete stash's",
    );
    assert.strictEqual(
      meta.diagnostics?.cardSourceFrom,
      'fetch',
      'the build reports that it fell back to fetching',
    );
  });
});
