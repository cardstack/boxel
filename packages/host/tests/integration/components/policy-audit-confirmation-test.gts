import { click, waitFor } from '@ember/test-helpers';

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

const POLICY = 'http://test-realm/policy-audit/policies/team';

const audit: PolicyShareAudit = {
  confirmation: 'confirmation-of-this-list',
  entries: [
    {
      realm: 'http://test-realm/policy-audit-team/',
      policy: POLICY,
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
      policy: POLICY,
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
  function mountRefusingRealm(shown: PolicyShareAudit = audit) {
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
              meta: { code: POLICY_OPENS_SHARES_CODE, audit: shown },
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

  test('a declined list is not saved, and the next save that is refused for it asks again', async function (assert) {
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
    assert.dom('[data-test-policy-audit-modal]').doesNotExist();

    let again = cardService.saveSource(new URL(POLICY_URL), '{}', 'editor');
    await waitFor('[data-test-policy-audit-modal]');
    assert.dom('[data-test-policy-audit-modal]').exists('it asks again');
    await click('[data-test-policy-audit-confirm]');
    assert.strictEqual((await again).status, 204);
    assert.deepEqual(
      writes.map((write) => write.confirmation),
      [null, null, audit.confirmation],
    );
  });

  test('a list just confirmed is not asked about again while the save it confirmed lands', async function (assert) {
    let writes = mountRefusingRealm();
    await renderModal();
    let cardService = getService('card-service');
    let first = cardService.saveSource(new URL(POLICY_URL), '{}', 'editor');
    await waitFor('[data-test-policy-audit-modal]');
    await click('[data-test-policy-audit-confirm]');
    await first;
    let second = await cardService.saveSource(
      new URL(POLICY_URL),
      '{}',
      'editor',
    );
    assert.strictEqual(second.status, 204);
    assert.dom('[data-test-policy-audit-modal]').doesNotExist();
    assert.deepEqual(
      writes.map((write) => write.confirmation),
      [null, audit.confirmation, null, audit.confirmation],
      'the second save is sent again with the confirmation without asking',
    );
  });

  test('with nothing mounted to ask with, a refused save reports the refusal at once', async function (assert) {
    let writes = mountRefusingRealm();
    await assert.rejects(
      getService('card-service').saveSource(
        new URL(POLICY_URL),
        '{}',
        'editor',
      ),
    );
    assert.deepEqual(writes, [{ confirmation: null }]);
  });

  test('a list without the share details names the workspace instead', async function (assert) {
    mountRefusingRealm({
      ...audit,
      entries: audit.entries.map((entry) => ({
        ...entry,
        share: null,
        label: null,
        owner: null,
      })),
    });
    await renderModal();
    let refused = assert.rejects(
      getService('card-service').saveSource(
        new URL(POLICY_URL),
        '{}',
        'editor',
      ),
    );
    await waitFor('[data-test-policy-audit-modal]');
    assert
      .dom('[data-test-policy-audit-starting] [data-test-policy-audit-entry]')
      .containsText('A key shared into http://test-realm/policy-audit-team/')
      .doesNotContainText('@owner:localhost');
    await click('[data-test-policy-audit-cancel]');
    await refused;
  });
});
