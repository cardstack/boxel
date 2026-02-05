/* eslint-disable ember/no-empty-glimmer-component-classes */
import { getOwner } from '@ember/owner';
import Service from '@ember/service';
import { click, waitFor, type RenderingTestContext } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  baseRealm,
  CardContextName,
  PermissionsContextName,
  type CommandContext,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import { provideConsumeContext, setupCardLogs } from '../../helpers';
import {
  setupBaseRealm,
  field,
  contains,
  CardDef,
  StringField,
  RealmField,
} from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

class StubRealmService extends Service {
  allRealmsInfo = {
    'https://writable.example/': {
      info: {
        name: 'Writable Realm',
        iconURL: 'https://example.com/writable.png',
      },
      canWrite: true,
    },
    'https://readonly.example/': {
      info: {
        name: 'Read-only Realm',
        iconURL: 'https://example.com/readonly.png',
      },
      canWrite: false,
    },
  };

  get defaultWritableRealm() {
    return {
      path: 'https://writable.example/',
      info: this.allRealmsInfo['https://writable.example/'].info,
    };
  }

  get defaultReadableRealm() {
    return this.defaultWritableRealm;
  }

  async ensureRealmMeta() {
    return;
  }

  token = (_url: string): string | undefined => {
    return undefined;
  };
}

class DummyPrerenderedCardSearch extends GlimmerComponent {}

module('Integration | components | realm field', function (hooks) {
  setupRenderingTest(hooks);
  hooks.beforeEach(function (this: RenderingTestContext) {
    let owner = getOwner(this)!;
    owner.register('service:realm', StubRealmService);
  });
  setupBaseRealm(hooks);

  let loader: Loader;
  let commandContext: CommandContext;

  setupCardLogs(hooks, async () => {
    return await getService('loader-service').loader.import(
      `${baseRealm.url}card-api`,
    );
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;

    const commandService = getService('command-service');
    commandContext = commandService.commandContext;

    const store = getService('store');

    provideConsumeContext(CardContextName, {
      commandContext,
      prerenderedCardSearchComponent: DummyPrerenderedCardSearch,
      getCard: () => undefined,
      getCards: () => [],
      getCardCollection: () => undefined,
      store,
    } as any);
    provideConsumeContext(PermissionsContextName, {
      canWrite: true,
    });
  });

  test('renders writable realms and updates selection', async function (assert) {
    class RealmPickerCard extends CardDef {
      static displayName = 'Realm Picker';
      @field cardTitle = contains(StringField);
      @field targetRealm = contains(RealmField);
    }

    let card = new RealmPickerCard({
      cardTitle: 'Realm Picker Example',
      targetRealm: '',
    });

    await renderCard(loader, card, 'edit');

    await waitFor('[data-test-field="targetRealm"] .trigger');
    await click('[data-test-field="targetRealm"] .trigger');
    await waitFor('[data-test-boxel-menu-item-text="Writable Realm"]');

    assert
      .dom('[data-test-boxel-menu-item-text="Writable Realm"]')
      .exists('writable realm is listed');
    assert
      .dom('[data-test-boxel-menu-item-text="Read-only Realm"]')
      .doesNotExist('read-only realm is not offered');

    await click('[data-test-boxel-menu-item-text="Writable Realm"]');

    assert
      .dom('[data-test-field="targetRealm"] button .label')
      .hasText('Writable Realm');
    assert.strictEqual(card.targetRealm, 'https://writable.example/');
  });
});
