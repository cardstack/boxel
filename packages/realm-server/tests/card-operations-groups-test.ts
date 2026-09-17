import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  commitBatch,
  invocationsIn,
  isOperationFailure,
  parseOperationsEnvelope,
  resultsTree,
  stagedTree,
  type BatchCore,
  type BatchEntry,
  type BatchNode,
  type EntryPosition,
  type EnvelopeResult,
  type OperationError,
} from '@cardstack/runtime-common/card-operations';
import { isSplicedSource } from '@cardstack/runtime-common';
import type { CodeRef } from '@cardstack/runtime-common/code-ref';

// ============================================================================
// How a batch's groups schedule its staging.
//
// A batch is a tree: the top level is a serial run, and an entry in it may be
// a group whose members are entries in their own right. What is under test is
// what the shape of that tree does — which entries stage at the same time,
// which compose over which, and which pairs the coordinator refuses to order
// on the caller's behalf — so the realm is stubbed and nothing is written.
// Whether the commit then lands one job and one event is the realm-server
// suite's, against a real realm.
//
// Concurrency is asserted with a gate rather than with a clock wherever it
// can be: every member of a parallel group has to reach the gate before any
// of them is let through, so a schedule that ran them one at a time cannot
// pass by being fast. The one clock here is the claim that a parallel group
// costs about one member rather than all of them, which is a claim about
// time and is measured against the same batch run serially.
// ============================================================================

const REALM = 'http://example.com/test/';
const PERSON = { module: `${REALM}person`, name: 'Person' } as CodeRef;

interface Commit {
  writes: Record<string, string>;
  appends: Record<string, string>;
  deletes: string[];
}

interface Stub {
  core: BatchCore;
  commits: Commit[];
  // The files the batch asked to be serialized over, sorted. The lock set is
  // not visible in any answer, so a test that cares which writers a tree
  // excludes reads it here.
  lockedPaths: () => string[];
}

interface StubOptions {
  stored?: Record<string, string>;
  // Called as each entry serializes the card it is staging, which is the one
  // point inside staging a test can hold an entry at.
  onStage?: (path: string) => Promise<void>;
}

function personFile(firstName: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: { firstName, ...extra },
        meta: { adoptsFrom: PERSON },
      },
    },
    null,
    2,
  );
}

function stub(opts: StubOptions = {}): Stub {
  let { stored = {} } = opts;
  let commits: Commit[] = [];
  let lockedPaths: string[] = [];

  let core: BatchCore = {
    realmURL: REALM,
    async withWriteLocks(localPaths, fn) {
      lockedPaths = [...localPaths].sort();
      return await fn();
    },
    async fileExists(localPath) {
      return stored[localPath] !== undefined;
    },
    async readSourceFile(localPath) {
      let content = stored[localPath];
      return content === undefined
        ? undefined
        : { content, lastModified: 1000 };
    },
    async openSourceBytes(localPath) {
      let content = stored[localPath];
      if (content === undefined) {
        return undefined;
      }
      let bytes = new TextEncoder().encode(content);
      return {
        size: bytes.length,
        async *read(start: number, end: number) {
          yield bytes.subarray(start, end);
        },
      };
    },
    assertWriteSize() {},
    async drainIndexing() {},
    async isIgnored() {
      return false;
    },
    async commitUnlocked(batch) {
      let writes: Record<string, string> = {};
      for (let [path, content] of batch.writes ?? []) {
        writes[path] = isSplicedSource(content)
          ? `<spliced ${content.path}>`
          : String(content);
      }
      let appends: Record<string, string> = {};
      for (let [path, content] of batch.appends ?? []) {
        appends[path] = String(content);
      }
      commits.push({ writes, appends, deletes: [...(batch.deletes ?? [])] });
      return {
        writes: Object.entries(writes).map(([path, content]) => ({
          path,
          lastModified: 2000,
          created: 1000,
          contentHash: `hash-${content.length}`,
        })),
        generation: 9,
      };
    },
    async serializeCard(doc, relativeTo) {
      await opts.onStage?.(relativeTo.href);
      return doc;
    },
    codeRefKey(codeRef) {
      return 'module' in codeRef
        ? `${codeRef.module}/${codeRef.name}`
        : JSON.stringify(codeRef);
    },
    resolveModuleId(moduleId) {
      return moduleId;
    },
    storedLink(selfLink) {
      return selfLink;
    },
    resolvedLink(selfLink, relativeTo) {
      return new URL(selfLink, relativeTo).href;
    },
    async indexedCardValues() {
      return undefined;
    },
    async lookupDefinition() {
      return undefined;
    },
  };
  return { core, commits, lockedPaths: () => lockedPaths };
}

