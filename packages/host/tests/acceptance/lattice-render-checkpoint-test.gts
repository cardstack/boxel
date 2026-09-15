import { visit } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  serializeRenderRouteOptions,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import { createLatticeRenderCheckpoint } from '@cardstack/runtime-common/lattice-render-checkpoint';
import { rri } from '@cardstack/runtime-common/realm-identifiers';

import {
  setupLocalIndexing,
  setupOnSave,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  testRealmURL,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

module('Acceptance | Lattice render checkpoint', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });
  hooks.beforeEach(function () {
    (globalThis as any).__doNotSuppressRenderRouteError = true;
  });
  hooks.afterEach(function () {
    delete (globalThis as any).__doNotSuppressRenderRouteError;
    delete (globalThis as any).__latticeRenderCheckpoint;
    delete (globalThis as any).__boxelRenderContext;
    delete (globalThis as any).__boxelLoaderEpoch;
    delete (globalThis as any).__boxelJobId;
  });

  for (let withTheme of [false, true]) {
    test(`native HTML consumes a published checkpoint ${withTheme ? 'with a lazy theme' : 'without a theme'} without source, input graph or getter execution`, async function (assert) {
      let loader = getService('loader-service').loader;
      let api = await loader.import<typeof import('@cardstack/base/card-api')>(
        '@cardstack/base/card-api',
      );
      let { CardDef, Component, field, contains, NumberField, linksToMany } =
        api;
      let computations = 0;
      class Input extends CardDef {}
      class Dashboard extends CardDef {
        static materialized = true;
        @field inputs = linksToMany(Input, {
          query: {
            filter: {
              type: {
                module: rri(`${testRealmURL}lattice-dashboard`),
                name: 'Input',
              },
            },
          },
        });
        @field count = contains(NumberField, {
          computeVia: function () {
            computations++;
            return 999;
          },
        });
        static isolated = class extends Component<typeof Dashboard> {
          <template>
            <section class='lattice-native-count'>Published count:
              {{@model.count}}</section>
          </template>
        };
      }
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'lattice-dashboard.gts': { Dashboard, Input },
          'checkpoint-theme.json': {
            data: {
              type: 'card',
              attributes: {
                cssVariables: ':root { --lattice-checkpoint-theme: loaded; }',
              },
              meta: {
                adoptsFrom: {
                  module: '@cardstack/base/theme',
                  name: 'default',
                },
              },
            },
          },
        },
      });
      // There is deliberately no source card at this URL. Falling back to a
      // source or CardJson fetch cannot satisfy this render.
      let id = `${testRealmURL}Dashboard/published-only`;
      let doc: LooseSingleCardDocument = {
        data: {
          id,
          type: 'card',
          attributes: { count: 7, ...(withTheme ? { cardInfo: {} } : {}) },
          relationships: {
            ...(withTheme
              ? {
                  'cardInfo.theme': { links: { self: '../checkpoint-theme' } },
                }
              : {}),
            inputs: {
              data: [{ type: 'card', id: `${testRealmURL}Input/not-fetched` }],
              meta: { total: 1 },
            },
            'inputs.0': {
              links: { self: '../Input/not-fetched' },
              data: { type: 'card', id: `${testRealmURL}Input/not-fetched` },
            },
          },
          meta: {
            adoptsFrom: {
              module: rri('../lattice-dashboard'),
              name: 'Dashboard',
            },
            publication: {
              version: 1,
              state: 'ready',
              computedFields: ['count'],
              queryFields: ['inputs'],
              watches: [],
              validatedThrough: 1,
              outputRevision: 2,
              definitionRevision: 'lattice-code-1',
            },
          },
        },
      };
      computations = 0;
      let network = getService('network'),
        originalFetch = network.authedFetch.bind(network),
        dataFetches: string[] = [];
      let observedFetch = async (
        ...args: Parameters<typeof network.authedFetch>
      ) => {
        let url = String(args[0]);
        if (
          url === id ||
          url === `${id}.json` ||
          url.includes('/Input/') ||
          /_search|_federated-search/.test(url)
        )
          dataFetches.push(url);
        return originalFetch(...args);
      };
      let priorFetch = Object.getOwnPropertyDescriptor(network, 'authedFetch');
      Object.defineProperty(network, 'authedFetch', {
        configurable: true,
        get: () => observedFetch,
      });
      try {
        // Keep the theme resident across both renders, as a real background
        // job does. The second render must reuse it without a synchronous
        // tracked-field update from inside hasTheme.
        (globalThis as any).__boxelJobId = 'lattice-checkpoint-theme';
        (globalThis as any).__boxelRenderContext = true;
        let checkpoint = await createLatticeRenderCheckpoint(doc, testRealmURL);
        (globalThis as any).__latticeRenderCheckpoint = checkpoint;
        let options = encodeURIComponent(
          serializeRenderRouteOptions({
            cardRender: true,
            latticeUseSnapshot: true,
            latticeRenderCheckpoint: true,
            loaderEpoch: 'lattice-code-1',
          }),
        );
        await visit(
          `/render/${encodeURIComponent(id)}/lattice-one/${options}/html/isolated/0`,
        );
        assert.dom('.lattice-native-count').hasText('Published count: 7');
        assert.strictEqual(
          getComputedStyle(document.querySelector('.lattice-native-count')!)
            .getPropertyValue('--lattice-checkpoint-theme')
            .trim(),
          withTheme ? 'loaded' : '',
          'the published value renders with its requested theme',
        );
        assert.strictEqual(
          computations,
          0,
          'published computed getter never runs',
        );
        assert.deepEqual(
          dataFetches,
          [],
          'no source, root-card or query request',
        );
        assert.strictEqual(
          (globalThis as any).__renderModel.latticeRenderReceipt.documentHash,
          checkpoint.documentHash,
        );

        doc.data.attributes!.count = 8;
        doc.data.meta.publication!.validatedThrough = 2;
        doc.data.meta.publication!.outputRevision = 3;
        checkpoint = await createLatticeRenderCheckpoint(doc, testRealmURL);
        (globalThis as any).__latticeRenderCheckpoint = checkpoint;
        // Reuse nonce and options intentionally: different document identity must
        // not select a cached parent model containing the previous publication.
        await visit('/_standby');
        await visit(
          `/render/${encodeURIComponent(id)}/lattice-one/${options}/html/isolated/0`,
        );
        assert.dom('.lattice-native-count').hasText('Published count: 8');
        assert.strictEqual(
          getComputedStyle(document.querySelector('.lattice-native-count')!)
            .getPropertyValue('--lattice-checkpoint-theme')
            .trim(),
          withTheme ? 'loaded' : '',
          'the next publication preserves its theme',
        );
        assert.strictEqual(computations, 0);
        assert.deepEqual(dataFetches, []);
        assert.strictEqual(
          (globalThis as any).__renderModel.latticeRenderReceipt.documentHash,
          checkpoint.documentHash,
        );
      } finally {
        if (priorFetch) {
          Object.defineProperty(network, 'authedFetch', priorFetch);
        } else {
          Reflect.deleteProperty(network, 'authedFetch');
        }
      }
    });
  }
});
