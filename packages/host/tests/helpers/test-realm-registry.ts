import type { Realm } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

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

// The realm server is mocked at ENV.realmServerURL (http://test-realm); realms
// under that origin are served in-process via the test-realm registry and have
// no listener on the real network. Only realms that resolve to a genuinely
// served origin — the base and skills realms on localhost:4201 — can be reached
// with a real fetch. A `globalThis.fetch` against an in-process realm always
// rejects with `TypeError: Failed to fetch`; besides the noise, that rejection
// can escape as an uncaught error and red an unrelated sibling test.
export function isInProcessRealmURL(url: string): boolean {
  try {
    return new URL(url).origin === new URL(ENV.realmServerURL).origin;
  } catch {
    return false;
  }
}
