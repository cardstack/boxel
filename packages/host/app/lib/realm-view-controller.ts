import {
  isExactRealmView,
  REALM_VIEW_CONTEXT_SPEC,
  type ExactRealmView,
} from '@cardstack/runtime-common';

import {
  clearRealmViewSelection,
  installRealmViewSelection,
  restoreRealmViewSelection,
  selectedRealmView,
} from './realm-view-selection';

interface DeckCapabilities {
  deckCollaboration: true;
  realmRRI: string;
  protocol: 'deck-r0';
  sync: 'content-addressed';
  history: 'jj';
}

interface BranchObservation {
  schema: 'boxel-deck-branch-observation-v2';
  realmRRI: string;
  branchName: string;
  repositoryHash: string;
  treeHash: string;
  lockHash: string;
  historyHead: string;
  indexGenerationHash: string;
}

export interface RealmViewControllerOptions {
  enabled: boolean;
  fetch: (request: Request) => Promise<Response>;
  rebuildHostGraph: (reason: string) => Promise<void>;
}

export class DeckCollaborationUnavailableError extends Error {}
export class RealmViewSelectionSupersededError extends Error {}

export class RealmViewController {
  private transition: Promise<void> = Promise.resolve();
  private epoch = 0;

  constructor(private options: RealmViewControllerOptions) {}

  selectBranch(
    realmURL: string | URL,
    branch: string,
  ): Promise<ExactRealmView> {
    let epoch = this.epoch;
    return this.enqueue(() => this.selectBranchNow(realmURL, branch, epoch));
  }

  selectLive(): Promise<void> {
    let epoch = this.epoch;
    return this.enqueue(() => this.selectLiveNow(epoch));
  }

  invalidate(): void {
    this.epoch++;
    clearRealmViewSelection();
  }

  private async selectBranchNow(
    realmURL: string | URL,
    branch: string,
    epoch: number,
  ): Promise<ExactRealmView> {
    this.assertCurrent(epoch);
    if (!this.options.enabled) {
      throw new DeckCollaborationUnavailableError(
        'Deck collaboration is disabled in this Host',
      );
    }
    let normalizedRealmURL = normalizeRealmURL(realmURL);
    let capabilities = await this.readCapabilities(normalizedRealmURL);
    this.assertCurrent(epoch);
    let observation = await this.readBranch(normalizedRealmURL, branch);
    this.assertCurrent(epoch);
    if (observation.realmRRI !== capabilities.realmRRI) {
      throw new Error('Deck branch belongs to a different Realm');
    }

    let exact: ExactRealmView = {
      context: {
        schema: REALM_VIEW_CONTEXT_SPEC,
        realmRRI: observation.realmRRI,
        branch: observation.branchName,
        repositoryHash: observation.repositoryHash,
        treeHash: observation.treeHash,
        lockHash: observation.lockHash,
        historyHead: observation.historyHead,
      },
      indexGenerationHash: observation.indexGenerationHash,
    };
    if (!isExactRealmView(exact)) {
      throw new Error('Deck branch returned an invalid exact Realm view');
    }

    let previous = selectedRealmView();
    installRealmViewSelection(normalizedRealmURL, exact);
    try {
      await this.options.rebuildHostGraph(
        `select ${observation.realmRRI}${observation.branchName}`,
      );
    } catch (error) {
      restoreRealmViewSelection(previous);
      await this.options
        .rebuildHostGraph('restore previous Realm view')
        .catch(() => undefined);
      throw error;
    }
    return exact;
  }

  private async selectLiveNow(epoch: number): Promise<void> {
    this.assertCurrent(epoch);
    let previous = selectedRealmView();
    clearRealmViewSelection();
    try {
      await this.options.rebuildHostGraph('select live Realm view');
    } catch (error) {
      restoreRealmViewSelection(previous);
      await this.options
        .rebuildHostGraph('restore previous Realm view')
        .catch(() => undefined);
      throw error;
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    let result = this.transition.then(operation, operation);
    this.transition = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private assertCurrent(epoch: number): void {
    if (epoch !== this.epoch) {
      throw new RealmViewSelectionSupersededError(
        'Realm view selection was superseded by a session boundary',
      );
    }
  }

  private async readCapabilities(realmURL: string): Promise<DeckCapabilities> {
    let response = await this.options.fetch(
      new Request(new URL('.deck/capabilities', realmURL)),
    );
    if (response.status === 404) {
      throw new DeckCollaborationUnavailableError(
        'This Realm does not offer Deck collaboration',
      );
    }
    if (!response.ok) {
      throw new Error(
        `Could not inspect Deck capabilities (${response.status})`,
      );
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      throw new Error('Deck capabilities are not valid JSON', { cause: error });
    }
    if (!isDeckCapabilities(value)) {
      throw new Error('Deck capabilities are malformed');
    }
    return value;
  }

  private async readBranch(
    realmURL: string,
    branch: string,
  ): Promise<BranchObservation> {
    let url = new URL('.deck/branch', realmURL);
    url.searchParams.set('name', branch);
    let response = await this.options.fetch(new Request(url));
    if (!response.ok) {
      throw new Error(`Could not resolve Deck branch (${response.status})`);
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      throw new Error('Deck branch observation is not valid JSON', {
        cause: error,
      });
    }
    if (!isBranchObservation(value) || value.branchName !== branch) {
      throw new Error('Deck branch observation is malformed');
    }
    return value;
  }
}

function isDeckCapabilities(value: unknown): value is DeckCapabilities {
  if (!value || typeof value !== 'object') return false;
  let capabilities = value as Partial<DeckCapabilities>;
  return (
    capabilities.deckCollaboration === true &&
    typeof capabilities.realmRRI === 'string' &&
    capabilities.realmRRI.startsWith('@') &&
    capabilities.realmRRI.endsWith('/') &&
    capabilities.protocol === 'deck-r0' &&
    capabilities.sync === 'content-addressed' &&
    capabilities.history === 'jj'
  );
}

function isBranchObservation(value: unknown): value is BranchObservation {
  if (!value || typeof value !== 'object') return false;
  let observation = value as Partial<BranchObservation>;
  return (
    observation.schema === 'boxel-deck-branch-observation-v2' &&
    typeof observation.realmRRI === 'string' &&
    typeof observation.branchName === 'string' &&
    typeof observation.repositoryHash === 'string' &&
    typeof observation.treeHash === 'string' &&
    typeof observation.lockHash === 'string' &&
    typeof observation.historyHead === 'string' &&
    typeof observation.indexGenerationHash === 'string'
  );
}

function normalizeRealmURL(realmURL: string | URL): string {
  let url = new URL(String(realmURL));
  url.search = '';
  url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}
