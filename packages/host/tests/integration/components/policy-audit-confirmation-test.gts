import { click, settled, waitFor } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import FromElseWhere from 'ember-elsewhere/components/from-elsewhere';
import { module, test } from 'qunit';

import {
  POLICY_AUDIT_CONFIRMATION_HEADER,
  POLICY_OPENS_SHARES_CODE,
  type PolicyShareAudit,
} from '@cardstack/runtime-common';

import PolicyAuditConfirmationModal from '@cardstack/host/components/operator-mode/policy-audit-confirmation-modal';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

const POLICY_URL = 'http://test-realm/policy-audit/policies/team.json';

const audit: PolicyShareAudit = {
  policy: 'http://test-realm/policy-audit/policies/team',
  confirmation: 'confirmation-of-this-list',
  entries: [
    {
      realm: 'http://test-realm/policy-audit-team/',
      share: 'share-alerts',
      label: 'Alerts key',
      owner: '@other:localhost',
      keyAllowsAnonymous: false,
      operations: [
        'http://test-realm/policy-audit-team/weather#Weather.alerts',
      ],
    },
    {
      realm: 'http://test-realm/policy-audit-team/',
      share: 'share-forecast',
      label: 'Forecast key',
      owner: '@owner:localhost',
      keyAllowsAnonymous: true,
      operations: [
        'http://test-realm/policy-audit-team/weather#Weather.forecast',
      ],
    },
  ],
};

module('Integration | policy audit confirmation', function (hooks) {
  setupRenderingTest(hooks);

  // A realm that refuses a write of the policy card until it carries the
  // confirmation, recording each write it is sent.
  function mountRefusingRealm() {
    let writes: { confirmation: string | null }[] = [];
    let handler = async (request: Request) => {
      if (request.url !== POLICY_URL || request.method !== 'POST') {
        return null;
      }
      let confirmation = request.headers.get(POLICY_AUDIT_CONFIRMATION_HEADER);
      writes.push({ confirmation });
      if (confirmation === audit.confirmation) {
        return new Response(null, { status: 204 });
      }
      return new Response(
        JSON.stringify({
          errors: [
            {
              status: 409,
              title: 'Confirm the shared keys this change opens',
              message: 'This change lets people who aren’t signed in…',
              meta: { code: POLICY_OPENS_SHARES_CODE, audit },
            },
          ],
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    };
    getService('network').virtualNetwork.mount(handler, { prepend: true });
    return writes;
  }

  async function renderModal() {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <PolicyAuditConfirmationModal />
          <FromElseWhere @name='modal-elsewhere' />
        </template>
      },
    );
  }

  test('a refused policy save lists the keys it opens, and is sent again with the confirmation once the person agrees', async function (assert) {
    let writes = mountRefusingRealm();
    await renderModal();
    let saving = getService('card-service').saveSource(
      new URL(POLICY_URL),
      '{}',
      'editor',
    );
    await waitFor('[data-test-policy-audit-modal]');
    assert
      .dom('[data-test-policy-audit-starting] [data-test-policy-audit-entry]')
      .exists({ count: 1 });
    assert
      .dom('[data-test-policy-audit-entry="Forecast key"]')
      .containsText('@owner:localhost')
      .containsText('Weather.forecast');
    assert
      .dom('[data-test-policy-audit-refusing] [data-test-policy-audit-entry]')
      .exists({ count: 1 });
    assert
      .dom('[data-test-policy-audit-entry="Alerts key"]')
      .containsText('Weather.alerts');

    await click('[data-test-policy-audit-confirm]');
    let response = await saving;
    assert.strictEqual(response.status, 204, 'the save lands');
    assert.deepEqual(writes, [
      { confirmation: null },
      { confirmation: audit.confirmation },
    ]);
    assert.dom('[data-test-policy-audit-modal]').doesNotExist();
  });

  test('a declined list is not saved, and is not asked about again', async function (assert) {
    let writes = mountRefusingRealm();
    await renderModal();
    let cardService = getService('card-service');
    // Observed from the start, so the refusal is never an unhandled one.
    let refused = assert.rejects(
      cardService.saveSource(new URL(POLICY_URL), '{}', 'editor'),
      'the save reports the refusal',
    );
    await waitFor('[data-test-policy-audit-modal]');
    await click('[data-test-policy-audit-cancel]');
    await refused;

    let refusedAgain = assert.rejects(
      cardService.saveSource(new URL(POLICY_URL), '{}', 'editor'),
    );
    await settled();
    assert.dom('[data-test-policy-audit-modal]').doesNotExist();
    await refusedAgain;
    assert.deepEqual(
      writes.map((write) => write.confirmation),
      [null, null],
      'nothing is sent with a confirmation',
    );
  });
});
