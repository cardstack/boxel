import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  advanceRepositoryBranch,
  captureRepositoryCheckpoint,
  ensureRepositoryMain,
  hashBytes,
  readBranchHead,
  readRepository,
  repositoryManifest,
  writeRepositoryConfig,
} from '@cardstack/deck/node';
import { DeckdHistory } from '@cardstack/deck-history/deckd';
import {
  ASTRA_QUERY_SPEC,
  type AstraQueryProvenance,
  type AstraQueryResult,
} from '@cardstack/runtime-common';

import { runDeckAstraQuery } from '../lib/deck-astra-query.ts';
import { buildDeckBranchIndex } from '../lib/deck-branch-index.ts';
import { openDeckRepositoryProtocol } from '../lib/deck-repository-protocol.ts';

const execFileAsync = promisify(execFile);
const packageRRI = '@cardstack/pretui/';
const packageName = 'cardstack/pretui';
const policy = { enabled: true, realmRRIs: new Set([packageRRI]) };
const actor = { id: '@fixture:boxel.test', name: 'PretUI Fixture' };

function cardDocument(
  module: string,
  name: string,
  attributes: Record<string, unknown>,
): string {
  return `${JSON.stringify(
    {
      data: {
        type: 'card',
        attributes,
        meta: { adoptsFrom: { module, name } },
      },
    },
    null,
    2,
  )}\n`;
}

function shortHash(hash: string): string {
  return hash.slice(0, 12);
}

function resolvedLabel(provenance: AstraQueryProvenance): string {
  return provenance.kind === 'version'
    ? provenance.resolved
    : `${provenance.branch} · ${shortHash(provenance.treeHash)}`;
}

