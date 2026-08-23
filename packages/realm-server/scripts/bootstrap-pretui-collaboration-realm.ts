import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  captureRepositoryCheckpoint,
  ensureRepositoryMain,
  hashBytes,
  readBranchHead,
  readRepository,
  repositoryManifest,
  writeRepositoryConfig,
} from '@cardstack/deck/node';
import { DeckdHistory } from '@cardstack/deck-history/deckd';

import { buildDeckBranchIndex } from '../lib/deck-branch-index.ts';
import { openDeckRepositoryProtocol } from '../lib/deck-repository-protocol.ts';

const execFileAsync = promisify(execFile);
const packageRRI = '@cardstack/pretui/';
const policy = { enabled: true, realmRRIs: new Set([packageRRI]) };
const actor = { id: '@fixture:boxel.test', name: 'PretUI Fixture' };

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
    // generator. Its synthetic protocol state is deliberately not imported.
    if (entry.name === '.deck' || entry.name === '.jj') continue;
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
        treeHash,
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
