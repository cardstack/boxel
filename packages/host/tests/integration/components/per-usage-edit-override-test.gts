import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  PermissionsContextName,
  type Permissions,
  baseRealm,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import {
  setupCardLogs,
  setupLocalIndexing,
  testRealmURL,
  provideConsumeContext,
  setupOperatorModeStateCleanup,
} from '../../helpers';
import {
  CardDef,
  contains,
  containsMany,
  field,
  linksTo,
  linksToMany,
  setupBaseRealm,
  StringField,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | per-usage edit override', function (hooks) {
  let loader: Loader;

  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
  setupLocalIndexing(hooks);

  setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  setupBaseRealm(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
    let permissions: Permissions = { canRead: true, canWrite: true };
    provideConsumeContext(PermissionsContextName, permissions);
  });

  test('a contains field can override its edit component per usage', async function (assert) {
    const CustomEditor: TemplateOnlyComponent<{
      Args: { model: unknown };
    }> = <template>
      <div data-test-custom-contains-editor>custom</div>
    </template>;

    class Card extends CardDef {
      @field nickname = contains(StringField, { edit: CustomEditor });
    }

    await renderCard(loader, new Card({ nickname: 'Spike' }), 'edit');

    assert
      .dom('[data-test-custom-contains-editor]')
      .exists('the per-usage override renders');
    assert
      .dom('[data-test-field="nickname"] input')
      .doesNotExist('the default string editor is suppressed');
  });

  test('a linksTo field can override its edit component per usage', async function (assert) {
    class Friend extends CardDef {
      @field name = contains(StringField);
    }

    const CustomLinksToEditor: TemplateOnlyComponent<{
      Args: { model: unknown };
    }> = <template>
      <div data-test-custom-links-to-editor>custom</div>
    </template>;

    class Person extends CardDef {
      @field bestFriend = linksTo(Friend, { edit: CustomLinksToEditor });
    }

    await renderCard(loader, new Person(), 'edit');

    assert
      .dom('[data-test-custom-links-to-editor]')
      .exists('the per-usage override renders');
    assert
      .dom('[data-test-links-to-editor="bestFriend"]')
      .doesNotExist('the default LinksToEditor is suppressed');
  });

  test('a containsMany override receives @defaultEditor for the wrap contract', async function (assert) {
    const WrapEditor: TemplateOnlyComponent<{
      Args: { model: unknown; values: unknown; defaultEditor: unknown };
    }> = <template>
      <div data-test-wrap>
        <div data-test-wrap-banner>wrap banner</div>
        {{#let @defaultEditor as |DefaultEditor|}}
          <DefaultEditor />
        {{/let}}
      </div>
    </template>;

    class Tagged extends CardDef {
      @field tags = containsMany(StringField, { edit: WrapEditor });
    }

    await renderCard(loader, new Tagged({ tags: ['alpha', 'beta'] }), 'edit');

    assert.dom('[data-test-wrap]').exists('the wrap override renders');
    assert
      .dom('[data-test-wrap-banner]')
      .exists('the wrap contributes its own UI');
    assert
      .dom('[data-test-wrap] [data-test-contains-many="tags"]')
      .exists('rendering @defaultEditor produces the standard editor');
    assert
      .dom('[data-test-wrap] [data-test-contains-many="tags"] [data-test-item]')
      .exists({ count: 2 }, 'all values flow through the default iteration');
  });

  test('a linksToMany override receives @defaultEditor for the wrap contract', async function (assert) {
    class Pet extends CardDef {
      @field name = contains(StringField);
    }

    const WrapEditor: TemplateOnlyComponent<{
      Args: { model: unknown; values: unknown; defaultEditor: unknown };
    }> = <template>
      <div data-test-wrap-many>
        <div data-test-wrap-many-banner>wrap banner</div>
        {{#let @defaultEditor as |DefaultEditor|}}
          <DefaultEditor />
        {{/let}}
      </div>
    </template>;

    class Owner extends CardDef {
      @field pets = linksToMany(Pet, { edit: WrapEditor });
    }

    await renderCard(loader, new Owner(), 'edit');

    assert.dom('[data-test-wrap-many]').exists('the wrap override renders');
    assert
      .dom('[data-test-wrap-many-banner]')
      .exists('the wrap contributes its own UI');
    assert
      .dom('[data-test-wrap-many] [data-test-links-to-many="pets"]')
      .exists('rendering @defaultEditor produces the standard editor');
    assert
      .dom('[data-test-wrap-many] [data-test-add-new="pets"]')
      .exists(
        'the standard LinksToManyEditor add affordance is rendered through the wrap',
      );
  });
});
