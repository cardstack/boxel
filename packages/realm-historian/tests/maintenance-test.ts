import QUnit from 'qunit';
const { module, test } = QUnit;
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  computeContentHash,
  type ChangeEvent,
  type ChangeEventChange,
} from '@cardstack/runtime-common';
import {
  BLOB_MODE,
  blobBody,
  hashObject,
  ObjectStore,
  TreeBuilder,
} from '../src/git-objects.ts';
import {
  initRepo,
  MAIN_REF,
  readMain,
  repoPath,
  updateMain,
} from '../src/repo-format.ts';
import {
  countObjects,
  isMaintained,
  maintainedHead,
  maintainRepo,
  writeCommitGraph,
} from '../src/maintenance.ts';
import { probeGit } from '../src/git-capabilities.ts';
import { Recorder } from '../src/recorder.ts';
import { Semaphore } from '../src/semaphore.ts';
import { DEFAULT_GROUPING_LIMITS } from '../src/grouper.ts';
import {
  appendEvent,
  insertRealm,
  setupTestDatabase,
  type TestRealm,
} from './helpers.ts';
import { fsck, git } from './git-objects-test.ts';

const IDENTITY = { name: 'test', email: 'test', timestamp: 0 };

// Writes `count` revisions as loose objects, each changing one of 200 files
// spread over 50 directories, and returns their ids, oldest first.
async function writeLooseHistory(
  gitDir: string,
  count: number,
  { from = 0, parent }: { from?: number; parent?: string } = {},
): Promise<string[]> {
  let store = new ObjectStore(gitDir);
  let tree = new TreeBuilder();
  if (parent) {
    for (let line of (await git(gitDir, 'ls-tree', '-r', parent))
      .trim()
      .split('\n')) {
      let [meta, path] = line.split('\t');
      tree.set(path, { mode: BLOB_MODE, id: meta.split(' ')[2] });
    }
  }
  let ids: string[] = [];
  for (let i = from; i < from + count; i++) {
    tree.set(pathOf(i), {
      mode: BLOB_MODE,
      id: (await store.writeBlob(`{"revision":${i}}\n`)).id,
    });
    let { id } = await store.writeCommit({
      tree: await tree.write(store),
      parents: parent ? [parent] : [],
      author: { ...IDENTITY, timestamp: i },
      committer: { ...IDENTITY, timestamp: i },
      message: `revision ${i}`,
    });
    await updateMain(gitDir, id, parent);
    ids.push(id);
    parent = id;
  }
  return ids;
}

function pathOf(i: number): string {
  return `d${i % 50}/f${Math.floor(i / 50) % 4}.json`;
}

// Writes `count` revisions straight into a pack with `git fast-import`, each
// changing the one file of one of 500 directories, so a revision's root tree
// is wide, as a realm with many card types' directories is.
async function importHistory(gitDir: string, count: number): Promise<void> {
  let stream: string[] = [];
  for (let i = 0; i < count; i++) {
    let message = `revision ${i}\n`;
    let content = `{"revision":${i}}\n`;
    stream.push(
      `commit ${MAIN_REF}`,
      `mark :${i + 1}`,
      `committer test <test> ${i} +0000`,
      `data ${Buffer.byteLength(message)}`,
      message,
      ...(i > 0 ? [`from :${i}`] : []),
      `M 100644 inline ${importedPathOf(i)}`,
      `data ${Buffer.byteLength(content)}`,
      content,
    );
  }
  await gitWithInput(gitDir, ['fast-import', '--quiet'], stream.join('\n'));
}

function importedPathOf(i: number): string {
  return `d${i % 500}/card.json`;
}

// Runs git with `input` on its standard input, against the repo when one is
// given.
function gitWithInput(
  gitDir: string | undefined,
  args: string[],
  input: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let child = spawn('git', gitDir ? [`--git-dir=${gitDir}`, ...args] : args, {
      env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`git ${args[0]} exited ${code}: ${stderr}`));
      }
    });
    child.stdin.end(input);
  });
}

