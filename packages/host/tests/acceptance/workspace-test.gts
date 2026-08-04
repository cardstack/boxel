import { click, visit, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  setupLocalIndexing,
  setupAcceptanceTestRealm,
  testRealmURL,
  setupAuthEndpoints,
  setupUserSubscription,
  SYSTEM_CARD_FIXTURE_CONTENTS,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const STACK = '[data-test-operator-mode-stack="0"]';

module('Acceptance | workspace card', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  let { createAndJoinRoom } = mockMatrixUtils;

  hooks.beforeEach(async function () {
    createAndJoinRoom({ sender: '@testuser:localhost', name: 'room-test' });
    setupUserSubscription();
    setupAuthEndpoints();

    let loader = getService('loader-service').loader;
    let { field, contains, CardDef, Component } = await loader.import<
      typeof import('@cardstack/base/card-api')
    >('@cardstack/base/card-api');
    let { default: StringField } = await loader.import<
      typeof import('@cardstack/base/string')
    >('@cardstack/base/string');
    let { Workspace } = await loader.import<
      typeof import('@cardstack/base/workspace')
    >('@cardstack/base/workspace');

    class Note extends CardDef {
      @field cardTitle = contains(StringField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-note><@fields.cardTitle /></div>
        </template>
      };
    }

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'note.gts': { Note },
        'index.json': new Workspace(),
        'Note/1.json': new Note({ cardTitle: 'First Note' }),
        // A remix cloned from Note/1 — its own indexed instance is the record
        // of the clone that the Activity feed surfaces as a "Remixed" event.
        'Remix/1.json': {
          data: {
            attributes: { listingName: 'Remixed Space' },
            relationships: {
              remixedFrom: { links: { self: '../Note/1' } },
            },
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/remix-card',
                name: 'RemixCard',
              },
            },
          },
        },
      },
    });
  });

  test('a realm indexed by Workspace renders its shell and switches segments', async function (assert) {
    await visit('/');
    assert.dom('[data-test-workspace-chooser]').exists();
    await click('[data-test-workspace-button="Unnamed Workspace"]');

    await waitFor(`${STACK} nav.tabs`);
    assert
      .dom(`${STACK} nav.tabs .tab`)
      .exists({ count: 3 }, 'Home, Library, and Activity tabs render');
    assert
      .dom(`${STACK} nav.tabs .tab.active`)
      .hasText('Home', 'Home is the default segment');

    await click(`${STACK} nav.tabs .tab:nth-child(2)`);
    assert.dom(`${STACK} .library`).exists('Library pane renders');

    await click(`${STACK} nav.tabs .tab:nth-child(3)`);
    assert.dom(`${STACK} .activity-pane`).exists('Activity pane renders');
  });

  // The Home "Browse" module renders one pill per realm card/file type with
  // that type's instance count, and clicking a pill opens the Library filtered
  // to that type. It only renders once `_types` has reported inventory, so it
  // needs a realm with real indexed instances — hence acceptance, not the bare
  // isolated-render integration tests.
  test('Home Browse lists a pill per card type with its instance count', async function (assert) {
    await visit('/');
    await click('[data-test-workspace-button="Unnamed Workspace"]');
    await waitFor(`${STACK} nav.tabs`);

    await waitFor(`${STACK} [data-test-browse]`);
    assert
      .dom(`${STACK} [data-test-browse]`)
      .exists(
        'the Home Browse module renders once the realm reports inventory',
      );

    let noteChip = [
      ...document.querySelectorAll(`${STACK} [data-test-type-chip]`),
    ].find((el) => el.textContent?.includes('Note')) as HTMLElement | undefined;
    assert.ok(noteChip, 'a pill for the Note card type is present');
    assert
      .dom(noteChip!.querySelector('[data-test-type-chip-count]'))
      .hasText('1', 'the Note pill shows its single-instance count');
  });

  test('clicking a Home Browse pill opens the Library filtered to that type', async function (assert) {
    await visit('/');
    await click('[data-test-workspace-button="Unnamed Workspace"]');
    await waitFor(`${STACK} [data-test-browse]`);

    let noteChip = [
      ...document.querySelectorAll(`${STACK} [data-test-type-chip]`),
    ].find((el) => el.textContent?.includes('Note')) as HTMLElement | undefined;
    let noteTypeId = noteChip!.getAttribute('data-test-type-chip');

    await click(noteChip!);

    assert
      .dom(`${STACK} nav.tabs .tab.active`)
      .hasText('Library', 'the pill switches to the Library segment');
    assert
      .dom(`${STACK} [data-test-workspace-filter="${noteTypeId}"]`)
      .hasClass(
        'selected',
        'the Library opens with the clicked type pre-selected',
      );
  });

  // The Library rail lists a row per realm card type (sourced from the same
  // `_types` inventory that feeds the Home pills), each with its instance count
  // — not just the base Everything / Cards / Files filters.
  test('the Library rail lists a row per card type with its count', async function (assert) {
    await visit('/');
    await click('[data-test-workspace-button="Unnamed Workspace"]');
    await waitFor(`${STACK} nav.tabs`);

    await click(`${STACK} nav.tabs .tab:nth-child(2)`); // Library
    await waitFor(`${STACK} .rail-group`);

    let noteRow = [
      ...document.querySelectorAll(`${STACK} .rail-row.type`),
    ].find((el) => el.textContent?.includes('Note')) as HTMLElement | undefined;
    assert.ok(noteRow, 'the Library rail lists a Note card-type row');
    assert
      .dom(noteRow!.querySelector('.rail-count'))
      .hasText('1', 'the Note rail row shows its single-instance count');
  });

  test('a remix surfaces in the Activity feed as a first-class event', async function (assert) {
    await visit('/');
    await click('[data-test-workspace-button="Unnamed Workspace"]');
    await waitFor(`${STACK} nav.tabs`);

    await click(`${STACK} nav.tabs .tab:nth-child(3)`); // Activity
    await waitFor(`${STACK} .feed-verb.remixed`);
    assert
      .dom(`${STACK} .feed-verb.remixed`)
      .hasText('Remixed', 'the remix reads as a Remixed event, not a save');

    await waitFor(`${STACK} .feed-remix-source`);
    assert
      .dom(`${STACK} .feed-remix-source`)
      .hasText(
        'from First Note',
        'the event names the source it was cloned from',
      );
  });
});
