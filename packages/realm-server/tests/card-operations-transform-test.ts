import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  commitBatch,
  isOperationFailure,
  setOperationPerfSink,
  type BatchCore,
  type BatchEntry,
  type IndexedCardValues,
  type OperationDefinition,
  type OperationPerfEvent,
} from '@cardstack/runtime-common/card-operations';
import { maybeRelativeReference } from '@cardstack/runtime-common';
import type { CodeRef, Definition } from '@cardstack/runtime-common';

// ============================================================================
// What a transform decides before anything is written.
//
// The realm's collaborators are stubbed here, which is the point: what is
// under test is the executor's half of running a program — which program it
// runs, what it accepts as a payload, which cards it will record a link to,
// what it does with a program that changes nothing, and what it reports about
// the layer that answered each read. The stub records what it was handed and
// never writes, so "nothing was committed" is checked by the commit simply
// never having been called, which is the property itself rather than a proxy
// for it.
//
// The program is planned by the real planner against the real overlay
// machinery, so what these pin is where the executor meets it. What only
// exists against a real realm — the bytes on disk, the index rows the overlays
// are built from, the operations a module's declarations lower to — is covered
// by `card-operations-commit-test.ts`.
// ============================================================================

const REALM = 'http://example.com/test/';
const REPORT = { module: `${REALM}report`, name: 'Report' } as CodeRef;
const PERSON = { module: `${REALM}person`, name: 'Person' } as CodeRef;
const STRING = { module: `${REALM}string`, name: 'default' } as CodeRef;

interface Commit {
  writes: Record<string, string>;
  deletes: string[];
}

interface StubOptions {
  // The stored source files the realm holds, by local path.
  stored?: Record<string, string>;
  // The index's view of a card, keyed by URL. A card with no entry here has no
  // clean index row, which is what makes its computed and linked values
  // unavailable rather than empty.
  indexed?: Record<string, IndexedCardValues>;
}

function stub(opts: StubOptions = {}): { core: BatchCore; commits: Commit[] } {
  let { stored = {}, indexed = {} } = opts;
  let commits: Commit[] = [];
  let definitions: Record<string, Definition> = {
    Report: reportDefinition(),
    Person: personDefinition(),
  };

  let core: BatchCore = {
    realmURL: REALM,
    async withWriteLock(fn) {
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
    async openSourceBytes() {
      // A transform plans against the whole document, so it never opens one in
      // bounded pieces; an entry that does has its own suite.
      return undefined;
    },
    assertWriteSize() {},
    async drainIndexing() {},
    async isIgnored() {
      return false;
    },
    async indexedCardValues(url: URL) {
      return indexed[url.href];
    },
    async commitUnlocked(batch) {
      let writes: Record<string, string> = {};
      for (let [path, content] of batch.writes ?? []) {
        writes[path] = String(content);
      }
      commits.push({ writes, deletes: [...(batch.deletes ?? [])] });
      return {
        // A real commit fingerprints the bytes it wrote; the stub stands in
        // with the byte length, which is enough to tell one version from
        // another.
        writes: Object.entries(writes).map(([path, content]) => ({
          path,
          lastModified: 2000,
          contentHash: `hash-${content.length}`,
        })),
        generation: 9,
      };
    },
    // The identity, so a test's expected bytes are the ones the program
    // produced rather than the ones a serializer went on to normalize.
    async serializeCard(doc) {
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
    async lookupDefinition(codeRef) {
      return 'name' in codeRef ? definitions[codeRef.name] : undefined;
    },
  };
  return { core, commits };
}

// A card with a computed field and two links — one the author marked
// `searchable` and one they did not — which is the shape a program's three
// read layers are visible through.
function report(attributes: Record<string, unknown>): string {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: { headline: 'Quarterly Review', ...attributes },
        relationships: {
          owner: { links: { self: './reviewer' } },
          auditor: { links: { self: './reviewer' } },
        },
        meta: { adoptsFrom: REPORT },
      },
    },
    null,
    2,
  );
}

function reportDefinition(): Definition {
  return {
    type: 'card-def',
    codeRef: REPORT,
    displayName: 'Report',
    fields: {
      headline: 'f0',
      status: 'f0',
      summary: 'f1',
      owner: 'f2',
      auditor: 'f3',
      reviewers: 'f4',
    },
    fieldDefs: {
      f0: {
        type: 'contains',
        isPrimitive: true,
        isComputed: false,
        fieldOrCard: STRING,
      },
      f1: {
        type: 'contains',
        isPrimitive: true,
        isComputed: true,
        fieldOrCard: STRING,
      },
      f2: {
        type: 'linksTo',
        isPrimitive: false,
        isComputed: false,
        fieldOrCard: PERSON,
        searchable: true,
      },
      f3: {
        type: 'linksTo',
        isPrimitive: false,
        isComputed: false,
        fieldOrCard: PERSON,
      },
      f4: {
        type: 'linksToMany',
        isPrimitive: false,
        isComputed: false,
        fieldOrCard: PERSON,
      },
    },
  } as Definition;
}