// Every object HEAD reaches: commits, trees and blobs.
async function reachableObjects(gitDir: string): Promise<string[]> {
  return (await git(gitDir, 'rev-list', '--objects', MAIN_REF))
    .trim()
    .split('\n')
    .map((line) => line.split(' ')[0]);
}

// The ids `git cat-file -e` doesn't find.
async function missingObjects(
  gitDir: string,
  ids: string[],
): Promise<string[]> {
  let missing: string[] = [];
  for (let id of ids) {
    try {
      await git(gitDir, 'cat-file', '-e', id);
    } catch {
      missing.push(id);
    }
  }
  return missing;
}

// The commits the commit-graph holds, read from each layer's OID Lookup
// chunk (`OIDL`), with the layer's commit count from the last entry of its
// OID Fanout chunk (`OIDF`).
async function graphCommits(gitDir: string): Promise<Set<string>> {
  let directory = join(gitDir, 'objects', 'info', 'commit-graphs');
  let chain: string[];
  try {
    chain = (await readFile(join(directory, 'commit-graph-chain'), 'utf8'))
      .trim()
      .split('\n');
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return new Set();
    }
    throw error;
  }
  let commits = new Set<string>();
  for (let layer of chain) {
    let bytes = await readFile(join(directory, `graph-${layer}.graph`));
    if (bytes.toString('latin1', 0, 4) !== 'CGPH') {
      throw new Error(`graph-${layer}.graph is not a commit-graph`);
    }
    let chunkCount = bytes[6];
    let chunks = new Map<string, number>();
    for (let i = 0; i < chunkCount; i++) {
      let entry = 8 + i * 12;
      chunks.set(
        bytes.toString('latin1', entry, entry + 4),
        Number(bytes.readBigUInt64BE(entry + 4)),
      );
    }
    let count = bytes.readUInt32BE(chunks.get('OIDF')! + 255 * 4);
    let lookup = chunks.get('OIDL')!;
    for (let i = 0; i < count; i++) {
      commits.add(
        bytes.toString('hex', lookup + i * 20, lookup + (i + 1) * 20),
      );
    }
  }
  return commits;
}

