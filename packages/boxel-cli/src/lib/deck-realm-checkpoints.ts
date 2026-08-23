import type { RealmAuthenticator } from './realm-authenticator.ts';
import {
  hashDeckWorkspaceDirectory,
  inventoryTreeHash,
  loadDeckWorkspaceState,
  saveDeckWorkspaceState,
} from './deck-workspace-state.ts';

const HASH = /^[0-9a-f]{64}$/;
const RESULT_SPEC = 'boxel-deck-checkpoint-create-result-v1';

export interface DeckCheckpointCreateResult {
  schema: typeof RESULT_SPEC;
  realmRRI: string;
  branchName: string;
  checkpointHash: string;
  parentCheckpointHash: string | null;
  repositoryHash: string;
  treeHash: string;
  lockHash: string;
  historyHead: string;
  indexGenerationHash: string;
  refGeneration: number;
}

function isResult(value: unknown): value is DeckCheckpointCreateResult {
  let result = value as DeckCheckpointCreateResult;
  return (
    typeof result === 'object' &&
    result !== null &&
    result.schema === RESULT_SPEC &&
    typeof result.realmRRI === 'string' &&
    typeof result.branchName === 'string' &&
    HASH.test(result.checkpointHash) &&
    (result.parentCheckpointHash === null ||
      HASH.test(result.parentCheckpointHash)) &&
    HASH.test(result.repositoryHash) &&
    HASH.test(result.treeHash) &&
    HASH.test(result.lockHash) &&
    typeof result.historyHead === 'string' &&
    HASH.test(result.indexGenerationHash) &&
    Number.isSafeInteger(result.refGeneration) &&
    result.refGeneration >= 1
  );
}

export async function createDeckWorkspaceCheckpoint(options: {
  localDir: string;
  message: string;
  authenticator: RealmAuthenticator;
}): Promise<DeckCheckpointCreateResult> {
  let workspace = await loadDeckWorkspaceState(options.localDir);
  if (!workspace) {
    throw new Error(
      'Deck Checkpoint requires an existing .boxel-sync.json workspace',
    );
  }
  let localFiles = await hashDeckWorkspaceDirectory(options.localDir);
  if (inventoryTreeHash(localFiles) !== workspace.baseTreeHash) {
    throw new Error(
      `Workspace has unpushed changes on ${workspace.branchName}; push them before creating a Checkpoint`,
    );
  }
  let url = new URL(workspace.realmURL);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/.deck/checkpoint`;
  url.searchParams.set('branch', workspace.branchName);
  let response = await options.authenticator.authedRealmFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      schema: 'boxel-deck-checkpoint-create-v1',
      message: options.message,
      expected: {
        repositoryHash: workspace.baseRepositoryHash,
        treeHash: workspace.baseTreeHash,
        lockHash: workspace.baseLockHash,
        refGeneration: workspace.observedRefGeneration,
      },
    }),
  });
  if (!response.ok) {
    let detail = (await response.text()).trim().slice(0, 300);
    throw new Error(
      response.status === 409
        ? `Deck branch ${workspace.branchName} moved; pull or sync before creating a Checkpoint`
        : `Could not create Checkpoint: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`,
    );
  }
  let value: unknown = await response.json();
  if (!isResult(value)) {
    throw new Error('Realm returned an invalid Checkpoint creation result');
  }
  if (
    value.realmRRI !== workspace.realmRRI ||
    value.branchName !== workspace.branchName ||
    value.repositoryHash !== workspace.baseRepositoryHash ||
    value.treeHash !== workspace.baseTreeHash ||
    value.lockHash !== workspace.baseLockHash ||
    value.historyHead !== workspace.baseHistoryHead ||
    value.indexGenerationHash !== workspace.baseIndexGenerationHash
  ) {
    throw new Error('Checkpoint result does not match the local branch base');
  }
  await saveDeckWorkspaceState(options.localDir, {
    ...workspace,
    observedRefGeneration: value.refGeneration,
  });
  return value;
}
