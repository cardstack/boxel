import { visit } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type {
  PrerenderMeta,
  RenderRouteOptions,
} from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  setupOnSave,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  testRealmURL,
  capturePrerenderResult,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

module('Acceptance | Lattice loader epoch', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });
  hooks.afterEach(function () {
    for (let key of [
      '__boxelRenderContext',
      '__boxelJobId',
      '__boxelRenderScope',
      '__boxelLoaderEpoch',
    ])
      delete (globalThis as any)[key];
  });

  for (let foreign of [false, true]) {
    test(`fresh data and ${foreign ? 'foreign' : 'local'} module authority across loader reuse`, async function (assert) {
      let source = (count: number) => ({
        data: {
          type: 'card',
          attributes: { count },
          meta: { adoptsFrom: { module: '../lattice-stats', name: 'Stats' } },
        },
      });
      let calculation = (factor: number) =>
        `export function calculate(count) { return count * ${factor}; }`;
      let foreignRealmURL = 'http://lattice-foreign-code/';
      let foreignRealm = foreign
        ? await setupAcceptanceTestRealm({
            mockMatrixUtils,
            realmURL: foreignRealmURL,
            startMatrix: false,
            contents: { 'lattice-calculate.gts': calculation(2) },
          })
        : undefined;
      let { adapter, realm } = await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'lattice-calculate.gts': calculation(2),
          'lattice-stats.gts': `
          import { CardDef, field, contains, NumberField } from '@cardstack/base/card-api';
          import { calculate } from '${foreign ? foreignRealmURL : './'}lattice-calculate';
          export class Stats extends CardDef {
            @field count = contains(NumberField);
            @field total = contains(NumberField, {
              computeVia: function() { return calculate(this.count); }
            });
          }
        `,
          'Stats/one.json': source(6),
        },
      });
      let codeAdapter = foreignRealm?.adapter ?? adapter;
      let codeRealm = foreignRealm?.realm ?? realm;
      let loaderService = getService('loader-service');
      let sequence = 0;
      async function render(options: RenderRouteOptions) {
        await visit('/_standby');
        let job = `lattice-epoch-${++sequence}`;
        Object.assign(globalThis, {
          __boxelRenderContext: true,
          __boxelJobId: job,
          __boxelRenderScope: `${testRealmURL}@${job}`,
        });
        await visit(
          `/render/${encodeURIComponent(`${testRealmURL}Stats/one.json`)}/${job}/${encodeURIComponent(JSON.stringify({ cardRender: true, captureModuleSources: true, ...options }))}/meta`,
        );
        let { value } = await capturePrerenderResult('textContent');
        return JSON.parse(value) as PrerenderMeta;
      }

      let first = await render({ loaderEpoch: 'code-1' });
      assert.strictEqual(first.serialized?.data.attributes?.total, 12);
      function helperHash(result: PrerenderMeta) {
        let entry = result.moduleSources?.find((item) =>
          item.key.endsWith('/lattice-calculate'),
        );
        return entry?.kind === 'source' ? entry.sourceHash : undefined;
      }
      let initialHelperHash = helperHash(first);
      assert.true(
        /^[a-f0-9]{64}$/.test(initialHelperHash ?? ''),
        'the native response identifies the helper source actually loaded',
      );
      let warmLoader = loaderService.loader;
      await adapter.write('Stats/one.json', JSON.stringify(source(7)));
      realm.__testOnlyClearCaches();
      let updated = await render({ loaderEpoch: 'code-1' });
      assert.strictEqual(updated.serialized?.data.attributes?.total, 14);
      assert.strictEqual(updated.searchDoc?.total, 14);
      assert.strictEqual(
        helperHash(updated),
        initialHelperHash,
        'a source-record edit reuses the same helper source',
      );
      assert.strictEqual(
        loaderService.loader,
        warmLoader,
        'new data scope reads the changed source without discarding executable modules',
      );

      await codeAdapter.write('lattice-calculate.gts', calculation(3));
      codeRealm.__testOnlyClearCaches();
      if (foreign) {
        // A local-only epoch is insufficient evidence for reusing imports. Keep
        // this diagnostic until an imported-module authority receipt closes it.
        let unwitnessed = await render({ loaderEpoch: 'code-1' });
        assert.strictEqual(
          unwitnessed.serialized?.data.attributes?.total,
          14,
          'the owning realm token alone leaves the changed foreign computation stale',
        );
        assert.strictEqual(
          helperHash(unwitnessed),
          initialHelperHash,
          'the inventory reports resident old code, not assumed current code',
        );
        let conservative = await render({
          loaderEpoch: 'code-1',
          clearCache: true,
        });
        assert.strictEqual(
          conservative.serialized?.data.attributes?.total,
          21,
          'the existing conservative reset observes the imported change',
        );
      }
      let changedCode = await render({ loaderEpoch: 'code-2' });
      assert.strictEqual(changedCode.serialized?.data.attributes?.total, 21);
      assert.strictEqual(changedCode.searchDoc?.total, 21);
      assert.notStrictEqual(
        helperHash(changedCode),
        initialHelperHash,
        'reloading the edited helper changes its source identity',
      );
      assert.notStrictEqual(loaderService.loader, warmLoader);

      await codeAdapter.write('lattice-calculate.gts', calculation(4));
      codeRealm.__testOnlyClearCaches();
      let rebuilt = await render({ loaderEpoch: 'code-2', clearCache: true });
      assert.strictEqual(
        rebuilt.serialized?.data.attributes?.total,
        28,
        'an explicit rebuild still reloads code with an unchanged epoch',
      );

      await codeAdapter.write('lattice-calculate.gts', calculation(5));
      codeRealm.__testOnlyClearCaches();
      let differentTimeline = await render({ loaderEpoch: 'code-1' });
      assert.strictEqual(
        differentTimeline.serialized?.data.attributes?.total,
        35,
        'any epoch mismatch reloads dependencies, including a previously seen token',
      );
      let capturedLoader = loaderService.loader;
      let ordinary = await render({
        loaderEpoch: 'code-1',
        captureModuleSources: undefined,
      });
      assert.strictEqual(ordinary.serialized?.data.attributes?.total, 35);
      assert.strictEqual(
        ordinary.moduleSources,
        undefined,
        'ordinary visits do not return or capture module inventory',
      );
      assert.strictEqual(
        loaderService.loader,
        capturedLoader,
        'ending capture retains valid modules for the ordinary visit',
      );
      await adapter.write('Stats/one.json', JSON.stringify(source(8)));
      realm.__testOnlyClearCaches();
      let nextOrdinary = await render({
        loaderEpoch: 'code-1',
        captureModuleSources: undefined,
      });
      assert.strictEqual(nextOrdinary.serialized?.data.attributes?.total, 40);
      assert.strictEqual(nextOrdinary.moduleSources, undefined);
      assert.strictEqual(
        loaderService.loader,
        capturedLoader,
        'successive ordinary visits reuse code while reading changed card data',
      );

      await codeAdapter.write('lattice-calculate.gts', calculation(6));
      codeRealm.__testOnlyClearCaches();
      let recaptured = await render({ loaderEpoch: 'code-1' });
      assert.strictEqual(recaptured.serialized?.data.attributes?.total, 48);
      assert.notStrictEqual(
        loaderService.loader,
        capturedLoader,
        'starting capture again reloads code instead of inventing old source receipts',
      );
      assert.notStrictEqual(
        helperHash(recaptured),
        helperHash(differentTimeline),
      );
      assert.true(
        /^[a-f0-9]{64}$/.test(helperHash(recaptured) ?? ''),
        'the new capture inventories the source it actually evaluated',
      );
    });
  }
});
