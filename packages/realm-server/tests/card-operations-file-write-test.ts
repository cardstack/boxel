import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  commitBatch,
  isOperationFailure,
  type BatchCore,
  type BatchEntry,
} from '@cardstack/runtime-common/card-operations';
import {
  computeContentHash,
  isSplicedSource,
  maybeRelativeReference,
} from '@cardstack/runtime-common';
import type { CodeRef } from '@cardstack/runtime-common/code-ref';

// ============================================================================
// What the coordinator stages for a change to a file's content, and what it
// refuses.
//
// The realm's collaborators are stubbed here, which is the point: what is
// under test is the decision the coordinator makes about a batch — which files
// it would write, which it would add to the end of, and whether it reaches the
// commit at all — not the realm's ability to carry the commit out. The stub
// records what it was handed and never writes anything, so a batch that must
// abandon before committing is checked by the commit simply never having been
// called, which is the property itself rather than a proxy for it. It also
// records every path the batch asked to read, which is how the one claim an
// append makes about itself — that it never reads its target — is checked.
//
// The commit's own behavior — the bytes on disk, one index job, one index
// event, the version the realm computes from what it wrote — only exists
// against a real realm, and is covered in `card-operations-commit-test.ts`.
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
  readPaths: () => string[];
}

function stub(stored: Record<string, string> = {}): Stub {
  let commits: Commit[] = [];
  let readPaths: string[] = [];

  let core: BatchCore = {
    realmURL: REALM,
    async withWriteLocks(_localPaths, fn) {
      return await fn(() => {});
    },
    async fileExists(localPath) {
      return stored[localPath] !== undefined;
    },
    async readSourceFile(localPath) {
      readPaths.push(localPath);
      let content = stored[localPath];
      return content === undefined
        ? undefined
        : { content, lastModified: 1000 };
    },
    async openSourceBytes(localPath) {
      readPaths.push(localPath);
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
    assertWriteSize() {
      // Every payload here is a line or a short document, so nothing is near a
      // ceiling. The shape `Realm.assertWriteSize` throws is exercised where
      // the ceiling is: the batch suite that stages an oversized card.
    },
    async drainIndexing() {},
    async isIgnored() {
      return false;
    },
    async commitUnlocked(batch) {
      let writes: Record<string, string> = {};
      for (let [path, content] of batch.writes ?? []) {
        writes[path] = isSplicedSource(content)
          ? '<described>'
          : String(content);
      }
      let appends: Record<string, string> = {};
      for (let [path, content] of batch.appends ?? []) {
        appends[path] = String(content);
      }
      commits.push({ writes, appends, deletes: [...(batch.deletes ?? [])] });
      return {
        // A real commit fingerprints the bytes it wrote; the stub stands in
        // with the byte length, which is enough to tell one version from
        // another. An appended file is fingerprinted from what it holds
        // afterwards, as the realm's own commit does, so an entry that added
        // to a file reports a version covering all of it.
        writes: [
          ...Object.entries(writes).map(([path, content]) => ({
            path,
            lastModified: 2000,
            created: 1000,
            contentHash: `hash-${content.length}`,
          })),
          ...Object.entries(appends).map(([path, content]) => ({
            path,
            lastModified: 2000,
            created: 1000,
            contentHash: `hash-${
              (writes[path] ?? stored[path] ?? '').length + content.length
            }`,
          })),
        ],
        generation: 9,
      };
    },
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
    async indexedCardValues() {
      // Nothing here reads indexed values: a file's content is not a document
      // the index has a view of, and the two writes under test work on bytes.
      return undefined;
    },
    async lookupDefinition() {
      return undefined;
    },
    async realmConfig() {
      // No entry in these suites reads a realm setting; an empty map is the
      // realm that configures none.
      return {};
    },
  };
  return { core, commits, readPaths: () => readPaths };
}

function cardFile(attributes: Record<string, unknown>) {
  return JSON.stringify(
    { data: { type: 'card', attributes, meta: { adoptsFrom: PERSON } } },
    null,
    2,
  );
}

// What a batch refused, as the caller sees it: the status, the code, and which
// entry produced it. A batch that commits instead answers undefined, which is
// what a test asserting a refusal fails on.
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

module(basename(import.meta.filename), function () {
  module('replacing a file', function () {
    test("a file's content is replaced at the path its url names", async function (assert) {
      let { core, commits } = stub({ 'notes.md': '# Notes\n' });
      let results = await commitBatch(
        core,
        [
          {
            op: 'update',
            href: `${REALM}notes.md`,
            content: '# Notes\n\nrewritten\n',
          },
        ],
        {},
      );
      assert.deepEqual(
        commits[0].writes,
        { 'notes.md': '# Notes\n\nrewritten\n' },
        'the content the caller sent is what the file holds, at the path the ' +
          'url names rather than at that path plus `.json`',
      );
      assert.strictEqual(results[0]?.id, `${REALM}notes.md`);
      assert.ok(results[0]?.meta.version, 'with the version the commit wrote');
    });

    test('a file replaced on top of a version the caller held reports the match', async function (assert) {
      let { core } = stub({
        'notes.md': '# Notes\n',
        'other.md': '# Other\n',
      });
      let results = await commitBatch(
        core,
        [
          {
            op: 'update',
            href: `${REALM}notes.md`,
            content: 'rewritten',
            baseVersion: computeContentHash('# Notes\n'),
          },
          {
            op: 'update',
            href: `${REALM}other.md`,
            content: 'rewritten',
            baseVersion: 'some-other-version',
          },
        ],
        {},
      );
      assert.true(
        results[0]?.meta.baseMatched,
        'a file the batch never read whole still reports the version it held',
      );
      assert.false(
        results[1]?.meta.baseMatched,
        'and reports a base that had moved on',
      );
    });

    test('an update on a card carries a patch rather than content', async function (assert) {
      let { core, commits } = stub({
        'Person/mango.json': cardFile({ firstName: 'Mango' }),
      });
      let failed = await refusal(core, [
        { op: 'update', href: `${REALM}Person/mango`, content: 'not a card' },
      ]);
      assert.deepEqual(failed, {
        status: 405,
        code: 'operation-not-allowed',
        entry: 0,
      });
      assert.strictEqual(commits.length, 0, 'nothing is committed');
    });

    test("a card's stored source is not a file an update replaces", async function (assert) {
      let { core } = stub({
        'Person/mango.json': cardFile({ firstName: 'Mango' }),
      });
      let failed = await refusal(core, [
        {
          op: 'update',
          href: `${REALM}Person/mango.json`,
          content: '{"data": {"attributes": {"firstName": "Replaced"}}}',
        },
      ]);
      assert.deepEqual(failed, {
        status: 405,
        code: 'operation-not-allowed',
        entry: 0,
      });
    });

    test('stored json that is not a card is a file like any other', async function (assert) {
      let { core, commits } = stub({ 'data.json': '{"a": 1}' });
      await commitBatch(
        core,
        [{ op: 'update', href: `${REALM}data.json`, content: '{"a": 2}' }],
        {},
      );
      assert.deepEqual(
        commits[0].writes,
        { 'data.json': '{"a": 2}' },
        'the extension does not decide it; what the bytes hold does',
      );
    });

    test('a collection document is stored json, not a card', async function (assert) {
      let { core, commits } = stub({ 'feed.json': '{"data": []}' });
      await commitBatch(
        core,
        [{ op: 'update', href: `${REALM}feed.json`, content: '{"data": [1]}' }],
        {},
      );
      assert.deepEqual(
        commits[0].writes,
        { 'feed.json': '{"data": [1]}' },
        'a JSON:API collection never becomes a card instance, so the realm ' +
          'holds it as a file and a replacement of it is a file write',
      );
    });

    test("a module's source is not a file an update replaces", async function (assert) {
      let { core } = stub({ 'person.gts': 'export class Person {}' });
      let failed = await refusal(core, [
        {
          op: 'update',
          href: `${REALM}person.gts`,
          content: 'export class {}',
        },
      ]);
      assert.deepEqual(failed, {
        status: 405,
        code: 'operation-not-allowed',
        entry: 0,
      });
    });

    test('a verbatim replacement reaches the source an envelope cannot', async function (assert) {
      let { core, commits, readPaths } = stub({
        'person.gts': 'export class Person {}',
      });
      await commitBatch(
        core,
        [
          {
            op: 'update',
            href: `${REALM}person.gts`,
            content: 'export class Person { name }',
            rawSource: true,
          },
        ],
        {},
      );
      assert.deepEqual(
        commits[0].writes,
        { 'person.gts': 'export class Person { name }' },
        "the module's bytes are replaced exactly as they were sent",
      );
      // It replaces a module, a card's stored source and a data file
      // identically, so it never has to ask which one is there — and the file
      // it would have read to find out can be a card's whole source, on the
      // route an editor saves through.
      assert.deepEqual(
        readPaths(),
        [],
        'and nothing on the batch read surface was asked for the file it ' +
          'replaced',
      );
    });

    test('a verbatim replacement reads the file only to answer for a base version', async function (assert) {
      let { core, commits, readPaths } = stub({
        'notes.md': '# Notes\n',
      });
      let results = await commitBatch(
        core,
        [
          {
            op: 'update',
            href: `${REALM}notes.md`,
            content: '# Rewritten\n',
            rawSource: true,
            baseVersion: 'not-the-stored-hash',
          },
        ],
        {},
      );
      assert.deepEqual(
        commits[0].writes,
        { 'notes.md': '# Rewritten\n' },
        'the bytes are replaced either way',
      );
      // Naming a base is the one thing that makes the stored bytes the
      // caller's business: the realm owes it an answer about whether the file
      // still held what the caller last saw.
      assert.deepEqual(
        readPaths(),
        ['notes.md'],
        'a caller that named a base version is answered from the file',
      );
      assert.false(
        results[0]?.meta.baseMatched,
        'and is told its base had moved',
      );
    });

    test('an update carries one payload or the other', async function (assert) {
      let { core, commits } = stub({ 'notes.md': '# Notes\n' });
      let failed = await refusal(core, [
        {
          op: 'update',
          href: `${REALM}notes.md`,
          content: 'rewritten',
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
        status: 400,
        code: 'invalid-params',
        entry: 0,
      });
      assert.strictEqual(commits.length, 0, 'nothing is committed');
    });

    test('a verbatim replacement carries the bytes to replace with', async function (assert) {
      let { core } = stub({ 'person.gts': 'export class Person {}' });
      let failed = await refusal(core, [
        { op: 'update', href: `${REALM}person.gts`, rawSource: true },
      ]);
      assert.deepEqual(failed, {
        status: 400,
        code: 'invalid-params',
        entry: 0,
      });
    });

    test('an update has nothing to replace when the file is not there', async function (assert) {
      let { core, commits } = stub();
      let failed = await refusal(core, [
        { op: 'update', href: `${REALM}notes.md`, content: 'rewritten' },
      ]);
      assert.deepEqual(failed, {
        status: 404,
        code: 'target-not-found',
        entry: 0,
      });
      assert.strictEqual(commits.length, 0, 'nothing is committed');
    });
  });

  module('appending a line', function () {
    test('a line is added to the end of a file nothing reads', async function (assert) {
      let { core, commits, readPaths } = stub({ 'telemetry.log': 'boot\n' });
      let results = await commitBatch(
        core,
        [
          {
            op: 'appendLine',
            href: `${REALM}telemetry.log`,
            params: { line: 'deploy 41' },
          },
        ],
        {},
      );
      assert.deepEqual(
        commits[0].appends,
        { 'telemetry.log': 'deploy 41\n' },
        'exactly the line and its terminator reach the file',
      );
      assert.deepEqual(commits[0].writes, {}, 'and nothing is rewritten');
      assert.notOk(
        readPaths().includes('telemetry.log'),
        'nothing on the batch read surface was asked for the file it ' +
          'appended to',
      );
      assert.strictEqual(results[0]?.id, `${REALM}telemetry.log`);
      assert.ok(
        results[0]?.meta.version,
        'the result reports the version the appended file now holds',
      );
    });

    test('two lines added to one file reach it once, in order', async function (assert) {
      let { core, commits } = stub({ 'telemetry.log': 'boot\n' });
      let results = await commitBatch(
        core,
        [
          {
            op: 'appendLine',
            href: `${REALM}telemetry.log`,
            params: { line: 'first' },
          },
          {
            op: 'appendLine',
            href: `${REALM}telemetry.log`,
            params: { line: 'second' },
          },
        ],
        {},
      );
      assert.strictEqual(commits.length, 1, 'one commit');
      assert.deepEqual(
        commits[0].appends,
        { 'telemetry.log': 'first\nsecond\n' },
        'both lines are joined in the order they were sent and the file is ' +
          'reached once',
      );
      assert.strictEqual(
        results[0]?.meta.version,
        results[1]?.meta.version,
        'and both entries report the version the file ended up at, since one ' +
          'commit is what produced it',
      );
    });

    test('a file replaced and then appended to keeps both changes', async function (assert) {
      let { core, commits } = stub({ 'telemetry.log': 'boot\n' });
      await commitBatch(
        core,
        [
          { op: 'update', href: `${REALM}telemetry.log`, content: 'rotated\n' },
          {
            op: 'appendLine',
            href: `${REALM}telemetry.log`,
            params: { line: 'first line after the rotation' },
          },
        ],
        {},
      );
      assert.deepEqual(commits[0].writes, { 'telemetry.log': 'rotated\n' });
      assert.deepEqual(commits[0].appends, {
        'telemetry.log': 'first line after the rotation\n',
      });
    });

    test('two entries cannot both replace one file', async function (assert) {
      let { core, commits } = stub({ 'notes.md': '# Notes\n' });
      let failed = await refusal(core, [
        { op: 'update', href: `${REALM}notes.md`, content: 'first' },
        { op: 'update', href: `${REALM}notes.md`, content: 'second' },
      ]);
      assert.deepEqual(
        failed,
        { status: 400, code: 'invalid-params', entry: 1 },
        "a replacement composes over nothing, so the first entry's content " +
          'could only be dropped while it reported success',
      );
      assert.strictEqual(commits.length, 0, 'nothing is committed');
    });

    test('a file replaced twice is refused even when the two agree', async function (assert) {
      let { core } = stub({ 'notes.md': '# Notes\n' });
      let failed = await refusal(core, [
        { op: 'update', href: `${REALM}notes.md`, content: 'same' },
        { op: 'update', href: `${REALM}notes.md`, content: 'same' },
      ]);
      assert.deepEqual(
        failed,
        { status: 400, code: 'invalid-params', entry: 1 },
        'the pair is refused on what it asks for rather than on what it ' +
          'happens to produce',
      );
    });

    test('a batch appends to a file after it writes one, not before', async function (assert) {
      let { core, commits } = stub({ 'telemetry.log': 'boot\n' });
      let failed = await refusal(core, [
        {
          op: 'appendLine',
          href: `${REALM}telemetry.log`,
          params: { line: 'about to be discarded' },
        },
        { op: 'update', href: `${REALM}telemetry.log`, content: 'rotated\n' },
      ]);
      assert.deepEqual(failed, {
        status: 400,
        code: 'invalid-params',
        entry: 1,
      });
      assert.strictEqual(commits.length, 0, 'nothing is committed');
    });

    test('binary content is not a line of anything', async function (assert) {
      let { core } = stub({ 'chart.png': 'PNG' });
      let failed = await refusal(core, [
        {
          op: 'appendLine',
          href: `${REALM}chart.png`,
          params: { line: 'deploy 41' },
        },
      ]);
      assert.deepEqual(failed, {
        status: 405,
        code: 'operation-not-allowed',
        entry: 0,
      });
    });

    test('a line after a json document leaves bytes that are not one', async function (assert) {
      let { core } = stub({ 'data.json': '{"a": 1}' });
      let failed = await refusal(core, [
        {
          op: 'appendLine',
          href: `${REALM}data.json`,
          params: { line: 'deploy 41' },
        },
      ]);
      assert.deepEqual(failed, {
        status: 405,
        code: 'operation-not-allowed',
        entry: 0,
      });
    });

    test('a card is not something a line is appended to', async function (assert) {
      let { core } = stub({
        'Person/mango.json': cardFile({ firstName: 'Mango' }),
      });
      let failed = await refusal(core, [
        {
          op: 'appendLine',
          href: `${REALM}Person/mango`,
          params: { line: 'deploy 41' },
        },
      ]);
      assert.deepEqual(failed, {
        status: 405,
        code: 'operation-not-allowed',
        entry: 0,
      });
    });

    test('a module is not something a line is appended to', async function (assert) {
      let { core } = stub({ 'person.gts': 'export class Person {}' });
      let failed = await refusal(core, [
        {
          op: 'appendLine',
          href: `${REALM}person.gts`,
          params: { line: '// a note' },
        },
      ]);
      assert.deepEqual(failed, {
        status: 405,
        code: 'operation-not-allowed',
        entry: 0,
      });
    });

    test('one call appends one line', async function (assert) {
      let { core, commits } = stub({ 'telemetry.log': 'boot\n' });
      let failed = await refusal(core, [
        {
          op: 'appendLine',
          href: `${REALM}telemetry.log`,
          params: { line: 'deploy 41\ndeploy 42' },
        },
      ]);
      assert.deepEqual(failed, {
        status: 400,
        code: 'invalid-params',
        entry: 0,
      });
      assert.strictEqual(commits.length, 0, 'nothing is committed');
    });

    test('an appended line is the line the payload carries', async function (assert) {
      let { core } = stub({ 'telemetry.log': 'boot\n' });
      assert.deepEqual(
        await refusal(core, [
          { op: 'appendLine', href: `${REALM}telemetry.log` },
        ]),
        { status: 400, code: 'invalid-params', entry: 0 },
        'a payload naming no line has nothing to append',
      );
      assert.deepEqual(
        await refusal(core, [
          {
            op: 'appendLine',
            href: `${REALM}telemetry.log`,
            params: { line: 41 as unknown as string },
          },
        ]),
        { status: 400, code: 'invalid-params', entry: 0 },
        'and a line that is not text is not a line',
      );
    });

    test('the first line creates the file it is appended to', async function (assert) {
      let { core, commits, readPaths } = stub();
      let results = await commitBatch(
        core,
        [
          {
            op: 'appendLine',
            href: `${REALM}telemetry.log`,
            params: { line: 'deploy 41' },
          },
        ],
        {},
      );
      assert.deepEqual(
        commits[0].appends,
        { 'telemetry.log': 'deploy 41\n' },
        'the line is staged for a path holding nothing, the same as for one ' +
          'already holding something',
      );
      assert.deepEqual(
        commits[0].writes,
        {},
        'and it is staged as an append rather than as a write, so the realm ' +
          'creates the file by adding to it',
      );
      assert.notOk(
        readPaths().includes('telemetry.log'),
        'the path is not read to find out whether it holds anything',
      );
      assert.ok(
        results[0]?.meta.version,
        'the result reports the version the created file holds',
      );
    });

    test('two lines reach a file the batch itself creates, in order', async function (assert) {
      let { core, commits } = stub();
      await commitBatch(
        core,
        [
          {
            op: 'appendLine',
            href: `${REALM}telemetry.log`,
            params: { line: 'first' },
          },
          {
            op: 'appendLine',
            href: `${REALM}telemetry.log`,
            params: { line: 'second' },
          },
        ],
        {},
      );
      assert.strictEqual(commits.length, 1, 'one commit');
      assert.deepEqual(
        commits[0].appends,
        { 'telemetry.log': 'first\nsecond\n' },
        'the entry that creates the file and the one that follows it are ' +
          'joined the same way two appends to a stored file are',
      );
    });

    // Creating on the first append is what makes these worth asking a second
    // time. Every one of them is refused on what the path's name says it
    // holds, and before there was a stored file behind that name; now there is
    // not, and the only thing standing between a caller and a file of their
    // choosing at a path of their choosing is the refusal itself.
    for (let { what, href } of [
      { what: 'binary content', href: `${REALM}chart.png` },
      { what: 'a json document', href: `${REALM}data.json` },
      { what: 'a module', href: `${REALM}person.gts` },
      { what: 'a card', href: `${REALM}Person/mango` },
    ]) {
      test(`${what} is not created by a line refused for it`, async function (assert) {
        let { core, commits } = stub();
        let failed = await refusal(core, [
          { op: 'appendLine', href, params: { line: 'deploy 41' } },
        ]);
        assert.deepEqual(failed, {
          status: 405,
          code: 'operation-not-allowed',
          entry: 0,
        });
        assert.strictEqual(
          commits.length,
          0,
          'nothing is committed, so the refusal leaves no file behind',
        );
      });
    }

    test('a failing sibling leaves a line with nothing to append to', async function (assert) {
      let { core, commits } = stub({ 'telemetry.log': 'boot\n' });
      let failed = await refusal(core, [
        {
          op: 'appendLine',
          href: `${REALM}telemetry.log`,
          params: { line: 'deploy 41' },
        },
        { op: 'delete', href: `${REALM}not-there` },
      ]);
      assert.deepEqual(failed, {
        status: 404,
        code: 'target-not-found',
        entry: 1,
      });
      assert.strictEqual(commits.length, 0, 'the batch commits nothing at all');
    });
  });
});
