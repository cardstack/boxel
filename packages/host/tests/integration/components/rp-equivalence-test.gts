import { getRootElement, waitFor } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { rri, type LooseCardResource } from '@cardstack/runtime-common';

import CardRenderer from '@cardstack/host/components/card-renderer';

import {
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
  cleanWhiteSpace,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type { BaseDef, CardDef, Format } from '@cardstack/base/card-api';

const baseCardApiModule = rri('https://cardstack.com/base/card-api');

// The visible behavior the two entries must agree on: rendered text, the
// `data-boxel-card-*` attributes Base stamps on the card container, the
// format-driven classes (RP-2.10), and the container boundary classes.
// Deliberately not byte-identical HTML: Glimmer comments and scoped-CSS
// attributes may legitimately differ between mounts.
interface CardRenderSnapshot {
  text: string;
  cardId: string | null;
  cardFormat: string | null;
  classes: string[];
}

function snapshotRenderedCard(assert: Assert): CardRenderSnapshot {
  let container = getRootElement().querySelector(
    '[data-test-field-component-card]',
  );
  assert.ok(container, 'a card container rendered');
  return {
    text: cleanWhiteSpace(container?.textContent ?? ''),
    cardId: container?.getAttribute('data-boxel-card-id') ?? null,
    cardFormat: container?.getAttribute('data-boxel-card-format') ?? null,
    classes: [...(container?.classList ?? [])].sort(),
  };
}

async function renderLegacy(
  card: BaseDef,
  format?: Format,
  displayContainer?: boolean,
) {
  await renderComponent(
    class TestDriver extends GlimmerComponent {
      <template>
        <CardRenderer
          @card={{card}}
          @format={{format}}
          @displayContainer={{displayContainer}}
        />
      </template>
    },
  );
  await waitFor('[data-test-field-component-card]', { timeout: 10000 });
}

async function renderProtocolDirect(
  card: BaseDef,
  format?: Format,
  displayContainer?: boolean,
) {
  await renderComponent(
    class TestDriver extends GlimmerComponent {
      <template>
        <CardRenderer
          @card={{card}}
          @format={{format}}
          @displayContainer={{displayContainer}}
          @execution='auto'
        />
      </template>
    },
  );
  await waitFor(
    '[data-boxel-execution="direct"] [data-test-field-component-card]',
    {
      timeout: 10000,
    },
  );
}

module('Integration | rp-equivalence', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });
  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
      }),
    );
  });

  setupCardLogs(hooks, async () =>
    getService('loader-service').loader.import('@cardstack/base/card-api'),
  );

  // The equivalence oracle runs on a trusted fixture because the protocol
  // routes only trusted modules to the Direct tier (RP-6.1 R1/R5); the
  // legacy path renders the identical instance for comparison.
  async function createTrustedFixture(): Promise<CardDef> {
    let resource: LooseCardResource = {
      attributes: {
        cardInfo: {
          name: 'Trusted Fixture',
          summary: 'An equivalence-oracle fixture',
        },
      },
      meta: { adoptsFrom: { module: baseCardApiModule, name: 'CardDef' } },
    };
    let store = getService('store');
    return await store.__dangerousCreateFromSerialized(
      resource,
      { data: resource },
      new URL(testRealmURL),
    );
  }

  test('RP-15.4, RP-1.5: the legacy path and the protocol Direct tier agree on an isolated render', async function (assert) {
    let card = await createTrustedFixture();

    await renderLegacy(card, 'isolated');
    assert
      .dom('[data-boxel-execution]')
      .doesNotExist('the legacy path mounts no execution tier');
    let legacy = snapshotRenderedCard(assert);

    await renderProtocolDirect(card, 'isolated');
    let protocol = snapshotRenderedCard(assert);

    assert.deepEqual(
      protocol,
      legacy,
      'text, data-boxel-card-* attributes, and container classes agree',
    );
    assert.true(
      legacy.text.includes('Trusted Fixture'),
      'both snapshots carry the rendered card content',
    );
    assert.strictEqual(
      legacy.cardFormat,
      'isolated',
      'the root renders in the caller-seeded default format',
    );
  });

  test('RP-1.5, RP-2.10: root default-format seeding matches main across the display formats', async function (assert) {
    let card = await createTrustedFixture();

    for (let format of ['embedded', 'fitted', 'atom'] as Format[]) {
      await renderLegacy(card, format);
      let legacy = snapshotRenderedCard(assert);

      await renderProtocolDirect(card, format);
      let protocol = snapshotRenderedCard(assert);

      assert.deepEqual(
        protocol,
        legacy,
        `the two entries agree for the '${format}' format`,
      );
      assert.strictEqual(
        protocol.cardFormat,
        format,
        `the ambient default resolves the root to '${format}'`,
      );
      assert.true(
        protocol.classes.includes(`${format}-format`),
        `Base stamps the '${format}-format' geometry class`,
      );
    }
  });

  test('RP-1.6, RP-11.4: container boundaries and @displayContainer pass-through agree', async function (assert) {
    let card = await createTrustedFixture();

    await renderLegacy(card, 'embedded');
    let legacyDefault = snapshotRenderedCard(assert);
    assert.true(
      legacyDefault.classes.includes('boxel-card-container--boundaries'),
      'an unset @displayContainer keeps the Base-owned boundary',
    );

    await renderProtocolDirect(card, 'embedded');
    let protocolDefault = snapshotRenderedCard(assert);
    assert.deepEqual(
      protocolDefault.classes,
      legacyDefault.classes,
      'default container classes agree across the two entries',
    );

    await renderLegacy(card, 'embedded', false);
    let legacySuppressed = snapshotRenderedCard(assert);
    assert.false(
      legacySuppressed.classes.includes('boxel-card-container--boundaries'),
      'an explicit false suppresses the container boundary',
    );

    await renderProtocolDirect(card, 'embedded', false);
    let protocolSuppressed = snapshotRenderedCard(assert);
    assert.deepEqual(
      protocolSuppressed,
      legacySuppressed,
      'boundary suppression agrees across the two entries',
    );
  });
});
