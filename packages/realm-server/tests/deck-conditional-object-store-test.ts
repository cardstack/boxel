import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PutObjectCommand } from '@aws-sdk/client-s3';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import {
  ConditionalWriteConflictError,
  hashBytes,
  type BranchHeadState,
  type ConditionalObjectStore,
} from '@cardstack/deck/node';
import QUnit from 'qunit';

import {
  RealmFileConditionalObjectStore,
  S3ConditionalObjectStore,
  type S3CommandClient,
} from '../lib/deck-conditional-object-store.ts';
import {
  commitPreparedBranchUpdate,
  prepareBranchUpdate,
} from '../lib/deck-prepared-branch-update.ts';

const { module, test, skip } = QUnit;

function etag(bytes: Buffer): string {
  return `"${hashBytes(bytes)}"`;
}

function preconditionFailed(): Error {
  return Object.assign(new Error('Precondition Failed'), {
    name: 'PreconditionFailed',
    $metadata: { httpStatusCode: 412 },
  });
}

class MemoryS3Client implements S3CommandClient {
  objects = new Map<string, Buffer>();

  async send(command: GetObjectCommand | PutObjectCommand): Promise<unknown> {
    if (command instanceof GetObjectCommand) {
      let key = command.input.Key!;
      let bytes = this.objects.get(key);
      if (!bytes) {
        throw Object.assign(new Error('missing'), {
          name: 'NoSuchKey',
          $metadata: { httpStatusCode: 404 },
        });
      }
      return {
        ETag: etag(bytes),
        Body: { transformToByteArray: async () => bytes },
      };
    }
    let key = command.input.Key!;
    let bytes = Buffer.from(command.input.Body as Uint8Array);
    let current = this.objects.get(key);
    if (
      (command.input.IfNoneMatch === '*' && current) ||
      (command.input.IfMatch !== undefined &&
        (!current || etag(current) !== command.input.IfMatch))
    ) {
      throw preconditionFailed();
    }
    this.objects.set(key, bytes);
    return { ETag: etag(bytes) };
  }
}

function state(seed: string): BranchHeadState {
  return {
    repositoryHash: seed.repeat(64),
    historyHead: `history:${seed}`,
    indexGenerationHash: seed.toUpperCase().repeat(64).toLowerCase(),
    latestCheckpointHash: null,
  };
}

function objectStoreContract(
  label: string,
  makeStore: () => Promise<{
    objects: ConditionalObjectStore;
    cleanup(): Promise<void>;
  }>,
) {
  module(label, function (hooks) {
    let objects: ConditionalObjectStore;
    let cleanup: () => Promise<void>;

    hooks.beforeEach(async function () {
      ({ objects, cleanup } = await makeStore());
    });

    hooks.afterEach(async function () {
      await cleanup();
    });

    test('implements create and compare-and-swap without lost updates', async function (assert) {
      let key = '.deck/refs/heads/main.json';
      let first = Buffer.from('first');
      let second = Buffer.from('second');
      let created = await objects.put(key, first, { ifNoneMatch: '*' });

      await assert.rejects(
        objects.put(key, second, { ifNoneMatch: '*' }),
        ConditionalWriteConflictError,
      );
      await objects.put(key, second, { ifMatch: created.etag });
      await assert.rejects(
        objects.put(key, Buffer.from('stale'), { ifMatch: created.etag }),
        ConditionalWriteConflictError,
      );
      assert.strictEqual((await objects.get(key))?.bytes.toString(), 'second');
    });

    test('serializes contenders and lets only one stale writer win', async function (assert) {
      let key = '.deck/refs/heads/main.json';
      let created = await objects.put(key, Buffer.from('base'), {
        ifNoneMatch: '*',
      });
      let results = await Promise.allSettled([
        objects.put(key, Buffer.from('writer-a'), { ifMatch: created.etag }),
        objects.put(key, Buffer.from('writer-b'), { ifMatch: created.etag }),
      ]);

      assert.strictEqual(
        results.filter(({ status }) => status === 'fulfilled').length,
        1,
      );
      assert.strictEqual(
        results.filter(({ status }) => status === 'rejected').length,
        1,
      );
    });

    test('keeps prepared updates writer-owned and recovers after commit acknowledgement loss', async function (assert) {
      let prepared = await prepareBranchUpdate({
        objects,
        id: 'known-date-main-1',
        writerId: 'realm-server-a',
        branchKey: '.deck/refs/heads/main.json',
        expectedGeneration: null,
        next: state('a'),
        createdAt: '2026-08-24T00:00:00.000Z',
      });
      await prepareBranchUpdate({
        objects,
        id: 'known-date-main-1',
        writerId: 'realm-server-a',
        branchKey: '.deck/refs/heads/main.json',
        expectedGeneration: null,
        next: state('a'),
        createdAt: '2026-08-24T00:00:00.000Z',
      });

      await assert.rejects(
        commitPreparedBranchUpdate({
          objects,
          id: prepared.id,
          writerId: 'realm-server-b',
        }),
        /belongs to writer realm-server-a/,
      );
      let committed = await commitPreparedBranchUpdate({
        objects,
        id: prepared.id,
        writerId: 'realm-server-a',
      });
      let recovered = await commitPreparedBranchUpdate({
        objects,
        id: prepared.id,
        writerId: 'realm-server-a',
      });

      assert.false(committed.recovered);
      assert.true(recovered.recovered);
      assert.deepEqual(recovered.head, committed.head);
    });
  });
}

objectStoreContract('realm-file conditional object store', async () => {
  let realmDir = await mkdtemp(join(tmpdir(), 'deck-file-objects-'));
  return {
    objects: new RealmFileConditionalObjectStore(realmDir),
    cleanup: () => rm(realmDir, { recursive: true, force: true }),
  };
});

objectStoreContract('S3 conditional object store protocol', async () => {
  let client = new MemoryS3Client();
  return {
    objects: new S3ConditionalObjectStore('test-bucket', 'realms/pretui', {
      client,
    }),
    cleanup: async () => {},
  };
});

let awsBucket = process.env.BOXEL_DECK_S3_TEST_BUCKET;
let awsTest = awsBucket ? test : skip;
awsTest(
  'runs conditional writes against the configured AWS test bucket',
  async function (assert) {
    let prefix = `deck-b1a-test/${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let objects = new S3ConditionalObjectStore(awsBucket!, prefix, {
      region: process.env.BOXEL_DECK_S3_TEST_REGION,
    });
    let created = await objects.put('.deck/probe.json', Buffer.from('one'), {
      ifNoneMatch: '*',
    });
    await objects.put('.deck/probe.json', Buffer.from('two'), {
      ifMatch: created.etag,
    });
    await assert.rejects(
      objects.put('.deck/probe.json', Buffer.from('stale'), {
        ifMatch: created.etag,
      }),
      ConditionalWriteConflictError,
    );
    assert.strictEqual(
      (await objects.get('.deck/probe.json'))?.bytes.toString(),
      'two',
    );
  },
);
