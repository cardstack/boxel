import type { Realm } from '@cardstack/runtime-common';
import { findRealm } from './realm-routing.ts';
import type { CreateRoutesArgs } from '../routes.ts';

// Whether a realm's policy opens a call that sends a shared key to people who
// aren't signed in: some live grant names `"anonymous"` on a `callApi` with a
// shared-key slot (`{{apiKey}}`). The policy compiles such a grant only for an
// operation whose every credential slot takes a shared key, and one on a
// keyless `callApi` sends no key at all, so this is exactly whether a share in
// the realm could be asked to serve such a caller.
//
// Sharing a key into such a realm means those callers will use it, so only a
// key whose owner allows anonymous use, on the key itself, is shared or
// swapped in there (`key-shares.ts`). The secure window and the CLI read this
// to say so before sharing.
export async function opensSharedKeysToAnonymous(
  realm: Pick<Realm, 'getCompiledPolicy'>,
): Promise<boolean> {
  let policy = await realm.getCompiledPolicy();
  if (!policy?.anonymous) {
    return false;
  }
  return policy.rules.some((rule) =>
    rule.grants.some((grant) => grant.anonymous?.sendsSharedKey === true),
  );
}

// The same, for the realm a URL names among those this server serves,
// mounting it. False for a realm it doesn't serve, can't mount, or whose
// policy can't be read. Asked only for a direct writer of the realm.
export function realmOpensSharedKeysToAnonymous({
  dbAdapter,
  realms,
  reconciler,
}: Pick<CreateRoutesArgs, 'dbAdapter' | 'realms' | 'reconciler'>) {
  return async (realmURL: URL): Promise<boolean> => {
    let served = await findRealm(realmURL, { realms, reconciler, dbAdapter });
    if (!served || served.url !== realmURL.href) {
      return false;
    }
    // A policy that can't be read opens nothing that sharing must wait on: a
    // share of a key that doesn't allow anonymous use serves signed-in people
    // only.
    try {
      let realm = await served.mount();
      return realm ? await opensSharedKeysToAnonymous(realm) : false;
    } catch {
      return false;
    }
  };
}
