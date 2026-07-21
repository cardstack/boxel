import { getService } from '@universal-ember/test-support';
import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import {
  rri,
  type ResolvedCodeRef,
  type Sort,
} from '@cardstack/runtime-common';

import type { SortOption } from '@cardstack/host/components/search/constants';
import type ResetService from '@cardstack/host/services/reset';
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

  test('is cleared by the reset service (logout/realm reset)', function (assert) {
    populate(service);
    (getService('reset') as ResetService).resetAll();
    assertCleared(assert, service, 'resetAll');
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
});
