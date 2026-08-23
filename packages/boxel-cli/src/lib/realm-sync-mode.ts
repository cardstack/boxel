import type { RealmAuthenticator } from './realm-authenticator.ts';
import {
  isDeckBranchSnapshot,
  type DeckBranchSnapshot,
} from './deck-workspace-state.ts';

export interface LegacyRealmSyncMode {
  mode: 'legacy';
  sync: 'mtime';
  history: 'none';
}

export interface DeckRealmSyncMode {
  mode: 'deck';
  realmRRI: string;
  protocol: 'deck-r0';
  sync: 'content-addressed';
  history: 'jj';
}

export type RealmSyncMode = LegacyRealmSyncMode | DeckRealmSyncMode;

function capabilityURL(realmURL: string): URL {
  let normalized = new URL(realmURL);
  normalized.pathname = `${normalized.pathname.replace(/\/+$/, '')}/.deck/capabilities`;
  normalized.search = '';
  normalized.hash = '';
  return normalized;
}

function isDeckCapabilities(value: unknown): value is {
  deckCollaboration: true;
  realmRRI: string;
  protocol: 'deck-r0';
  sync: 'content-addressed';
  history: 'jj';
} {
  let capability = value as Record<string, unknown>;
  return (
    typeof capability === 'object' &&
    capability !== null &&
    capability.deckCollaboration === true &&
    typeof capability.realmRRI === 'string' &&
    capability.realmRRI.startsWith('@') &&
    capability.realmRRI.endsWith('/') &&
    capability.protocol === 'deck-r0' &&
    capability.sync === 'content-addressed' &&
    capability.history === 'jj'
  );
}

/**
 * Select one complete synchronization protocol for a realm. A 404 means the
 * realm is legacy. Authentication, server, and malformed-capability failures
 * are not silently downgraded because doing so could publish with mtime rules
 * to a Deck realm whose capability probe merely failed.
 */
export async function detectRealmSyncMode(
  realmURL: string,
  authenticator: RealmAuthenticator,
): Promise<RealmSyncMode> {
  let response = await authenticator.authedRealmFetch(capabilityURL(realmURL), {
    headers: { Accept: 'application/json' },
  });
  if (response.status === 404) {
    return { mode: 'legacy', sync: 'mtime', history: 'none' };
  }
  if (!response.ok) {
    throw new Error(
      `Could not determine realm sync mode: ${response.status} ${response.statusText}`,
    );
  }
  let capability: unknown;
  try {
    capability = await response.json();
  } catch {
    throw new Error('Deck capability response is not valid JSON');
  }
  if (!isDeckCapabilities(capability)) {
    throw new Error('Realm advertised an unsupported Deck capability');
  }
  return {
    mode: 'deck',
    realmRRI: capability.realmRRI,
    protocol: capability.protocol,
    sync: capability.sync,
    history: capability.history,
  };
}

export async function readDeckBranchSnapshot(
  realmURL: string,
  branchName: string,
  authenticator: RealmAuthenticator,
): Promise<DeckBranchSnapshot> {
  let url = capabilityURL(realmURL);
  url.pathname = url.pathname.replace(/capabilities$/, 'branch');
  url.searchParams.set('name', branchName);
  let response = await authenticator.authedRealmFetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(
      `Could not read Deck branch ${branchName}: ${response.status} ${response.statusText}`,
    );
  }
  let snapshot: unknown;
  try {
    snapshot = await response.json();
  } catch {
    throw new Error('Deck branch observation is not valid JSON');
  }
  if (!isDeckBranchSnapshot(snapshot)) {
    throw new Error('Realm returned an invalid Deck branch observation');
  }
  return snapshot;
}
