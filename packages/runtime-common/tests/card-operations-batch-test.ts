import {
  commitBatch,
  isOperationFailure,
  type BatchCore,
  type BatchEntry,
  type OperationDefinition,
} from '../card-operations/index.ts';
import {
  computeContentHash,
  isSplicedSource,
  maybeRelativeReference,
  streamSpliced,
  type SplicedSource,
} from '../index.ts';
import { CardError } from '../error.ts';
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
const EVENT_LOG = { module: `${REALM}event-log`, name: 'EventLog' } as CodeRef;
const LOG_EVENT = { module: `${REALM}event-log`, name: 'LogEvent' } as CodeRef;
const HOTFIX_EVENT = {
  module: `${REALM}event-log`,
  name: 'HotfixEvent',
} as CodeRef;

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
  // Local paths the realm's ignore rules exclude. Such a file is never
  // visited by indexing, so it never has an index row to remove.
  ignored?: string[];
  // The definition-cache entry a code ref resolves to, keyed by its name.
  definitions?: Record<string, Definition>;
  // What `serializeCard` does to a resource on its way to storage. The default
  // is the identity, which keeps a test's expected bytes readable; a test that
  // cares about a serializer refusal supplies its own.
  serialize?: (doc: any) => any;
}

// The bytes a described content stands for. A realm streams these to disk;
// a test reads them so it can compare them to what a load-modify-write of the
// same file would have produced.
async function materialize(
  content: SplicedSource,
  stored: Record<string, string>,
): Promise<string> {
  let source = new TextEncoder().encode(stored[content.path] ?? '');
  let chunks: Uint8Array[] = [];
  for await (let chunk of streamSpliced(content, async function* (start, end) {
    yield source.subarray(start, end);
  })) {
    chunks.push(chunk);
  }
  let bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (let chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return new TextDecoder().decode(bytes);
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
    async openSourceBytes(localPath) {
      readsOutsideLock += held > 0 ? 0 : 1;
      let content = stored[localPath];
      if (content === undefined) {
        return undefined;
      }
      let bytes = new TextEncoder().encode(content);
      return {
        size: bytes.length,
        // Yielded one byte at a time, so a scan that assumed a chunk was a
        // whole document — or a whole token — would be found out here rather
        // than only against a real file.
        async *read(start: number, end: number) {
          for (let at = start; at < end; at++) {
            yield bytes.subarray(at, at + 1);
          }
        },
      };
    },
    assertWriteSize(localPath, content) {
      let limit = opts.sizeLimit;
      let size = isSplicedSource(content) ? content.size : content.length;
      if (limit !== undefined && size > limit) {
        // The shape `Realm.assertWriteSize` throws, down to the status: a
        // stub that threw a bare `Error` here could not tell whether the
        // coordinator carries the realm's 413 through or flattens it.
        throw new CardError(`${localPath} is over the realm's size limit`, {
          status: 413,
          title: 'Payload Too Large',
        });
      }
    },
    async drainIndexing() {
      drains++;
    },
    async isIgnored(url) {
      return (opts.ignored ?? []).some((p) => url.href === `${REALM}${p}`);
    },
    async commitUnlocked(batch, options) {
      readsOutsideLock += held > 0 ? 0 : 1;
      let writes: Record<string, string> = {};
      for (let [path, content] of batch.writes ?? []) {
        writes[path] = isSplicedSource(content)
          ? await materialize(content, stored)
          : String(content);
      }
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
    // The realm's own normalization, reached through the same pure path math
    // it uses, so what a test pins is the form a link is actually stored in.
    storedLink(selfLink: string, relativeTo: URL) {
      return maybeRelativeReference(
        new URL(selfLink),
        relativeTo,
        new URL(REALM),
      );
    },
    resolvedLink(selfLink: string, relativeTo: URL) {
      return new URL(selfLink, relativeTo).href;
    },
    // No index behind this stub. Nothing here stages an entry that reads one,
    // and a row invented for a card the stub never indexed would describe
    // values no test put there.
    async indexedCardValues() {
      return undefined;
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

// A card whose `containsMany` holds composite items — the shape an append is
// for. Built by serializing the whole document, so a test's expected bytes are
// the bytes a load-modify-write of the same card produces rather than a
// separately-maintained idea of them.
function eventLog(
  events: Record<string, unknown>[],
  relationships?: Record<string, unknown>,
  metaFields?: Record<string, unknown>,
  notes?: string[],
): string {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: {
          title: 'Deploys',
          events,
          ...(notes ? { notes } : {}),
        },
        ...(relationships ? { relationships } : {}),
        meta: {
          ...(metaFields ? { fields: metaFields } : {}),
          adoptsFrom: EVENT_LOG,
        },
      },
    },
    null,
    2,
  );
}

// What loading the stored file, making the same change in memory and writing
// it back would produce — the oracle every append case is compared to. The
// description an append stages is what makes a large card affordable; it earns
// that only if the bytes are the ones the ordinary path would have written,
// down to where a container the file did not carry ends up.
function loadModifyWrite(
  stored: string,
  change: (resource: any) => void,
): string {
  let doc = JSON.parse(stored);
  change(doc.data);
  return JSON.stringify(doc, null, 2);
}

function eventLogDefinition(): Definition {
  return {
    type: 'card-def',
    codeRef: EVENT_LOG,
    displayName: 'Event Log',
    fields: { title: 'f0', events: 'f1', notes: 'f2', count: 'f3' },
    fieldDefs: {
      f0: {
        type: 'contains',
        isPrimitive: true,
        isComputed: false,
        fieldOrCard: STRING,
      },
      f1: {
        type: 'containsMany',
        isPrimitive: false,
        isComputed: false,
        fieldOrCard: LOG_EVENT,
      },
      f2: {
        type: 'containsMany',
        isPrimitive: true,
        isComputed: false,
        fieldOrCard: STRING,
      },
      f3: {
        type: 'containsMany',
        isPrimitive: true,
        isComputed: true,
        fieldOrCard: STRING,
      },
    },
  } as Definition;
}

// A subtype of the declared item type, with a field of its own. An item that
// names it is split against this rather than against the declared type.
function hotfixEventDefinition(): Definition {
  return {
    ...logEventDefinition(),
    codeRef: HOTFIX_EVENT,
    fields: { label: 'f0', author: 'f1', witnesses: 'f2', severity: 'f3' },
    fieldDefs: {
      ...logEventDefinition().fieldDefs,
      f3: {
        type: 'contains',
        isPrimitive: true,
        isComputed: false,
        fieldOrCard: STRING,
      },
    },
  } as Definition;
}

function logEventDefinition(): Definition {
  return {
    type: 'field-def',
    codeRef: LOG_EVENT,
    displayName: null,
    fields: { label: 'f0', author: 'f1', witnesses: 'f2' },
    fieldDefs: {
      f0: {
        type: 'contains',
        isPrimitive: true,
        isComputed: false,
        fieldOrCard: STRING,
      },
      f1: {
        type: 'linksTo',
        isPrimitive: false,
        isComputed: false,
        fieldOrCard: PERSON,
      },
      f2: {
        type: 'linksToMany',
        isPrimitive: false,
        isComputed: false,
        fieldOrCard: PERSON,
      },
    },
  } as Definition;
}

async function refusal(
  core: BatchCore,
  entries: BatchEntry[],
  options: Parameters<typeof commitBatch>[2] = {},
): Promise<{ status: number; code: string; entry: unknown } | undefined> {
  try {
    await commitBatch(core, entries, options);
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
    // What keeps a client's `realmURL` out of the file is the realm stamping
    // its own over it on the way to storage, not the strip in the merge —
    // the strip is defensive, and removing it would change nothing about the
    // bytes. So this pins the stamp, which is the property a reader of the
    // file depends on, and would fail if the realm stopped applying it.
    assert.strictEqual(
      data.meta.realmURL,
      REALM,
      "the realm's own URL is stored, whatever the client sent",
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

  'a removal takes a card, not any stored json': async (assert) => {
    let { core, commits } = stub({
      stored: {
        'notes.json': JSON.stringify({ note: 'not a card' }, null, 2),
        'empty.json': JSON.stringify({ data: null }, null, 2),
      },
    });
    for (let href of [`${REALM}notes`, `${REALM}empty`]) {
      let failed = await refusal(core, [{ op: 'delete', href }]);
      assert.deepEqual(
        failed,
        { status: 404, code: 'target-not-found', entry: 0 },
        `${href} holds no card, which is what DELETE answers for it too`,
      );
    }
    assert.strictEqual(commits.length, 0, 'neither file is removed');
  },

  'a realm config is a card, and a removal treats it as one': async (
    assert,
  ) => {
    // Stored the way a realm actually stores it, rather than as a bare
    // settings object: a realm's config IS a card document. So the guard
    // above does not exempt it, and this batch removes it — which is what
    // `DELETE` does with the same URL. Pinned so that reading the guard as
    // protection for the realm's own configuration fails here rather than in
    // a realm.
    let { core, commits } = stub({
      stored: {
        'realm.json': cardFile(
          { cardInfo: { name: 'Test Realm' } },
          { module: `${REALM}realm-config`, name: 'RealmConfig' },
        ),
      },
    });
    let results = await commitBatch(
      core,
      [{ op: 'delete', href: `${REALM}realm` }],
      {},
    );
    assert.deepEqual(results, [null], 'the removal reports as any does');
    assert.deepEqual(
      commits[0].deletes,
      ['realm.json'],
      'the config is removed, at parity with the endpoint',
    );
  },

  'a write into the capture subtree is refused': async (assert) => {
    let { core, commits } = stub({
      definitions: { Person: personDefinition() },
    });
    let failed = await refusal(core, [
      {
        op: 'create',
        lid: 'shot',
        directory: '_screenshot',
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Captured' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ]);
    assert.strictEqual(failed?.status, 422, 'the answer /_atomic gives');
    assert.strictEqual(failed?.entry, 0);
    assert.strictEqual(
      commits.length,
      0,
      'a file the realm would never serve back is not written',
    );
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

  'a link to a side-load in another realm says which realm holds it': async (
    assert,
  ) => {
    // The caller did send this resource, so the refusal a link to an id
    // nobody sent gets would describe a batch it did not compose — and the
    // remedy is a different one.
    let { core, commits } = stub();
    let failure:
      | { status: number; code: string; entry: unknown; detail?: string }
      | undefined;
    try {
      await commitBatch(
        core,
        [
          {
            op: 'create',
            lid: 'local',
            document: {
              data: {
                type: 'card',
                attributes: { firstName: 'Local' },
                relationships: {
                  friend: { data: { type: 'card', lid: 'abroad' } },
                },
                meta: { adoptsFrom: PERSON },
              },
              included: [
                {
                  type: 'card',
                  lid: 'abroad',
                  attributes: { firstName: 'Abroad' },
                  meta: {
                    adoptsFrom: PERSON,
                    realmURL: 'http://elsewhere.example/other/',
                  },
                } as any,
              ],
            },
          },
        ],
        {},
      );
    } catch (err: unknown) {
      if (!isOperationFailure(err)) {
        throw err;
      }
      failure = {
        status: err.error.status,
        code: err.error.code,
        entry: err.error.meta?.entry,
        detail: err.error.detail,
      };
    }
    assert.strictEqual(failure?.status, 400);
    assert.strictEqual(failure?.entry, 0);
    assert.true(
      failure?.detail?.includes('another realm') ?? false,
      'the refusal names the realm holding the card, not a missing entry',
    );
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'two entries changing one card compose, and the file is written once': async (
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
    let results = await commitBatch(
      core,
      [entry({ firstName: 'Left' }), entry({ nickname: 'Lefty' })],
      {},
    );

    assert.strictEqual(commits.length, 1, 'one commit');
    assert.deepEqual(
      Object.keys(commits[0].writes),
      ['person-1.json'],
      'the card is written once, not twice',
    );
    let { data } = JSON.parse(commits[0].writes['person-1.json']);
    assert.deepEqual(
      data.attributes,
      { firstName: 'Left', nickname: 'Lefty' },
      'the second entry merged over what the first staged, so neither ' +
        'change is discarded',
    );
    assert.strictEqual(
      results[0]!.meta.version,
      results[1]!.meta.version,
      'both entries report the version the file was committed at',
    );
  },

  'a base version names what the entry merged over, not the batch pre-state':
    async (assert) => {
      let stored = cardFile({ firstName: 'Original' }, PERSON);
      let { core } = stub({ stored: { 'person-1.json': stored } });
      let entry = (
        attributes: Record<string, unknown>,
        baseVersion: string,
      ): BatchEntry => ({
        op: 'update',
        href: `${REALM}person-1`,
        baseVersion,
        document: {
          data: { type: 'card', attributes, meta: { adoptsFrom: PERSON } },
        },
      });
      let preBatch = computeContentHash(stored);
      let results = await commitBatch(
        core,
        [
          entry({ firstName: 'Left' }, preBatch),
          entry({ nickname: 'Lefty' }, preBatch),
        ],
        {},
      );

      assert.true(
        results[0]!.meta.baseMatched,
        'the first entry did merge over the bytes the batch started from',
      );
      assert.false(
        results[1]!.meta.baseMatched,
        'the second merged over what the first staged, so the pre-batch ' +
          'version is not the base it was computed against',
      );
    },

  'a removal after a change takes the card, and the write with it': async (
    assert,
  ) => {
    let { core, commits } = stub({
      stored: { 'person-1.json': cardFile({ firstName: 'Original' }, PERSON) },
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
              attributes: { firstName: 'Doomed' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
        { op: 'delete', href: `${REALM}person-1` },
      ],
      {},
    );

    assert.deepEqual(
      Object.keys(commits[0].writes),
      [],
      'the superseded write never reaches the commit — writing bytes the ' +
        'same commit then unlinks is work with no observable result',
    );
    assert.deepEqual(commits[0].deletes, ['person-1.json']);
    assert.deepEqual(
      results,
      [null, null],
      'neither entry has state left to report',
    );
  },

  'a change after a removal has nothing to change': async (assert) => {
    let { core, commits } = stub({
      stored: { 'person-1.json': cardFile({ firstName: 'Original' }, PERSON) },
    });
    let failed = await refusal(core, [
      { op: 'delete', href: `${REALM}person-1` },
      {
        op: 'update',
        href: `${REALM}person-1`,
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Too late' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ]);
    assert.deepEqual(
      failed,
      { status: 404, code: 'target-not-found', entry: 1 },
      'the batch already removed it, which is the answer it would get for a ' +
        'card that was never there',
    );
    assert.strictEqual(commits.length, 0, 'the removal is abandoned too');
  },

  'a card the realm ignores has no removal to make': async (assert) => {
    // An ignored file is never visited, so it never gets an index row, and
    // `DELETE` — which needs one — refuses it forever. Reading the bytes off
    // disk is not the same permission: removing it here would destroy a file
    // no other caller can, and the realm would go on ignoring its absence.
    let { core, commits } = stub({
      stored: {
        'hidden/Person/secret.json': cardFile({ firstName: 'Secret' }, PERSON),
      },
      ignored: ['hidden/Person/secret.json'],
    });
    let failed = await refusal(core, [
      { op: 'delete', href: `${REALM}hidden/Person/secret` },
    ]);
    assert.deepEqual(failed, {
      status: 404,
      code: 'target-not-found',
      entry: 0,
    });
    assert.strictEqual(commits.length, 0, 'the file stays on disk');
  },

  'a side-load cannot land on a card another entry is changing': async (
    assert,
  ) => {
    // A side-loaded resource is serialized whole rather than merged, so it
    // cannot compose over an earlier entry's change the way a second patch
    // does — landing it last would drop that change silently while its entry
    // still reported success.
    let { core, commits } = stub({
      stored: {
        'Person/a.json': cardFile(
          { firstName: 'Original', keepMe: 'yes' },
          PERSON,
        ),
        'b.json': cardFile({ firstName: 'B' }, PERSON),
      },
    });
    let failed = await refusal(core, [
      {
        op: 'update',
        href: `${REALM}Person/a`,
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Patched' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
      {
        op: 'update',
        href: `${REALM}b`,
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'B' },
            meta: { adoptsFrom: PERSON },
          },
          included: [
            {
              type: 'card',
              lid: 'a',
              attributes: { firstName: 'Clobbered' },
              meta: { adoptsFrom: PERSON },
            } as any,
          ],
        },
      },
    ]);
    assert.strictEqual(failed?.code, 'invalid-params');
    assert.strictEqual(failed?.entry, 1, 'the side-load is the refusal');
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'a batch cannot both remove a card and write it': async (assert) => {
    // Un-queueing the removal so the write can land would report the removal
    // entry as a completed one, which a caller cannot tell from a real
    // removal — the two entries are asking for opposite things.
    let { core, commits } = stub({
      stored: {
        'Person/a.json': cardFile({ firstName: 'Original' }, PERSON),
        'b.json': cardFile({ firstName: 'B' }, PERSON),
      },
    });
    let failed = await refusal(core, [
      { op: 'delete', href: `${REALM}Person/a` },
      {
        op: 'update',
        href: `${REALM}b`,
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'B' },
            meta: { adoptsFrom: PERSON },
          },
          included: [
            {
              type: 'card',
              lid: 'a',
              attributes: { firstName: 'Resurrected' },
              meta: { adoptsFrom: PERSON },
            } as any,
          ],
        },
      },
    ]);
    assert.strictEqual(failed?.code, 'invalid-params');
    assert.strictEqual(failed?.entry, 1);
    assert.strictEqual(
      commits.length,
      0,
      'the removal is not quietly cancelled',
    );
  },

  'a card removed in the batch cannot be minted again at its path': async (
    assert,
  ) => {
    // Removing a card and minting one at the same path is the same pair of
    // opposite asks as any other write over a removal, so it is answered as
    // that pair rather than as an occupied destination: the stored card is on
    // its way out, and telling the caller to patch it instead would describe
    // a batch it did not send.
    let { core, commits } = stub({
      stored: {
        'Person/reuse.json': cardFile({ firstName: 'Stored' }, PERSON),
      },
    });
    let failure:
      | { status: number; code: string; entry: unknown; detail?: string }
      | undefined;
    try {
      await commitBatch(
        core,
        [
          { op: 'delete', href: `${REALM}Person/reuse` },
          {
            op: 'create',
            lid: 'reuse',
            document: {
              data: {
                type: 'card',
                attributes: { firstName: 'Reminted' },
                meta: { adoptsFrom: PERSON },
              },
            },
          },
        ],
        {},
      );
    } catch (err: unknown) {
      if (!isOperationFailure(err)) {
        throw err;
      }
      failure = {
        status: err.error.status,
        code: err.error.code,
        entry: err.error.meta?.entry,
        detail: err.error.detail,
      };
    }
    assert.strictEqual(failure?.status, 400);
    assert.strictEqual(failure?.code, 'invalid-params');
    assert.strictEqual(failure?.entry, 1);
    assert.true(
      failure?.detail?.includes('which an earlier entry removes') ?? false,
      'the refusal names the entries that conflict, not the stored card',
    );
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'a card the batch creates is not a target for a later entry': async (
    assert,
  ) => {
    let { core, commits } = stub();
    let failed = await refusal(core, [
      {
        op: 'create',
        lid: 'fresh',
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Fresh' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
      {
        op: 'update',
        href: `${REALM}Person/fresh`,
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Amended' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ]);
    assert.deepEqual(
      failed,
      { status: 404, code: 'target-not-found', entry: 1 },
      'a minted card is reached by the local id other entries link to, not ' +
        'by a URL they target',
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
      failed?.status,
      413,
      "the realm's own answer for an oversized payload, so the caller is " +
        'told to send less rather than to send again',
    );
    assert.strictEqual(failed?.code, 'payload-too-large');
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

  'a template that keys into the actor names a member that does not exist':
    async (assert) => {
      // The caller is a user id. A stored marker carrying a key asks for a
      // member of it, and answering the id anyway would write the caller
      // under a name the declaration did not mean.
      let definition: OperationDefinition = {
        base: 'create',
        deterministic: true,
        of: PERSON,
        fill: { firstName: { $ref: 'actor', key: 'id' } as never },
      };
      let { core, commits } = stub({
        definitions: { Person: personDefinition() },
      });
      assert.deepEqual(
        await refusal(core, [{ op: 'create', lid: 'anon', definition }], {
          actor: '@tester:localhost',
        }),
        { status: 400, code: 'invalid-params', entry: 0 },
        'a keyed actor read is refused even when the caller is known',
      );
      assert.strictEqual(commits.length, 0, 'nothing is committed');
    },

  'the caller cannot be written into a relationship, however it is spelled':
    async (assert) => {
      // Two routes into the same edge: the field's own type makes a link out
      // of a bare marker, and `card(…)` declares one whatever field it fills.
      // A user id names no card, so either would store an edge pointing at a
      // URL nothing is stored at.
      for (let [name, fill] of [
        ['a bare marker in a link field', { friend: { $ref: 'actor' } }],
        [
          'a marker wrapped in card()',
          { friend: { $ref: 'card', value: { $ref: 'actor' } } },
        ],
        [
          'a marker inside a link list',
          { friend: [{ $ref: 'card', value: { $ref: 'actor' } }] },
        ],
      ] as [string, Record<string, unknown>][]) {
        let definition: OperationDefinition = {
          base: 'create',
          deterministic: true,
          of: PERSON,
          fill: fill as never,
        };
        let { core, commits } = stub({
          definitions: { Person: personDefinition() },
        });
        assert.deepEqual(
          await refusal(core, [{ op: 'create', lid: 'anon', definition }], {
            actor: '@tester:localhost',
          }),
          { status: 400, code: 'invalid-params', entry: 0 },
          `refused: ${name}`,
        );
        assert.strictEqual(commits.length, 0, `nothing committed for ${name}`);
      }
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

  // ==========================================================================
  // `appendContainsMany`
  //
  // Every case below compares the committed bytes to what the same change
  // would have produced had the file been loaded, changed and written back —
  // which is the property the whole behavior rests on. The description it
  // stages is what makes a large card affordable; the bytes have to be the
  // ones the general-purpose path would have written, or the two ways of
  // changing a card would not be interchangeable.
  // ==========================================================================

  'an item is appended to the array the field is stored in': async (assert) => {
    let stored = eventLog([{ label: 'first' }]);
    let { core, commits } = stub({
      stored: { 'log-1.json': stored },
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
      },
    });
    await commitBatch(
      core,
      [
        {
          op: 'appendContainsMany',
          href: `${REALM}log-1`,
          field: 'events',
          items: [{ label: 'second' }],
        },
      ],
      {},
    );
    assert.strictEqual(
      commits[0].writes['log-1.json'],
      loadModifyWrite(stored, (resource) => {
        resource.attributes.events.push({ label: 'second' });
      }),
      'the file holds what loading it, appending and writing it back would have',
    );
  },

  'an item appended to an empty array opens it': async (assert) => {
    let stored = eventLog([]);
    let { core, commits } = stub({
      stored: { 'log-1.json': stored },
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
      },
    });
    await commitBatch(
      core,
      [
        {
          op: 'appendContainsMany',
          href: `${REALM}log-1`,
          field: 'events',
          items: [{ label: 'first' }],
        },
      ],
      {},
    );
    assert.strictEqual(
      commits[0].writes['log-1.json'],
      loadModifyWrite(stored, (resource) => {
        resource.attributes.events.push({ label: 'first' });
      }),
      'an empty array is filled rather than extended, with no stray comma',
    );
  },

  "an item's links become relationship keys under the item's index": async (
    assert,
  ) => {
    let stored = eventLog([{ label: 'first' }]);
    let { core, commits } = stub({
      stored: { 'log-1.json': stored },
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
      },
    });
    await commitBatch(
      core,
      [
        {
          op: 'appendContainsMany',
          href: `${REALM}log-1`,
          field: 'events',
          items: [
            {
              label: 'second',
              author: `${REALM}Person/mango`,
              witnesses: [`${REALM}Person/van-gogh`],
            },
          ],
        },
      ],
      {},
    );
    assert.strictEqual(
      commits[0].writes['log-1.json'],
      loadModifyWrite(stored, (resource) => {
        resource.attributes.events.push({ label: 'second' });
        // Relative, the way the realm's own serializer records a link inside
        // the writing realm — so a realm that is cloned or served under
        // another host keeps linking within itself.
        resource.relationships = {
          'events.1.author': { links: { self: './Person/mango' } },
          'events.1.witnesses.0': { links: { self: './Person/van-gogh' } },
        };
      }),
      'a link leaves the array and is recorded under the flattened key',
    );
  },

  'a link to a card the same batch creates resolves to its minted url': async (
    assert,
  ) => {
    let stored = eventLog([]);
    let { core, commits } = stub({
      stored: { 'log-1.json': stored },
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
        Person: personDefinition(),
      },
    });
    await commitBatch(
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
        {
          op: 'appendContainsMany',
          href: `${REALM}log-1`,
          field: 'events',
          items: [{ label: 'first', author: { lid: 'mango' } }],
        },
      ],
      {},
    );
    assert.strictEqual(
      commits[0].writes['log-1.json'],
      loadModifyWrite(stored, (resource) => {
        resource.attributes.events.push({ label: 'first' });
        resource.relationships = {
          'events.0.author': { links: { self: './Person/mango' } },
        };
      }),
      'the local id resolves to the card the create mints, stored the way ' +
        'every other write in the batch stores a link',
    );
  },

  'an item that is not a saved card or a local id is not a link': async (
    assert,
  ) => {
    let { core, commits } = stub({
      stored: { 'log-1.json': eventLog([]) },
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
      },
    });
    let failed = await refusal(core, [
      {
        op: 'appendContainsMany',
        href: `${REALM}log-1`,
        field: 'events',
        items: [{ label: 'first', author: 42 }],
      },
    ]);
    assert.deepEqual(failed, { status: 400, code: 'invalid-params', entry: 0 });
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'an item names its own type when that is not the declared one': async (
    assert,
  ) => {
    let stored = eventLog([{ label: 'first' }]);
    let { core, commits } = stub({
      stored: { 'log-1.json': stored },
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
        HotfixEvent: hotfixEventDefinition(),
      },
    });
    await commitBatch(
      core,
      [
        {
          op: 'appendContainsMany',
          href: `${REALM}log-1`,
          field: 'events',
          items: [
            {
              label: 'second',
              // Declared by the item's own type and not by the declared one,
              // so an append that split against the declared type would
              // refuse it.
              severity: 'high',
              meta: { adoptsFrom: HOTFIX_EVENT },
            },
          ],
        },
      ],
      {},
    );
    assert.strictEqual(
      commits[0].writes['log-1.json'],
      loadModifyWrite(stored, (resource) => {
        resource.attributes.events.push({ label: 'second', severity: 'high' });
        resource.meta.fields = { events: [{}, { adoptsFrom: HOTFIX_EVENT }] };
      }),
      'the item is split against its own type, and the sidecar reaches it — ' +
        'standing in for the item ahead of it that had no type of its own',
    );
  },

  'an item cannot name a type the realm has no definition for': async (
    assert,
  ) => {
    let { core, commits } = stub({
      stored: { 'log-1.json': eventLog([]) },
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
      },
    });
    let failed = await refusal(core, [
      {
        op: 'appendContainsMany',
        href: `${REALM}log-1`,
        field: 'events',
        items: [{ label: 'first', meta: { adoptsFrom: HOTFIX_EVENT } }],
      },
    ]);
    assert.deepEqual(failed, { status: 400, code: 'invalid-params', entry: 0 });
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'a link collection an author emptied is stored as one': async (assert) => {
    let stored = eventLog([]);
    let { core, commits } = stub({
      stored: { 'log-1.json': stored },
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
      },
    });
    await commitBatch(
      core,
      [
        {
          op: 'appendContainsMany',
          href: `${REALM}log-1`,
          field: 'events',
          items: [{ label: 'first', author: null, witnesses: [] }],
        },
      ],
      {},
    );
    assert.strictEqual(
      commits[0].writes['log-1.json'],
      loadModifyWrite(stored, (resource) => {
        resource.attributes.events.push({ label: 'first' });
        resource.relationships = {
          'events.0.author': { links: { self: null } },
          'events.0.witnesses': { links: { self: null } },
        };
      }),
      'an emptied link and an emptied collection are both recorded, so the ' +
        'item reads back as emptied rather than as never set',
    );
  },

  "an item's meta carries its type and nothing an append would drop": async (
    assert,
  ) => {
    let { core, commits } = stub({
      stored: { 'log-1.json': eventLog([]) },
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
        HotfixEvent: hotfixEventDefinition(),
      },
    });
    let failed = await refusal(core, [
      {
        op: 'appendContainsMany',
        href: `${REALM}log-1`,
        field: 'events',
        items: [
          {
            label: 'first',
            meta: {
              adoptsFrom: HOTFIX_EVENT,
              // A nested value's own type, which the sidecar entry an append
              // writes has no room for.
              fields: { detail: { adoptsFrom: HOTFIX_EVENT } },
            },
          },
        ],
      },
    ]);
    assert.deepEqual(failed, { status: 400, code: 'invalid-params', entry: 0 });
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'a sidecar that describes more items than the field holds is refused': async (
    assert,
  ) => {
    // Positional, so one longer than the array names items that are not there
    // — and an entry appended after it would land at an index no item occupies.
    let stored = eventLog([{ label: 'first' }], undefined, {
      events: [{}, {}, {}],
    });
    let { core, commits } = stub({
      stored: { 'log-1.json': stored },
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
        HotfixEvent: hotfixEventDefinition(),
      },
    });
    let failed = await refusal(core, [
      {
        op: 'appendContainsMany',
        href: `${REALM}log-1`,
        field: 'events',
        items: [{ label: 'second', meta: { adoptsFrom: HOTFIX_EVENT } }],
      },
    ]);
    assert.deepEqual(failed, { status: 500, code: 'internal-error', entry: 0 });
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'two fields are appended to in one entry': async (assert) => {
    let stored = eventLog([{ label: 'first' }], undefined, undefined, ['a']);
    let { core, commits } = stub({
      stored: { 'log-1.json': stored },
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
      },
    });
    await commitBatch(
      core,
      [
        {
          op: 'appendContainsMany',
          href: `${REALM}log-1`,
          fields: { events: [{ label: 'second' }], notes: ['b'] },
        },
      ],
      {},
    );
    assert.strictEqual(
      commits[0].writes['log-1.json'],
      loadModifyWrite(stored, (resource) => {
        resource.attributes.events.push({ label: 'second' });
        resource.attributes.notes.push('b');
      }),
      'both arrays grow, from one pass over the file',
    );
  },

  'a field that holds one value is not a field an append adds to': async (
    assert,
  ) => {
    let { core, commits } = stub({
      stored: { 'log-1.json': eventLog([]) },
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
      },
    });
    let failed = await refusal(core, [
      {
        op: 'appendContainsMany',
        href: `${REALM}log-1`,
        field: 'title',
        items: ['x'],
      },
    ]);
    assert.deepEqual(failed, { status: 400, code: 'invalid-params', entry: 0 });
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'a field the type does not have is refused': async (assert) => {
    let { core } = stub({
      stored: { 'log-1.json': eventLog([]) },
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
      },
    });
    let failed = await refusal(core, [
      {
        op: 'appendContainsMany',
        href: `${REALM}log-1`,
        field: 'nope',
        items: ['x'],
      },
    ]);
    assert.deepEqual(failed, { status: 400, code: 'invalid-params', entry: 0 });
  },

  "a member the item's type does not declare is refused rather than stored":
    async (assert) => {
      let { core } = stub({
        stored: { 'log-1.json': eventLog([]) },
        definitions: {
          EventLog: eventLogDefinition(),
          LogEvent: logEventDefinition(),
        },
      });
      let failed = await refusal(core, [
        {
          op: 'appendContainsMany',
          href: `${REALM}log-1`,
          field: 'events',
          items: [{ label: 'first', severity: 'high' }],
        },
      ]);
      assert.deepEqual(failed, {
        status: 400,
        code: 'invalid-params',
        entry: 0,
      });
    },

  'an append names the items to append': async (assert) => {
    let { core } = stub({
      stored: { 'log-1.json': eventLog([]) },
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
      },
    });
    let failed = await refusal(core, [
      {
        op: 'appendContainsMany',
        href: `${REALM}log-1`,
        field: 'events',
        items: [],
      },
    ]);
    assert.deepEqual(failed, { status: 400, code: 'invalid-params', entry: 0 });
  },

  'an append has nothing to add to when the card is not there': async (
    assert,
  ) => {
    let { core } = stub({
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
      },
    });
    let failed = await refusal(core, [
      {
        op: 'appendContainsMany',
        href: `${REALM}log-1`,
        field: 'events',
        items: [{ label: 'first' }],
      },
    ]);
    assert.deepEqual(failed, {
      status: 404,
      code: 'target-not-found',
      entry: 0,
    });
  },

  'a stored file an append cannot read is the realm to answer for': async (
    assert,
  ) => {
    let { core, commits } = stub({
      stored: { 'log-1.json': '{"data": {"attributes": {"events": [1, 2' },
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
      },
    });
    let failed = await refusal(core, [
      {
        op: 'appendContainsMany',
        href: `${REALM}log-1`,
        field: 'events',
        items: [{ label: 'first' }],
      },
    ]);
    assert.deepEqual(failed, {
      status: 500,
      code: 'internal-error',
      entry: 0,
    });
    assert.strictEqual(commits.length, 0, 'nothing is written');
  },

  'two appends to one card compose, and the file is written once': async (
    assert,
  ) => {
    let stored = eventLog([{ label: 'first' }]);
    let { core, commits } = stub({
      stored: { 'log-1.json': stored },
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
      },
    });
    await commitBatch(
      core,
      [
        {
          op: 'appendContainsMany',
          href: `${REALM}log-1`,
          field: 'events',
          items: [{ label: 'second' }],
        },
        {
          op: 'appendContainsMany',
          href: `${REALM}log-1`,
          field: 'events',
          items: [{ label: 'third', author: `${REALM}Person/mango` }],
        },
      ],
      {},
    );
    assert.strictEqual(
      Object.keys(commits[0].writes).length,
      1,
      'one file, written once',
    );
    assert.strictEqual(
      commits[0].writes['log-1.json'],
      loadModifyWrite(stored, (resource) => {
        resource.attributes.events.push(
          { label: 'second' },
          { label: 'third' },
        );
        resource.relationships = {
          'events.2.author': { links: { self: './Person/mango' } },
        };
      }),
      'the second entry appends after the first rather than instead of it, ' +
        'and indexes its links against the composed array',
    );
  },

  'a patch cannot merge over a card an append staged without reading': async (
    assert,
  ) => {
    let { core, commits } = stub({
      stored: { 'log-1.json': eventLog([]) },
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
      },
    });
    let failed = await refusal(core, [
      {
        op: 'appendContainsMany',
        href: `${REALM}log-1`,
        field: 'events',
        items: [{ label: 'first' }],
      },
      {
        op: 'update',
        href: `${REALM}log-1`,
        document: {
          data: {
            type: 'card',
            attributes: { title: 'Renamed' },
            meta: { adoptsFrom: EVENT_LOG },
          },
        },
      },
    ]);
    assert.deepEqual(failed, { status: 400, code: 'invalid-params', entry: 1 });
    assert.strictEqual(commits.length, 0, 'nothing is committed');
  },

  'an append composes over a patch staged earlier in the batch': async (
    assert,
  ) => {
    let { core, commits } = stub({
      stored: { 'log-1.json': eventLog([]) },
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
      },
      serialize: (doc: any) => doc,
    });
    await commitBatch(
      core,
      [
        {
          op: 'update',
          href: `${REALM}log-1`,
          document: {
            data: {
              type: 'card',
              attributes: { title: 'Renamed' },
              meta: { adoptsFrom: EVENT_LOG },
            },
          },
        },
        {
          op: 'appendContainsMany',
          href: `${REALM}log-1`,
          field: 'events',
          items: [{ label: 'first' }],
        },
      ],
      {},
    );
    let { data } = JSON.parse(commits[0].writes['log-1.json']);
    assert.strictEqual(
      data.attributes.title,
      'Renamed',
      "the patch's change survives",
    );
    assert.deepEqual(
      data.attributes.events,
      [{ label: 'first' }],
      'and the append lands on top of it',
    );
  },

  'an append has no base version to be computed on top of': async (assert) => {
    let { core } = stub({
      stored: { 'log-1.json': eventLog([]) },
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
      },
    });
    let failed = await refusal(core, [
      {
        op: 'appendContainsMany',
        href: `${REALM}log-1`,
        field: 'events',
        items: [{ label: 'first' }],
        baseVersion: 'abc',
      },
    ]);
    assert.deepEqual(failed, { status: 400, code: 'invalid-params', entry: 0 });
  },

  'a failing sibling leaves an append with nothing committed': async (
    assert,
  ) => {
    let { core, commits } = stub({
      stored: { 'log-1.json': eventLog([]) },
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
      },
    });
    let failed = await refusal(core, [
      {
        op: 'appendContainsMany',
        href: `${REALM}log-1`,
        field: 'events',
        items: [{ label: 'first' }],
      },
      { op: 'delete', href: `${REALM}not-there` },
    ]);
    assert.deepEqual(failed, {
      status: 404,
      code: 'target-not-found',
      entry: 1,
    });
    assert.strictEqual(commits.length, 0, 'the append does not land either');
  },

  'an append reports the version the commit wrote': async (assert) => {
    let { core } = stub({
      stored: { 'log-1.json': eventLog([]) },
      definitions: {
        EventLog: eventLogDefinition(),
        LogEvent: logEventDefinition(),
      },
    });
    let results = await commitBatch(
      core,
      [
        {
          op: 'appendContainsMany',
          href: `${REALM}log-1`,
          field: 'events',
          items: [{ label: 'first' }],
        },
      ],
      {},
    );
    assert.strictEqual(
      results[0]?.id,
      `${REALM}log-1`,
      'the target is reported',
    );
    assert.ok(
      results[0]?.meta.version,
      'with the version the file holds once the commit lands',
    );
    assert.strictEqual(
      results[0]?.meta.baseMatched,
      undefined,
      'and no base match, since an append names no base',
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
