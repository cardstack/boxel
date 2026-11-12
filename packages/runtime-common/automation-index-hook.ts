// The automation card's index hook: after an index pass commits, every
// switched-on automation whose card the pass touched has its row brought in
// step with the card as indexed (`syncAutomationWithCard`). The worker's
// indexing tasks call it once their pass has committed, so the row is read
// against the committed index.
//
// The `automations` table is server-only, so the hook runs only against
// Postgres.

import { automationRef } from './automation-declaration.ts';
import {
  automationsInRealm,
  syncAutomationWithCard,
  type AutomationSync,
} from './automations.ts';
import type { DBAdapter } from './db.ts';
import type { DefinitionLookup } from './definition-lookup.ts';
import { internalKeyFor } from './index.ts';
import { IndexQueryEngine } from './index-query-engine.ts';
import { ri } from './realm-identifiers.ts';
import type { VirtualNetwork } from './virtual-network.ts';

export interface AutomationIndexHookArgs {
  dbAdapter: DBAdapter;
  definitionLookup: DefinitionLookup;
  virtualNetwork: VirtualNetwork;
  realmURL: string;
  // The file URLs the pass visited or deleted. Absent for a pass over the
  // whole realm, which syncs every automation in it.
  touched?: readonly string[];
  // Unix seconds; the current time when absent.
  now?: number;
}

// Syncs each switched-on automation in the realm whose card is among
// `touched` (every one when `touched` is absent), and returns what it did to
// each, keyed by automation id.
export async function syncAutomationsAfterIndex({
  dbAdapter,
  definitionLookup,
  virtualNetwork,
  realmURL,
  touched,
  now,
}: AutomationIndexHookArgs): Promise<Map<string, AutomationSync>> {
  let synced = new Map<string, AutomationSync>();
  if (dbAdapter.kind !== 'pg') {
    return synced;
  }
  // The row's realm is its canonical identifier, the spelling the realm's
  // served URL unresolves to.
  let realm = ri(virtualNetwork.unresolveURL(realmURL));
  let automations = await automationsInRealm(dbAdapter, realm);
  if (automations.length === 0) {
    return synced;
  }
  // A card's file is its id plus `.json`; both spellings count as touched.
  let touchedCards = touched
    ? new Set(touched.map((url) => url.replace(/\.json$/, '')))
    : undefined;
  let engine = new IndexQueryEngine(
    dbAdapter,
    definitionLookup,
    virtualNetwork,
  );
  let automationTypeKey = internalKeyFor(
    automationRef,
    undefined,
    virtualNetwork,
  );
  for (let { automationId } of automations) {
    let cardURL = virtualNetwork.toURLHref(automationId);
    if (touchedCards && !touchedCards.has(cardURL)) {
      continue;
    }
    let card = await engine.getInstanceSource(new URL(cardURL));
    let result = await syncAutomationWithCard(dbAdapter, automationId, card, {
      automationTypeKey,
      virtualNetwork,
      now,
    });
    if (result) {
      synced.set(automationId, result);
    }
  }
  return synced;
}