// Serves the directory's files as they are, the way a static file server
// over the read-only EFS tunnel does: git's dumb HTTP protocol.
async function serveFiles(
  root: string,
): Promise<{ url: string; close(): Promise<void> }> {
  let server: Server = createServer((request, response) => {
    let path = normalize(
      join(
        root,
        decodeURIComponent(new URL(request.url!, 'http://x').pathname),
      ),
    );
    if (!path.startsWith(root)) {
      response.writeHead(403).end();
      return;
    }
    stat(path).then(
      (info) => {
        if (!info.isFile()) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        createReadStream(path).pipe(response);
      },
      () => response.writeHead(404).end(),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function cloneBare(source: string, destination: string): Promise<string> {
  await gitWithInput(
    undefined,
    ['clone', '--bare', '--quiet', source, destination],
    '',
    { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  );
  return (await readMain(destination))!;
}

// The best of `runs` wall-clock times of a path-filtered `git log`, and its
// output.
async function timeLog(
  gitDir: string,
  config: string[],
  path: string,
  runs = 5,
): Promise<{ bestMs: number; output: string }> {
  let bestMs = Infinity;
  let output = '';
  for (let run = 0; run < runs; run++) {
    let started = performance.now();
    output = await git(
      gitDir,
      ...config,
      'log',
      '--format=%H',
      MAIN_REF,
      '--',
      path,
    );
    bestMs = Math.min(bestMs, performance.now() - started);
  }
  return { bestMs, output };
}

// The `definitely_not` count of git's Bloom filter statistics for a
// path-filtered `git log`, or undefined when git used no Bloom filter.
async function bloomDefinitelyNot(
  gitDir: string,
  directory: string,
  path: string,
): Promise<number | undefined> {
  let trace = join(directory, 'trace.json');
  await rm(trace, { force: true });
  await gitWithInput(gitDir, ['log', '--format=%H', MAIN_REF, '--', path], '', {
    ...process.env,
    GIT_TRACE2_EVENT: trace,
  });
  for (let line of (await readFile(trace, 'utf8')).split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    let event = JSON.parse(line);
    if (event.category === 'bloom' && event.key === 'statistics') {
      return event.value.definitely_not;
    }
  }
  return undefined;
}

module('maintenance', (hooks) => {
  let root: string;
  let gitDir: string;

  hooks.beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'realm-maintenance-'));
    gitDir = join(root, 'realm.git');
    await initRepo(gitDir);
  });

  hooks.afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('a pass packs every loose object HEAD reaches and prunes the ones it does not, once past the expiry', async (assert) => {
    let commits = await writeLooseHistory(gitDir, 20);
    let store = new ObjectStore(gitDir);
    let orphans: string[] = [];
    for (let i = 0; i < 5; i++) {
      orphans.push(
        (await store.writeBlob(`captured, never committed ${i}`)).id,
      );
    }
    let reachable = await reachableObjects(gitDir);

    let first = await maintainRepo(gitDir);
    assert.strictEqual(
      first.before.looseObjects,
      reachable.length + orphans.length,
      'every object starts loose',
    );
    assert.strictEqual(first.after.packs, 1);
    assert.strictEqual(first.after.packedObjects, reachable.length);
    assert.strictEqual(
      first.after.looseObjects,
      orphans.length,
      'objects younger than the expiry stay loose',
    );
    assert.strictEqual(first.pruned, 0);
    assert.deepEqual(await missingObjects(gitDir, orphans), []);

    let second = await maintainRepo(gitDir, { pruneExpiryMs: 0 });
    assert.strictEqual(second.pruned, orphans.length);
    assert.strictEqual(second.after.looseObjects, 0, 'no loose object is left');
    assert.deepEqual(
      await missingObjects(gitDir, orphans),
      orphans,
      'the objects no revision uses are gone',
    );
    assert.deepEqual(
      await missingObjects(gitDir, reachable),
      [],
      'every object a revision uses remains',
    );
    assert.strictEqual(await readMain(gitDir), commits[commits.length - 1]);
    assert.strictEqual(await fsck(gitDir), '');
  });

  test('a reader keeps answering while a pass repacks the repo', async (assert) => {
    await writeLooseHistory(gitDir, 300);
    let reachable = await reachableObjects(gitDir);
    let log = await git(gitDir, 'log', '--format=%H %T', MAIN_REF);
    let batch = `${reachable.join('\n')}\n`;
    let check = await gitWithInput(
      gitDir,
      ['cat-file', '--batch-check'],
      batch,
    );

    let done = false;
    let reads = 0;
    let failures: string[] = [];
    let reader = (async () => {
      while (!done) {
        try {
          if ((await git(gitDir, 'log', '--format=%H %T', MAIN_REF)) !== log) {
            failures.push('git log answered differently');
          }
          let answer = await gitWithInput(
            gitDir,
            ['cat-file', '--batch-check'],
            batch,
          );
          if (answer !== check) {
            failures.push('git cat-file answered differently');
          }
        } catch (error) {
          failures.push(String(error));
        }
        reads++;
      }
    })();
    let result = await maintainRepo(gitDir, { pruneExpiryMs: 0 }).finally(
      () => (done = true),
    );
    await reader;

    assert.strictEqual(result.before.looseObjects, reachable.length);
    assert.strictEqual(result.after.looseObjects, 0);
    assert.true(reads > 0, 'the reader read during the pass');
    assert.deepEqual(failures, [], 'every read answered, unchanged');
  });

  test('a path-filtered git log on a 1,000-revision repo uses the Bloom filters and is faster with the commit-graph', async (assert) => {
    await importHistory(gitDir, 1000);
    let path = importedPathOf(57);
    let without = await timeLog(gitDir, ['-c', 'core.commitGraph=false'], path);
    assert.strictEqual(
      await bloomDefinitelyNot(gitDir, root, path),
      undefined,
      'no Bloom filter before the commit-graph is written',
    );

    let result = await maintainRepo(gitDir);
    assert.strictEqual(
      (await graphCommits(gitDir)).size,
      1000,
      'the commit-graph holds every revision',
    );
    let definitelyNot = await bloomDefinitelyNot(gitDir, root, path);
    assert.notStrictEqual(definitelyNot, undefined, 'git used Bloom filters');
    assert.true(
      definitelyNot! >= 900,
      `the Bloom filters rule out at least 900 of 1,000 revisions without reading their trees (${definitelyNot})`,
    );
    let withGraph = await timeLog(gitDir, [], path);
    assert.strictEqual(
      withGraph.output,
      without.output,
      'the same revisions, newest first',
    );
    assert.strictEqual(withGraph.output.trim().split('\n').length, 2);
    assert.true(
      withGraph.bestMs < without.bestMs,
      `git log -- ${path}: ${withGraph.bestMs.toFixed(1)} ms with the commit-graph, ${without.bestMs.toFixed(1)} ms without (commit-graph written in ${result.durations.commitGraph.toFixed(0)} ms)`,
    );
  });

  test('the commit-graph gains the revisions since its last write as a new layer', async (assert) => {
    let first = await writeLooseHistory(gitDir, 10);
    await writeCommitGraph(gitDir);
    let second = await writeLooseHistory(gitDir, 10, {
      from: 10,
      parent: first[first.length - 1],
    });
    assert.strictEqual((await graphCommits(gitDir)).size, 10);
    await writeCommitGraph(gitDir);
    assert.deepEqual(
      [...(await graphCommits(gitDir))].sort(),
      [...first, ...second].sort(),
    );
    assert.strictEqual(await fsck(gitDir), '');
  });

  test('after a pass the repo clones over a file URL and over dumb HTTP from a static file server', async (assert) => {
    let commits = await writeLooseHistory(gitDir, 5);
    let head = commits[commits.length - 1];
    let server = await serveFiles(root);
    try {
      let viaHTTP = `${server.url}/realm.git`;
      await assert.rejects(
        cloneBare(viaHTTP, join(root, 'before.git')),
        'without info/refs a dumb HTTP clone finds nothing to clone',
      );

      await maintainRepo(gitDir);
      await stat(join(gitDir, 'info', 'refs'));
      await stat(join(gitDir, 'objects', 'info', 'packs'));
      assert.strictEqual(
        await cloneBare(`file://${gitDir}`, join(root, 'file-clone.git')),
        head,
      );
      let httpClone = join(root, 'http-clone.git');
      assert.strictEqual(await cloneBare(viaHTTP, httpClone), head);
      assert.strictEqual(await fsck(httpClone), '');
    } finally {
      await server.close();
    }
  });

  test('a pass puts every pack into one once the repo has as many packs as the threshold', async (assert) => {
    let parent: string | undefined;
    let packs: number[] = [];
    let consolidated: boolean[] = [];
    for (let pass = 0; pass < 4; pass++) {
      let ids = await writeLooseHistory(gitDir, 3, { from: pass * 3, parent });
      parent = ids[ids.length - 1];
      let result = await maintainRepo(gitDir, { consolidateAtPacks: 3 });
      packs.push(result.after.packs);
      consolidated.push(result.consolidated);
    }
    assert.deepEqual(packs, [1, 2, 3, 1]);
    assert.deepEqual(consolidated, [false, false, false, true]);
    assert.deepEqual(
      await missingObjects(gitDir, await reachableObjects(gitDir)),
      [],
    );
    assert.strictEqual(await fsck(gitDir), '');
  });

  test('a commit-graph lock left by a killed git is removed once stale, and a current one is left alone', async (assert) => {
    await writeLooseHistory(gitDir, 3);
    let lock = join(
      gitDir,
      'objects',
      'info',
      'commit-graphs',
      'commit-graph-chain.lock',
    );
    await mkdir(dirname(lock), { recursive: true });
    await writeFile(lock, '');
    await assert.rejects(
      writeCommitGraph(gitDir),
      /File exists/,
      'a lock another git may hold fails the write',
    );
    await stat(lock);

    let twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000);
    await utimes(lock, twoHoursAgo, twoHoursAgo);
    await writeCommitGraph(gitDir);
    assert.strictEqual((await graphCommits(gitDir)).size, 3);
    await assert.rejects(stat(lock), 'the stale lock is gone');
  });

  test('an aborted pass stops git, and the next pass completes', async (assert) => {
    await writeLooseHistory(gitDir, 300);
    let controller = new AbortController();
    let pass = maintainRepo(gitDir, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(pass, (error: any) => error?.name === 'AbortError');
    assert.false(await isMaintained(gitDir));

    let result = await maintainRepo(gitDir);
    assert.strictEqual(result.after.looseObjects, 0);
    assert.true(await isMaintained(gitDir));
    assert.strictEqual(await fsck(gitDir), '');
  });

  test('info/refs records the HEAD the last pass saw', async (assert) => {
    assert.true(
      await isMaintained(join(root, 'absent.git')),
      'no repo, nothing to maintain',
    );
    assert.true(await isMaintained(gitDir), 'no revision, nothing to maintain');
    let [first] = await writeLooseHistory(gitDir, 1);
    assert.false(await isMaintained(gitDir));
    await maintainRepo(gitDir);
    assert.strictEqual(await maintainedHead(gitDir), first);
    assert.true(await isMaintained(gitDir));
    await writeLooseHistory(gitDir, 1, { from: 1, parent: first });
    assert.false(
      await isMaintained(gitDir),
      'a later revision is unmaintained',
    );
  });

  test('a pass that fails after its repack leaves the repo unmaintained', async (assert) => {
    let [first] = await writeLooseHistory(gitDir, 1);
    await maintainRepo(gitDir);
    await writeLooseHistory(gitDir, 3, { from: 1, parent: first });
    // A lock another git holds fails the commit-graph step, which follows
    // the repack.
    let lock = join(
      gitDir,
      'objects',
      'info',
      'commit-graphs',
      'commit-graph-chain.lock',
    );
    await writeFile(lock, '');
    await assert.rejects(maintainRepo(gitDir), /File exists/);
    assert.strictEqual(
      (await countObjects(gitDir)).packs,
      2,
      'the repack step ran',
    );
    assert.strictEqual(
      await maintainedHead(gitDir),
      first,
      'info/refs still names the HEAD of the last complete pass',
    );
    assert.false(await isMaintained(gitDir));
  });

  test('counting objects reports loose and packed objects', async (assert) => {
    await writeLooseHistory(gitDir, 2);
    let loose = await countObjects(gitDir);
    assert.strictEqual(loose.packs, 0);
    assert.true(loose.looseObjects > 0);
    assert.true(loose.looseBytes > 0);
    await maintainRepo(gitDir);
    let packed = await countObjects(gitDir);
    assert.strictEqual(packed.looseObjects, 0);
    assert.strictEqual(packed.packedObjects, loose.looseObjects);
    assert.true(packed.packBytes > 0);
  });
});

module('git capabilities', () => {
  test('the probe reports the version and whether Bloom filters serve one path filter and several', async (assert) => {
    let capabilities = await probeGit();
    let version = (await gitWithInput(undefined, ['--version'], ''))
      .trim()
      .replace(/^git version /, '');
    assert.strictEqual(capabilities.version, version);
    let [major, minor] = version.split('.').map(Number);
    let from251 = major > 2 || (major === 2 && minor >= 51);
    assert.true(capabilities.bloomWithOnePath, 'git 2.27 or later');
    assert.strictEqual(
      capabilities.bloomWithSeveralPaths,
      from251,
      `git ${version} ${capabilities.bloomWithSeveralPaths ? 'uses' : "doesn't use"} Bloom filters with several path filters`,
    );
  });
});

module('maintenance of a recorded repo', (hooks) => {
  let database = setupTestDatabase(hooks);
  let root: string;
  let realmDir: string;
  let historyRoot: string;
  let realm: TestRealm;
  let recorders: Recorder[];
  let fatals: Error[];
  const AUTHOR = '@test-author:localhost';
  const PATH = 'Author/jane.json';
  const T0 = Date.parse('2026-11-11T10:00:00.000Z');
  const { quietPeriodMs } = DEFAULT_GROUPING_LIMITS;

  hooks.beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'realm-maintenance-'));
    realmDir = join(root, 'realm');
    historyRoot = join(root, 'history');
    await mkdir(realmDir, { recursive: true });
    realm = await insertRealm(database.db, {
      url: 'http://localhost:4201/test-user/realm/',
    });
    await database.db.execute(
      `INSERT INTO realm_historian_leases (shard, holder, expires_at)
       VALUES ('0', 'maintenance-test-task', now() + interval '1 hour')`,
    );
    recorders = [];
    fatals = [];
  });

  hooks.afterEach(async (assert) => {
    for (let recorder of recorders.splice(0)) {
      await recorder.stop();
    }
    assert.deepEqual(fatals, [], 'no recorder failed');
    await rm(root, { recursive: true, force: true });
  });

  function recorder(): Recorder {
    let created = new Recorder({
      db: database.db,
      realm: { id: realm.id, url: realm.url, directory: realmDir, shard: 0 },
      historyRoot,
      holder: 'maintenance-test-task',
      io: new Semaphore(4),
      onFatal: (error) => fatals.push(error),
    });
    recorders.push(created);
    return created;
  }

  async function save(content: string, offsetMs: number): Promise<ChangeEvent> {
    let full = join(realmDir, PATH);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
    let change: ChangeEventChange = {
      path: PATH,
      status: 'M',
      contentHash: computeContentHash(Buffer.from(content)),
      size: Buffer.byteLength(content),
    };
    return appendEvent(database.db, realm, {
      author: AUTHOR,
      changes: [change],
      occurredAt: new Date(T0 + offsetMs),
    });
  }

  test("after an autosave burst, a pass prunes the burst's intermediate captures and keeps every object a revision uses", async (assert) => {
    let target = recorder();
    let saves = Array.from({ length: 8 }, (_, i) => `{"v":${i}}`);
    // Each save is captured before the next lands, as saves seconds apart
    // are, so every intermediate state is written to the repo.
    for (let [i, content] of saves.entries()) {
      await target.record(await save(content, i * 1000));
      await target.settled();
    }
    target.tick(T0 + 7000 + quietPeriodMs);
    await target.settled();

    let gitDir = repoPath(historyRoot, realm.id);
    let revisions = (await git(gitDir, 'rev-list', MAIN_REF))
      .trim()
      .split('\n');
    assert.strictEqual(revisions.length, 1, 'the burst is one revision');
    let intermediates = saves
      .slice(0, -1)
      .map((content) => hashObject('blob', blobBody(content)));
    assert.deepEqual(
      await missingObjects(gitDir, intermediates),
      [],
      'each intermediate save was captured',
    );

    let result = await maintainRepo(gitDir, { pruneExpiryMs: 0 });
    assert.strictEqual(result.pruned, intermediates.length);
    assert.strictEqual(result.after.looseObjects, 0);
    assert.deepEqual(
      await missingObjects(gitDir, intermediates),
      intermediates,
      'the intermediate captures are gone',
    );
    let blobs = (await git(gitDir, 'ls-tree', '-r', MAIN_REF))
      .trim()
      .split('\n')
      .map((line) => line.split(/\s+/)[2]);
    assert.deepEqual(
      blobs,
      [hashObject('blob', blobBody(saves[saves.length - 1]))],
      'the revision holds the last save',
    );
    assert.deepEqual(
      await missingObjects(gitDir, await reachableObjects(gitDir)),
      [],
      'every object the revision uses remains',
    );
    assert.strictEqual(await fsck(gitDir), '');
  });
});
