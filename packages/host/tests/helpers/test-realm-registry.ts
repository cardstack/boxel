import type { Realm } from '@cardstack/runtime-common';

import type { TestRealmAdapter } from './adapter';

type TestRealmRecord = {
  realm: Realm;
  adapter: TestRealmAdapter;
};

const TEST_REALM_REGISTRY = '__cardstack_testRealmRegistry';

export function getTestRealmRegistry(): Map<string, TestRealmRecord> {
  // We track test realms globally so helpers like persistDocumentToTestRealm can
  // locate the correct realm/adapter for a card URL during test runs.
  let registry = (globalThis as any)[TEST_REALM_REGISTRY] as
    | Map<string, TestRealmRecord>
    | undefined;
  if (!registry) {
    registry = new Map();
    (globalThis as any)[TEST_REALM_REGISTRY] = registry;
  }
  return registry;
}
