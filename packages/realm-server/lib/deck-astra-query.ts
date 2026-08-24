import {
  hashProtocolObject,
  readCheckpoint,
  readStoreMeta,
  resolveVersionSpec,
  type JsonValue,
} from '@cardstack/deck/node';
import {
  ASTRA_QUERY_RESULT_SPEC,
  astraBranchProvenance,
  type AstraQueryCard,
  type AstraQueryComparison,
  type AstraQueryRequest,
  type AstraQueryResult,
  type AstraQueryViewResult,
  type AstraQueryViewSelector,
} from '@cardstack/runtime-common';

import type { DeckCollaborationPolicy } from './deck-collaboration-policy.ts';
import {
  readDeckBranchIndex,
  readDeckIndexGeneration,
} from './deck-branch-index.ts';
import {
  buildDeckVersionIndex,
  type DeckIndexCard,
} from './deck-version-index.ts';

function pathWithoutJson(sourcePath: string): string {
  return sourcePath.endsWith('.json') ? sourcePath.slice(0, -5) : sourcePath;
}

function logicalRRI(realmRRI: string, sourcePath: string): string {
  return `${realmRRI}${pathWithoutJson(sourcePath)}`;
}

function matchingCards(
  cards: DeckIndexCard[],
  realmRRI: string,
  query: string | undefined,
): AstraQueryCard[] {
  let needle = query?.trim().toLocaleLowerCase();
  return cards
    .filter((card) => !needle || card.searchText.includes(needle))
    .map(({ rri, sourcePath, document }) => ({
      rri,
      logicalRRI: logicalRRI(realmRRI, sourcePath),
      sourcePath,
      document,
    }));
}

function sameCheckpointView(
  view: {
    repositoryHash: string;
    historyHead: string;
  },
  checkpoint: {
    repositoryHash: string;
    historyHead: string;
  },
): boolean {
  return (
    view.repositoryHash === checkpoint.repositoryHash &&
    view.historyHead === checkpoint.historyHead
  );
}

async function resolveView(options: {
  realmDir: string;
  realmRRI: string;
  packageName: string;
  policy: DeckCollaborationPolicy;
  selector: AstraQueryViewSelector;
  query?: string;
}): Promise<AstraQueryViewResult> {
  let { selector } = options;
  if (selector.kind === 'branch') {
    let snapshot = await readDeckBranchIndex({
      realmDir: options.realmDir,
      realmRRI: options.realmRRI,
      branch: selector.branch,
      policy: options.policy,
    });
    return {
      provenance: astraBranchProvenance(
        'branch',
        selector,
        snapshot.view,
        snapshot.indexGenerationHash,
      ),
      cards: matchingCards(snapshot.cards, options.realmRRI, options.query),
    };
  }

  if (selector.kind === 'checkpoint') {
    let checkpoint = await readCheckpoint(
      options.realmDir,
      selector.checkpointHash,
    );
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${selector.checkpointHash}`);
    }
    let generation = await readDeckIndexGeneration(
      options.realmDir,
      checkpoint.indexGenerationHash,
    );
    if (!generation || !sameCheckpointView(generation.view, checkpoint)) {
      throw new Error(
        `Checkpoint ${selector.checkpointHash} has no matching index generation`,
      );
    }
    if (generation.view.realmRRI !== options.realmRRI) {
      throw new Error(
        `Checkpoint ${selector.checkpointHash} belongs to ${generation.view.realmRRI}`,
      );
    }
    return {
      provenance: astraBranchProvenance(
        'checkpoint',
        selector,
        generation.view,
        checkpoint.indexGenerationHash,
        selector.checkpointHash,
      ),
      cards: matchingCards(generation.cards, options.realmRRI, options.query),
    };
  }

  if (selector.kind === 'index') {
    let generation = await readDeckIndexGeneration(
      options.realmDir,
      selector.indexGenerationHash,
    );
    if (!generation) {
      throw new Error(
        `Index generation not found: ${selector.indexGenerationHash}`,
      );
    }
    if (generation.view.realmRRI !== options.realmRRI) {
      throw new Error(
        `Index generation ${selector.indexGenerationHash} belongs to ${generation.view.realmRRI}`,
      );
    }
    return {
      provenance: astraBranchProvenance(
        'index',
        selector,
        generation.view,
        selector.indexGenerationHash,
      ),
      cards: matchingCards(generation.cards, options.realmRRI, options.query),
    };
  }

  let meta = await readStoreMeta(
    `${options.realmDir}/.deck/store`,
    options.packageName,
  );
  if (!meta) throw new Error(`No Versions exist for ${options.realmRRI}`);
  let resolution = resolveVersionSpec(selector.spec, meta);
  if (resolution.kind === 'invalid' || resolution.kind === 'not-found') {
    throw new Error(resolution.detail);
  }
  let snapshot = await buildDeckVersionIndex({
    realmDir: options.realmDir,
    packageName: options.packageName,
    version: resolution.version,
  });
  return {
    provenance: {
      kind: 'version',
      realmRRI: options.realmRRI,
      selector,
      mutability: 'immutable',
      indexHash: snapshot.indexHash,
      treeHash: snapshot.treeHash,
      requested: selector.spec,
      resolved: resolution.version,
      versionRRI: snapshot.packageRRI,
    },
    cards: matchingCards(snapshot.cards, options.realmRRI, options.query),
  };
}

function documentHash(card: AstraQueryCard): string {
  return hashProtocolObject(card.document as unknown as JsonValue);
}

function compareViews(
  views: AstraQueryViewResult[],
  from: number,
  to: number,
): AstraQueryComparison {
  let before = new Map(
    views[from].cards.map((card) => [card.sourcePath, card]),
  );
  let after = new Map(views[to].cards.map((card) => [card.sourcePath, card]));
  let paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  let added: string[] = [];
  let removed: string[] = [];
  let changed: string[] = [];
  let unchanged: string[] = [];
  for (let path of paths) {
    let previous = before.get(path);
    let next = after.get(path);
    if (!previous && next) {
      added.push(next.logicalRRI);
    } else if (previous && !next) {
      removed.push(previous.logicalRRI);
    } else if (previous && next) {
      (documentHash(previous) === documentHash(next)
        ? unchanged
        : changed
      ).push(next.logicalRRI);
    }
  }
  return { from, to, added, removed, changed, unchanged };
}

export async function runDeckAstraQuery(options: {
  realmDir: string;
  realmRRI: string;
  packageName: string;
  policy: DeckCollaborationPolicy;
  request: AstraQueryRequest;
}): Promise<AstraQueryResult> {
  let views = await Promise.all(
    options.request.views.map((selector) =>
      resolveView({
        ...options,
        selector,
        query: options.request.query.text,
      }),
    ),
  );
  return {
    schema: ASTRA_QUERY_RESULT_SPEC,
    query: options.request.query,
    views,
    ...(options.request.compare
      ? {
          comparison: compareViews(
            views,
            options.request.compare.from,
            options.request.compare.to,
          ),
        }
      : {}),
  };
}
