import {
  click,
  fillIn,
  find,
  triggerKeyEvent,
  visit,
  waitFor,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  setupAcceptanceTestRealm,
  testRealmURL,
  setupAuthEndpoints,
  setupUserSubscription,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  realmConfigCardJSON,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const STACK = '[data-test-operator-mode-stack="0"]';
const WORKSPACE_NAME = 'Test Workspace';
const WORKSPACE_BUTTON = `[data-test-workspace-button="${WORKSPACE_NAME}"]`;

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
        'realm.json': realmConfigCardJSON({ name: WORKSPACE_NAME }),
        'note.gts': { Note },
        'index.json': new Workspace(),
        'Note/1.json': new Note({ cardTitle: 'First Note' }),
        // A plain uploaded file (not a card). It indexes as a `file` row, so it
        // only reaches the Activity feed if the feed query surfaces files
        // alongside cards.
        'welcome-song.mp3': 'ID3 fake audio bytes',
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
    await click(WORKSPACE_BUTTON);

    await waitFor(`${STACK} nav.tabs`);
    assert
      .dom(`${STACK} nav.tabs [data-test-workspace-tab]`)
      .exists({ count: 3 }, 'Home, Library, and Activity tabs render');
    assert
      .dom(`${STACK} nav.tabs [aria-current="true"]`)
      .hasText('Home', 'Home is the default segment');

    await click(`${STACK} [data-test-workspace-tab="library"]`);
    assert.dom(`${STACK} [data-test-library]`).exists('Library pane renders');

    await click(`${STACK} [data-test-workspace-tab="activity"]`);
    assert.dom(`${STACK} [data-test-activity]`).exists('Activity pane renders');
  });

  // Pills are matched by their visible label rather than by index, since the
  // order of `_types` inventory isn't part of the contract. Asserts and then
  // throws on a miss so a fixture that stops producing the type fails as a
  // named assertion instead of a null dereference further down.
  function findTypeChip(assert: Assert, label: string): HTMLElement {
    let chip = [
      ...document.querySelectorAll(`${STACK} [data-test-type-chip]`),
    ].find((el) => el.textContent?.includes(label));
    assert.ok(chip, `a pill for the ${label} card type is present`);
    if (!(chip instanceof HTMLElement)) {
      throw new Error(`no Browse pill labelled "${label}" was rendered`);
    }
    return chip;
  }

  test('the "New card" chooser searches across all available realms, not just this workspace', async function (assert) {
    await visit('/');
    await click(WORKSPACE_BUTTON);
    await waitFor(`${STACK} nav.tabs`);

    // The empty-space welcome hero offers a "New card" affordance that opens
    // the Spec chooser. The chosen Spec may live in any realm the user can
    // reach; the new card still lands in this workspace's realm.
    await click(`${STACK} [data-test-welcome-new-card]`);
    await waitFor('[data-test-card-chooser-modal]');

    // The realm scope must not be locked to the workspace's own realm — the
    // picker stays interactive and offers other reachable realms.
    await waitFor('[data-test-realm-picker] [data-test-boxel-picker-trigger]');
    await click('[data-test-realm-picker] [data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');
    assert
      .dom(`[data-test-boxel-picker-option-row="${baseRealm.url}"]`)
      .exists('a realm other than the workspace realm is selectable');
    assert
      .dom(`[data-test-boxel-picker-option-row="${testRealmURL}"]`)
      .exists('the workspace realm is also among the choices');
  });

  // The Home "Browse" module renders one pill per realm card/file type with
  // that type's instance count, and clicking a pill opens the Library filtered
  // to that type. It only renders once `_types` has reported inventory, so it
  // needs a realm with real indexed instances — hence acceptance, not the bare
  // isolated-render integration tests.
  test('Home Browse lists a pill per card type with its instance count', async function (assert) {
    await visit('/');
    await click(WORKSPACE_BUTTON);
    await waitFor(`${STACK} nav.tabs`);

    await waitFor(`${STACK} [data-test-browse]`);
    assert
      .dom(`${STACK} [data-test-browse]`)
      .exists(
        'the Home Browse module renders once the realm reports inventory',
      );

    let noteChip = findTypeChip(assert, 'Note');
    assert
      .dom(noteChip.querySelector('[data-test-type-chip-count]'))
      .hasText('1', 'the Note pill shows its single-instance count');
  });

  test('clicking a Home Browse pill opens the Library filtered to that type', async function (assert) {
    await visit('/');
    await click(WORKSPACE_BUTTON);
    await waitFor(`${STACK} [data-test-browse]`);

    let noteChip = findTypeChip(assert, 'Note');
    assert.ok(
      noteChip.getAttribute('data-test-type-chip'),
      'the Note pill carries the type id it filters on',
    );

    await click(noteChip);

    assert
      .dom(`${STACK} nav.tabs [aria-current="true"]`)
      .hasText('Library', 'the pill switches to the Library segment');
    assert
      .dom(`${STACK} [data-test-selected-filter="Note"]`)
      .exists('the Library opens with the clicked type pre-selected');
  });

  // The Library rail lists a row per realm card type (sourced from the same
  // `_types` inventory that feeds the Home pills), each with its instance count
  // — not just the base Everything / Cards / Files filters.
  test('the Library rail lists a row per card type with its count', async function (assert) {
    await visit('/');
    await click(WORKSPACE_BUTTON);
    await waitFor(`${STACK} nav.tabs`);

    await click(`${STACK} [data-test-workspace-tab="library"]`);
    await waitFor(`${STACK} [data-test-rail-group]`);

    assert
      .dom(
        `${STACK} [data-test-boxel-filter-list-button="Note"] [data-test-filter-list-count]`,
      )
      .hasText('1', 'the Note rail row shows its single-instance count');
  });

  // Operator mode reads Escape on anything that is not a text field as "close
  // this card". A result is a button, so the Escape that dismisses the search
  // from a focused result has to stop before it reaches the document, or the
  // whole workspace closes with the list.
  test('Escape on a focused search result dismisses the results and keeps the workspace open', async function (assert) {
    await visit('/');
    await click(WORKSPACE_BUTTON);
    await waitFor(`${STACK} nav.tabs`);

    await fillIn(`${STACK} [data-test-workspace-search]`, 'First');
    await waitFor(`${STACK} [data-test-search-result]`);

    let result = find(`${STACK} [data-test-search-result]`) as HTMLElement;
    result.focus();
    await triggerKeyEvent(result, 'keydown', 'Escape');

    assert
      .dom(`${STACK} [data-test-workspace-index]`)
      .exists('the workspace card is still open');
    assert
      .dom(`${STACK} [data-test-search-result]`)
      .doesNotExist('the results are dismissed');
    assert
      .dom(`${STACK} [data-test-workspace-search]`)
      .hasValue('', 'the term is cleared');
  });

  test('a remix surfaces in the Activity feed as a first-class event', async function (assert) {
    await visit('/');
    await click(WORKSPACE_BUTTON);
    await waitFor(`${STACK} nav.tabs`);

    await click(`${STACK} [data-test-workspace-tab="activity"]`); // Activity
    await waitFor(`${STACK} [data-test-feed-verb="Remixed"]`);
    assert
      .dom(`${STACK} [data-test-feed-verb="Remixed"]`)
      .hasText('Remixed', 'the remix reads as a Remixed event, not a save');

    await waitFor(`${STACK} [data-test-feed-remix-source]`);
    assert
      .dom(`${STACK} [data-test-feed-remix-source]`)
      .hasText(
        'from First Note',
        'the event names the source it was cloned from',
      );
  });

  test('an uploaded file surfaces in the Activity feed alongside cards', async function (assert) {
    await visit('/');
    await click(WORKSPACE_BUTTON);
    await waitFor(`${STACK} nav.tabs`);

    await click(`${STACK} [data-test-workspace-tab="activity"]`); // Activity
    await waitFor(`${STACK} [data-test-feed-row]`);

    let rows = [...document.querySelectorAll(`${STACK} [data-test-feed-row]`)];
    let titleOf = (row: Element) =>
      row.querySelector('[data-test-feed-title]')?.textContent?.trim();
    let fileRow = rows.find((row) => titleOf(row) === 'welcome-song.mp3');
    assert.ok(
      fileRow,
      `the uploaded audio file appears in the feed (saw: ${rows
        .map(titleOf)
        .join(', ')})`,
    );

    // A file row must be dated, not merely present: '—' is the placeholder
    // rendered when the file's `lastModified` meta fails to reach the client,
    // and the title alone would still render in that case.
    let when =
      fileRow!.querySelector('[data-test-feed-when]')?.textContent?.trim() ??
      '';
    assert.notStrictEqual(
      when,
      '—',
      'the file row carries a real timestamp, not the missing-date placeholder',
    );
    assert.notStrictEqual(when, '', 'the file row renders its timestamp rail');

    // Source modules index as file rows too, but the feed's query excludes
    // code edits so they cannot crowd cards out of the shared row budget.
    assert.notOk(
      rows.some((row) => titleOf(row) === 'note.gts'),
      'a source module does not appear in the feed',
    );
  });

  test('opening a file feed row opens the file, not a card', async function (assert) {
    await visit('/');
    await click(WORKSPACE_BUTTON);
    await waitFor(`${STACK} nav.tabs`);

    await click(`${STACK} [data-test-workspace-tab="activity"]`); // Activity
    await waitFor(`${STACK} [data-test-feed-row]`);

    // A file feed row routes through the file stack-item path, keyed by the
    // file's URL — not the card path a card row takes.
    await click(`${STACK} [aria-label="Open welcome-song.mp3"]`);
    await waitFor(`[data-test-stack-card="${testRealmURL}welcome-song.mp3"]`);
    assert
      .dom(`[data-test-stack-card="${testRealmURL}welcome-song.mp3"]`)
      .exists('the file opens as a file stack item');
  });
});
