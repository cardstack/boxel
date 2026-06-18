import {
  waitFor,
  click,
  fillIn,
  triggerKeyEvent,
  focus,
  doubleClick,
  typeIn,
} from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import {
  testRealmURL,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  setupOperatorModeStateCleanup,
  realmConfigCardJSON,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

const realmName = 'Local Workspace';

module('Integration | card-chooser', function (hooks) {
  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });

  const noop = () => {};

  hooks.beforeEach(async function () {
    let loader = getService('loader-service').loader;
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let string: typeof import('https://cardstack.com/base/string');
    let textArea: typeof import('https://cardstack.com/base/text-area');
    let cardsGrid: typeof import('https://cardstack.com/base/cards-grid');
    let spec: typeof import('https://cardstack.com/base/spec');
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    textArea = await loader.import(`${baseRealm.url}text-area`);
    cardsGrid = await loader.import(`${baseRealm.url}cards-grid`);
    spec = await loader.import(`${baseRealm.url}spec`);

    let { field, contains, linksTo, CardDef, FieldDef } = cardApi;
    let { default: StringField } = string;
    let { default: TextAreaField } = textArea;
    let { CardsGrid } = cardsGrid;
    let { Spec } = spec;

    class Author extends CardDef {
      static displayName = 'Author';
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
    }

    class Person extends CardDef {
      static displayName = 'Person';
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
    }

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field firstName = contains(StringField);
    }

    class Tree extends CardDef {
      static displayName = 'Tree';
      @field species = contains(StringField);
    }

    class BlogPost extends CardDef {
      static displayName = 'Blog Post';
      @field cardTitle = contains(StringField);
      @field body = contains(TextAreaField);
      @field authorBio = linksTo(Author);
    }

    class Address extends FieldDef {
      static displayName = 'Address';
      @field street = contains(StringField);
      @field city = contains(StringField);
      @field state = contains(StringField);
      @field zip = contains(StringField);
    }

    class PublishingPacket extends CardDef {
      static displayName = 'Publishing Packet';
      @field blogPost = linksTo(BlogPost);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'blog-post.gts': { BlogPost },
        'address.gts': { Address },
        'author.gts': { Author },
        'person.gts': { Person },
        'pet.gts': { Pet },
        'tree.gts': { Tree },
        'publishing-packet.gts': { PublishingPacket },
        'realm.json': realmConfigCardJSON({
          name: realmName,
          iconURL: 'https://example-icon.test',
        }),
        'index.json': new CardsGrid(),
        'Spec/publishing-packet.json': new Spec({
          cardTitle: 'Publishing Packet',
          cardDescription: 'Spec for PublishingPacket',
          specType: 'card',
          ref: {
            module: `${testRealmURL}publishing-packet`,
            name: 'PublishingPacket',
          },
        }),
        'Spec/author.json': new Spec({
          cardTitle: 'Author',
          cardDescription:
            'Spec for Author — covers biographical sketches by ornithologists',
          specType: 'card',
          ref: {
            module: `${testRealmURL}author`,
            name: 'Author',
          },
        }),
        'Spec/person.json': new Spec({
          cardTitle: 'Person',
          cardDescription: 'Spec for Person',
          specType: 'card',
          ref: {
            module: `${testRealmURL}person`,
            name: 'Person',
          },
        }),
        'Spec/pet.json': new Spec({
          cardTitle: 'Pet',
          cardDescription: 'Spec for Pet',
          specType: 'card',
          ref: {
            module: `${testRealmURL}pet`,
            name: 'Pet',
          },
        }),
        'Spec/tree.json': new Spec({
          cardTitle: 'Tree',
          cardDescription: 'Spec for Tree',
          specType: 'card',
          ref: {
            module: `${testRealmURL}tree`,
            name: 'Tree',
          },
        }),
        'Spec/blog-post.json': new Spec({
          cardTitle: 'BlogPost',
          cardDescription: 'Spec for BlogPost',
          specType: 'card',
          ref: {
            module: `${testRealmURL}blog-post`,
            name: 'BlogPost',
          },
        }),
        'Spec/address.json': new Spec({
          cardTitle: 'Address',
          cardDescription:
            'Spec for Address field — also frequented by ornithologists',
          specType: 'field',
          ref: {
            module: `${testRealmURL}address`,
            name: 'Address',
          },
        }),
      },
    });

    let operatorModeStateService = getService('operator-mode-state-service');

    operatorModeStateService.restore({
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}index"]`);
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await click('[data-test-create-new-card-button]');
    await waitFor('[data-test-realm="Local Workspace"]');
    await waitFor('[data-test-realm="Base Workspace"]');
  });

  module('realm filters', function () {
    test('displays all realms by default', async function (assert) {
      await waitFor(`[data-test-realm="${realmName}"]`);
      await waitFor('[data-test-realm="Base Workspace"]');

      assert.dom('[data-test-realm]').exists({ count: 2 });
      assert
        .dom(`[data-test-realm="${realmName}"] [data-test-results-count]`)
        .hasText('6 results');
      assert
        .dom(`[data-test-realm="${realmName}"] [data-test-item-button]`)
        .exists({ count: 5 });
      assert
        .dom('[data-test-realm="Base Workspace"] [data-test-item-button]')
        .exists();
      assert
        .dom('[data-test-realm-picker]')
        .exists('realm picker is displayed');

      let localResults = [
        ...document.querySelectorAll(
          '[data-test-realm="Local Workspace"] [data-test-item-button]',
        ),
      ].map((n) => n.getAttribute('data-test-item-button'));

      // note that Address field is not in the results
      assert.deepEqual(localResults, [
        'http://test-realm/test/Spec/author',
        'http://test-realm/test/Spec/blog-post',
        'http://test-realm/test/Spec/person',
        'http://test-realm/test/Spec/pet',
        'http://test-realm/test/Spec/publishing-packet',
      ]);
    });

    test('can filter cards by selecting a realm', async function (assert) {
      // Open the realm picker and select only Base Workspace
      await click('[data-test-realm-picker] [data-test-boxel-picker-trigger]');

      assert
        .dom('[data-test-boxel-picker-search] input')
        .hasAttribute(
          'placeholder',
          'Search for a realm',
          'realm picker has correct search placeholder',
        );

      await click(`[data-test-boxel-picker-option-row="${baseRealm.url}"]`);

      // Only Base Workspace results should be shown
      assert
        .dom(`[data-test-realm="Base Workspace"] [data-test-item-button]`)
        .exists();
      assert.dom(`[data-test-realm="${realmName}"]`).doesNotExist();
    });

    test('can paginate results from a realm', async function (assert) {
      assert
        .dom(`[data-test-realm="Base Workspace"] [data-test-show-more-cards]`)
        .exists('show pagination button for base realm');
      assert
        .dom(`[data-test-realm="${realmName}"] [data-test-show-more-cards]`)
        .exists('show pagination button for test realm');
      assert
        .dom(`[data-test-realm="${realmName}"] [data-test-show-more-cards]`)
        .containsText('Show 1 more card (1 not shown)');

      await click(
        `[data-test-realm="${realmName}"] [data-test-show-more-cards]`,
      );
      assert
        .dom(`[data-test-realm="${realmName}"] [data-test-show-more-cards]`)
        .doesNotExist("don't show pagination button for test realm");
      assert
        .dom(`[data-test-realm="${realmName}"] [data-test-item-button]`)
        .exists({ count: 6 });
      let localResults = [
        ...document.querySelectorAll(
          '[data-test-realm="Local Workspace"] [data-test-item-button]',
        ),
      ].map((n) => n.getAttribute('data-test-item-button'));
      assert.deepEqual(localResults, [
        'http://test-realm/test/Spec/author',
        'http://test-realm/test/Spec/blog-post',
        'http://test-realm/test/Spec/person',
        'http://test-realm/test/Spec/pet',
        'http://test-realm/test/Spec/publishing-packet',
        'http://test-realm/test/Spec/tree',
      ]);
    });

    test('catalog items render with the Adorn visual treatment', async function (assert) {
      await waitFor(`[data-test-realm="${realmName}"] [data-test-item-button]`);

      // The card chooser opts in to the Adorn treatment (teal hover tab +
      // chip + outline), so every catalog item button carries the `adorn`
      // class — matching the operator-mode cards-grid look.
      assert
        .dom(`[data-test-realm="${realmName}"] [data-test-item-button]`)
        .exists({ count: 5 }, 'catalog items are rendered');
      assert
        .dom(
          `[data-test-realm="${realmName}"] [data-test-item-button]:not(.adorn)`,
        )
        .doesNotExist('every catalog item renders with the adorn class');
    });
  });

  module('mouse and key events', function () {
    test(`pressing enter on a card selects it and submits the selection`, async function (assert) {
      const card = `${testRealmURL}Spec/publishing-packet`;
      assert
        .dom(
          `[data-test-stack-card-index="0"] [data-test-boxel-card-header-title]`,
        )
        .hasText('Workspace - Local Workspace');
      assert.dom('[data-test-stack-card-index="1"]').doesNotExist();

      await waitFor('[data-test-card-chooser-modal]');
      await waitFor(`[data-test-item-button="${card}"]`);
      assert.dom(`[data-test-item-button-selected]`).doesNotExist();

      await triggerKeyEvent(
        `[data-test-item-button="${card}"]`,
        'keydown',
        'Enter',
      );
      await waitFor('[data-test-card-chooser-modal]', { count: 0 });
      await waitFor(`[data-test-stack-card-index="1"]`);
      assert
        .dom(
          `[data-test-stack-card-index="1"] [data-test-boxel-card-header-title]`,
        )
        .hasText('Publishing Packet - Untitled');
    });

    test(`can select card using mouse click and then submit selection using enter key`, async function (assert) {
      const card = `${testRealmURL}Spec/blog-post`;
      assert
        .dom(
          `[data-test-stack-card-index="0"] [data-test-boxel-card-header-title]`,
        )
        .hasText('Workspace - Local Workspace');
      assert.dom('[data-test-stack-card-index="1"]').doesNotExist();

      await waitFor('[data-test-card-chooser-modal]');
      await waitFor(`[data-test-item-button="${card}"]`);
      assert.dom(`[data-test-item-button-selected]`).doesNotExist();

      await click(`[data-test-item-button="${card}"]`);
      assert
        .dom(`[data-test-item-button="${card}"]`)
        .hasAttribute('data-test-item-button-selected');

      await triggerKeyEvent(
        `[data-test-item-button="${card}"]`,
        'keydown',
        'Enter',
      );
      await waitFor('[data-test-card-chooser-modal]', { count: 0 });
      await waitFor(`[data-test-stack-card-index="1"]`);
      assert
        .dom(
          `[data-test-stack-card-index="1"] [data-test-boxel-card-header-title]`,
        )
        .hasText('Blog Post');
    });

    test(`selecting a card, then focusing on another card and pressing enter submits the focused card`, async function (assert) {
      const card1 = `${testRealmURL}Spec/blog-post`;
      const card2 = `${testRealmURL}Spec/author`;
      assert
        .dom(
          `[data-test-stack-card-index="0"] [data-test-boxel-card-header-title]`,
        )
        .hasText('Workspace - Local Workspace');
      assert.dom('[data-test-stack-card-index="1"]').doesNotExist();

      await waitFor('[data-test-card-chooser-modal]');
      await waitFor(`[data-test-item-button="${card1}"]`);
      await waitFor(`[data-test-item-button="${card2}"]`);
      assert.dom(`[data-test-item-button-selected]`).doesNotExist();

      await click(`[data-test-item-button="${card1}"]`);
      assert
        .dom(`[data-test-item-button="${card1}"]`)
        .hasAttribute('data-test-item-button-selected');

      await focus(`[data-test-item-button="${card2}"]`);
      await triggerKeyEvent(
        `[data-test-item-button="${card2}"]`,
        'keydown',
        'Enter',
      );
      await waitFor('[data-test-card-chooser-modal]', { count: 0 });
      await waitFor(`[data-test-stack-card-index="1"]`);
      assert
        .dom(
          `[data-test-stack-card-index="1"] [data-test-boxel-card-header-title]`,
        )
        .hasText('Author - Untitled');
    });

    test(`double-clicking on a card selects the card and submits the selection`, async function (assert) {
      const card = `${testRealmURL}Spec/blog-post`;
      assert
        .dom(
          `[data-test-stack-card-index="0"] [data-test-boxel-card-header-title]`,
        )
        .hasText('Workspace - Local Workspace');
      assert.dom('[data-test-stack-card-index="1"]').doesNotExist();

      await waitFor('[data-test-card-chooser-modal]');
      await waitFor(`[data-test-item-button="${card}"]`);
      assert.dom(`[data-test-item-button-selected]`).doesNotExist();

      await doubleClick(`[data-test-item-button="${card}"]`);
      await waitFor('[data-test-card-chooser-modal]', { count: 0 });
      await waitFor(`[data-test-stack-card-index="1"]`);
      assert
        .dom(
          `[data-test-stack-card-index="1"] [data-test-boxel-card-header-title]`,
        )
        .hasText('Blog Post');
    });

    test(`pressing escape key closes the modal`, async function (assert) {
      assert
        .dom(
          `[data-test-stack-card-index="0"] [data-test-boxel-card-header-title]`,
        )
        .hasText('Workspace - Local Workspace');
      assert.dom('[data-test-stack-card-index="1"]').doesNotExist();

      await waitFor('[data-test-card-chooser-modal]');
      await waitFor(`[data-test-item-button]`);

      await triggerKeyEvent(
        `[data-test-card-chooser-modal]`,
        'keydown',
        'Escape',
      );
      await waitFor('[data-test-card-chooser-modal]', { count: 0 });
      assert.dom(`[data-test-stack-card-index="0"]`).exists();
      assert.dom('[data-test-stack-card-index="1"]').doesNotExist();
    });
  });

  module('content search', function () {
    test('finds cards by description content, not just title, and respects type scoping', async function (assert) {
      await waitFor('[data-test-card-chooser-modal]');
      await waitFor(`[data-test-item-button="${testRealmURL}Spec/author"]`);

      // 'ornithologists' appears in both Spec/author (specType: 'card') and
      // Spec/address (specType: 'field'). The chooser's baseFilter scopes to
      // card-type specs, so only the Author spec should surface — proving
      // matches is layered on top of type scoping, not replacing it.
      await fillIn('[data-test-search-field]', 'ornithologists');
      await waitFor(
        `[data-test-realm="${realmName}"] [data-test-item-button="${testRealmURL}Spec/author"]`,
      );

      assert
        .dom(`[data-test-realm="${realmName}"] [data-test-item-button]`)
        .exists(
          { count: 1 },
          'only the card-type spec is shown; field-type spec with the same content term is filtered out',
        );
      assert
        .dom(
          `[data-test-realm="${realmName}"] [data-test-item-button="${testRealmURL}Spec/address"]`,
        )
        .doesNotExist(
          'field-type spec is excluded even though its description matches',
        );
    });
  });

  module('component stability', function () {
    test('the search field stays mounted and focused across keystrokes', async function (assert) {
      await waitFor('[data-test-card-chooser-modal]');
      await waitFor(`[data-test-item-button="${testRealmURL}Spec/author"]`);

      let field = document.querySelector(
        '[data-test-search-field]',
      ) as HTMLInputElement | null;
      assert.ok(field, 'the search field is rendered');
      field = field!;
      await focus('[data-test-search-field]');

      // Type one keystroke at a time. Each keystroke updates the search key,
      // which re-runs the v2 search resource and re-renders the result
      // sections. If that churned the field — a resource rebuilt per render, or
      // non-memoized view-models re-mounting an ancestor — Glimmer would
      // replace the field with a new element and it would lose focus
      // mid-typing. DOM-node identity (===) is the definitive proof the field
      // was never re-mounted: a re-rendered element is always a new node.
      await typeIn('[data-test-search-field]', 'ornithologists');

      let after = document.querySelector('[data-test-search-field]');
      assert.strictEqual(
        after,
        field,
        'the search field is the same DOM node after typing (never re-mounted)',
      );
      assert.strictEqual(
        document.activeElement,
        field,
        'the search field retains focus across every keystroke',
      );
      assert.strictEqual(
        field.value,
        'ornithologists',
        'every keystroke registered on the stable field',
      );
    });
  });
});