function personDefinition(): Definition {
  return {
    type: 'card-def',
    codeRef: PERSON,
    displayName: 'Person',
    fields: { firstName: 'f0' },
    fieldDefs: {
      f0: {
        type: 'contains',
        isPrimitive: true,
        isComputed: false,
        fieldOrCard: STRING,
      },
    },
  } as Definition;
}

// The row the index holds for that card: `pristine_doc`'s attributes carry the
// computed value the card never stores, and `search_doc` carries the fields of
// the card behind the link the author marked `searchable` — and only that one.
function indexedReport(): IndexedCardValues {
  return {
    computeds: {
      headline: 'Quarterly Review',
      status: 'open',
      summary: 'quarterly-review',
    },
    linked: {
      headline: 'Quarterly Review',
      owner: { id: `${REALM}reviewer`, firstName: 'Reviewer' },
    },
  };
}

// A lowered operation carrying one program, the shape a declaration's clauses
// lower to. Written out rather than lowered here: what a declaration lowers to
// is pinned where lowering is, and what this file is about is what the
// executor does with the result.
function transformOperation(source: string): OperationDefinition {
  return {
    base: 'transform',
    deterministic: true,
    program: { source, syntax: 'solidified' },
  };
}

function openReport(): StubOptions {
  return {
    stored: { 'report-1.json': report({ status: 'open' }) },
    indexed: { [`${REALM}report-1`]: indexedReport() },
  };
}

function attributesOf(commit: Commit, path: string) {
  return JSON.parse(commit.writes[path]).data.attributes;
}

