import { click, fillIn, waitFor, waitUntil } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import { testRealmURL, type TestContextWithSave } from '../../helpers';
import setupOperatorModeTest from '../../helpers/operator-mode-test-setup';
import { renderComponent } from '../../helpers/render-component';

module('Integration | operator-mode | card linking', function (hooks) {
  let { noop, setCardInOperatorModeState, testRealmAdapter } =
    setupOperatorModeTest(hooks);

  test('can choose a card for a linksTo field that has an existing value', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/1"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="authorBio"]').containsText('Alien Bob');
    assert.dom('[data-test-add-new="authorBio"]').doesNotExist();

    await click('[data-test-remove-card]');
    assert.dom('[data-test-add-new="authorBio"]').exists();
    await click('[data-test-add-new="authorBio"]');
    await waitFor(`[data-test-card-catalog-modal]`);
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Author/2"]`);
    await click(`[data-test-select="${testRealmURL}Author/2"]`);
    assert
      .dom(
        `[data-test-card-catalog-item="${testRealmURL}Author/2"][data-test-card-catalog-item-selected]`,
      )
      .exists();

    await waitUntil(
      () =>
        (
          document.querySelector(`[data-test-card-catalog-go-button]`) as
            | HTMLButtonElement
            | undefined
        )?.disabled === false,
    );
    await click('[data-test-card-catalog-go-button]');

    await waitFor(`.operator-mode [data-test-author="R2-D2"]`);
    assert.dom('[data-test-field="authorBio"]').containsText('R2-D2');
  });

  test('can choose a card for a linksTo field that has no existing value', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}BlogPost/2`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`);
    await click('[data-test-edit-button]');
    assert.dom('[data-test-add-new="authorBio"]').exists();

    await click('[data-test-add-new="authorBio"]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Author/2"]`);
    await click(`[data-test-select="${testRealmURL}Author/2"]`);
    await click('[data-test-card-catalog-go-button]');

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));
    assert.dom('[data-test-field="authorBio"]').containsText('R2-D2');

    await click('[data-test-edit-button]');
    await waitFor('.operator-mode [data-test-blog-post-isolated]');

    assert
      .dom('.operator-mode [data-test-blog-post-isolated]')
      .hasText('Beginnings by R2-D2');
  });

  test<TestContextWithSave>('can create a new card to populate a linksTo field', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}BlogPost/2`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    let savedCards = new Set<string>();
    this.onSave((url) => savedCards.add(url.href));

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`);
    await click('[data-test-edit-button]');
    assert.dom('[data-test-add-new="authorBio"]').exists();

    await click('[data-test-add-new="authorBio"]');
    await waitFor(`[data-test-card-catalog-modal]`);
    await click(`[data-test-card-catalog-create-new-button]`);
    await click(`[data-test-card-catalog-go-button]`);
    await waitFor('[data-test-stack-card-index="1"]');

    assert
      .dom('[data-test-stack-card-index="1"] [data-test-field="firstName"]')
      .exists();
    await fillIn(
      '[data-test-stack-card-index="1"] [data-test-field="firstName"] [data-test-boxel-input]',
      'Alice',
    );

    let authorId = [...savedCards].find((k) => k.includes('Author'))!;
    await waitFor(
      `[data-test-stack-card-index="1"] [data-test-card="${authorId}"]`,
    );

    await click('[data-test-stack-card-index="1"] [data-test-close-button]');
    await waitFor('[data-test-stack-card-index="1"]', { count: 0 });
    assert.dom('[data-test-add-new="authorBio"]').doesNotExist();
    assert.dom('[data-test-field="authorBio"]').containsText('Alice');

    await click('[data-test-stack-card-index="0"] [data-test-edit-button]');
    assert.dom('[data-test-blog-post-isolated]').hasText('Beginnings by Alice');
  });

  test('can choose a card from a publicly readable realm to link to a card in the current realm', async function (assert) {
    setCardInOperatorModeState(
      `${testRealmURL}SpecCardLinker/spec-card-linker`,
    );
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(
      `[data-test-stack-card="${testRealmURL}SpecCardLinker/spec-card-linker"]`,
    );
    await click('[data-test-edit-button]');
    await click('[data-test-add-new="spec"]');
    await waitFor('[data-test-card-catalog-modal]');
    await waitFor('[data-test-search-field]');
    await fillIn('[data-test-search-field]', 'Pet');
    await waitFor('[data-test-card-catalog-modal] [data-test-select]');
    await click(
      '[data-test-card-catalog-item="https://cardstack.com/base/cards/pet"] [data-test-select]',
    );
    await waitFor('[data-test-card-catalog-go-button]');
    await click('[data-test-card-catalog-go-button]');

    await waitFor('[data-test-spec-card-linker-isolated]');
    assert
      .dom('[data-test-spec-card-linker-isolated]')
      .containsText('The card is: PetLinked to: Pet');
  });

  test('can remove the link for a linksTo field', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/1"]`);
    await click('[data-test-edit-button]');
    assert.dom('[data-test-field="authorBio"]').containsText('Alien Bob');
    assert.dom('[data-test-add-new="authorBio"]').doesNotExist();

    await click('[data-test-remove-card]');
    assert.dom('[data-test-field="authorBio"]').containsText('Choose a card');
  });

  test('can add a card to a linksToMany field with existing values', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    await click('[data-test-edit-button]');
    assert.dom('[data-test-list="friends"] [data-test-item]').exists();

    await click('[data-test-links-to-many="friends"] [data-test-add-new]');
    await waitFor('[data-test-card-catalog-modal]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Pet/mango"]`);
    await click(`[data-test-select="${testRealmURL}Pet/mango"]`);
    await click('[data-test-card-catalog-go-button]');
    assert.dom('[data-test-field="friends"]').containsText('Mango');
  });

  test('can add a card to a linksTo field creating a loop', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Friend/friend-b`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Friend/friend-b"]`);
    await click('[data-test-edit-button]');
    assert.dom('[data-test-field="friend"]').containsText('Friend A');

    await click('[data-test-add-new="friend"]');
    await waitFor('[data-test-card-catalog-modal]');
    await waitFor(
      `[data-test-card-catalog-item="${testRealmURL}Friend/friend-a"]`,
    );
    await click(`[data-test-select="${testRealmURL}Friend/friend-a"]`);
    await click('[data-test-card-catalog-go-button]');
    assert.dom('[data-test-field="friend"]').containsText('Friend A');
  });

  test('can add a card to linksToMany field that has no existing values', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`);
    await click('[data-test-edit-button]');
    assert.dom('[data-test-field="friends"]').containsText('Choose a card');
    await click('[data-test-links-to-many="friends"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Pet/mango"]`);
    await click(`[data-test-select="${testRealmURL}Pet/mango"]`);
    await click('[data-test-card-catalog-go-button]');
    assert.dom('[data-test-field="friends"]').containsText('Mango');
  });

  test('can add a card to linksToMany field that has a null value for relationship', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    await click('[data-test-edit-button]');
    await click('[data-test-links-to-many="friends"] [data-test-remove-card]');
    await click('[data-test-links-to-many="friends"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Pet/mango"]`);
    await click(`[data-test-select="${testRealmURL}Pet/mango"]`);
    await click('[data-test-card-catalog-go-button]');
    assert.dom('[data-test-field="friends"]').containsText('Mango');
  });

  test('can change the item selection in a linksToMany field', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    await click('[data-test-edit-button]');
    assert.dom('[data-test-field="friends"]').containsText('Jackie');
    await click(
      '[data-test-links-to-many="friends"] [data-test-item="0"] [data-test-remove-card]',
    );
    await click('[data-test-links-to-many="friends"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Pet/mango"]`);
    await click(`[data-test-select="${testRealmURL}Pet/mango"]`);
    await click('[data-test-card-catalog-go-button]');
    assert.dom('[data-test-field="friends"]').containsText('Woody');
  });

  test<TestContextWithSave>('can create a new card to add to a linksToMany field from card chooser', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    let savedCards = new Set<string>();
    this.onSave((url) => savedCards.add(url.href));

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    await click('[data-test-edit-button]');
    await click('[data-test-links-to-many="friends"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-modal]`);
    await click(`[data-test-card-catalog-create-new-button]`);
    await click(`[data-test-card-catalog-go-button]`);
    await waitFor('[data-test-stack-card-index="1"]');
    await fillIn(
      '[data-test-stack-card-index="1"] [data-test-field="name"] input',
      'Woodster',
    );
    let petId = [...savedCards].find((k) => k.includes('Pet'))!;
    await waitFor(
      `[data-test-stack-card-index="1"] [data-test-card="${petId}"]`,
    );
    await click('[data-test-stack-card-index="1"] [data-test-close-button]');
    await waitUntil(
      () => !document.querySelector('[data-test-stack-card-index="1"]'),
    );
    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');

    //Ensuring the card chooser modal doesn't get stuck
    await click('[data-test-links-to-many="friends"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-modal]`);
    assert
      .dom('[data-test-card-catalog-create-new-button]')
      .hasText('Create New Pet');
  });

  test<TestContextWithSave>('does not create a new card to add to a linksToMany field from card chooser, if user cancel the edit view', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    let savedCards = new Set<string>();
    this.onSave((url) => savedCards.add(url.href));

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    await click('[data-test-edit-button]');
    await click('[data-test-links-to-many="friends"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-modal]`);
    await click(`[data-test-card-catalog-create-new-button]`);
    await click(`[data-test-card-catalog-go-button]`);
    await waitFor('[data-test-stack-card-index="1"]');
    await fillIn(
      '[data-test-stack-card-index="1"] [data-test-field="name"] input',
      'Woodster',
    );
    await click('[data-test-stack-card-index="1"] [data-test-close-button]');
    await waitUntil(
      () => !document.querySelector('[data-test-stack-card-index="1"]'),
    );
    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');

    await click('[data-test-links-to-many="friends"] [data-test-item="1"]');
    await waitFor(`[data-test-stack-card="${testRealmURL}Pet/woody"]`);
    await click('[data-test-edit-button]');
    await waitFor('[data-test-add-new="pet-room"]');
    await click('[data-test-add-new="pet-room"]');
    await waitFor('[data-test-card-catalog-modal]');
    await waitFor('[data-test-card-catalog-create-new-button]');
    await click('[data-test-card-catalog-create-new-button]');
    await click('[data-test-card-catalog-go-button]');
    await waitFor('[data-test-stack-card-index="2"]');
    await click('[data-test-stack-card-index="2"] [data-test-close-button]');
    await waitUntil(
      () => !document.querySelector('[data-test-stack-card-index="2"]'),
    );
    assert
      .dom('[data-test-card-catalog-create-new-button]')
      .hasText('Create New Pet Room');
    await click('[data-test-card-catalog-cancel-button]');

    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');
  });

  test('can remove all items of a linksToMany field', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    assert
      .dom(
        `[data-test-plural-view-field="friends"] [data-test-plural-view-item]`,
      )
      .exists({ count: 3 });
    await click('[data-test-edit-button]');
    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');

    await click(
      '[data-test-links-to-many="friends"] [data-test-item="1"] [data-test-remove-card]',
    );
    await click(
      '[data-test-links-to-many="friends"] [data-test-item="0"] [data-test-remove-card]',
    );
    await click(
      '[data-test-links-to-many="friends"] [data-test-item="0"] [data-test-remove-card]',
    );

    await click('[data-test-edit-button]');
    await waitFor(`[data-test-person="Burcu"]`);
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Person/burcu"]`)
      .doesNotContainText('Jackie');
    assert
      .dom(
        `[data-test-plural-view-field="friends"] [data-test-plural-view-item]`,
      )
      .doesNotExist();
  });

  test<TestContextWithSave>('New cards are optimistically created for a linksTo field', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/1`, 'edit');
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    let savedCards = new Set<string>();
    this.onSave((url) => {
      savedCards.add(url.href);
    });
    await waitFor(`[data-test-stack-card="${testRealmURL}Person/1"]`);
    await waitFor('[data-test-links-to-editor="pet"] [data-test-remove-card]');
    await click('[data-test-links-to-editor="pet"] [data-test-remove-card]');
    await waitFor('[data-test-add-new="pet"]');
    assert.dom('[data-test-add-new="pet"]').exists();
    assert
      .dom('[data-test-links-to-editor="pet"] [data-test-boxel-card-container]')
      .doesNotExist();
    await click('[data-test-add-new="pet"]');
    await waitFor(`[data-test-card-catalog-modal]`);
    await waitFor(`[data-test-card-catalog-create-new-button]`);
    await click(`[data-test-card-catalog-create-new-button]`);
    // don't await this click so the test waiters don't get in the way
    click(`[data-test-card-catalog-go-button]`);
    await waitFor('[data-test-stack-card-index="1"]'); // wait for the 2nd stack item: Pet
    assert.deepEqual(
      [...savedCards],
      [`${testRealmURL}Person/1`],
      'linked card has not been saved yet',
    );
    await fillIn(
      `[data-test-stack-card-index="1"] [data-test-field="name"] input`,
      'Mango',
    );
    await click(`[data-test-stack-card-index="1"] [data-test-close-button]`);
    assert
      .dom(
        `[data-test-stack-card="${testRealmURL}Person/1"] [data-test-links-to-editor="pet"]`,
      )
      .containsText(
        'Mango',
        'the embedded link of new card is rendered correctly',
      );
    let ids = Array.from(savedCards);
    let paths = ids.map((url) => url.substring(testRealmURL.length) + '.json');
    let path = paths.find((p) => p.includes('Pet/'));
    let fileRef = await testRealmAdapter.openFile(path!);
    assert.deepEqual(
      JSON.parse(fileRef!.content as string),
      {
        data: {
          attributes: {
            name: 'Mango',
            cardInfo: {
              title: null,
              description: null,
              thumbnailURL: null,
              notes: null,
            },
          },
          relationships: {
            'cardInfo.theme': {
              links: {
                self: null,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: '../pet',
              name: 'Pet',
            },
          },
          type: 'card',
        },
      },
      'file contents were saved correctly',
    );
  });

  test<TestContextWithSave>('Clicking on "Finish Editing" after creating a card from linksTo field will switch the card into isolated mode', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}BlogPost/2`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`);
    await click('[data-test-edit-button]');
    assert.dom('[data-test-add-new="authorBio"]').exists();
    await click('[data-test-add-new="authorBio"]');
    await waitFor(`[data-test-card-catalog-modal]`);
    await click(`[data-test-card-catalog-create-new-button]`);
    await click(`[data-test-card-catalog-go-button]`);
    await waitFor('[data-test-stack-card-index="1"]');

    await click('[data-test-stack-card-index="1"] [data-test-edit-button]');

    await waitFor('[data-test-isolated-author]');
    assert.dom('[data-test-isolated-author]').exists();
  });
});
