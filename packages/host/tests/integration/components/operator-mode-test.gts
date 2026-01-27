import { waitFor, waitUntil, click, fillIn } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { Deferred } from '@cardstack/runtime-common';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import {
  percySnapshot,
  testRealmURL,
  type TestContextWithSave,
  withSlowSave,
} from '../../helpers';
import { renderComponent } from '../../helpers/render-component';

import { setupOperatorModeTests } from './operator-mode/setup';

module('Integration | operator-mode | basics', function (hooks) {
  let ctx = setupOperatorModeTests(hooks);

  let noop = () => {};

  test('it loads a card and renders its isolated view', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor('[data-test-boxel-card-header-title]');
    await waitFor(
      `[data-test-card-header-realm-icon="https://boxel-images.boxel.ai/icons/Letter-o.png"]`,
    );
    assert
      .dom('[data-test-boxel-card-header-title]')
      .hasText('Person - Fadhlan');
    assert
      .dom(
        `[data-test-card-header-realm-icon="https://boxel-images.boxel.ai/icons/Letter-o.png"]`,
      )
      .exists();
    assert.dom('[data-test-person]').hasText('Fadhlan');
    assert.dom('[data-test-first-letter-of-the-name]').hasText('F');
    assert.dom('[data-test-city]').hasText('Bandung');
    assert.dom('[data-test-country]').hasText('Indonesia');
    assert.dom('[data-test-stack-card]').exists({ count: 1 });
    await waitFor('[data-test-pet="Mango"]');
    await click('[data-test-pet="Mango"]');
    await waitFor(`[data-test-stack-card="${testRealmURL}Pet/mango"]`);
    assert.dom('[data-test-stack-card]').exists({ count: 2 });
    assert.dom('[data-test-stack-card-index="1"]').includesText('Mango');
  });

  test('it renders a card with an error that has does not have a last known good state', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}FriendWithCSS/missing-link`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    assert
      .dom('[data-test-boxel-card-header-title]')
      .includesText('Link Not Found', 'card error title is displayed');
    assert
      .dom('[data-test-error-message]')
      .containsText(
        `missing file ${testRealmURL}FriendWithCSS/does-not-exist.json`,
      );
    await percySnapshot(assert);
    await click('[data-test-toggle-details]');
    assert
      .dom('[data-test-error-details]')
      .containsText(`FriendWithCSS/does-not-exist.json not found`);
    assert
      .dom('[data-test-error-stack]')
      .containsText('at Realm.getSourceOrRedirect');
    assert.strictEqual(
      ctx.operatorModeStateService.state?.submode,
      'interact',
      'in interact mode',
    );
    await click('[data-test-view-in-code-mode-button]');
    assert.strictEqual(
      ctx.operatorModeStateService.state?.submode,
      'code',
      'in code mode',
    );
    assert.strictEqual(
      ctx.operatorModeStateService.state?.codePath?.href,
      `${testRealmURL}FriendWithCSS/missing-link.json`,
      'codePath is correct',
    );
  });

  module(
    'card with an error that has a last known good state',
    function (hooks) {
      hooks.beforeEach(async function () {
        await ctx.testRealm.write(
          'FriendWithCSS/friend-a.json',
          JSON.stringify({
            data: {
              type: 'card',
              attributes: {
                name: 'Friend A',
              },
              relationships: {
                friend: {
                  links: {
                    self: './does-not-exist',
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  module: '../friend-with-css.gts',
                  name: 'FriendWithCSS',
                },
              },
            },
          } as LooseSingleCardDocument),
        );
      });

      test('it renders a card with an error that has a last known good state', async function (assert) {
        ctx.setCardInOperatorModeState(`${testRealmURL}FriendWithCSS/friend-a`);
        await renderComponent(
          class TestDriver extends GlimmerComponent {
            <template><OperatorMode @onClose={{noop}} /></template>
          },
        );

        assert
          .dom('[data-test-boxel-card-header-title]')
          .includesText('Link Not Found', 'card error title is displayed');
        assert
          .dom('[data-test-card-error]')
          .includesText(
            'Hassan has a friend Jade',
            'the last known good HTML is rendered',
          );

        await percySnapshot(assert);

        await click('[data-test-toggle-details]');
        assert
          .dom('[data-test-error-details]')
          .containsText(`FriendWithCSS/does-not-exist.json not found`);
        assert
          .dom('[data-test-error-stack]')
          .containsText('at Realm.getSourceOrRedirect');
        assert.strictEqual(
          ctx.operatorModeStateService.state?.submode,
          'interact',
          'in interact mode',
        );
        await click('[data-test-view-in-code-mode-button]');
        assert.strictEqual(
          ctx.operatorModeStateService.state?.submode,
          'code',
          'in code mode',
        );
        assert.strictEqual(
          ctx.operatorModeStateService.state?.codePath?.href,
          `${testRealmURL}FriendWithCSS/friend-a.json`,
          'codePath is correct',
        );
      });

      test('it has the ability to delete the card that has an error', async function (assert) {
        ctx.setCardInOperatorModeState(`${testRealmURL}FriendWithCSS/friend-a`);
        await renderComponent(
          class TestDriver extends GlimmerComponent {
            <template><OperatorMode @onClose={{noop}} /></template>
          },
        );

        await click('[data-test-more-options-button]');
        await click('[data-test-boxel-menu-item-text="Delete Card"]');
        assert
          .dom('[data-test-delete-modal-container]')
          .includesText('Delete the card Hassan?');
        await click('[data-test-confirm-delete-button]');

        assert
          .dom(`[data-test-stack-card="${testRealmURL}FriendWithCSS/friend-a"]`)
          .doesNotExist();
        assert.dom(`[data-test-stack-card="${testRealmURL}index"]`).exists();
      });
    },
  );

  test<TestContextWithSave>('it auto saves the field value', async function (assert) {
    assert.expect(7);
    ctx.setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor('[data-test-person]');
    await click('[data-test-edit-button]');
    let finishedSaving = false;
    this.onSave((_, json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      finishedSaving = true;
      assert.strictEqual(json.data.attributes?.firstName, 'EditedName');
    });
    fillIn(
      '[data-test-field="firstName"] [data-test-boxel-input]',
      'EditedName',
    );
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-auto-save-indicator]')
          ?.textContent?.trim() === 'Saving…',
      { timeout: 5000 },
    );
    assert.dom('[data-test-auto-save-indicator]').containsText('Saving…');
    assert.false(finishedSaving, 'save in-flight message is correct');
    await waitUntil(() => finishedSaving, { timeout: 10000 });
    assert.true(finishedSaving, 'finished saving message is correct');
    await waitFor('[data-test-last-saved]');
    assert.dom('[data-test-last-saved]').containsText('Saved');

    ctx.setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);

    await waitFor('[data-test-person="EditedName"]');
    assert.dom('[data-test-person]').hasText('EditedName');
    assert.dom('[data-test-first-letter-of-the-name]').hasText('E');
  });

  test('an error in auto-save is handled gracefully', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}BoomPet/paper`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor('[data-test-pet]');
    await waitFor('[data-test-edit-button]');
    await click('[data-test-edit-button]');
    fillIn('[data-test-field="boom"] input', 'Bad cat!');
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-auto-save-indicator]')
          ?.textContent?.trim() == 'Saving…',
    );
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-auto-save-indicator]')
          ?.textContent?.trim() == 'Failed to save: Boom!',
    );
    await click('[data-test-edit-button]');
    assert
      .dom('[data-test-card-error]')
      .exists('last known good state is displayed in isolated mode');
  });

  test('a 403 from Web Application Firewall is handled gracefully when auto-saving', async function (assert) {
    let networkService = getService('network');
    networkService.virtualNetwork.mount(
      async (req: Request) => {
        if (req.method === 'PATCH' && req.url.includes('test/Pet/buzz')) {
          return new Response(
            '{ message: "Request blocked by Web Application Firewall. See x-blocked-by-waf-rule response header for detail." }',
            {
              status: 403,
              headers: {
                'Content-Type': 'application/json',
                'X-Blocked-By-WAF-Rule': 'CrossSiteScripting_BODY',
              },
            },
          );
        }
        return null;
      },
      { prepend: true },
    );
    ctx.setCardInOperatorModeState(`${testRealmURL}Pet/buzz`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor('[data-test-field="name"]');
    await waitFor('[data-test-edit-button]');
    await click('[data-test-edit-button]');
    fillIn('[data-test-field="name"] input', 'Fuzz');
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-auto-save-indicator]')
          ?.textContent?.trim() == 'Saving…',
      { timeoutMessage: 'Waiting for Saving... to appear' },
    );
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-auto-save-indicator]')
          ?.textContent?.trim() ==
        'Failed to save: Request blocked by Web Application Firewall. X-blocked-by-waf-rule response header specifies rule: CrossSiteScripting_BODY',
      { timeoutMessage: 'Waiting for "Failed to save" to appear' },
    );
    assert
      .dom('[data-test-auto-save-indicator]')
      .containsText(
        'Failed to save: Request blocked by Web Application Firewall. X-blocked-by-waf-rule response header specifies rule: CrossSiteScripting_BODY',
      );
  });

  test('opens workspace chooser after closing the only remaining card on the stack', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor('[data-test-person]');
    assert.dom('[data-test-person]').isVisible();

    await click('[data-test-close-button]');
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
      .doesNotExist();
    assert.dom(`[data-test-stack-card="${testRealmURL}index"]`).exists();
    await percySnapshot(assert);
  });

  test('displays cards on cards-grid and includes `spec` instances', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await waitFor(`[data-test-cards-grid-item]`);

    assert.dom(`[data-test-stack-card-index="0"]`).exists();
    assert.dom(`[data-test-cards-grid-item]`).exists();

    assert
      .dom(`[data-test-cards-grid-item="${testRealmURL}BlogPost/1"] `)
      .includesText('Outer Space Journey');

    assert
      .dom(
        `[data-test-cards-grid-item="${testRealmURL}Spec/publishing-packet"]`,
      )
      .exists('publishing-packet spec is displayed on cards-grid');
    assert
      .dom(`[data-test-cards-grid-item="${testRealmURL}Spec/pet-room"]`)
      .exists('pet-room spec instance is displayed on cards-grid');
  });

  test<TestContextWithSave>('can optimistically create a card using the cards-grid', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    let saved = new Deferred<void>();
    let savedCards = new Set<string>();
    this.onSave((url) => {
      savedCards.add(url.href);
      saved.fulfill();
    });

    await withSlowSave(1000, async () => {
      await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
      assert.dom(`[data-test-stack-card-index="0"]`).exists();

      await click(`[data-test-boxel-filter-list-button="All Cards"]`);
      await click('[data-test-create-new-card-button]');
      assert
        .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
        .containsText('Choose a Spec card');
      await waitFor(
        `[data-test-card-catalog-item="${testRealmURL}Spec/publishing-packet"]`,
      );
      assert
        .dom(
          `[data-test-realm="${ctx.realmName}"] [data-test-card-catalog-item]`,
        )
        .exists({ count: 3 });

      await click(`[data-test-select="${testRealmURL}Spec/publishing-packet"]`);
      click('[data-test-card-catalog-go-button]');
      await waitFor('[data-test-stack-card-index="1"]');
      assert
        .dom('[data-test-stack-card-index="1"] [data-test-field="blogPost"]')
        .exists();
      assert.strictEqual(
        savedCards.size,
        0,
        'the new card has not been saved yet',
      );
      await click(
        '[data-test-stack-card-index="1"] [data-test-more-options-button]',
      );
      await fillIn(`[data-test-field="cardInfo-name"] input`, 'New Post');
      await saved.promise;
      let packetId = [...savedCards].find((k) =>
        k.includes('PublishingPacket'),
      )!;
      ctx.setCardInOperatorModeState(packetId);

      await waitFor(`[data-test-stack-card="${packetId}"]`);
      assert.dom(`[data-test-stack-card="${packetId}"]`).exists();
    });
  });

  test('can open a card from the cards-grid and close it', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await waitFor(`[data-test-stack-card-index]`);
    assert.dom(`[data-test-stack-card-index="0"]`).exists();
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await waitFor(`[data-test-cards-grid-item]`);
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/burcu"] .field-component-card`,
    );

    await waitFor(`[data-test-stack-card-index="1"]`);
    assert.dom(`[data-test-stack-card-index="1"]`).exists();
    assert
      .dom(
        `[data-test-stack-card-index="1"] [data-test-boxel-card-header-title]`,
      )
      .includesText('Person');

    await click('[data-test-stack-card-index="1"] [data-test-close-button]');
    await waitFor('[data-test-stack-card-index="1"]', { count: 0 });
    assert.dom(`[data-test-stack-card-index="1"]`).doesNotExist();
  });

  test<TestContextWithSave>('create new card editor opens in the stack at each nesting level', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    let savedCards = new Set<string>();
    this.onSave((url) => savedCards.add(url.href));

    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    assert.dom(`[data-test-stack-card-index="0"]`).exists();
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);

    await click('[data-test-create-new-card-button]');
    await waitFor(
      `[data-test-card-catalog-item="${testRealmURL}Spec/publishing-packet"]`,
    );
    assert
      .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
      .containsText('Choose a Spec card');
    assert
      .dom(`[data-test-realm="${ctx.realmName}"] [data-test-card-catalog-item]`)
      .exists({ count: 3 });

    await click(`[data-test-select="${testRealmURL}Spec/publishing-packet"]`);
    await click('[data-test-card-catalog-go-button]');
    await waitFor('[data-test-stack-card-index="1"]');
    assert
      .dom('[data-test-stack-card-index="1"] [data-test-field="blogPost"]')
      .exists();

    await click('[data-test-add-new="blogPost"]');
    await waitFor(`[data-test-card-catalog-modal]`);
    await click(`[data-test-card-catalog-create-new-button]`);
    await click(`[data-test-card-catalog-go-button]`);

    await waitFor(`[data-test-stack-card-index="2"]`);
    assert.dom('[data-test-stack-card-index]').exists({ count: 3 });
    assert
      .dom('[data-test-stack-card-index="2"] [data-test-field="authorBio"]')
      .exists();

    await fillIn(
      '[data-test-stack-card-index="2"] [data-test-field="cardTitle"] [data-test-boxel-input]',
      'Mad As a Hatter',
    );

    await click(
      '[data-test-stack-card-index="2"] [data-test-field="authorBio"] [data-test-add-new]',
    );
    await waitFor(`[data-test-card-catalog-modal]`);
    await click(`[data-test-card-catalog-create-new-button]`);
    await click(`[data-test-card-catalog-go-button]`);

    await waitFor(`[data-test-stack-card-index="3"]`);

    assert
      .dom('[data-test-field="firstName"] [data-test-boxel-input]')
      .exists();
    await fillIn(
      '[data-test-field="firstName"] [data-test-boxel-input]',
      'Alice',
    );
    let authorId = [...savedCards].find((k) => k.includes('Author'))!;
    await waitFor(
      `[data-test-stack-card-index="3"] [data-test-card="${authorId}"]`,
    );
    await fillIn(
      '[data-test-field="lastName"] [data-test-boxel-input]',
      'Enwunder',
    );

    await click('[data-test-stack-card-index="3"] [data-test-close-button]');
    await waitFor('[data-test-stack-card-index="3"]', { count: 0 });

    await waitUntil(() =>
      /Alice\s*Enwunder/.test(
        document.querySelector(
          '[data-test-stack-card-index="2"] [data-test-field="authorBio"]',
        )!.textContent!,
      ),
    );

    await click('[data-test-stack-card-index="2"] [data-test-close-button]');
    await waitFor('[data-test-stack-card-index="2"]', { count: 0 });
    let packetId = [...savedCards].find((k) => k.includes('PublishingPacket'))!;
    await waitFor(
      `[data-test-stack-card-index="1"] [data-test-card="${packetId}"]`,
    );
    await fillIn(
      '[data-test-stack-card-index="1"] [data-test-field="socialBlurb"] [data-test-boxel-input]',
      `Everyone knows that Alice ran the show in the Brady household. But when Alice’s past comes to light, things get rather topsy turvy…`,
    );
    assert
      .dom('[data-test-stack-card-index="1"] [data-test-field="blogPost"]')
      .containsText('Mad As a Hatter by Alice Enwunder');

    await click('[data-test-stack-card-index="1"] [data-test-edit-button]');

    await waitUntil(() => {
      return document
        .querySelector(
          `[data-test-stack-item-content] >[data-test-card="${packetId}"]`,
        )
        ?.textContent?.includes(
          'Everyone knows that Alice ran the show in the Brady household.',
        );
    });
  });

  test('can close cards by clicking the header of a card deeper in the stack', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await waitFor(`[data-test-cards-grid-item]`);
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
    );
    await waitFor(`[data-test-stack-card-index="1"]`);
    assert.dom(`[data-test-stack-card-index="1"]`).exists();
    await waitFor('[data-test-person]');

    await waitFor('[data-test-cards-grid-item]');
    await click('[data-test-cards-grid-item] .field-component-card');
    await waitFor(`[data-test-stack-card-index="2"]`);
    assert.dom(`[data-test-stack-card-index="2"]`).exists();
    await click('[data-test-stack-card-index="0"] [data-test-card-header]');

    await waitFor('[data-test-stack-card-index="2"]', { count: 0 });
    await waitFor('[data-test-stack-card-index="1"]', { count: 0 });

    assert.dom(`[data-test-stack-card-index="2"]`).doesNotExist();
    assert.dom(`[data-test-stack-card-index="1"]`).doesNotExist();
    assert.dom(`[data-test-stack-card-index="0"]`).exists();
  });

  test(`displays realm name as cards grid card title and card's display name as other card titles`, async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    assert.dom(`[data-test-stack-card-header]`).containsText(ctx.realmName);

    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
    );
    await waitFor(`[data-test-stack-card-index="1"]`);
    assert.dom(`[data-test-stack-card-index="1"]`).exists();
    assert
      .dom(
        `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-boxel-card-header-title]`,
      )
      .containsText('Person');

    assert.dom(`[data-test-cards-grid-cards]`).isNotVisible();
    assert.dom(`[data-test-create-new-card-button]`).isNotVisible();
  });
});
