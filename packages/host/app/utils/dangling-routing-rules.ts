import {
  ensureTrailingSlash,
  isCardErrorJSONAPI,
  isCardInstance,
  joinRoutingPaths,
} from '@cardstack/runtime-common';

import type StoreService from '@cardstack/host/services/store';

import type * as CardAPI from '@cardstack/base/card-api';

export interface DanglingRoutingRule {
  path: string;
  // The URL of the missing card.
  reference: string;
}

// Finds the host routing rules in a realm's config whose target card no longer
// exists, child routes too. A host serves the matched path as a 404
// placeholder. Reads each rule's `instance` reference, which stays even when
// the link is broken, and counts a rule only when its target 404s. A child
// rule's path is its full path, from its parent's. Throws when the config
// can't be read.
export async function findDanglingRoutingRules(
  store: StoreService,
  api: typeof CardAPI,
  realmURL: string,
): Promise<DanglingRoutingRule[]> {
  let realmConfigId = `${ensureTrailingSlash(realmURL)}realm`;
  let configCard = await store.get(realmConfigId);
  if (!isCardInstance(configCard)) {
    return [];
  }
  let dangling: DanglingRoutingRule[] = [];
  let visit = async (rules: any[] | undefined, parentPath: string) => {
    for (let rule of rules ?? []) {
      if (!rule) {
        continue;
      }
      let path = joinRoutingPaths(parentPath, rule.path ?? '/');
      let slot = api.getRelationshipMembershipState(rule, 'instance')
        .membership?.[0];
      let reference = slot?.reference;
      if (reference) {
        let targetId = new URL(reference, realmConfigId).href;
        let target = await store.get(targetId);
        if (isCardErrorJSONAPI(target) && target.status === 404) {
          dangling.push({ path, reference: targetId });
        }
      }
      await visit(rule.routes, path);
    }
  };
  await visit(
    (configCard as unknown as { hostRoutingRules?: any[] }).hostRoutingRules,
    '/',
  );
  return dangling;
}