// A patch that sets one attribute on a stored card.
function setAttribute(
  card: string,
  attributes: Record<string, unknown>,
  label?: number | string,
): BatchNode {
  return {
    op: 'update',
    href: `${REALM}${card}`,
    ...(label === undefined ? {} : { label }),
    document: {
      data: { type: 'card', attributes, meta: { adoptsFrom: PERSON } },
    },
  } as BatchNode;
}

function attributesOf(commit: Commit, card: string): Record<string, unknown> {
  return JSON.parse(commit.writes[`${card}.json`]).data.attributes;
}

async function refusal(
  core: BatchCore,
  batch: BatchNode[],
): Promise<OperationError> {
  try {
    await commitBatch(core, batch);
  } catch (err: unknown) {
    if (isOperationFailure(err)) {
      return err.error;
    }
    throw err;
  }
  throw new Error('expected the batch to be refused');
}

// A gate every member of a parallel group must reach before any of them is
// let through. Reached by fewer than `count` of them, it never opens, and the
// wait gives up — which is what a serial schedule looks like from inside an
// entry.
function gate(count: number, giveUpAfterMs = 1500) {
  let arrived = 0;
  let open!: () => void;
  let opened = new Promise<void>((resolve) => (open = resolve));
  return {
    arrived: () => arrived,
    async wait() {
      if (++arrived >= count) {
        open();
      }
      let timer: ReturnType<typeof setTimeout>;
      try {
        await Promise.race([
          opened,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    `only ${arrived} of ${count} entries reached the gate`,
                  ),
                ),
              giveUpAfterMs,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer!);
      }
    },
  };
}

async function elapsed(run: () => Promise<unknown>): Promise<number> {
  let started = Date.now();
  await run();
  return Date.now() - started;
}

// A batch body carrying `operations` at the top level.
function envelope(...operations: unknown[]) {
  return { 'boxel:operations': operations };
}

function invoke(name: string, href?: string): Record<string, unknown> {
  return { op: 'invoke', 'boxel:name': name, ...(href ? { href } : {}) };
}

function group(
  op: 'parallel' | 'serial',
  ...members: unknown[]
): Record<string, unknown> {
  return { op, 'boxel:operations': members };
}

// A body nested `depth` groups deep, with one invocation at the bottom.
function nested(depth: number): Record<string, unknown> {
  let node: Record<string, unknown> = invoke('escalate', '/report');
  for (let at = 0; at < depth; at++) {
    node = group('serial', node);
  }
  return node;
}

function parseRefusal(body: unknown): OperationError {
  try {
    parseOperationsEnvelope(body, REALM);
  } catch (err: unknown) {
    if (isOperationFailure(err)) {
      return err.error;
    }
    throw err;
  }
  throw new Error('expected the envelope to be refused');
}