async function writeAstraEvidence(
  realmDir: string,
  result: AstraQueryResult,
): Promise<void> {
  let slugs = ['previous', 'stable', 'next', 'main'];
  let labels = [
    'Previous release',
    'Stable on main',
    'Next development',
    'Current main branch',
  ];
  for (let [position, view] of result.views.entries()) {
    let provenance = view.provenance;
    await writeFile(
      join(realmDir, 'astra', 'views', `${slugs[position]}.json`),
      cardDocument(`${packageRRI}cards/astra-view`, 'AstraView', {
        cardInfo: { name: labels[position] },
        title: labels[position],
        label: labels[position],
        kind: provenance.kind,
        selector:
          provenance.selector.kind === 'version'
            ? provenance.selector.spec
            : provenance.selector.kind === 'branch'
              ? provenance.selector.branch
              : provenance.selector.kind === 'checkpoint'
                ? shortHash(provenance.selector.checkpointHash)
                : shortHash(provenance.selector.indexGenerationHash),
        resolved: resolvedLabel(provenance),
        mutability: provenance.mutability,
        resultCount: String(view.cards.length),
        indexHash: shortHash(provenance.indexHash),
      }),
    );
  }
  let comparison = result.comparison;
  if (!comparison) throw new Error('Astra fixture query did not compare views');
  await writeFile(
    join(realmDir, 'astra', 'harness.json'),
    cardDocument(`${packageRRI}cards/astra-harness`, 'AstraHarness', {
      cardInfo: { name: 'Astra Query Harness' },
      title: 'Astra Query Harness',
      query: 'all cards',
      from: 'previous · 0.9.0',
      to: 'stable · 1.0.0',
      viewCount: String(result.views.length),
      added: String(comparison.added.length),
      changed: String(comparison.changed.length),
      removed: String(comparison.removed.length),
      unchanged: String(comparison.unchanged.length),
      evidence: '.deck/fixtures/astra-query.json',
    }),
  );
  await mkdir(join(realmDir, '.deck', 'fixtures'), { recursive: true });
  await writeFile(
    join(realmDir, '.deck', 'fixtures', 'astra-query.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  );
}

function usage(): never {
  throw new Error(
    'usage: node scripts/bootstrap-pretui-collaboration-realm.ts <empty-realm-dir>',
  );
}

async function requireEmptyDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  if ((await readdir(path)).length > 0) {
    throw new Error(`PretUI collaboration Realm must be empty: ${path}`);
  }
}

async function copyAuthoredTree(source: string, target: string): Promise<void> {
  for (let entry of await readdir(source, { withFileTypes: true })) {
    // The older fixture is used only as a deterministic 28-unit content
    // generator. Its synthetic refs/Reviews/Checkpoints are deliberately not
    // imported, but published Versions and their CAS objects are real authored
    // inputs needed by the live Astra replay.
    if (entry.name === '.deck') {
      await mkdir(join(target, '.deck'), { recursive: true });
      await cp(join(source, '.deck', 'store'), join(target, '.deck', 'store'), {
        recursive: true,
      });
      continue;
    }
    if (entry.name === '.jj') continue;
    await cp(join(source, entry.name), join(target, entry.name), {
      recursive: entry.isDirectory(),
    });
  }
}

let args = process.argv.slice(2);
if (args[0] === '--') args.shift();
if (!args[0] || args.length !== 1) usage();

let realmDir = resolve(args[0]);
await requireEmptyDirectory(realmDir);
let stagingDir = await mkdtemp(join(tmpdir(), 'pretui-content-'));
let history = new DeckdHistory({ watch: false });

try {
  let generator = join(
    dirname(fileURLToPath(import.meta.url)),
    'seed-pretui-team-fixture.ts',
  );
  await execFileAsync(process.execPath, [generator, stagingDir], {
    env: {
      ...process.env,
      BOXEL_DECK_COLLABORATION_ENABLED: 'true',
      BOXEL_DECK_COLLABORATION_REALM_RRIS: packageRRI,
    },
    maxBuffer: 10 * 1024 * 1024,
  });
  await copyAuthoredTree(stagingDir, realmDir);

  let historyHead = await history.seal(
    realmDir,
    'Initialize PretUI 1.0 team Realm',
    { name: actor.name },
  );
  if (!historyHead) {
    throw new Error('deckd did not create the initial PretUI History Step');
  }

  let config = repositoryManifest({
    roots: [packageRRI],
    members: { [packageRRI]: '.' },
  });
  await writeRepositoryConfig(realmDir, config);

  // Establish the first Repository object/ref, then replace its deliberately
  // unreachable placeholder index with the real branch-qualified generation
  // before the Realm is mounted by a server.
  await ensureRepositoryMain({
    realmDir,
    config,
    author: actor,
    historyHead,
    indexGenerationHash: hashBytes('pretui-main-index-preparation'),
  });
  let initial = await openDeckRepositoryProtocol({
    realmDir,
    realmRRI: packageRRI,
    policy,
  }).readBranch('main');
  if (!initial) throw new Error('PretUI main branch was not created');
  let treeHash = initial.repository.members[packageRRI];
  let index = await buildDeckBranchIndex({
    realmDir,
    branch: initial,
    historyHead,
    repositoryHash: initial.head.repositoryHash,
    treeHash,
    lockHash: initial.repository.lockHash,
  });
  let checkpoint = await captureRepositoryCheckpoint({
    realmDir,
    config,
    branch: 'main',
    historyHead,
    indexGenerationHash: index.indexGenerationHash,
    message: 'Prepare exact PretUI main view',
    author: actor,
  });
  let main = await readBranchHead(realmDir, 'main');
  let repository = main
    ? await readRepository(realmDir, main.repositoryHash)
    : undefined;
  if (
    !main ||
    !repository ||
    repository.members[packageRRI] !== treeHash ||
    main.indexGenerationHash !== index.indexGenerationHash ||
    main.historyHead !== historyHead
  ) {
    throw new Error('PretUI main ref is not self-consistent');
  }

  // Execute the real Astra implementation against the exact baseline view,
  // then materialize its result as ordinary cards. The evidence card records
  // the immutable view it queried; adding that evidence advances main once.
  let astraResult = await runDeckAstraQuery({
    realmDir,
    realmRRI: packageRRI,
    packageName,
    policy,
    request: {
      schema: ASTRA_QUERY_SPEC,
      query: {},
      views: [
        { kind: 'version', spec: '0.9.0' },
        { kind: 'version', spec: '1.0.0' },
        { kind: 'version', spec: '1.1.0-dev.1' },
        { kind: 'branch', branch: 'main' },
      ],
      compare: { from: 0, to: 1 },
    },
  });
  await writeAstraEvidence(realmDir, astraResult);
  let evidenceHistoryHead = await history.seal(
    realmDir,
    'Record exact Astra multi-view query evidence',
    { name: actor.name },
  );
  if (!evidenceHistoryHead) {
    throw new Error('deckd did not record the Astra evidence History Step');
  }
  await advanceRepositoryBranch({
    realmDir,
    config,
    branch: 'main',
    historyHead: evidenceHistoryHead,
    indexGenerationHash: hashBytes('pretui-astra-index-preparation'),
  });
  let evidenceBranch = await openDeckRepositoryProtocol({
    realmDir,
    realmRRI: packageRRI,
    policy,
  }).readBranch('main');
  if (!evidenceBranch) throw new Error('PretUI main branch disappeared');
  let evidenceTreeHash = evidenceBranch.repository.members[packageRRI];
  index = await buildDeckBranchIndex({
    realmDir,
    branch: evidenceBranch,
    historyHead: evidenceHistoryHead,
    repositoryHash: evidenceBranch.head.repositoryHash,
    treeHash: evidenceTreeHash,
    lockHash: evidenceBranch.repository.lockHash,
  });
  checkpoint = await captureRepositoryCheckpoint({
    realmDir,
    config,
    branch: 'main',
    historyHead: evidenceHistoryHead,
    indexGenerationHash: index.indexGenerationHash,
    message: 'Expose Astra views in the PretUI Workspace',
    author: actor,
  });
  historyHead = evidenceHistoryHead;
  main = await readBranchHead(realmDir, 'main');
  repository = main
    ? await readRepository(realmDir, main.repositoryHash)
    : undefined;
  if (
    !main ||
    !repository ||
    repository.members[packageRRI] !== evidenceTreeHash ||
    main.indexGenerationHash !== index.indexGenerationHash ||
    main.historyHead !== evidenceHistoryHead
  ) {
    throw new Error('PretUI Astra evidence ref is not self-consistent');
  }

  console.log(
    JSON.stringify(
      {
        schema: 'boxel-pretui-live-bootstrap-v1',
        realmDir,
        realmRRI: packageRRI,
        branch: 'main',
        files: (await readdir(realmDir, { recursive: true })).filter(
          (path) => !path.startsWith('.deck/') && !path.startsWith('.jj/'),
        ).length,
        historyHead,
        repositoryHash: main.repositoryHash,
        treeHash: evidenceTreeHash,
        indexGenerationHash: index.indexGenerationHash,
        checkpointHash: checkpoint.checkpointHash,
      },
      null,
      2,
    ),
  );
} catch (error) {
  // A failed bootstrap must not leave a directory that looks ready enough to
  // mount. The caller supplied an empty fixture target, so cleanup is safe.
  await rm(realmDir, { recursive: true, force: true });
  throw error;
} finally {
  history.close();
  await rm(stagingDir, { recursive: true, force: true });
}
