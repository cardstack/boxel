import QUnit from 'qunit';
const { module, test } = QUnit;
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

import { readTreeFile } from '@cardstack/deck/object-store';

const execFileAsync = promisify(execFile);

async function listGTS(root: string, current = root): Promise<string[]> {
  let result: string[] = [];
  for (let entry of await readdir(current, { withFileTypes: true })) {
    if (entry.name === '.deck') continue;
    let path = join(current, entry.name);
    if (entry.isDirectory()) result.push(...(await listGTS(root, path)));
    if (entry.isFile() && entry.name.endsWith('.gts'))
      result.push(path.slice(root.length + 1));
  }
  return result.sort();
}

module(basename(import.meta.filename), function (hooks) {
  let realmDir: string;

  hooks.beforeEach(async () => {
    realmDir = await mkdtemp(join(tmpdir(), 'pretui-team-fixture-'));
  });

  hooks.afterEach(async () => {
    await rm(realmDir, { recursive: true, force: true });
  });

  test('replays a multi-developer PretUI release and opens the next development line', async function (assert) {
    let script = new URL(
      '../scripts/seed-pretui-team-fixture.ts',
      import.meta.url,
    );
    let { stdout } = await execFileAsync(process.execPath, [
      script.pathname,
      realmDir,
    ]);
    let report = JSON.parse(stdout) as {
      artifactCount: number;
      componentStates: { two: number; three: number };
      reviews: Array<{ state: string; events: string[] }>;
      tags: Record<string, string>;
      versions: Record<string, string>;
      branches: {
        main: { repositoryHash: string };
        develop: { repositoryHash: string };
        next: { repositoryHash: string };
      };
    };

    assert.strictEqual(
      report.artifactCount,
      28,
      'twenty-eight components, fields, and cards',
    );
    assert.deepEqual(
      report.componentStates,
      { three: 8, two: 20 },
      'every unit varies across two or three source states',
    );
    let materializedModules = await listGTS(realmDir);
    assert.strictEqual(
      materializedModules.length,
      31,
      'main materializes 28 release units and three inspectable fixture cards',
    );
    assert.deepEqual(
      materializedModules.filter((path) =>
        [
          'cards/astra-harness.gts',
          'cards/astra-view.gts',
          'cards/component-entry.gts',
        ].includes(path),
      ),
      [
        'cards/astra-harness.gts',
        'cards/astra-view.gts',
        'cards/component-entry.gts',
      ],
      'the query harness, exact-view card, and catalog card ship with the realm',
    );
    assert.strictEqual(
      report.reviews.length,
      5,
      'four layer Reviews plus one release Review',
    );
    assert.true(
      report.reviews.every(({ state }) => state === 'merged'),
      'every submitted Review merged',
    );
    assert.true(
      report.reviews.every(
        ({ events }) => events.join(',') === 'reviewed,merge-started,merged',
      ),
      'approval and two-phase merge history is durable',
    );
    assert.deepEqual(
      report.tags,
      { latest: '1.0.0', dev: '1.1.0-dev.1' },
      'main and next development have distinct moving tags',
    );
    assert.strictEqual(
      report.branches.main.repositoryHash,
      report.branches.develop.repositoryHash,
      'develop and main agree after release',
    );
    assert.notStrictEqual(
      report.branches.main.repositoryHash,
      report.branches.next.repositoryHash,
      'next development has its own exact Repository',
    );

    let stableLock = JSON.parse(
      await readFile(
        join(realmDir, 'workspaces', 'mina', 'importmap.json'),
        'utf8',
      ),
    );
    assert.strictEqual(
      stableLock.imports['@cardstack/pretui'],
      '@cardstack/pretui@1.0.0/',
      'the mutable main tree locks the latest stable release',
    );

    let storeDir = join(realmDir, '.deck', 'store');
    let candidateLock = JSON.parse(
      (await readTreeFile(
        storeDir,
        report.versions['1.0.0-dev.1'],
        'workspaces/mina/importmap.json',
      ))!.toString('utf8'),
    );
    let nextLock = JSON.parse(
      (await readTreeFile(
        storeDir,
        report.versions['1.1.0-dev.1'],
        'workspaces/mina/importmap.json',
      ))!.toString('utf8'),
    );
    assert.strictEqual(
      candidateLock.imports['@cardstack/pretui'],
      '@cardstack/pretui@1.0.0-dev.1/',
      'candidate consumers retain the exact reviewed dev lock',
    );
    assert.strictEqual(
      nextLock.imports['@cardstack/pretui'],
      '@cardstack/pretui@1.1.0-dev.1/',
      'the next branch advances its exact dev lock without moving main',
    );
  });
});