module(basename(import.meta.filename), function () {
  module('wire grammar', function () {
    test('a top-level entry is named by its index and a nested one by its path', async function (assert) {
      let tree = parseOperationsEnvelope(
        envelope(
          invoke('escalate', '/report-1'),
          group(
            'parallel',
            invoke('escalate', '/report-2'),
            group('serial', invoke('escalate', '/report-3')),
          ),
        ),
        REALM,
      );

      assert.deepEqual(
        invocationsIn(tree).map((entry) => entry.position),
        [
          0,
          '[1].boxel:operations[0]',
          '[1].boxel:operations[1].boxel:operations[0]',
        ],
        'the entries come back depth-first, each named the way a caller can ' +
          'point at it',
      );
    });

    test('a group holding no members is refused, naming the group', async function (assert) {
      let error = parseRefusal(
        envelope(invoke('escalate', '/report-1'), group('parallel')),
      );

      assert.strictEqual(error.status, 400, 'HTTP 400 status');
      assert.strictEqual(error.meta?.entry, 1);
      assert.true(
        error.detail.includes('no members'),
        `the detail says what is missing: ${error.detail}`,
      );
    });

    test("a group carrying an invocation's members is refused", async function (assert) {
      for (let [member, value] of [
        ['boxel:name', 'escalate'],
        ['href', '/report-1'],
        ['data', { body: 'x' }],
      ] as [string, unknown][]) {
        let error = parseRefusal(
          envelope({
            ...group('serial', invoke('escalate', '/report-1')),
            [member]: value,
          }),
        );

        assert.true(
          error.detail.includes(member),
          `"${member}" is refused, and named: ${error.detail}`,
        );
      }
    });

    test('a group carrying no member list is refused', async function (assert) {
      let error = parseRefusal(envelope({ op: 'serial' }));

      assert.true(
        error.detail.includes('boxel:operations'),
        `the detail names the member it looked for: ${error.detail}`,
      );
    });

    test('an entry naming no verb the envelope carries is refused', async function (assert) {
      let error = parseRefusal(envelope({ op: 'add', href: '/report-1' }));

      for (let verb of ['invoke', 'parallel', 'serial']) {
        assert.true(
          error.detail.includes(verb),
          `the detail names "${verb}": ${error.detail}`,
        );
      }
    });

    test('nesting is bounded, and the bound is well past anything composed by hand', async function (assert) {
      // The grammar nests to any depth; what is bounded is how deep a body
      // may drive the two recursive walks it is read and staged by.
      assert.strictEqual(
        invocationsIn(parseOperationsEnvelope(envelope(nested(32)), REALM))
          .length,
        1,
        'a body at the bound is read',
      );

      let error = parseRefusal(envelope(nested(33)));
      assert.strictEqual(error.status, 400, 'HTTP 400 status');
      assert.true(
        error.detail.includes('deep'),
        `and past it the refusal says so: ${error.detail}`,
      );
    });

    test('the results mirror the shape of the request', async function (assert) {
      let tree = parseOperationsEnvelope(
        envelope(
          invoke('read', '/report-1'),
          group(
            'parallel',
            group('serial', invoke('escalate', '/report-2')),
            invoke('escalate', '/report-3'),
          ),
        ),
        REALM,
      );
      let results = new Map<EntryPosition, EnvelopeResult>(
        invocationsIn(tree).map((entry, index) => [
          entry.position,
          { data: { id: `answer-${index}` } },
        ]),
      );

      assert.deepEqual(resultsTree(tree, results), [
        { data: { id: 'answer-0' } },
        [[{ data: { id: 'answer-1' } }], { data: { id: 'answer-2' } }],
      ]);
    });

    test('the staged tree keeps the schedule and drops the entries that only read', async function (assert) {
      let tree = parseOperationsEnvelope(
        envelope(
          group('parallel', invoke('read', '/report-1')),
          group(
            'parallel',
            invoke('read', '/report-2'),
            group('serial', invoke('escalate', '/report-3')),
          ),
        ),
        REALM,
      );
      let entries = invocationsIn(tree);
      let staged = new Map<EntryPosition, BatchEntry>(
        entries
          .filter((entry) => entry.name === 'escalate')
          .map((entry) => [
            entry.position,
            {
              op: 'transform',
              href: entry.href!,
              label: entry.position,
            } as BatchEntry,
          ]),
      );

      assert.deepEqual(stagedTree(tree, staged), [
        {
          op: 'parallel',
          members: [
            {
              op: 'serial',
              members: [
                {
                  op: 'transform',
                  href: `${REALM}report-3`,
                  label: '[1].boxel:operations[1].boxel:operations[0]',
                },
              ],
            },
          ],
        },
      ]);
    });
  });

  module('scheduling', function () {
    test('the members of a parallel group stage at the same time', async function (assert) {
      let held = gate(3);
      let { core, commits } = stub({
        stored: {
          'person-1.json': personFile('Mango'),
          'person-2.json': personFile('Van Gogh'),
          'person-3.json': personFile('Paper'),
        },
        onStage: () => held.wait(),
      });

      // None of the three can finish staging until all three have started, so
      // this only returns at all if they were in flight together.
      await commitBatch(core, [
        {
          op: 'parallel',
          members: [
            setAttribute('person-1', { nickname: 'a' }),
            setAttribute('person-2', { nickname: 'b' }),
            setAttribute('person-3', { nickname: 'c' }),
          ],
        },
      ]);

      assert.strictEqual(held.arrived(), 3, 'all three entries staged at once');
      assert.deepEqual(
        Object.keys(commits[0].writes).sort(),
        ['person-1.json', 'person-2.json', 'person-3.json'],
        'and one commit carries all three',
      );
    });

    test('the same entries in a serial group stage one at a time', async function (assert) {
      // The negative control for the gate: sent serially, the first entry
      // waits for two that have not started, so the batch cannot get past it.
      let held = gate(3, 300);
      let { core, commits } = stub({
        stored: {
          'person-1.json': personFile('Mango'),
          'person-2.json': personFile('Van Gogh'),
          'person-3.json': personFile('Paper'),
        },
        onStage: () => held.wait(),
      });

      let error = await refusal(core, [
        {
          op: 'serial',
          members: [
            setAttribute('person-1', { nickname: 'a' }),
            setAttribute('person-2', { nickname: 'b' }),
            setAttribute('person-3', { nickname: 'c' }),
          ],
        },
      ]);

      assert.strictEqual(held.arrived(), 1, 'only the first entry had started');
      assert.strictEqual(error.meta?.entry, 0, 'and it is the one that failed');
      assert.deepEqual(commits, [], 'nothing was committed');
    });

    test('a parallel group costs about one member rather than all of them', async function (assert) {
      let cards = ['person-1', 'person-2', 'person-3', 'person-4', 'person-5'];
      let stored = Object.fromEntries(
        cards.map((card) => [`${card}.json`, personFile(card)]),
      );
      let slow = async () =>
        await new Promise<void>((resolve) => setTimeout(resolve, 60));
      let members = cards.map((card) => setAttribute(card, { nickname: 'x' }));

      let serially = await elapsed(() =>
        commitBatch(stub({ stored, onStage: slow }).core, [
          { op: 'serial', members },
        ]),
      );
      let together = await elapsed(() =>
        commitBatch(stub({ stored, onStage: slow }).core, [
          { op: 'parallel', members },
        ]),
      );

      // Compared against the same batch run the other way rather than against
      // a fixed number of milliseconds, so a loaded machine slows both and
      // the claim — that the group costs one member and not five — is what is
      // being measured.
      assert.true(
        together * 2 < serially,
        `parallel ${together}ms is well under serial ${serially}ms`,
      );
    });

    test('a serial run inside a parallel group composes, and the group composes into what follows', async function (assert) {
      let { core, commits } = stub({
        stored: {
          'person-1.json': personFile('Mango'),
          'person-2.json': personFile('Van Gogh'),
        },
      });

      await commitBatch(core, [
        {
          op: 'parallel',
          members: [
            {
              op: 'serial',
              members: [
                setAttribute('person-1', { nickname: 'first' }),
                setAttribute('person-1', { title: 'second' }),
              ],
            },
            setAttribute('person-2', { nickname: 'elsewhere' }),
          ],
        },
        setAttribute('person-1', { pronouns: 'third' }),
      ]);

      assert.strictEqual(commits.length, 1, 'one commit');
      assert.deepEqual(
        attributesOf(commits[0], 'person-1'),
        {
          firstName: 'Mango',
          nickname: 'first',
          title: 'second',
          pronouns: 'third',
        },
        'the serial branch composes, and the entry after the group composes ' +
          'over what the group staged',
      );
      assert.deepEqual(
        attributesOf(commits[0], 'person-2'),
        { firstName: 'Van Gogh', nickname: 'elsewhere' },
        'the other branch landed alongside it',
      );
    });

    test('groups nest to any depth', async function (assert) {
      let { core, commits } = stub({
        stored: {
          'person-1.json': personFile('Mango'),
          'person-2.json': personFile('Van Gogh'),
          'person-3.json': personFile('Paper'),
        },
      });

      await commitBatch(core, [
        {
          op: 'parallel',
          members: [
            {
              op: 'serial',
              members: [
                {
                  op: 'parallel',
                  members: [
                    setAttribute('person-1', { nickname: 'deep' }),
                    setAttribute('person-2', { nickname: 'deep' }),
                  ],
                },
                setAttribute('person-1', { title: 'after' }),
              ],
            },
            setAttribute('person-3', { nickname: 'sibling' }),
          ],
        },
      ]);

      assert.strictEqual(commits.length, 1, 'one commit');
      assert.deepEqual(
        attributesOf(commits[0], 'person-1'),
        { firstName: 'Mango', nickname: 'deep', title: 'after' },
        'the entry after the innermost group composes over what it staged',
      );
      assert.deepEqual(
        Object.keys(commits[0].writes).sort(),
        ['person-1.json', 'person-2.json', 'person-3.json'],
        'and every branch of the tree landed',
      );
    });

    test('the lock covers every file in the tree', async function (assert) {
      let { core, lockedPaths } = stub({
        stored: {
          'person-1.json': personFile('Mango'),
          'person-2.json': personFile('Van Gogh'),
        },
      });

      await commitBatch(core, [
        {
          op: 'parallel',
          members: [
            setAttribute('person-1', { nickname: 'a' }),
            {
              op: 'serial',
              members: [setAttribute('person-2', { nickname: 'b' })],
            },
          ],
        },
      ]);

      assert.deepEqual(
        lockedPaths(),
        ['person-1', 'person-1.json', 'person-2', 'person-2.json'],
        'a nested entry is serialized against other writers the same as a ' +
          'top-level one',
      );
    });
  });

  module('conflicting targets', function () {
    test('two members of one parallel group changing a card are refused, naming both', async function (assert) {
      let { core, commits } = stub({
        stored: { 'person-1.json': personFile('Mango') },
      });

      let error = await refusal(core, [
        setAttribute('person-1', { title: 'ordered' }),
        {
          op: 'parallel',
          members: [
            setAttribute('person-1', { nickname: 'a' }),
            setAttribute('person-1', { nickname: 'b' }),
          ],
        },
      ]);

      assert.strictEqual(error.status, 400, 'HTTP 400 status');
      assert.strictEqual(error.code, 'conflicting-targets');
      assert.strictEqual(error.meta?.entry, 2, 'the later of the two');
      assert.strictEqual(error.meta?.conflictsWith, 1, 'and the earlier');
      assert.true(
        error.detail.includes('person-1.json'),
        `the detail names the file both change: ${error.detail}`,
      );
      assert.deepEqual(commits, [], 'nothing was committed');
    });

    test('two members of one parallel group appending to a file are refused', async function (assert) {
      let { core, commits } = stub({ stored: { 'deploys.log': 'boot\n' } });

      let error = await refusal(core, [
        {
          op: 'parallel',
          members: [
            {
              op: 'appendLine',
              href: `${REALM}deploys.log`,
              params: { line: 'first' },
            },
            {
              op: 'appendLine',
              href: `${REALM}deploys.log`,
              params: { line: 'second' },
            },
          ],
        },
      ]);

      assert.strictEqual(error.code, 'conflicting-targets');
      assert.deepEqual(
        [error.meta?.conflictsWith, error.meta?.entry],
        [0, 1],
        'both entries are named; two lines with no order between them are ' +
          'not something the commit may choose an order for',
      );
      assert.deepEqual(commits, [], 'nothing was committed');
    });

    test('a member removing what another member writes is refused', async function (assert) {
      let { core, commits } = stub({
        stored: { 'person-1.json': personFile('Mango') },
      });

      let error = await refusal(core, [
        {
          op: 'parallel',
          members: [
            setAttribute('person-1', { nickname: 'a' }),
            { op: 'delete', href: `${REALM}person-1` } as BatchNode,
          ],
        },
      ]);

      assert.strictEqual(error.code, 'conflicting-targets');
      assert.deepEqual(commits, [], 'nothing was committed');
    });

    test('the same two entries in serial order compose instead', async function (assert) {
      let { core, commits } = stub({
        stored: { 'person-1.json': personFile('Mango') },
      });

      await commitBatch(core, [
        {
          op: 'serial',
          members: [
            setAttribute('person-1', { nickname: 'a' }),
            setAttribute('person-1', { title: 'b' }),
          ],
        },
      ]);

      assert.strictEqual(commits.length, 1, 'one commit');
      assert.deepEqual(
        Object.keys(commits[0].writes),
        ['person-1.json'],
        'and the file is written once',
      );
      assert.deepEqual(attributesOf(commits[0], 'person-1'), {
        firstName: 'Mango',
        nickname: 'a',
        title: 'b',
      });
    });

    test('two entries in separate parallel groups are not siblings', async function (assert) {
      // The rule is about the members of one group, not about concurrency
      // anywhere in the batch: these two groups run one after the other, so
      // the second composes over what the first staged.
      let { core, commits } = stub({
        stored: { 'person-1.json': personFile('Mango') },
      });

      await commitBatch(core, [
        { op: 'parallel', members: [setAttribute('person-1', { a: 1 })] },
        { op: 'parallel', members: [setAttribute('person-1', { b: 2 })] },
      ]);

      assert.deepEqual(attributesOf(commits[0], 'person-1'), {
        firstName: 'Mango',
        a: 1,
        b: 2,
      });
    });
  });

  module('refusals', function () {
    test('a member that cannot be staged abandons the whole tree', async function (assert) {
      let { core, commits } = stub({
        stored: {
          'person-1.json': personFile('Mango'),
          'person-2.json': personFile('Van Gogh'),
        },
      });

      let error = await refusal(core, [
        {
          op: 'parallel',
          members: [
            setAttribute('person-1', { nickname: 'a' }),
            setAttribute('absent', { nickname: 'b' }),
            setAttribute('person-2', { nickname: 'c' }),
          ],
        },
      ]);

      assert.strictEqual(error.code, 'target-not-found');
      assert.strictEqual(error.meta?.entry, 1, 'the member that was wrong');
      assert.deepEqual(
        commits,
        [],
        'the members that staged successfully wrote nothing either',
      );
    });

    test('two wrong members report the earlier one, however the work finished', async function (assert) {
      // The two are wrong at deliberately different times: the first spends
      // 50ms before it fails, the second fails on a target that is not there
      // and so fails at once. Raced, the answer would be the second one's,
      // which is the entry the caller would then go and look at.
      let { core } = stub({
        stored: { 'person-1.json': personFile('Mango') },
        onStage: async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
          throw new Error('the slower entry is the one that is wrong');
        },
      });

      let error = await refusal(core, [
        {
          op: 'parallel',
          members: [
            setAttribute('person-1', { nickname: 'a' }),
            setAttribute('absent', { nickname: 'b' }),
          ],
        },
      ]);

      assert.strictEqual(
        error.meta?.entry,
        0,
        'the earliest entry in request order, not the first to finish',
      );
      assert.true(
        error.detail.includes('the slower entry is the one that is wrong'),
        `and it is that entry's own failure: ${error.detail}`,
      );
    });

    test('a refusal from inside a group is labelled with the position the caller named', async function (assert) {
      // A transport that numbers its entries by their path through the tree
      // hands that path down as the entry's label, and every position the
      // batch reports comes from there.
      let { core } = stub({
        stored: { 'person-1.json': personFile('Mango') },
      });

      let error = await refusal(core, [
        {
          op: 'parallel',
          members: [
            setAttribute('person-1', { a: 1 }, '[0].boxel:operations[0]'),
            setAttribute('person-1', { b: 2 }, '[0].boxel:operations[1]'),
          ],
        },
      ]);

      assert.strictEqual(error.meta?.entry, '[0].boxel:operations[1]');
      assert.strictEqual(error.meta?.conflictsWith, '[0].boxel:operations[0]');
      assert.true(
        error.detail.includes('[0].boxel:operations[0]'),
        `the prose names the path too: ${error.detail}`,
      );
    });
  });
});
