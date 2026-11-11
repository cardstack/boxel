import { CardError } from '@cardstack/runtime-common/error';
import QUnit from 'qunit';
import { basename, join } from 'node:path';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
  mkdir,
  utimes,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { computeContentHash } from '@cardstack/runtime-common/content-hash';
import { StagedFile } from '@cardstack/runtime-common/staged-file';
import {
  UploadStaging,
  sweepAbandonedUploads,
  sweepUploadDirectory,
} from '../lib/upload-staging.ts';

const { module, test } = QUnit;

function stream(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream(
    {
      pull(controller) {
        let chunk = chunks.shift();
        if (chunk) controller.enqueue(Uint8Array.from(chunk));
        else controller.close();
      },
    },
    { highWaterMark: 0 },
  );
}

module(basename(import.meta.filename), function (hooks) {
  let dir: string;
  hooks.beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'upload-test-'));
  });
  hooks.afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('streams exact-limit bytes and preserves both hashes on atomic publication', async function (assert) {
    let staging = new UploadStaging(20);
    let target = join(dir, 'asset.bin');
    let bytes = Buffer.from([0, 255, 128, 2]);
    let content = await staging.stage(target, stream([0, 255], [128, 2]), 4, 4);
    assert.strictEqual(content.size, 4);
    assert.strictEqual(content.contentHash, computeContentHash(bytes));
    assert.strictEqual(
      content.sha256,
      createHash('sha256').update(bytes).digest('hex'),
    );
    assert.false(
      (await readdir(dir)).includes('asset.bin'),
      'not published during staging',
    );
    await staging.commit(target, content);
    await staging.dispose(content);
    assert.deepEqual([...(await readFile(target))], [...bytes]);
    assert.deepEqual(
      await readdir(dir),
      ['asset.bin'],
      'no staging file remains',
    );
  });

  test('staging into a missing directory creates no directory until commit', async function (assert) {
    let staging = new UploadStaging(20);
    let target = join(dir, 'new', 'nested', 'asset.bin');
    let content = await staging.stage(target, stream([1, 2, 3]), 3, 3);
    assert.deepEqual(await readdir(dir), [], 'nothing created in the realm');
    await staging.commit(target, content);
    await staging.dispose(content);
    assert.deepEqual([...(await readFile(target))], [1, 2, 3]);
    assert.deepEqual(await readdir(join(dir, 'new', 'nested')), ['asset.bin']);
  });

  test('a refused upload into a missing directory leaves nothing behind', async function (assert) {
    let staging = new UploadStaging(20);
    await assert.rejects(
      staging.stage(join(dir, 'new', 'asset.bin'), stream([1, 2, 3, 4]), 3),
      (error: unknown) => error instanceof CardError && error.status === 413,
    );
    assert.deepEqual(await readdir(dir), []);
  });

  test('rejects Content-Length before pulling or allocating staging bytes', async function (assert) {
    let staging = new UploadStaging(5);
    let pulls = 0;
    let body = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulls++;
        },
      },
      { highWaterMark: 0 },
    );
    await assert.rejects(
      staging.stage(join(dir, 'asset.bin'), body, 4, 5),
      (error: unknown) => error instanceof CardError && error.status === 413,
    );
    assert.strictEqual(pulls, 0);
    assert.deepEqual(await readdir(dir), []);
  });

  test('cuts off chunked uploads and releases staging capacity', async function (assert) {
    let staging = new UploadStaging(5);
    let canceled = false;
    let pulls = 0;
    let body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls++;
          controller.enqueue(new Uint8Array(3));
        },
        cancel() {
          canceled = true;
        },
      },
      { highWaterMark: 0 },
    );
    await assert.rejects(
      staging.stage(join(dir, 'asset.bin'), body, 4),
      (error: unknown) => error instanceof CardError && error.status === 413,
    );
    assert.true(canceled);
    assert.true(pulls < 10, 'does not drain the producer');
    assert.deepEqual(await readdir(dir), []);
    let next = await staging.stage(
      join(dir, 'next.bin'),
      stream([1, 2, 3, 4, 5]),
      5,
      5,
    );
    await staging.dispose(next);
  });

  test('capacity refusal leaves no bytes and disposal permits the next upload', async function (assert) {
    let staging = new UploadStaging(5);
    let first = await staging.stage(
      join(dir, 'first.bin'),
      stream([1, 2, 3]),
      5,
      3,
    );
    await assert.rejects(
      staging.stage(join(dir, 'second.bin'), stream([4, 5, 6]), 5, 3),
      (error: unknown) => error instanceof CardError && error.status === 503,
    );
    await staging.dispose(first);
    let second = await staging.stage(
      join(dir, 'second.bin'),
      stream([4, 5, 6]),
      5,
      3,
    );
    await staging.dispose(second);
    assert.deepEqual(await readdir(dir), []);
  });

  test('a declared length that never arrives holds no staging capacity', async function (assert) {
    let staging = new UploadStaging(5);
    let stalledBody!: ReadableStreamDefaultController<Uint8Array>;
    let stalled = staging.stage(
      join(dir, 'stalled.bin'),
      new ReadableStream<Uint8Array>(
        {
          start(controller) {
            stalledBody = controller;
          },
        },
        { highWaterMark: 0 },
      ),
      5,
      5,
    );
    let next = await staging.stage(
      join(dir, 'next.bin'),
      stream([1, 2, 3, 4, 5]),
      5,
      5,
    );
    assert.strictEqual(next.size, 5, 'the whole budget was still available');
    await staging.dispose(next);
    stalledBody.error(new Error('client went away'));
    await assert.rejects(stalled, /client went away/);
    assert.deepEqual(await readdir(dir), []);
  });

  test('concurrent uploads to one target have distinct staging files', async function (assert) {
    let staging = new UploadStaging(10);
    let target = join(dir, 'asset.bin');
    let [first, second] = await Promise.all([
      staging.stage(target, stream([1]), 1, 1),
      staging.stage(target, stream([2]), 1, 1),
    ]);
    assert.notStrictEqual(first.stagedPath, second.stagedPath);
    await staging.commit(target, first);
    assert.false(await staging.equals(target, second));
    await staging.commit(target, second);
    assert.true(await staging.equals(target, second));
    await staging.dispose(first);
    await staging.dispose(second);
    assert.deepEqual([...(await readFile(target))], [2]);
    assert.deepEqual(await readdir(dir), ['asset.bin']);
  });

  test('read failure and publication failure both permit cleanup', async function (assert) {
    let staging = new UploadStaging(5);
    let failed = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('disconnected'));
      },
    });
    await assert.rejects(
      staging.stage(join(dir, 'asset.bin'), failed, 5, 3),
      /disconnected/,
    );
    assert.deepEqual(await readdir(dir), []);
    let target = join(dir, 'directory');
    await mkdir(target);
    let content = await staging.stage(target, stream([1]), 5, 1);
    await assert.rejects(staging.commit(target, content));
    await staging.dispose(content);
    assert.deepEqual(await readdir(dir), ['directory']);
    await assert.rejects(
      staging.commit(
        join(dir, 'forged'),
        new StagedFile(content.stagedPath, 1, '', ''),
      ),
      /Unknown/,
    );
  });

  test('unknown-length uploads stage locally and publish intact', async function (assert) {
    let staging = new UploadStaging(5);
    let target = join(dir, 'asset.bin');
    let content = await staging.stage(target, stream([1, 2], [3]), 5);
    assert.notStrictEqual(basename(content.stagedPath), 'asset.bin');
    assert.false(content.stagedPath.startsWith(dir));
    await staging.commit(target, content);
    await staging.dispose(content);
    assert.strictEqual((await stat(target)).size, 3);
  });

  // Linux CI supplies a tmpfs on /dev/shm, so this exercises an actual
  // EXDEV rename instead of replacing filesystem calls with mocks.
  let crossDeviceTest = process.platform === 'linux' ? test : test.skip;
  crossDeviceTest(
    'publishes across filesystems through an atomic sibling copy',
    async function (assert) {
      let destination = await mkdtemp('/dev/shm/boxel-upload-test-');
      let staging = new UploadStaging(10);
      let content = await staging.stage(
        join(destination, 'asset.bin'),
        stream([0, 255, 128]),
        5,
      );
      try {
        assert.notStrictEqual(
          (await stat(destination)).dev,
          (await stat(content.stagedPath)).dev,
          'source and target really differ',
        );
        await staging.commit(join(destination, 'asset.bin'), content);
        assert.deepEqual(
          [...(await readFile(join(destination, 'asset.bin')))],
          [0, 255, 128],
        );
        assert.deepEqual(await readdir(destination), ['asset.bin']);
      } finally {
        await staging.dispose(content);
        await rm(destination, { recursive: true, force: true });
      }
    },
  );

  test('staging into a directory removes expired upload siblings left by replaced containers', async function (assert) {
    let stale = join(dir, '.boxel-upload.abcdef.boxel-partial');
    let active = join(dir, '.boxel-upload.123456.boxel-partial');
    let unrelated = join(dir, 'ordinary.boxel-partial');
    await writeFile(stale, 'abandoned');
    await writeFile(active, 'active');
    await writeFile(unrelated, 'other writer');
    let old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(stale, old, old);
    await utimes(unrelated, old, old);
    await sweepUploadDirectory(dir);
    assert.deepEqual(await readdir(dir), [
      basename(active),
      basename(unrelated),
    ]);
  });

  test('startup sweep reclaims dead owners and preserves live owners', async function (assert) {
    let dead = join(dir, '2147483647-dead');
    let live = join(dir, `${process.pid}-live`);
    await mkdir(dead);
    await mkdir(live);
    let sibling = join(dir, 'asset.upload-id.boxel-partial');
    await writeFile(sibling, 'partial');
    await writeFile(join(dead, 'upload-id.json'), JSON.stringify([sibling]));
    await writeFile(join(live, 'keep'), 'active');
    await sweepAbandonedUploads(dir);
    assert.deepEqual(await readdir(dir), [basename(live)]);
    assert.strictEqual(await readFile(join(live, 'keep'), 'utf8'), 'active');
  });

  test('200 MB HTTP upload stays bounded in memory', async function (assert) {
    let output = '';
    let child = spawn(
      process.execPath,
      [
        // Room for the realm-server modules the child imports. The bound on
        // the upload itself is asserted below, as growth from a baseline.
        '--max-old-space-size=256',
        '--expose-gc',
        join(import.meta.dirname, 'fixtures/upload-staging-child.ts'),
        dir,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    let code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    assert.strictEqual(code, 0, output);
    if (code === 0) {
      let result = JSON.parse(output.trim());
      assert.strictEqual(result.size, 200 * 1024 ** 2);
      assert.true(
        result.maxBuffers < 40 * 1024 ** 2,
        `peak byte buffers: ${result.maxBuffers}`,
      );
      assert.true(
        result.heapGrowth < 32 * 1024 ** 2,
        `heap growth during the upload: ${result.heapGrowth}`,
      );
    }
  });
});
