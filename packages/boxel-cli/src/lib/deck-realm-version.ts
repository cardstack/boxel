import {
  assertObservedBranchHead,
  hashDeckWorkspaceDirectory,
  inventoryTreeHash,
  loadDeckWorkspaceState,
} from './deck-workspace-state.ts';
import type { RealmAuthenticator } from './realm-authenticator.ts';
import { readDeckBranchSnapshot } from './realm-sync-mode.ts';

export interface DeckVersionCut {
  versionRRI: string;
  packageRRI: string;
  version: string;
  checkpointHash: string;
  repositoryHash: string;
  treeHash: string;
  indexHash: string;
  lockHash: string;
}

function deckURL(rootURL: string, path: string): URL {
  let url = new URL(rootURL);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/.deck/${path}`;
  url.search = '';
  url.hash = '';
  return url;
}

// The mutable root of a package the realm hosts, from the realm's package
// directory. The realm's own package is the realm URL itself.
async function packageRootURL(
  realmURL: string,
  packageRRI: string | undefined,
  authenticator: RealmAuthenticator,
): Promise<string> {
  if (!packageRRI) {
    return realmURL;
  }
  let response = await authenticator.authedRealmFetch(
    deckURL(realmURL, 'capabilities'),
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok) {
    throw new Error(
      `Could not read the realm's packages: ${response.status} ${response.statusText}`,
    );
  }
  let capability = (await response.json()) as { packages?: unknown };
  let packages = capability.packages as Record<string, unknown> | undefined;
  let root = `${packageRRI.replace(/\/+$/, '')}/`;
  let url = packages?.[root];
  if (typeof url !== 'string') {
    throw new Error(`${realmURL} does not host ${root}`);
  }
  return url;
}

function isVersionCut(value: unknown): value is DeckVersionCut {
  let cut = value as Partial<DeckVersionCut>;
  return (
    typeof cut === 'object' &&
    cut !== null &&
    typeof cut.versionRRI === 'string' &&
    typeof cut.packageRRI === 'string' &&
    typeof cut.version === 'string' &&
    typeof cut.checkpointHash === 'string' &&
    typeof cut.repositoryHash === 'string' &&
    typeof cut.treeHash === 'string'
  );
}

/**
 * Cut an exact Version of one package from the branch head. The version is
 * the one the package's package.json declares there unless `version` names
 * it, and the server refuses one that disagrees or already exists.
 *
 * From a workspace, the workspace must be clean and still at the exact head
 * it last observed, so the Version is exactly what the author has; the cut
 * names that Repository and is refused if the branch has moved.
 */
export async function cutDeckRealmVersion(options: {
  realmURL: string;
  branchName: string;
  authenticator: RealmAuthenticator;
  packageRRI?: string;
  version?: string;
  localDir?: string;
}): Promise<DeckVersionCut> {
  let expectedRepositoryHash: string | undefined;
  if (options.localDir) {
    let workspace = await loadDeckWorkspaceState(options.localDir);
    if (!workspace) {
      throw new Error(
        'Cutting a Version requires a workspace made by realm pull',
      );
    }
    let remote = await readDeckBranchSnapshot(
      options.realmURL,
      options.branchName,
      options.authenticator,
    );
    assertObservedBranchHead(workspace, remote);
    let local = await hashDeckWorkspaceDirectory(options.localDir);
    if (inventoryTreeHash(local) !== workspace.baseTreeHash) {
      throw new Error(
        'Cutting a Version requires a clean workspace; sync your local edits first',
      );
    }
    expectedRepositoryHash = workspace.baseRepositoryHash;
  }
  let root = await packageRootURL(
    options.realmURL,
    options.packageRRI,
    options.authenticator,
  );
  let url = deckURL(root, 'versions');
  url.searchParams.set('branch', options.branchName);
  let response = await options.authenticator.authedRealmFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      schema: 'boxel-deck-version-cut-v1',
      ...(options.version ? { version: options.version } : {}),
      ...(expectedRepositoryHash ? { expectedRepositoryHash } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Could not cut a Version: ${response.status} ${await response.text()}`,
    );
  }
  let cut: unknown = await response.json();
  if (!isVersionCut(cut)) {
    throw new Error('Realm returned an invalid Version cut');
  }
  return cut;
}
