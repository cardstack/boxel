// The automation card's index hook: after an index pass commits, every
// switched-on automation whose card or script file the pass touched has its
// row brought in step with the card as indexed (`syncAutomationWithCard`),
// and its key approvals compared with the card and script as they are now
// (`approvalsStillMatch`), so an edit that changes what a key's owner
// approved makes the automation wait for key approval at once. The worker's
// indexing tasks call it once their pass has committed, so the row is read
// against the committed index.
//
// The `automations` table is server-only, so the hook runs only against
// Postgres.

import {
  automationRef,
  readAutomationDeclaration,
} from './automation-declaration.ts';
import { approvalsStillMatch } from './automation-key-approval.ts';
import type { ReportAutomationChange } from './automation-change-events.ts';
import type { ReportRunChange } from './automation-run-events.ts';
import {
  automationsInRealm,
  syncAutomationWithCard,
  type AutomationSync,
} from './automations.ts';
import type { DBAdapter } from './db.ts';
import { dbAdapterQuerier } from './expression.ts';
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
  // Reads a file of the realm as text, undefined when it can't be read. The
  // hook reads an automation's script with it to compare the automation with
  // its key approvals; absent, no approval is compared.
  readFile?: (url: string) => Promise<string | undefined>;
  // Told of each run a sync cancels.
  reportRunChange?: ReportRunChange;
  // Told of each automation a sync removes, pauses, or moves between active
  // and done.
  reportAutomationChange?: ReportAutomationChange;
}

// What the hook did with one automation: the sync's result, or the error
// that stopped its sync. One automation's failure doesn't stop the others.
export type AutomationSyncOutcome =
  | AutomationSync
  | { kind: 'failed'; error: unknown };

// Syncs each switched-on automation in the realm whose card is among
// `touched` (every one when `touched` is absent), and returns what it did to
// each, keyed by automation id. Each automation syncs on its own: one whose
// sync throws (a lock timeout, say) is reported as `failed`, and the rest
// still sync in this pass.
export async function syncAutomationsAfterIndex({
  dbAdapter,
  definitionLookup,
  virtualNetwork,
  realmURL,
  touched,
  now,
  readFile,
  reportRunChange,
  reportAutomationChange,
}: AutomationIndexHookArgs): Promise<Map<string, AutomationSyncOutcome>> {
  let synced = new Map<string, AutomationSyncOutcome>();
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
  let touchedFiles = touched ? new Set(touched) : undefined;
  let querier = dbAdapterQuerier(dbAdapter);
  for (let { automationId } of automations) {
    try {
      let cardURL = virtualNetwork.toURLHref(automationId);
      if (
        touchedCards &&
        !touchedCards.has(cardURL) &&
        !(await scriptTouched(cardURL))
      ) {
        continue;
      }
      let result = await syncAutomationWithCard(
        dbAdapter,
        automationId,
        () => engine.getInstanceSource(new URL(cardURL)),
        {
          automationTypeKey,
          virtualNetwork,
          now,
          reportRunChange,
          reportAutomationChange,
          ...(readFile
            ? {
                keyApprovalsMatch: (automation, declaration) =>
                  approvalsStillMatch(querier, {
                    automationId,
                    declaration,
                    payer: automation.payer,
                    readScript: () =>
                      readFile(virtualNetwork.toURLHref(declaration.script)),
                  }),
              }
            : {}),
        },
      );
      if (result) {
        synced.set(automationId, result);
      }
    } catch (error) {
      synced.set(automationId, { kind: 'failed', error });
    }
  }
  return synced;

  // Whether the pass touched the script the automation's card names, as the
  // card is indexed now.
  async function scriptTouched(cardURL: string): Promise<boolean> {
    if (!touchedFiles?.size) {
      return false;
    }
    let card = await engine.getInstanceSource(new URL(cardURL));
    if (!card?.instance || card.failureWithheld) {
      return false;
    }
    let read = readAutomationDeclaration(
      {
        url: cardURL,
        realmURL: card.realmURL,
        types: card.types,
        instance: card.instance,
      },
      { automationTypeKey, virtualNetwork },
    );
    return (
      read.ok &&
      touchedFiles.has(virtualNetwork.toURLHref(read.declaration.script))
    );
  }
}
