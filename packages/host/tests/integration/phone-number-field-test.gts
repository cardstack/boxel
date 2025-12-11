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
  PhoneNumberField,
  field,
  contains,
  CardDef,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';
import { getService } from '@universal-ember/test-support';

let loader: Loader;
const phoneSelector = `[data-test-field="phone"] [data-test-boxel-phone-input]`;

module('Integration | PhoneNumberField', function (hooks) {
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

  test('edit format persists normalized phone numbers', async function (assert) {
    class ContactCard extends CardDef {
      @field phone = contains(PhoneNumberField);
    }
    let card = new ContactCard({ phone: null });
    await renderCard(loader, card, 'edit');

    await fillIn(phoneSelector, '2025550125');
    await triggerEvent(phoneSelector, 'blur');

    assert.strictEqual(
      card.phone,
      '+12025550125',
      'card value updates to normalized E.164 format',
    );
  });

  test('edit format clears the model when input is emptied', async function (assert) {
    class ContactCard extends CardDef {
      @field phone = contains(PhoneNumberField);
    }
    let card = new ContactCard({ phone: '+12025550125' });
    await renderCard(loader, card, 'edit');

    await fillIn(phoneSelector, '');
    await triggerEvent(phoneSelector, 'blur');

    assert.strictEqual(card.phone, null, 'card value is cleared');
  });

  test('edit format does not persist invalid input', async function (assert) {
    class ContactCard extends CardDef {
      @field phone = contains(PhoneNumberField);
    }
    let card = new ContactCard({ phone: '+12025550125' });
    await renderCard(loader, card, 'edit');

    await fillIn(phoneSelector, '123');
    await triggerEvent(phoneSelector, 'blur');

    assert.strictEqual(
      card.phone,
      '+12025550125',
      'card retains previous normalized value when validation fails',
    );
  });
});
