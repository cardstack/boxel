import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '@cardstack/runtime-common';
import { RefBusyError } from '@cardstack/deck/node';
import {
  SealDebouncer,
  type HistoryBackend,
} from '@cardstack/deck-history/backend';
import { DeckdHistory } from '@cardstack/deck-history/deckd';
import {
  deckCollaborationPolicyFromEnvironment,
  hasDeckCollaboration,
  type DeckCollaborationPolicy,
} from './deck-collaboration-policy.ts';
import { commitHostSaves } from './deck-branch-content-update.ts';

const log = logger('realm-server:deck-history');

const DEBOUNCE_MS = 400;
const BUSY_RETRY_MS = 250;
const BUSY_RETRIES = 20;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Host saves on Deck realms, debounced, then committed: one History Step per
// burst, with main moved to the realm's live files so every boxel-cli user
// syncs against what the realm serves. A branch update takes a burst still
// waiting (take) and commits it itself, ahead of its own change.
export class HostSaveCommitter {
  #history: HistoryBackend;
  #realms = new Map<
    string,
    { realmRRI: string; policy: DeckCollaborationPolicy }
  >();
  #debouncer: SealDebouncer;
  #commit: typeof commitHostSaves;

  constructor(options: {
    history: HistoryBackend;
    debounceMs?: number;
    commit?: typeof commitHostSaves;
  }) {
    this.#history = options.history;
    this.#commit = options.commit ?? commitHostSaves;
    this.#debouncer = new SealDebouncer({
      debounceMs: options.debounceMs ?? DEBOUNCE_MS,
      seal: (realmDir, message) => this.#commitBurst(realmDir, message, 0),
      onError: (error) =>
        log.warn(`could not commit host saves: ${describe(error)}`),
    });
  }

  note(
    realmDir: string,
    realmRRI: string,
    policy: DeckCollaborationPolicy,
    path: string,
  ): void {
    this.#realms.set(realmDir, { realmRRI, policy });
    this.#debouncer.note(realmDir, path);
  }

  take(realmDir: string): string | undefined {
    return this.#debouncer.take(realmDir);
  }

  close(): void {
    this.#debouncer.close();
  }

  async #commitBurst(
    realmDir: string,
    message: string,
    attempt: number,
  ): Promise<void> {
    let realm = this.#realms.get(realmDir);
    if (!realm) return;
    try {
      await this.#commit({
        realmDir,
        realmRRI: realm.realmRRI,
        policy: realm.policy,
        history: this.#history,
        message,
      });
    } catch (error) {
      // A branch update holds the writer. It commits the live tree itself
      // before writing, which includes this burst; retrying only makes sure
      // the burst's own message lands if the update finished first.
      if (error instanceof RefBusyError && attempt < BUSY_RETRIES) {
        let timer = setTimeout(
          () =>
            void this.#commitBurst(realmDir, message, attempt + 1).catch(
              (retryError) =>
                log.warn(
                  `could not commit host saves: ${describe(retryError)}`,
                ),
            ),
          BUSY_RETRY_MS,
        );
        timer.unref?.();
        return;
      }
      throw error;
    }
  }
}

let sharedHistory: DeckdHistory | undefined;
let sharedCommitter: HostSaveCommitter | undefined;

// One deckd client for the whole process. deckd's own file watcher stays
// off: the realm server says which writes it accepted, so a large branch
// materialization is never sealed halfway.
export function sharedDeckHistory(): DeckdHistory {
  return (sharedHistory ??= new DeckdHistory({
    watch: false,
    onError: (error) => log.warn(`deckd: ${describe(error)}`),
  }));
}

export function sharedHostSaveCommitter(): HostSaveCommitter {
  return (sharedCommitter ??= new HostSaveCommitter({
    history: sharedDeckHistory(),
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

// The file adapter's mutation hook for one realm. A realm Deck is not enabled
// for gets no hook, or a hook that ignores it until its package.json names an
// allowed package.
export function deckSaveRecorder(options: {
  realmDir: string;
  policy?: DeckCollaborationPolicy;
  committer?: HostSaveCommitter;
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
    (options.committer ?? sharedHostSaveCommitter()).note(
      options.realmDir,
      realmRRI,
      policy,
      path,
    );
  };
}
