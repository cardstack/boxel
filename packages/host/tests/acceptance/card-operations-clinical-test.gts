import { click, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import type { Realm } from '@cardstack/runtime-common';

import {
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  setupOnSave,
  setupRealmCacheTeardown,
  testRealmURL,
  visitOperatorMode,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

// The realm under test is the shipped clinical example, read from the files
// the realm actually serves rather than from a copy — so the example and this
// test cannot drift apart. A change that breaks an operation breaks this.
import chartFields from '../../../experiments-realm/clinical/chart-fields.gts?raw';
import clinicalDashboard from '../../../experiments-realm/clinical/clinical-dashboard.gts?raw';
import clinician from '../../../experiments-realm/clinical/clinician.gts?raw';
import facility from '../../../experiments-realm/clinical/facility.gts?raw';
import patientRecord from '../../../experiments-realm/clinical/patient-record.gts?raw';

import aishaTahir from '../../../experiments-realm/clinical/Clinician/aisha-tahir.json?raw';
import elenaRuiz from '../../../experiments-realm/clinical/Clinician/elena-ruiz.json?raw';
import jordanBlake from '../../../experiments-realm/clinical/Clinician/jordan-blake.json?raw';
import theoMartin from '../../../experiments-realm/clinical/Clinician/theo-martin.json?raw';
import northstar from '../../../experiments-realm/clinical/HospitalFacility/northstar.json?raw';
import pt1001 from '../../../experiments-realm/clinical/PatientRecord/pt-1001.json?raw';

const OPEN_EVENT = 'RE-4471';
const RESOLVED_EVENT = 'RE-4469';

module('Acceptance | card operations | clinical example', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });
  let realm: Realm;

  hooks.beforeEach(async function () {
    ({ realm } = await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        'clinical/chart-fields.gts': chartFields,
        'clinical/clinician.gts': clinician,
        'clinical/facility.gts': facility,
        'clinical/patient-record.gts': patientRecord,
        'clinical/clinical-dashboard.gts': clinicalDashboard,
        'clinical/audit/pt-1001.txt': '# Clinical audit log for PT-1001\n',
        'clinical/Clinician/aisha-tahir.json': JSON.parse(aishaTahir),
        'clinical/Clinician/jordan-blake.json': JSON.parse(jordanBlake),
        'clinical/Clinician/theo-martin.json': JSON.parse(theoMartin),
        'clinical/Clinician/elena-ruiz.json': JSON.parse(elenaRuiz),
        'clinical/HospitalFacility/northstar.json': JSON.parse(northstar),
        'clinical/PatientRecord/pt-1001.json': JSON.parse(pt1001),
      },
    }));
  });

  async function openTheRecord() {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}clinical/PatientRecord/pt-1001`,
            format: 'isolated',
          },
        ],
      ],
    });
    await waitUntil(() =>
      Boolean(document.querySelector('[data-test-patient-name]')),
    );
  }

  // What the realm holds, as opposed to what the page is showing. An assertion
  // that only reads the DOM cannot tell a write that did not happen from one
  // the store has not caught up with yet.
  async function storedRecord(): Promise<any> {
    let response = await realm.handle(
      new Request(`${testRealmURL}clinical/PatientRecord/pt-1001`, {
        headers: { Accept: 'application/vnd.card+json' },
      }),
    );
    return (await response.json()).data;
  }

  function eventStatus(record: any, eventId: string): string | undefined {
    return (record.attributes.rhythmEvents as any[]).find(
      (event) => event.eventId === eventId,
    )?.status;
  }

  test('a named transform runs from the card and the record holds the change', async function (assert) {
    await openTheRecord();

    assert
      .dom(`[data-test-rhythm-event="${OPEN_EVENT}"] [data-test-rhythm-status]`)
      .hasText('open', 'the event starts open');
    assert.dom('[data-test-severity]').hasText('Moderate');

    await click(`[data-test-escalate="${OPEN_EVENT}"]`);
    await waitUntil(
      () =>
        document
          .querySelector(
            `[data-test-rhythm-event="${OPEN_EVENT}"] [data-test-rhythm-status]`,
          )
          ?.textContent?.trim() === 'escalated',
      { timeout: 10_000 },
    );

    assert
      .dom('[data-test-severity]')
      .hasText('Critical', 'the operation also set the severity it declares');
    assert
      .dom('[data-test-refusal]')
      .doesNotExist('and the operation was not refused');

    let stored = await storedRecord();
    assert.strictEqual(
      eventStatus(stored, OPEN_EVENT),
      'escalated',
      'the realm holds the escalated event, not just the page',
    );
    assert.strictEqual(
      stored.attributes.rhythmEvents.find(
        (event: any) => event.eventId === OPEN_EVENT,
      ).findings,
      'Rate control started, cardiology paged',
      'carrying the findings the payload supplied',
    );
    assert.strictEqual(
      eventStatus(stored, RESOLVED_EVENT),
      'resolved',
      'and the event the program did not select is untouched',
    );
  });

  test("a failed assert shows the author's message and writes nothing", async function (assert) {
    await openTheRecord();

    // The second event is already resolved, so the precondition the
    // declaration asserts — that the event is still open — does not hold.
    let before = await storedRecord();

    await click(`[data-test-escalate="${RESOLVED_EVENT}"]`);
    await waitUntil(
      () => Boolean(document.querySelector('[data-test-refusal]')),
      { timeout: 10_000 },
    );

    assert
      .dom('[data-test-refusal]')
      .containsText(
        'That rhythm event is not open, so there is nothing to escalate',
        "the sentence the declaration's own assert carries is what the page shows",
      );
    assert
      .dom(
        `[data-test-rhythm-event="${RESOLVED_EVENT}"] [data-test-rhythm-status]`,
      )
      .hasText('resolved', 'the event the caller named did not change');
    assert.dom('[data-test-severity]').hasText('Moderate');

    let after = await storedRecord();
    assert.strictEqual(
      eventStatus(after, RESOLVED_EVENT),
      'resolved',
      'and the realm wrote nothing',
    );
    assert.strictEqual(
      after.meta.version,
      before.meta.version,
      'the card is at the version it was at before the refusal',
    );
  });
});
