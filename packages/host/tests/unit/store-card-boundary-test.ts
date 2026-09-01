import { module, test } from 'qunit';

import type { Query, Store } from '@cardstack/runtime-common';

import type StoreService from '@cardstack/host/services/store';

import type { CardDef } from '@cardstack/base/card-api';
import type { FileDef } from '@cardstack/base/file-api';

// The card boundary, codified at the type level: the `Store` interface cards
// receive via `@context.store` exposes instances-level search only. The raw
// entry wire format (`searchEntries`) lives on the host `StoreService`
// and is deliberately unreachable through the cards' interface. These
// assertions fail the type-check (and so the test suite) if that boundary
// ever erodes.
type Assert<T extends true> = T;

type CardStoreExposesInstancesSearch = Assert<
  Store['search'] extends (
    query: Query,
    realmURLs?: string[],
  ) => Promise<CardDef[]>
    ? true
    : false
>;

// The element type follows the runtime `scope` argument: a file-scoped search
// is `FileDef`-typed and a mixed-scope search is `(CardDef | FileDef)`-typed,
// both without a caller cast. These pin the scope→element mapping — reverting
// `search` to a flat `Promise<CardDef[]>` breaks the two assertions below.
type CardStoreSearchFilesNarrows = Assert<
  Store['search'] extends (
    query: Query,
    realmURLs: string[] | undefined,
    opts: { scope: 'files' },
  ) => Promise<FileDef[]>
    ? true
    : false
>;

type CardStoreSearchAllNarrows = Assert<
  Store['search'] extends (
    query: Query,
    realmURLs: string[] | undefined,
    opts: { scope: 'all' },
  ) => Promise<(CardDef | FileDef)[]>
    ? true
    : false
>;

type CardStoreLacksSearchEntries = Assert<
  'searchEntries' extends keyof Store ? false : true
>;

type HostStoreServiceCarriesSearchEntries = Assert<
  'searchEntries' extends keyof StoreService ? true : false
>;

// The host service must keep satisfying the cards' interface — it is what a
// card ultimately receives, narrowed to `Store`.
type HostStoreServiceSatisfiesCardStore = Assert<
  StoreService extends Store ? true : false
>;

module('Unit | store card boundary', function () {
  test('the cards-facing Store interface exposes search but not searchEntries', function (assert) {
    // the real assertions are the compile-time types above
    let witnesses: [
      CardStoreExposesInstancesSearch,
      CardStoreSearchFilesNarrows,
      CardStoreSearchAllNarrows,
      CardStoreLacksSearchEntries,
      HostStoreServiceCarriesSearchEntries,
      HostStoreServiceSatisfiesCardStore,
    ] = [true, true, true, true, true, true];
    assert.deepEqual(witnesses, [true, true, true, true, true, true]);
  });
});
