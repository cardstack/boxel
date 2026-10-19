import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '@cardstack/runtime-common';
import type { HistoryBackend } from '@cardstack/deck-history/backend';
import { DeckdHistory } from '@cardstack/deck-history/deckd';
import {
  deckCollaborationPolicyFromEnvironment,
  hasDeckCollaboration,
  type DeckCollaborationPolicy,
} from './deck-collaboration-policy.ts';

const log = logger('realm-server:deck-history');

let shared: DeckdHistory | undefined;

// One deckd client for the whole process. The saves the file adapter notes
// and the branch updates the Deck routes seal share its per-realm queue and
// its pending burst, so a branch update can commit the host saves before it.
//
// deckd's own file watcher stays off: the realm server says which writes it
// accepted, so a large branch materialization is never sealed halfway.
export function sharedDeckHistory(): DeckdHistory {
  return (shared ??= new DeckdHistory({
    watch: false,
    onError: (error) =>
      log.warn(
        `deckd could not commit a save: ${error instanceof Error ? error.message : String(error)}`,
      ),
  }));
}

// Deck's own state is written by Deck, not saved by an author.
function isDeckState(path: string): boolean {
  return path === '.deck' || path.startsWith('.deck/');
}

function readRealmRRI(realmDir: string): string | undefined {
  try {
    let name = JSON.parse(
      readFileSync(join(realmDir, 'package.json'), 'utf8'),
    ).name;
    return typeof name === 'string' ? `${name.replace(/\/$/, '')}/` : undefined;
  } catch {
    return undefined;
  }
}

// The file adapter's mutation hook for one realm: each host save on a Deck
// realm is noted, and deckd commits a burst of saves as one History Step once
// the realm has been quiet for the debounce window. A realm Deck is not
// enabled for gets no hook at all, or a hook that ignores it until its
// package.json names an allowed package.
export function deckSaveRecorder(options: {
  realmDir: string;
  policy?: DeckCollaborationPolicy;
  history?: HistoryBackend;
}): ((path: string) => void) | undefined {
  let policy = options.policy ?? deckCollaborationPolicyFromEnvironment();
  if (!policy.enabled) {
    return undefined;
  }
  let realmRRI: string | undefined;
  let known = false;
  return (path: string) => {
    if (isDeckState(path)) {
      return;
    }
    if (!known || path === 'package.json') {
      realmRRI = readRealmRRI(options.realmDir);
      known = true;
    }
    if (!realmRRI || !hasDeckCollaboration(policy, realmRRI)) {
      return;
    }
    (options.history ?? sharedDeckHistory()).noteMutation(
      options.realmDir,
      path,
    );
  };
}
