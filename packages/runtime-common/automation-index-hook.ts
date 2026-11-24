// The automation card's index hook: after an index pass commits, every
// switched-on automation whose card or script file the pass touched has its
// row brought in step with the card as indexed (`syncAutomationWithCard`),
// and its key approvals compared with the card and script as they are now
// (`approvalsStillMatch`), so an edit that changes what a key's owner
// approved makes the automation wait for key approval at once. The worker's
// indexing tasks call it once their pass has committed, so the row is read
// against the committed index.
//
// The worker can't read a private realm's operation definitions, so the hook
// compares only the approvals already given. The full check, which tells
// whether every operation's approvals are there, runs in a realm server once
// the pass lands (`Realm.followAutomationKeyApprovals`): after an incremental
// pass, in the realm that started it, over the automations
// `automationTouchedBy` names; after a from-scratch pass, in each realm
// server serving the realm, over every automation in it that isn't paused,
// as the worker announces the pass (`REALM_AUTOMATIONS_REINDEXED_CHANNEL`).
// An edit that makes every approval match again runs the automation again,
// and one that adds an operation needing a key no approval covers makes it
// wait.
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
import { trimExecutableExtension } from './executable-extensions.ts';
import type { DefinitionLookup } from './definition-lookup.ts';
import { internalKeyFor } from './index.ts';
import { IndexQueryEngine } from './index-query-engine.ts';
import { ri, type RealmResourceIdentifier } from './realm-identifiers.ts';
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
  let touchedBy = touched
    ? automationTouchedBy({
        dbAdapter,
        definitionLookup,
        virtualNetwork,
        touched,
      })
    : undefined;
  let automationTypeKey = internalKeyFor(
    automationRef,
    undefined,
    virtualNetwork,
  );
  let engine = new IndexQueryEngine(
    dbAdapter,
    definitionLookup,
    virtualNetwork,
  );
  let querier = dbAdapterQuerier(dbAdapter);
  for (let { automationId } of automations) {
    try {
      let cardURL = virtualNetwork.toURLHref(automationId);
      if (touchedBy && !(await touchedBy(automationId))) {
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
                    realmURL,
                    declaration,
                    payer: automation.payer,
                    moduleOf: (module) =>
                      trimExecutableExtension(virtualNetwork.toURLHref(module)),
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
}

// Answers whether an index pass that visited or deleted the file URLs
// `touched` touched an automation: its card (whose file is its id plus
// `.json`; both spellings count), or the script its card names, as the card
// is indexed.
export function automationTouchedBy({
  dbAdapter,
  definitionLookup,
  virtualNetwork,
  touched,
}: {
  dbAdapter: DBAdapter;
  definitionLookup: DefinitionLookup;
  virtualNetwork: VirtualNetwork;
  touched: readonly string[];
}): (automationId: RealmResourceIdentifier) => Promise<boolean> {
  let touchedFiles = new Set(touched);
  let touchedCards = new Set(touched.map((url) => url.replace(/\.json$/, '')));
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
  return async (automationId) => {
    let cardURL = virtualNetwork.toURLHref(automationId);
    if (touchedCards.has(cardURL)) {
      return true;
    }
    if (touchedFiles.size === 0) {
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
  };
}
