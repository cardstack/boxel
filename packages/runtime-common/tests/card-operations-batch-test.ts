import {
  commitBatch,
  isOperationFailure,
  type BatchCore,
  type BatchEntry,
  type OperationDefinition,
} from '../card-operations/index.ts';
import { computeContentHash } from '../index.ts';
import type { CodeRef } from '../code-ref.ts';
import type { RealmIdentifier } from '../realm-identifiers.ts';
import type { Definition } from '../definitions.ts';
import type { SharedTests } from '../helpers/index.ts';

// ============================================================================
// What the coordinator stages, and what it refuses.
//
// The realm's collaborators are stubbed here, which is the point: what is
// under test is the decision the coordinator makes about a batch — which files
// it would write, which local ids resolve where, and whether it reaches the
// commit at all — not the realm's ability to carry the commit out. The stub
// records what it was handed and never writes anything, so a batch that must
// abandon before committing is checked by the commit simply never having been
// called, which is the property itself rather than a proxy for it.
//
// The commit's own behavior — one index job, one index event, bytes on disk —
// only exists against a real realm, and is covered by the realm-server suite.
// ============================================================================

const REALM = 'http://example.com/test/';
const PERSON = { module: `${REALM}person`, name: 'Person' } as CodeRef;
const PET = { module: `${REALM}pet`, name: 'Pet' } as CodeRef;
const STRING = { module: `${REALM}string`, name: 'default' } as CodeRef;

interface Commit {
  writes: Record<string, string>;
  deletes: string[];
  clientRequestId: string | null | undefined;
  waitForIndex: boolean | undefined;
}

interface Stub {
  core: BatchCore;
  commits: Commit[];
  lockDepth: () => number;
  drainCount: () => number;
  readsOutsideLock: () => number;
}

interface StubOptions {
  // The stored source files the realm holds, by local path.
  stored?: Record<string, string>;
  // The realm's size ceiling, for the paths a batch stages.
  sizeLimit?: number;
  // The definition-cache entry a code ref resolves to, keyed by its name.
  definitions?: Record<string, Definition>;
  // What `serializeCard` does to a resource on its way to storage. The default
  // is the identity, which keeps a test's expected bytes readable; a test that
  // cares about a serializer refusal supplies its own.
  serialize?: (doc: any) => any;
}

function cardFile(attributes: Record<string, unknown>, adoptsFrom: unknown) {
  return JSON.stringify(
    { data: { type: 'card', attributes, meta: { adoptsFrom } } },
    null,
    2,
  );
}

function stub(opts: StubOptions = {}): Stub {
  let { stored = {}, definitions = {}, serialize = (doc: any) => doc } = opts;
  let commits: Commit[] = [];
  let held = 0;
  let maxHeld = 0;
  let drains = 0;
  let readsOutsideLock = 0;

  let core: BatchCore = {
    realmURL: REALM,
    async withWriteLock(fn) {
      held++;
      maxHeld = Math.max(maxHeld, held);
      try {
        return await fn();
      } finally {
        held--;
      }
    },
    async fileExists(localPath) {
      readsOutsideLock += held > 0 ? 0 : 1;
      return stored[localPath] !== undefined;
    },
    async readSourceFile(localPath) {
      readsOutsideLock += held > 0 ? 0 : 1;
      let content = stored[localPath];
      return content === undefined
        ? undefined
        : { content, lastModified: 1000 };
    },
    assertWriteSize(localPath, content) {
      let limit = opts.sizeLimit;
      if (limit !== undefined && content.length > limit) {
        throw new Error(`${localPath} is over the realm's size limit`);
      }
    },
    async drainIndexing() {
      drains++;
    },
    async commitUnlocked(batch, options) {
      readsOutsideLock += held > 0 ? 0 : 1;
      let writes = Object.fromEntries(
        [...(batch.writes ?? new Map<string, string | Uint8Array>())].map(
          ([path, content]) => [path, String(content)],
        ),
      );
      commits.push({
        writes,
        deletes: [...(batch.deletes ?? [])],
        clientRequestId: options?.clientRequestId,
        waitForIndex: options?.waitForIndex,
      });
      return {
        // A real commit fingerprints the bytes it wrote; the stub stands in
        // with the byte length, which is enough for a test to tell one
        // version from another.
        writes: Object.entries(writes).map(([path, content]) => ({
          path,
          lastModified: 2000,
          contentHash: `hash-${content.length}`,
        })),
        generation: 9,
      };
    },
    async serializeCard(doc) {
      return serialize(doc);
    },
    codeRefKey(codeRef) {
      return 'module' in codeRef
        ? `${codeRef.module}/${codeRef.name}`
        : JSON.stringify(codeRef);
    },
    resolveModuleId(moduleId) {
      return moduleId;
    },
    async lookupDefinition(codeRef) {
      return 'name' in codeRef ? definitions[codeRef.name] : undefined;
    },
  };
  return {
    core,
    commits,
    lockDepth: () => maxHeld,
    drainCount: () => drains,
    readsOutsideLock: () => readsOutsideLock,
  };
}

