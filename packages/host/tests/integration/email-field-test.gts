import { fillIn, triggerEvent } from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  PermissionsContextName,
  type Permissions,
  baseRealm,
} from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import {
  provideConsumeContext,
  setupCardLogs,
  setupSnapshotRealm,
} from '../helpers';
import {
  EmailField,
  field,
  contains,
  CardDef,
  Component,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';
import { getService } from '@universal-ember/test-support';

let loader: Loader;

module('Integration | EmailField', function (hooks) {
  setupRenderingTest(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks);

  let snapshot = setupSnapshotRealm<{ loader: Loader }>(hooks, {
    mockMatrixUtils,
    async build({ loader }) {
      let loaderService = getService('loader-service');
      loaderService.loader = loader;
      return { loader };
    },
  });

  hooks.beforeEach(function () {
    let permissions: Permissions = { canWrite: true, canRead: true };
    provideConsumeContext(PermissionsContextName, permissions);
    ({ loader } = snapshot.get());
  });

  setupCardLogs(
    hooks,
    async () => await snapshot.get().loader.import(`${baseRealm.url}card-api`),
  );

  test('edit format uses EmailInput and only persists valid addresses', async function (assert) {
    class ContactCard extends CardDef {
      @field email = contains(EmailField);
    }

    let card = new ContactCard({ email: 'alice@email.com' });
    await renderCard(loader, card, 'edit');

    const emailInput = `[data-test-field="email"] [data-test-boxel-email-input]`;

    assert.dom(emailInput).hasAttribute('type', 'email', 'input type is email');
    assert
      .dom(emailInput)
      .hasValue('alice@email.com', 'input reflects initial card value');

    await fillIn(emailInput, 'invalid-address');
    await triggerEvent(emailInput, 'blur');

    assert.strictEqual(
      card.email,
      'alice@email.com',
      'card value remains unchanged when validation fails',
    );

    await fillIn(emailInput, 'alice-updated@email.com');

    assert.strictEqual(
      card.email,
      'alice-updated@email.com',
      'card value updates when a valid email is entered',
    );
  });

  test('atom format renders a mailto link when email is present', async function (assert) {
    class ContactCard extends CardDef {
      @field email = contains(EmailField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <@fields.email @format='atom' />
        </template>
      };
    }

    let card = new ContactCard({ email: 'person@example.com' });
    await renderCard(loader, card, 'isolated');

    assert
      .dom('[data-test-atom-email]')
      .hasAttribute('href', 'mailto:person@example.com');
    assert.dom('[data-test-atom-email]').hasText('person@example.com');
  });
});
