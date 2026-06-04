import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  PermissionsContextName,
  type Permissions,
  baseRealm,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import {
  provideConsumeContext,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
} from '../../helpers';
import {
  setupBaseRealm,
  CardDef,
  Component,
  MarkdownField,
  contains,
  field,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

let loader: Loader;

module('Integration | MarkdownField', function (hooks) {
  setupRenderingTest(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks);

  setupBaseRealm(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    let permissions: Permissions = {
      canWrite: true,
      canRead: true,
    };
    provideConsumeContext(PermissionsContextName, permissions);
    loader = getService('loader-service').loader;
  });
  setupLocalIndexing(hooks);

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  test('embedded renders inline :card references as BFM elements for URL-form refs', async function (assert) {
    class TestCard extends CardDef {
      @field body = contains(MarkdownField);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-card.gts': { TestCard },
      },
    });

    let card = new TestCard({
      body: 'See :card[https://example.com/cards/1] for details.',
    });
    let root = await renderCard(loader, card, 'embedded');
    assert
      .dom(root.querySelector('[data-boxel-bfm-inline-ref]'))
      .exists('inline card reference is rendered as BFM element');
    assert
      .dom(root.querySelector('[data-boxel-bfm-inline-ref]'))
      .hasAttribute('data-boxel-bfm-inline-ref', 'https://example.com/cards/1');
  });

  test('embedded renders inline :card references for prefix-form refs without crashing', async function (assert) {
    // Regression test for the CardContextConsumer plumbing in
    // MarkdownField.embedded. Before VN was threaded through the field
    // default, prefix-form refs in MarkdownField content couldn't be
    // resolved at all (no VN reached the resolveUrl helper); with VN
    // required at the MarkdownTemplate boundary, this render would
    // throw if the consumer plumbing weren't in place.
    class TestCard extends CardDef {
      @field body = contains(MarkdownField);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-card.gts': { TestCard },
      },
    });

    let card = new TestCard({
      body: 'See :card[@cardstack/catalog/Card/foo] for details.',
    });
    let root = await renderCard(loader, card, 'embedded');
    assert
      .dom(root.querySelector('[data-boxel-bfm-inline-ref]'))
      .exists('prefix-form card reference renders as BFM element');
    assert
      .dom(root.querySelector('[data-boxel-bfm-inline-ref]'))
      .hasAttribute('data-boxel-bfm-inline-ref', '@cardstack/catalog/Card/foo');
  });

  test('atom renders inline :card references as BFM elements', async function (assert) {
    class TestCard extends CardDef {
      @field body = contains(MarkdownField);
      static atom = class Atom extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-card.gts': { TestCard },
      },
    });

    let card = new TestCard({
      body: 'See :card[https://example.com/cards/2] for details.',
    });
    let root = await renderCard(loader, card, 'atom');
    assert
      .dom(root.querySelector('[data-boxel-bfm-inline-ref]'))
      .exists('inline card reference is rendered in atom format');
    assert
      .dom(root.querySelector('[data-boxel-bfm-inline-ref]'))
      .hasAttribute('data-boxel-bfm-inline-ref', 'https://example.com/cards/2');
  });
});