function personDefinition(): Definition {
  return {
    type: 'card-def',
    codeRef: PERSON,
    displayName: 'Person',
    fields: { friend: 'f0', firstName: 'f1' },
    fieldDefs: {
      f0: {
        type: 'linksTo',
        isPrimitive: false,
        isComputed: false,
        fieldOrCard: PERSON,
      },
      f1: {
        type: 'contains',
        isPrimitive: true,
        isComputed: false,
        fieldOrCard: STRING,
      },
    },
  } as Definition;
}

async function refusal(
  core: BatchCore,
  entries: BatchEntry[],
): Promise<{ status: number; code: string; entry: unknown } | undefined> {
  try {
    await commitBatch(core, entries, {});
  } catch (err: unknown) {
    if (!isOperationFailure(err)) {
      throw err;
    }
    return {
      status: err.error.status,
      code: err.error.code,
      entry: err.error.meta?.entry,
    };
  }
  return undefined;
}

const tests: SharedTests<Record<string, never>> = {
  'a create is staged at the path its local id names': async (assert) => {
    let { core, commits } = stub();
    let results = await commitBatch(
      core,
      [
        {
          op: 'create',
          lid: 'mango',
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Mango' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
      ],
      { clientRequestId: 'req-1' },
    );

    assert.strictEqual(commits.length, 1, 'the batch commits once');
    assert.deepEqual(
      Object.keys(commits[0].writes),
      ['Person/mango.json'],
      'the file is named after the local id, under the type directory',
    );
    assert.deepEqual(commits[0].deletes, [], 'nothing is removed');
    assert.strictEqual(
      commits[0].clientRequestId,
      'req-1',
      "the commit carries the caller's own request id",
    );
    assert.true(
      commits[0].waitForIndex,
      'the batch waits for indexing by default',
    );
    assert.strictEqual(results[0]?.id, `${REALM}Person/mango`);
    assert.strictEqual(
      results[0] && 'lid' in results[0] ? results[0].lid : undefined,
      'mango',
      'the result echoes the local id',
    );
    assert.strictEqual(
      results[0]?.meta.generation,
      9,
      "the result carries the commit's index generation",
    );
  },

  'a later entry links to a card an earlier one mints': async (assert) => {
    let { core, commits } = stub();
    await commitBatch(
      core,
      [
        {
          op: 'create',
          lid: 'owner',
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Hassan' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
        {
          op: 'create',
          lid: 'pet',
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Mango' },
              relationships: {
                friend: { data: { type: 'card', lid: 'owner' } },
              },
              meta: { adoptsFrom: PET },
            },
          },
        },
      ],
      {},
    );

    let staged = JSON.parse(commits[0].writes['Pet/pet.json']);
    assert.strictEqual(
      staged.data.relationships.friend.links.self,
      `${REALM}Person/owner`,
      'the link resolves to the URL the other entry will be written at',
    );
    assert.deepEqual(
      Object.keys(commits[0].writes).sort(),
      ['Person/owner.json', 'Pet/pet.json'],
      'both cards are staged in one commit',
    );
  },

  'a side-loaded resource is created alongside its primary': async (assert) => {
    let { core, commits } = stub();
    await commitBatch(
      core,
      [
        {
          op: 'create',
          lid: 'primary',
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Primary' },
              relationships: {
                friend: { data: { type: 'card', lid: 'sidecar' } },
              },
              meta: { adoptsFrom: PERSON },
            },
            included: [
              {
                type: 'card',
                lid: 'sidecar',
                attributes: { firstName: 'Sidecar' },
                meta: { adoptsFrom: PET },
              },
              // No local id, so nothing can name it and it is not staged.
              {
                type: 'card',
                attributes: { firstName: 'Anonymous' },
                meta: { adoptsFrom: PET },
              },
            ],
          },
        },
      ],
      {},
    );

    assert.deepEqual(
      Object.keys(commits[0].writes).sort(),
      ['Person/primary.json', 'Pet/sidecar.json'],
      'the side-loaded resource with a local id is staged, the other is not',
    );
    let primary = JSON.parse(commits[0].writes['Person/primary.json']);
    assert.strictEqual(
      primary.data.relationships.friend.links.self,
      `${REALM}Pet/sidecar`,
      'the primary links to the side-loaded card',
    );
  },

  'an entry that cannot be staged abandons the batch before it commits': async (
    assert,
  ) => {
    let { core, commits } = stub();
    let failed = await refusal(core, [
      {
        op: 'create',
        lid: 'never-written',
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Ghost' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
      {
        op: 'update',
        href: `${REALM}absent`,
        document: {
          data: { type: 'card', attributes: {}, meta: { adoptsFrom: PERSON } },
        },
      },
    ]);

    assert.deepEqual(
      failed,
      { status: 404, code: 'target-not-found', entry: 1 },
      "the refusal is the entry's own, labelled with its position",
    );
    assert.strictEqual(
      commits.length,
      0,
      'nothing is committed, so the entry ahead of the failure never lands',
    );
  },

  'a patch merges over the stored file, replacing arrays': async (assert) => {
    let { core, commits } = stub({
      stored: {
        'person-1.json': cardFile(
          { firstName: 'Original', nicknames: ['a', 'b'], age: 7 },
          PERSON,
        ),
      },
    });
    await commitBatch(
      core,
      [
        {
          op: 'update',
          href: `${REALM}person-1`,
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Patched', nicknames: ['c'] },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
      ],
      {},
    );

    let { data } = JSON.parse(commits[0].writes['person-1.json']);
    assert.strictEqual(data.attributes.firstName, 'Patched', 'the patch wins');
    assert.strictEqual(
      data.attributes.age,
      7,
      'a field the patch does not name is kept',
    );
    assert.deepEqual(
      data.attributes.nicknames,
      ['c'],
      'a patched array replaces the stored one rather than merging into it',
    );
  },

  'a patch that changes nothing stages the bytes already on disk': async (
    assert,
  ) => {
    let content = cardFile({ firstName: 'Original' }, PERSON);
    let { core, commits } = stub({ stored: { 'person-1.json': content } });
    let results = await commitBatch(
      core,
      [
        {
          op: 'update',
          href: `${REALM}person-1`,
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Original' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
      ],
      {},
    );

    assert.strictEqual(
      commits[0].writes['person-1.json'],
      content,
      'the staged bytes are the stored bytes, so the commit finds nothing to write',
    );
    assert.ok(results[0], 'the entry still reports the version the file holds');
  },

  'a patch cannot change the type a card adopts': async (assert) => {
    let { core, commits } = stub({
      stored: { 'person-1.json': cardFile({ firstName: 'Original' }, PERSON) },
    });
    let failed = await refusal(core, [
      {
        op: 'update',
        href: `${REALM}person-1`,
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Shapeshifter' },
            meta: { adoptsFrom: PET },
          },
        },
      },
    ]);

    assert.strictEqual(failed?.status, 400, 'the type change is refused');
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'realm-managed keys in a patch never reach the file': async (assert) => {
    let { core, commits } = stub({
      stored: { 'person-1.json': cardFile({ firstName: 'Original' }, PERSON) },
    });
    await commitBatch(
      core,
      [
        {
          op: 'update',
          href: `${REALM}person-1`,
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Patched' },
              meta: {
                adoptsFrom: PERSON,
                realmInfo: { name: 'Spoofed' },
                realmURL: 'http://elsewhere.example/',
                screenshots: { poster: 'http://elsewhere.example/shot.png' },
              },
            } as any,
          },
        },
      ],
      {},
    );

    let { data } = JSON.parse(commits[0].writes['person-1.json']);
    assert.strictEqual(
      data.meta.realmInfo,
      undefined,
      'a client cannot persist realm info',
    );
    assert.strictEqual(
      data.meta.screenshots,
      undefined,
      'a client cannot persist a screenshot manifest',
    );
    // `realmURL` is stripped from the patch and then stamped by the realm on
    // the way to storage; the serializer drops it again before the bytes
    // land, so what this pins is that the client's value never survives the
    // merge — not that the realm's does.
    assert.notStrictEqual(
      data.meta.realmURL,
      'http://elsewhere.example/',
      'a client cannot persist a realm URL of its choosing',
    );
  },

  'a write and a removal reach the commit together': async (assert) => {
    let { core, commits } = stub({
      stored: {
        'person-1.json': cardFile({ firstName: 'Kept' }, PERSON),
        'person-2.json': cardFile({ firstName: 'Doomed' }, PERSON),
      },
    });
    let results = await commitBatch(
      core,
      [
        {
          op: 'update',
          href: `${REALM}person-1`,
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Renamed' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
        { op: 'delete', href: `${REALM}person-2` },
      ],
      {},
    );

    assert.strictEqual(commits.length, 1, 'one commit covers both');
    assert.deepEqual(Object.keys(commits[0].writes), ['person-1.json']);
    assert.deepEqual(commits[0].deletes, ['person-2.json']);
    assert.ok(results[0], 'the write reports its identity');
    assert.strictEqual(
      results[1],
      null,
      'a removal has no state left to describe',
    );
  },

  'a removal needs something to remove': async (assert) => {
    let { core, commits } = stub();
    let failed = await refusal(core, [
      { op: 'delete', href: `${REALM}absent` },
    ]);
    assert.deepEqual(failed, {
      status: 404,
      code: 'target-not-found',
      entry: 0,
    });
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'a base version is compared to the bytes the merge is computed over': async (
    assert,
  ) => {
    let content = cardFile({ firstName: 'Original' }, PERSON);
    let onDisk = computeContentHash(content);
    let patch = (firstName: string, baseVersion: string): BatchEntry[] => [
      {
        op: 'update',
        href: `${REALM}person-1`,
        baseVersion,
        document: {
          data: {
            type: 'card',
            attributes: { firstName },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ];

    let { core } = stub({ stored: { 'person-1.json': content } });
    let [matched] = await commitBatch(core, patch('Matched', onDisk), {});
    assert.true(
      matched?.meta.baseMatched,
      'the base the caller named fingerprints the bytes on disk',
    );

    let { core: moved } = stub({ stored: { 'person-1.json': content } });
    let [result] = await commitBatch(moved, patch('Moved', 'stale'), {});
    assert.false(
      result?.meta.baseMatched,
      'the bytes have moved past the base the caller named',
    );
  },

  'an unconditional write reports no base match': async (assert) => {
    let { core } = stub({
      stored: { 'person-1.json': cardFile({ firstName: 'Original' }, PERSON) },
    });
    let [result] = await commitBatch(
      core,
      [
        {
          op: 'update',
          href: `${REALM}person-1`,
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Whatever' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
      ],
      {},
    );
    assert.strictEqual(result?.meta.baseMatched, undefined);
  },

  'a base version belongs only to an update': async (assert) => {
    let { core, commits } = stub({
      stored: { 'person-1.json': cardFile({ firstName: 'Original' }, PERSON) },
    });
    let failed = await refusal(core, [
      { op: 'delete', href: `${REALM}person-1`, baseVersion: 'v1' },
    ]);
    assert.strictEqual(failed?.status, 400);
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'a local id names one card': async (assert) => {
    let { core, commits } = stub();
    let entry = (firstName: string): BatchEntry => ({
      op: 'create',
      lid: 'twice',
      document: {
        data: {
          type: 'card',
          attributes: { firstName },
          meta: { adoptsFrom: PERSON },
        },
      },
    });
    let failed = await refusal(core, [entry('One'), entry('Two')]);
    assert.strictEqual(failed?.status, 400, 'a duplicate local id is refused');
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'a link to a local id nothing creates is refused': async (assert) => {
    let { core, commits } = stub();
    let failed = await refusal(core, [
      {
        op: 'create',
        lid: 'lonely',
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Lonely' },
            relationships: {
              friend: { data: { type: 'card', lid: 'nobody' } },
            },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ]);
    assert.deepEqual(failed, { status: 400, code: 'invalid-params', entry: 0 });
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'two entries changing one card are refused rather than ordered': async (
    assert,
  ) => {
    let { core, commits } = stub({
      stored: { 'person-1.json': cardFile({ firstName: 'Original' }, PERSON) },
    });
    let entry = (attributes: Record<string, unknown>): BatchEntry => ({
      op: 'update',
      href: `${REALM}person-1`,
      document: {
        data: { type: 'card', attributes, meta: { adoptsFrom: PERSON } },
      },
    });
    let failed = await refusal(core, [
      entry({ firstName: 'Left' }),
      entry({ age: 9 }),
    ]);
    assert.strictEqual(failed?.code, 'invalid-params');
    assert.strictEqual(
      failed?.entry,
      1,
      'the second claim on the file is the refusal',
    );
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'a target outside the realm is not the batch to commit it': async (
    assert,
  ) => {
    let { core, commits } = stub();
    let failed = await refusal(core, [
      {
        op: 'update',
        href: 'http://elsewhere.example/other/person-1',
        document: {
          data: { type: 'card', attributes: {}, meta: { adoptsFrom: PERSON } },
        },
      },
    ]);
    assert.deepEqual(failed, {
      status: 404,
      code: 'target-not-found',
      entry: 0,
    });
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'a create naming another realm is refused': async (assert) => {
    let { core, commits } = stub();
    let failed = await refusal(core, [
      {
        op: 'create',
        lid: 'foreign',
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Foreign' },
            meta: {
              adoptsFrom: PERSON,
              realmURL: 'http://elsewhere.example/' as RealmIdentifier,
            },
          },
        },
      },
    ]);
    assert.strictEqual(failed?.status, 400);
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'a field the type refuses is the payload to fix, not the realm': async (
    assert,
  ) => {
    let { core, commits } = stub({
      serialize: () => {
        throw new Error('field validation error: firstName must be a string');
      },
    });
    let failed = await refusal(core, [
      {
        op: 'create',
        lid: 'invalid',
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 7 },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ]);
    assert.deepEqual(failed, { status: 400, code: 'invalid-params', entry: 0 });
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'a stored file that is not a card document is the realm to answer for':
    async (assert) => {
      let { core } = stub({ stored: { 'person-1.json': 'not json {' } });
      let failed = await refusal(core, [
        {
          op: 'update',
          href: `${REALM}person-1`,
          document: {
            data: {
              type: 'card',
              attributes: {},
              meta: { adoptsFrom: PERSON },
            },
          },
        },
      ]);
      assert.deepEqual(failed, {
        status: 500,
        code: 'internal-error',
        entry: 0,
      });
    },

  'every read and the commit happen inside one holding of the write lock':
    async (assert) => {
      let { core, lockDepth, readsOutsideLock } = stub({
        stored: {
          'person-1.json': cardFile({ firstName: 'Original' }, PERSON),
        },
      });
      await commitBatch(
        core,
        [
          {
            op: 'create',
            lid: 'one',
            document: {
              data: {
                type: 'card',
                attributes: { firstName: 'One' },
                meta: { adoptsFrom: PERSON },
              },
            },
          },
          {
            op: 'update',
            href: `${REALM}person-1`,
            document: {
              data: {
                type: 'card',
                attributes: { firstName: 'Two' },
                meta: { adoptsFrom: PERSON },
              },
            },
          },
        ],
        {},
      );
      assert.strictEqual(
        lockDepth(),
        1,
        'the lock is never re-entered, whatever the batch contains',
      );
      assert.strictEqual(
        readsOutsideLock(),
        0,
        'nothing the batch acts on is read before the lock is held, and the ' +
          'commit runs while it still is',
      );
    },

  'a named create stages the type and attributes its declaration names': async (
    assert,
  ) => {
    let definition: OperationDefinition = {
      base: 'create',
      deterministic: true,
      of: PERSON,
      params: {
        title: { kind: 'field', codeRef: STRING },
        buddy: { kind: 'link', codeRef: PERSON },
      },
      fill: {
        firstName: { $ref: 'params', key: 'title' } as any,
        friend: { $ref: 'params', key: 'buddy' } as any,
      },
    };
    let { core, commits } = stub({
      definitions: { Person: personDefinition() },
    });
    await commitBatch(
      core,
      [
        {
          op: 'create',
          lid: 'minted',
          definition,
          params: { title: 'Declared', buddy: `${REALM}person-1` },
        },
      ],
      {},
    );

    let { data } = JSON.parse(commits[0].writes['Person/minted.json']);
    assert.deepEqual(
      data.meta.adoptsFrom,
      PERSON,
      'the type comes from the declaration',
    );
    assert.strictEqual(
      data.attributes.firstName,
      'Declared',
      'a field-typed param becomes an attribute',
    );
    assert.strictEqual(
      data.relationships.friend.links.self,
      `${REALM}person-1`,
      'a link-typed param becomes a relationship',
    );
  },

  'a named create resolves the actor and the card it is anchored on': async (
    assert,
  ) => {
    let definition: OperationDefinition = {
      base: 'create',
      deterministic: true,
      of: PERSON,
      fill: {
        firstName: { $ref: 'instance', key: 'firstName' } as any,
        friend: { $ref: 'instance', key: 'id' } as any,
        author: { $ref: 'actor' } as any,
      },
    };
    let { core, commits } = stub({
      stored: { 'person-1.json': cardFile({ firstName: 'Anchor' }, PERSON) },
      definitions: { Person: personDefinition() },
    });
    await commitBatch(
      core,
      [
        {
          op: 'create',
          lid: 'derived',
          href: `${REALM}person-1`,
          definition,
        },
      ],
      { actor: '@tester:localhost' },
    );

    let { data } = JSON.parse(commits[0].writes['Person/derived.json']);
    assert.strictEqual(
      data.attributes.firstName,
      'Anchor',
      "a member of the anchoring card's stored document",
    );
    assert.strictEqual(
      data.relationships.friend.links.self,
      `${REALM}person-1`,
      'the anchoring card, in a field the type declares as a link',
    );
    assert.strictEqual(
      data.attributes.author,
      '@tester:localhost',
      'the actor the request was authenticated as',
    );
  },

  'a named create with no target in scope cannot read one': async (assert) => {
    let definition: OperationDefinition = {
      base: 'create',
      deterministic: true,
      of: PERSON,
      fill: { firstName: { $ref: 'instance', key: 'firstName' } as any },
    };
    let { core, commits } = stub({
      definitions: { Person: personDefinition() },
    });
    let failed = await refusal(core, [
      { op: 'create', lid: 'orphan', definition },
    ]);
    assert.deepEqual(failed, { status: 400, code: 'invalid-params', entry: 0 });
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'a named create links to a card the same batch mints': async (assert) => {
    let definition: OperationDefinition = {
      base: 'create',
      deterministic: true,
      of: PERSON,
      params: { buddy: { kind: 'link', codeRef: PERSON } },
      fill: { friend: { $ref: 'params', key: 'buddy' } as any },
    };
    let { core, commits } = stub({
      definitions: { Person: personDefinition() },
    });
    await commitBatch(
      core,
      [
        {
          op: 'create',
          lid: 'target',
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Target' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
        {
          op: 'create',
          lid: 'linker',
          definition,
          params: { buddy: { lid: 'target' } },
        },
      ],
      {},
    );

    let { data } = JSON.parse(commits[0].writes['Person/linker.json']);
    assert.strictEqual(
      data.relationships.friend.links.self,
      `${REALM}Person/target`,
      'a link param given a local id resolves to the URL that card will hold',
    );
  },

  'a local id cannot name a file outside the type it creates': async (
    assert,
  ) => {
    let { core, commits } = stub();
    let create = (lid: string): BatchEntry[] => [
      {
        op: 'create',
        lid,
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Escapee' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ];
    // Each of these resolves, through a URL, to a file the create does not
    // name: the first two walk out of the type's directory and land on the
    // realm's own config, the third spreads one card over a path nobody asked
    // for, and the last two are cut short by a query or a fragment so the
    // card's id and its file stop naming each other.
    for (let lid of ['../realm', '%2e%2e/realm', 'a/b', 'a?b', 'a#b']) {
      assert.deepEqual(
        await refusal(core, create(lid)),
        { status: 400, code: 'invalid-params', entry: 0 },
        `a local id of "${lid}" is refused`,
      );
    }
    assert.strictEqual(commits.length, 0, 'nothing is committed');

    await commitBatch(core, create('mango-1'), {});
    assert.deepEqual(
      Object.keys(commits[0].writes),
      ['Person/mango-1.json'],
      'an ordinary local id still names its own file under the type',
    );
  },

  'a create does not commit over a card already stored at its destination':
    async (assert) => {
      let { core, commits } = stub({
        stored: {
          'Person/taken.json': cardFile({ firstName: 'Incumbent' }, PERSON),
        },
      });
      let failed = await refusal(core, [
        {
          op: 'create',
          lid: 'taken',
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Usurper' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
      ]);
      assert.deepEqual(failed, {
        status: 409,
        code: 'invalid-params',
        entry: 0,
      });
      assert.strictEqual(commits.length, 0, 'nothing is committed');
    },

  'a create names its card by the local id on the resource': async (assert) => {
    let { core, commits } = stub();
    await commitBatch(
      core,
      [
        {
          op: 'create',
          document: {
            data: {
              type: 'card',
              lid: 'owner',
              attributes: { firstName: 'Hassan' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
        {
          op: 'create',
          lid: 'pet',
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Mango' },
              relationships: {
                friend: { data: { type: 'card', lid: 'owner' } },
              },
              meta: { adoptsFrom: PET },
            },
          },
        },
      ],
      {},
    );
    assert.deepEqual(
      Object.keys(commits[0].writes).sort(),
      ['Person/owner.json', 'Pet/pet.json'],
      'a local id carried on the resource names the file, as a POST body does',
    );
    let staged = JSON.parse(commits[0].writes['Pet/pet.json']);
    assert.strictEqual(
      staged.data.relationships.friend.links.self,
      `${REALM}Person/owner`,
      'and another entry can link to it',
    );
  },

  'a malformed side-load is refused rather than reaching the serializer':
    async (assert) => {
      let { core, commits } = stub({
        stored: {
          'person-1.json': cardFile({ firstName: 'Original' }, PERSON),
        },
      });
      let create = (included: unknown): BatchEntry[] => [
        {
          op: 'create',
          lid: 'primary',
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Primary' },
              meta: { adoptsFrom: PERSON },
            },
            included,
          } as never,
        },
      ];
      assert.deepEqual(
        await refusal(core, create({ lid: 'not-a-list' })),
        { status: 400, code: 'invalid-params', entry: 0 },
        "an `included` that is not a list is the caller's payload to fix",
      );
      assert.deepEqual(
        await refusal(core, create([{ lid: 'x', attributes: {} }])),
        { status: 400, code: 'invalid-params', entry: 0 },
        'and so is a side-load that is not a card resource',
      );
      assert.deepEqual(
        await refusal(core, [
          {
            op: 'update',
            href: `${REALM}person-1`,
            document: {
              data: {
                type: 'card',
                attributes: { firstName: 'Patched' },
                meta: { adoptsFrom: PERSON },
              },
              included: { lid: 'not-a-list' },
            } as never,
          },
        ]),
        { status: 400, code: 'invalid-params', entry: 0 },
        'an update holds its side-loads to the same shape',
      );
      assert.strictEqual(commits.length, 0, 'nothing is committed');
    },

  'staging leaves the document it was handed alone': async (assert) => {
    let { core } = stub();
    let sideLoaded = {
      type: 'card' as const,
      lid: 'sidecar',
      attributes: { firstName: 'Sidecar' },
      meta: { adoptsFrom: PET },
    };
    let before = JSON.stringify(sideLoaded);
    await commitBatch(
      core,
      [
        {
          op: 'create',
          lid: 'primary',
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Primary' },
              meta: { adoptsFrom: PERSON },
            },
            included: [sideLoaded],
          },
        },
      ],
      {},
    );
    assert.strictEqual(
      JSON.stringify(sideLoaded),
      before,
      'the side-loaded resource the caller owns is not rewritten in place',
    );
  },

  'a named create needs every value its declaration asks for': async (
    assert,
  ) => {
    let definition: OperationDefinition = {
      base: 'create',
      deterministic: true,
      of: PERSON,
      params: { title: { kind: 'field', codeRef: STRING } },
      fill: { firstName: { $ref: 'params', key: 'title' } as never },
    };
    let { core, commits } = stub({
      definitions: { Person: personDefinition() },
    });
    assert.deepEqual(
      await refusal(core, [{ op: 'create', lid: 'missing', definition }]),
      { status: 400, code: 'invalid-params', entry: 0 },
      'a declared param with no value is refused, not left off the card',
    );
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'a local id inside a data array is refused rather than dropped': async (
    assert,
  ) => {
    let { core, commits } = stub();
    let failed = await refusal(core, [
      {
        op: 'create',
        lid: 'target',
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Target' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
      {
        op: 'create',
        lid: 'linker',
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Linker' },
            // No per-member key to record the link on, so serialization would
            // store the collection with the edge missing.
            relationships: {
              friend: { data: [{ type: 'card', lid: 'target' }] },
            },
            meta: { adoptsFrom: PERSON },
          } as never,
        },
      },
    ]);
    assert.deepEqual(failed, { status: 400, code: 'invalid-params', entry: 1 });
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'a member written under its own key still links': async (assert) => {
    let { core, commits } = stub();
    await commitBatch(
      core,
      [
        {
          op: 'create',
          lid: 'target',
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Target' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
        {
          op: 'create',
          lid: 'linker',
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Linker' },
              relationships: {
                'friend.0': { data: { type: 'card', lid: 'target' } },
              },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
      ],
      {},
    );
    let { data } = JSON.parse(commits[0].writes['Person/linker.json']);
    assert.strictEqual(
      data.relationships['friend.0'].links.self,
      `${REALM}Person/target`,
    );
  },

  'bytes the realm will not store are refused before anything commits': async (
    assert,
  ) => {
    let { core, commits } = stub({ sizeLimit: 1000 });
    let failed = await refusal(core, [
      {
        op: 'create',
        lid: 'small',
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Small' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
      {
        op: 'create',
        lid: 'huge',
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'H'.repeat(4000) },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ]);
    assert.strictEqual(failed?.entry, 1, 'the oversized entry is named');
    assert.strictEqual(
      commits.length,
      0,
      'the entry ahead of it is not written either — the size ceiling is ' +
        'reached while the realm is still untouched',
    );
  },

  'an empty batch touches nothing at all': async (assert) => {
    let { core, commits, lockDepth, drainCount } = stub();
    assert.deepEqual(await commitBatch(core, [], {}), []);
    assert.strictEqual(commits.length, 0, 'no commit');
    assert.strictEqual(lockDepth(), 0, 'the write lock is never taken');
    assert.strictEqual(drainCount(), 0, 'indexing is not drained');
  },

  'a batch drains in-flight indexing before it serializes anything': async (
    assert,
  ) => {
    let { core, drainCount } = stub();
    await commitBatch(
      core,
      [
        {
          op: 'create',
          lid: 'one',
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'One' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
      ],
      {},
    );
    assert.strictEqual(
      drainCount(),
      1,
      'a card is serialized against a definition the realm has finished ' +
        'indexing',
    );
  },

  'an update rewrites a side-loaded card that is already stored': async (
    assert,
  ) => {
    let { core, commits } = stub({
      stored: {
        'person-1.json': cardFile({ firstName: 'Original' }, PERSON),
        'Pet/side.json': cardFile({ firstName: 'Stored' }, PET),
      },
    });
    await commitBatch(
      core,
      [
        {
          op: 'update',
          href: `${REALM}person-1`,
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Patched' },
              meta: { adoptsFrom: PERSON },
            },
            included: [
              {
                type: 'card',
                lid: 'side',
                attributes: { firstName: 'Rewritten' },
                meta: { adoptsFrom: PET },
              },
            ],
          },
        },
      ],
      {},
    );
    assert.true(
      commits[0].writes['Pet/side.json'].includes('Rewritten'),
      'a side-load names a card the caller is rewriting, as it does on a PATCH',
    );
  },

  'a template that reads the actor needs one': async (assert) => {
    let definition: OperationDefinition = {
      base: 'create',
      deterministic: true,
      of: PERSON,
      fill: { firstName: { $ref: 'actor' } as never },
    };
    let { core, commits } = stub({
      definitions: { Person: personDefinition() },
    });
    assert.deepEqual(
      await refusal(core, [{ op: 'create', lid: 'anon', definition }]),
      { status: 400, code: 'invalid-params', entry: 0 },
      'an actor-less invocation does not write an empty author',
    );
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'an update carries the patch to apply': async (assert) => {
    let { core, commits } = stub({
      stored: { 'person-1.json': cardFile({ firstName: 'Original' }, PERSON) },
    });
    assert.deepEqual(
      await refusal(core, [
        { op: 'update', href: `${REALM}person-1` } as never,
      ]),
      { status: 400, code: 'invalid-params', entry: 0 },
      'a document-less update is the payload to fix, not a crash',
    );
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'a patch merges relationship keys rather than replacing the map': async (
    assert,
  ) => {
    let stored = JSON.stringify(
      {
        data: {
          type: 'card',
          attributes: { firstName: 'Original' },
          relationships: {
            friend: { links: { self: `${REALM}a` } },
            pet: { links: { self: `${REALM}b` } },
          },
          meta: { adoptsFrom: PERSON },
        },
      },
      null,
      2,
    );
    let { core, commits } = stub({ stored: { 'person-1.json': stored } });
    await commitBatch(
      core,
      [
        {
          op: 'update',
          href: `${REALM}person-1`,
          document: {
            data: {
              type: 'card',
              relationships: { pet: { links: { self: `${REALM}c` } } },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
      ],
      {},
    );
    let { data } = JSON.parse(commits[0].writes['person-1.json']);
    assert.strictEqual(
      data.relationships.friend.links.self,
      `${REALM}a`,
      'a relationship the patch does not name is kept',
    );
    assert.strictEqual(
      data.relationships.pet.links.self,
      `${REALM}c`,
      'and one it does name is replaced',
    );
  },

  'a replaced array drops the field metadata of the members it removed': async (
    assert,
  ) => {
    let stored = JSON.stringify(
      {
        data: {
          type: 'card',
          attributes: { nicknames: ['a', 'b', 'c'] },
          meta: {
            adoptsFrom: PERSON,
            fields: {
              'nicknames.0': { adoptsFrom: PET },
              'nicknames.2': { adoptsFrom: PET },
            },
          },
        },
      },
      null,
      2,
    );
    let { core, commits } = stub({ stored: { 'person-1.json': stored } });
    await commitBatch(
      core,
      [
        {
          op: 'update',
          href: `${REALM}person-1`,
          document: {
            data: {
              type: 'card',
              attributes: { nicknames: ['z'] },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
      ],
      {},
    );
    let { data } = JSON.parse(commits[0].writes['person-1.json']);
    assert.deepEqual(data.attributes.nicknames, ['z'], 'the array is replaced');
    assert.strictEqual(
      data.meta.fields,
      undefined,
      "the removed members' per-index metadata does not survive to be " +
        're-applied when the array grows again',
    );
  },

  'a create with nothing to create is refused': async (assert) => {
    let { core, commits } = stub();
    let failed = await refusal(core, [{ op: 'create', lid: 'empty' }]);
    assert.deepEqual(failed, { status: 400, code: 'invalid-params', entry: 0 });
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },
};

export default tests;
