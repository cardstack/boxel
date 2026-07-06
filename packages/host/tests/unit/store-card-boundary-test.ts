import { module, test } from 'qunit';

import type { Query, Store } from '@cardstack/runtime-common';

import type StoreService from '@cardstack/host/services/store';

import type { CardDef } from 'https://cardstack.com/base/card-api';

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
      CardStoreLacksSearchEntries,
      HostStoreServiceCarriesSearchEntries,
      HostStoreServiceSatisfiesCardStore,
    ] = [true, true, true, true];
    assert.deepEqual(witnesses, [true, true, true, true]);
  });
});
