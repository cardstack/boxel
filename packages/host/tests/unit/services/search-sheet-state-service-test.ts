import { getService } from '@universal-ember/test-support';
import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import {
  rri,
  type ResolvedCodeRef,
  type Sort,
} from '@cardstack/runtime-common';

import type { SortOption } from '@cardstack/host/components/search/constants';
import type SessionService from '@cardstack/host/services/session';
import type SearchSheetStateService from '@cardstack/host/services/search-sheet-state';

const CODE_REF: ResolvedCodeRef = {
  module: rri('http://test-realm/test/pet'),
  name: 'Pet',
};
const SORT: SortOption = {
  displayName: 'A-Z',
  sort: [{ by: 'cardTitle', direction: 'asc' }] as Sort,
};

function populate(service: SearchSheetStateService) {
  service.searchKey = 'Mango';
  service.selectedTypes = [CODE_REF];
  service.selectedRealms = [new URL('http://test-realm/test/')];
  service.activeSort = SORT;
  service.activeViewId = 'strip';
  service.pagination.focus('realm:http://test-realm/test/');
  service.resultsScrollTop = 240;
}

function assertCleared(
  assert: Assert,
  service: SearchSheetStateService,
  label: string,
) {
  assert.strictEqual(service.searchKey, '', `${label}: searchKey cleared`);
  assert.strictEqual(
    service.selectedTypes,
    undefined,
    `${label}: selectedTypes cleared`,
  );
  assert.deepEqual(
    service.selectedRealms,
    [],
    `${label}: selectedRealms cleared`,
  );
  assert.strictEqual(
    service.activeSort,
    undefined,
    `${label}: activeSort cleared`,
  );
  assert.strictEqual(
    service.activeViewId,
    'grid',
    `${label}: activeViewId back to default`,
  );
  assert.strictEqual(
    service.pagination.focusedSection,
    null,
    `${label}: pagination reset`,
  );
  assert.strictEqual(
    service.resultsScrollTop,
    0,
    `${label}: resultsScrollTop back to default`,
  );
}

module('Unit | Service | search-sheet-state', function (hooks) {
  setupTest(hooks);

  let service: SearchSheetStateService;

  hooks.beforeEach(function () {
    service = getService('search-sheet-state');
  });

  test('resetState() restores every field to its default', function (assert) {
    populate(service);
    service.resetState();
    assertCleared(assert, service, 'resetState');
  });

  test('is cleared by the session service on logout', function (assert) {
    populate(service);
    (getService('session') as SessionService).notifySessionEnded();
    assertCleared(assert, service, 'notifySessionEnded');
  });

  test('resetState() installs a fresh pagination instance', function (assert) {
    let before = service.pagination;
    service.resetState();
    assert.notStrictEqual(
      service.pagination,
      before,
      'a new SectionPagination replaces the old one',
    );
  });

  test('mainQuery is idle with an empty key and derives from the service inputs once a key is set', function (assert) {
    assert.strictEqual(
      service.mainQuery,
      undefined,
      'an empty search key leaves the query idle',
    );

    service.searchKey = 'Mango';
    let query = service.mainQuery;
    assert.ok(query, 'a search key yields a derived query');
    // The sheet caps each realm's rows at the focused-section display limit;
    // an empty realm selection lets the resource fall back to every realm.
    assert.ok(query?.page, 'the derived query carries the per-realm page cap');
    assert.deepEqual(
      query?.realms,
      [],
      'no realm selection => empty realms (the resource searches all)',
    );
  });

  test('a type-only search (empty term) is active and derives a type-filtered query', function (assert) {
    // Code mode's "Find instances" sets a type with no term. This must count as
    // an active search so the reopen gate lands on the results view, and the
    // derived query must carry the type filter (never run unfiltered).
    service.selectedTypes = [CODE_REF];

    assert.true(
      service.hasActiveSearch,
      'a type filter with no term is an active search',
    );
    let query = service.mainQuery;
    assert.ok(query, 'a type-only selection yields a derived query');
    assert.ok(
      JSON.stringify(query?.filter ?? {}).includes(CODE_REF.name),
      'the derived query carries the selected type filter',
    );
  });

  test('an empty search is not active', function (assert) {
    assert.false(
      service.hasActiveSearch,
      'no term, no type, no realm => no active search',
    );
  });
});
