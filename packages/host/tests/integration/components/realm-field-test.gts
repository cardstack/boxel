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
import { Loader } from '@cardstack/runtime-common/loader';

import {
  provideConsumeContext,
  setupCardLogs,
  setupSnapshotRealm,
} from '../../helpers';
import {
  field,
  contains,
  CardDef,
  StringField,
  RealmField,
} from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';
import { setupMockMatrix } from '../../helpers/mock-matrix';

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

  let loader: Loader;
  let commandContext: CommandContext;

  let snapshot = setupSnapshotRealm<{ loader: Loader }>(hooks, {
    mockMatrixUtils: setupMockMatrix(hooks),
    async build({ loader }) {
      let loaderService = getService('loader-service');
      loaderService.loader = loader;
      return { loader };
    },
  });

  setupCardLogs(hooks, async () => {
    return await snapshot.get().loader.import(`${baseRealm.url}card-api`);
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    ({ loader } = snapshot.get());

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
      @field title = contains(StringField);
      @field targetRealm = contains(RealmField);
    }

    let card = new RealmPickerCard({
      title: 'Realm Picker Example',
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
