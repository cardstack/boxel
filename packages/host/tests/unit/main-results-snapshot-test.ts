import { module, test } from 'qunit';

import type {
  RenderableSearchEntryLike,
  SearchResultsYield,
} from '@cardstack/runtime-common';

import type { MainResultsSnapshot } from '@cardstack/host/services/search-sheet-state';
import { resolveMainResults } from '@cardstack/host/utils/search/main-results-snapshot';

function entry(id: string): RenderableSearchEntryLike {
  return {
    id,
    realmUrl: 'http://test-realm/test/',
    name: id,
    isError: false,
    component: null as unknown as RenderableSearchEntryLike['component'],
  };
}

function live(partial: Partial<SearchResultsYield> = {}): SearchResultsYield {
  return {
    entries: [],
    isLoading: false,
    meta: { page: { total: 0 } },
    errors: undefined,
    ...partial,
  };
}

function snapshot(queryKey: string): MainResultsSnapshot {
  return {
    queryKey,
    entries: [entry('http://test-realm/test/Pet/mango')],
    meta: { page: { total: 1 } },
  };
}

module('Unit | main-results-snapshot | resolveMainResults', function () {
  test('shows the snapshot when its key matches and live is empty + loading', function (assert) {
    let result = resolveMainResults(
      live({ isLoading: true }),
      snapshot('key-a'),
      'key-a',
    );
    assert.strictEqual(result.entries.length, 1, 'snapshot entries are shown');
    assert.true(result.isLoading, 'flagged loading so the indicator shows');
  });

  test('renders live when the snapshot belongs to a different search', function (assert) {
    let result = resolveMainResults(
      live({ isLoading: true }),
      snapshot('key-a'),
      'key-b',
    );
    assert.strictEqual(result.entries.length, 0, 'stale snapshot is not shown');
  });

  test('renders live when the current search is idle (no key)', function (assert) {
    let result = resolveMainResults(
      live({ isLoading: true }),
      snapshot('key-a'),
      undefined,
    );
    assert.strictEqual(
      result.entries.length,
      0,
      'no snapshot for an idle sheet',
    );
  });

  test('renders live once the live search has settled', function (assert) {
    let settled = live({
      isLoading: false,
      entries: [entry('http://test-realm/test/Pet/vangogh')],
      meta: { page: { total: 1 } },
    });
    let result = resolveMainResults(settled, snapshot('key-a'), 'key-a');
    assert.strictEqual(result, settled, 'live results take over');
  });

  test('renders live when live already has rows (re-run keeps them)', function (assert) {
    let withRows = live({
      isLoading: true,
      entries: [entry('http://test-realm/test/Pet/vangogh')],
    });
    let result = resolveMainResults(withRows, snapshot('key-a'), 'key-a');
    assert.strictEqual(
      result,
      withRows,
      'no snapshot substitution when live has rows',
    );
  });

  test('renders live when there is no snapshot', function (assert) {
    let loading = live({ isLoading: true });
    let result = resolveMainResults(loading, undefined, 'key-a');
    assert.strictEqual(result, loading, 'nothing to substitute');
  });
});