async function refusal(
  core: BatchCore,
  entries: BatchEntry[],
): Promise<{ status: number; code: string; entry: unknown } | undefined> {
  try {
    await commitBatch(core, entries);
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

module(basename(import.meta.filename), function () {
  module('card operations transform', function () {
    test('a transform runs the program its operation carries', async function (assert) {
      let { core, commits } = stub(openReport());

      let results = await commitBatch(core, [
        {
          op: 'transform',
          name: 'escalate',
          href: `${REALM}report-1`,
          definition: transformOperation('.status="escalated";'),
        },
      ]);

      assert.strictEqual(
        attributesOf(commits[0], 'report-1.json').status,
        'escalated',
        'the program wrote the value into the staged bytes',
      );
      assert.strictEqual(
        attributesOf(commits[0], 'report-1.json').headline,
        'Quarterly Review',
        'a field the program never named is left exactly as it was',
      );
      assert.strictEqual(
        results[0]?.id,
        `${REALM}report-1`,
        'the result names the card the program ran against',
      );
    });

    test('a named operation runs no program the caller supplies', async function (assert) {
      let { core, commits } = stub(openReport());

      // The declaration carries no program, so there is nothing for the
      // operation to do — and the one on the entry is not a substitute for it.
      // Otherwise a caller could have the realm run BXL of its own choosing
      // under an author's operation name.
      let failed = await refusal(core, [
        {
          op: 'transform',
          name: 'escalate',
          href: `${REALM}report-1`,
          definition: { base: 'transform', deterministic: true },
          program: { source: '.status="escalated";', syntax: 'solidified' },
        },
      ]);
      assert.deepEqual(failed, {
        status: 400,
        code: 'invalid-params',
        entry: 0,
      });
      assert.strictEqual(commits.length, 0, 'nothing is committed');
    });

    test('a payload is checked against the declaration before any program runs', async function (assert) {
      let declared = {
        ...transformOperation('.status=params("status");'),
        params: { status: { kind: 'field' as const, codeRef: STRING } },
      };
      let entry = (params: Record<string, unknown>) => ({
        op: 'transform' as const,
        name: 'restate',
        href: `${REALM}report-1`,
        definition: declared,
        params,
      });

      let missing = stub(openReport());
      assert.deepEqual(
        await refusal(missing.core, [entry({})]),
        { status: 400, code: 'invalid-params', entry: 0 },
        'a declared param with no value is refused',
      );
      assert.strictEqual(missing.commits.length, 0, 'nothing is committed');

      let undeclared = stub(openReport());
      assert.deepEqual(
        await refusal(undeclared.core, [
          entry({ status: 'escalated', mood: 'brisk' }),
        ]),
        { status: 400, code: 'invalid-params', entry: 0 },
        'a param the declaration does not describe is refused',
      );
      assert.strictEqual(undeclared.commits.length, 0, 'nothing is committed');

      let accepted = stub(openReport());
      await commitBatch(accepted.core, [entry({ status: 'escalated' })]);
      assert.strictEqual(
        attributesOf(accepted.commits[0], 'report-1.json').status,
        'escalated',
        'the value the caller sent reaches the program',
      );
    });

    test("a failed assertion carries its author's message and commits nothing", async function (assert) {
      let { core, commits } = stub({
        stored: { 'report-1.json': report({ status: 'escalated' }) },
        indexed: { [`${REALM}report-1`]: indexedReport() },
      });

      let failed = await refusal(core, [
        {
          op: 'transform',
          name: 'openOnly',
          href: `${REALM}report-1`,
          definition: transformOperation(
            'assert(.status=="open";"Report is not open");.status="escalated";',
          ),
        },
      ]);
      assert.deepEqual(failed, {
        status: 400,
        code: 'assertion-failed',
        entry: 0,
      });
      assert.strictEqual(commits.length, 0, 'nothing is committed');
    });

    test('a link the realm holds no card for is refused', async function (assert) {
      let { core, commits } = stub(openReport());

      let failed = await refusal(core, [
        {
          op: 'transform',
          name: 'addReviewer',
          href: `${REALM}report-1`,
          definition: transformOperation(
            `append(.reviewers;card("${REALM}nobody"));`,
          ),
        },
      ]);
      assert.deepEqual(failed, {
        status: 400,
        code: 'invalid-params',
        entry: 0,
      });
      assert.strictEqual(commits.length, 0, 'nothing is committed');
    });

    test('a link to a card the same batch mints resolves', async function (assert) {
      let { core, commits } = stub(openReport());

      await commitBatch(core, [
        {
          op: 'create',
          lid: 'newcomer',
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Newcomer' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
        {
          op: 'transform',
          name: 'addReviewer',
          href: `${REALM}report-1`,
          definition: transformOperation(
            `append(.reviewers;card("${REALM}Person/newcomer"));`,
          ),
        },
      ]);

      // The identity, not the spelling: what a stored link is written as is
      // the realm serializer's, which this stub stands in for with the
      // identity function, so the edge reads here as the URL it resolves to.
      assert.strictEqual(
        JSON.parse(commits[0].writes['report-1.json']).data.relationships[
          'reviewers.0'
        ].links.self,
        `${REALM}Person/newcomer`,
        'the edge points at the card the create mints',
      );
    });

    test('a program that changes nothing stages the bytes already on disk', async function (assert) {
      let stored = report({ status: 'escalated' });
      let { core, commits } = stub({
        stored: { 'report-1.json': stored },
        indexed: { [`${REALM}report-1`]: indexedReport() },
      });

      let results = await commitBatch(core, [
        {
          op: 'transform',
          name: 'escalate',
          href: `${REALM}report-1`,
          definition: transformOperation('.status="escalated";'),
        },
      ]);

      assert.strictEqual(
        commits[0].writes['report-1.json'],
        stored,
        'the bytes staged are the bytes the file already holds',
      );
      assert.strictEqual(
        results[0]?.meta.diagnostics?.outcome,
        'unchanged',
        'and the run reports itself as one that changed nothing',
      );
    });

    test('a value no layer can supply is refused, with the reason', async function (assert) {
      // Indexed, so the computed values are there — but `auditor` is not
      // marked `searchable`, so nothing denormalized the card behind it, and
      // the program reads a field of that card.
      let { core, commits } = stub(openReport());

      let failed = await refusal(core, [
        {
          op: 'transform',
          name: 'stampAuditor',
          href: `${REALM}report-1`,
          definition: transformOperation('.status=.auditor.firstName;'),
        },
      ]);
      assert.deepEqual(failed, {
        status: 400,
        code: 'invalid-params',
        entry: 0,
      });
      assert.strictEqual(commits.length, 0, 'nothing is committed');
    });

    test('an execution reports the layer that answered each of its reads', async function (assert) {
      let events: OperationPerfEvent[] = [];
      setOperationPerfSink((event) => events.push(event));
      try {
        let { core } = stub(openReport());
        let results = await commitBatch(
          core,
          [
            {
              op: 'transform',
              name: 'stampSummary',
              href: `${REALM}report-1`,
              definition: transformOperation('.status=.summary;'),
            },
          ],
          { actor: '@tester:localhost' },
        );

        assert.strictEqual(events.length, 1, 'one line per execution');
        assert.strictEqual(events[0].operation, 'stampSummary');
        assert.strictEqual(events[0].base, 'transform');
        assert.strictEqual(events[0].target, `${REALM}report-1`);
        assert.strictEqual(events[0].actor, '@tester:localhost');
        assert.strictEqual(events[0].outcome, 'applied');
        assert.strictEqual(
          events[0].computedReads,
          1,
          'the computed value is attributed to the layer that answered it',
        );
        assert.deepEqual(events[0].missing, [], 'nothing was missing');

        let { realmURL: _realm, actor: _actor, ...summary } = events[0];
        assert.deepEqual(
          results[0]?.meta.diagnostics,
          summary,
          'and the caller is handed the same summary the channel carries',
        );
      } finally {
        setOperationPerfSink(undefined);
      }
    });
  });
});
