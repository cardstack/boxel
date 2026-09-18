import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  entryWithPayload,
  isDocumentResult,
  isHeadResult,
  isOperationFailure,
  paramsFor,
  projectedResult,
  readShape,
  runInputTransform,
  runOperation,
  runOutputTransform,
  type EnvelopeEntry,
  type OperationCore,
  type OperationDefinition,
  type OperationDocumentResult,
  type OperationError,
  type OperationHeadResult,
  type OperationResult,
} from '@cardstack/runtime-common/card-operations';
import type { CodeRef } from '@cardstack/runtime-common/code-ref';
import type { Definition } from '@cardstack/runtime-common/definitions';

// ============================================================================
// The `input` and `output` stages around an operation.
//
// What is under test is the order and the plumbing: that `input` runs over the
// payload before the `params` check reads it, that `output` runs over the
// result and replaces what the caller is served, that a program's failure is
// the author's rather than the realm's, and that a read reports whether its
// body was projected so a caller can decide what to do with its cache.
//
// Everything the core reads is stubbed, which is the point — a declaration is
// data in a definition-cache entry, so a case that would need a card module,
// a prerender and an index in a real realm is a literal here. The end-to-end
// half lives in `realm-endpoints/operations-test.ts` and in the card+json
// endpoint suites.
// ============================================================================

const REALM = 'http://example.com/test/';
const CARD = `${REALM}reports/1`;
const ACTOR = '@someone:example.com';
const PERSON: CodeRef = {
  module: `${REALM}person`,
  name: 'Person',
} as CodeRef;

// The document the stubbed index assembles, which every projection below is
// written against.
function storedDocument(url: URL) {
  return {
    data: {
      id: url.href,
      type: 'card',
      attributes: { title: 'Q3 report', salary: 120_000 },
      meta: { adoptsFrom: PERSON, lastModified: 1699 },
    },
  };
}

function stub(operations?: Definition['operations']): OperationCore {
  return {
    realmURL: REALM,
    definitionLookup: {
      async lookupDefinition(codeRef: CodeRef) {
        return {
          type: 'card-def',
          codeRef,
          displayName: 'Report',
          fields: {},
          fieldDefs: {},
          ...(operations ? { operations } : {}),
        };
      },
    },
    indexQueryEngine: {
      async cardDocument(url: URL) {
        return {
          type: 'doc',
          doc: storedDocument(url),
          generation: 7,
          indexedAt: 1700,
          deps: [],
          screenshots: null,
          queryBacked: false,
        } as any;
      },
      async instance(url: URL) {
        return {
          type: 'instance',
          instance: {
            id: url.href,
            type: 'card',
            meta: { adoptsFrom: PERSON },
          },
          generation: 7,
          indexedAt: 1700,
          lastModified: 1699,
          deps: [],
          screenshots: null,
        } as any;
      },
      async file() {
        return undefined;
      },
    },
    async readFileAsText() {
      return undefined;
    },
    async openStoredFile() {
      return undefined;
    },
    async storedFileMeta() {
      return {};
    },
    async isIgnored() {
      return false;
    },
    async fileMetaDocument() {
      return undefined;
    },
    resolveCodeRef(codeRef: CodeRef) {
      return codeRef as any;
    },
    fileDefCodeRef() {
      return PERSON;
    },
    unresolveInstanceIds() {},
  } as unknown as OperationCore;
}

function read(
  core: OperationCore,
  opts: {
    name?: string;
    params?: Record<string, unknown>;
    actor?: string;
    headersOnly?: true;
  } = {},
) {
  return runOperation(
    core,
    {
      target: { kind: 'instance', url: CARD },
      name: opts.name ?? 'read',
      actor: opts.actor ?? ACTOR,
      clientRequestId: 'test',
      ...(opts.params ? { params: opts.params } : {}),
    },
    opts.headersOnly ? { headersOnly: true } : {},
  );
}

// The two read shapes, narrowed by throwing rather than by an early return: a
// test that took the wrong branch would otherwise report the assertions it did
// make and say nothing about the one it skipped.
function documentOf(result: OperationResult): OperationDocumentResult {
  if (!isDocumentResult(result)) {
    throw new Error(
      `the read answered with no document: ${JSON.stringify(result)}`,
    );
  }
  return result;
}

function headersOf(result: OperationResult): OperationHeadResult {
  if (!isHeadResult(result)) {
    throw new Error(
      `the read answered with no headers: ${JSON.stringify(result)}`,
    );
  }
  return result;
}

async function refusal(body: () => Promise<unknown>): Promise<OperationError> {
  try {
    await body();
  } catch (err: unknown) {
    if (!isOperationFailure(err)) {
      throw err;
    }
    return err.error;
  }
  throw new Error('expected the operation to be refused, and it was not');
}

const REDACTING_READ: OperationDefinition = {
  base: 'read',
  deterministic: true,
  output: {
    syntax: 'solidified',
    source:
      '{data: {type: .data.type, id: .data.id, ' +
      'attributes: {title: .data.attributes.title}}}',
  },
};

module(basename(import.meta.filename), function () {
  module('output', function () {
    test('a projection replaces the document the caller is served', async function (assert) {
      let result = documentOf(await read(stub({ read: REDACTING_READ })));
      assert.true(result.projected, 'the result reports that it was projected');
      assert.deepEqual(
        // An author's projection is whatever the program produced, so it is
        // compared as data rather than against the document type it replaced.
        result.document as unknown,
        {
          data: {
            type: 'card',
            id: CARD,
            attributes: { title: 'Q3 report' },
          },
        },
        'the projection is what comes back, and the redacted field is gone',
      );
    });

    test('a card whose type declares nothing is served the document unchanged', async function (assert) {
      let result = documentOf(await read(stub()));
      assert.false(result.projected, 'nothing projected it');
      assert.deepEqual(
        (result.document.data as { attributes?: unknown }).attributes,
        { title: 'Q3 report', salary: 120_000 },
        'every field the index assembled is still there',
      );
    });

    test('the row the headers are computed from survives a projection', async function (assert) {
      let result = documentOf(await read(stub({ read: REDACTING_READ })));
      assert.deepEqual(
        result.headers,
        {
          type: 'card',
          indexedAt: 1700,
          lastModified: 1699,
          generation: 7,
          screenshots: null,
          deps: [],
        },
        'a projection reshapes the body and not the row behind it',
      );
    });

    test('a projection may read the caller', async function (assert) {
      let result = documentOf(
        await read(
          stub({
            read: {
              base: 'read',
              deterministic: true,
              readsActor: true,
              output: {
                syntax: 'solidified',
                source: '{data: {type: "card", id: .data.id, readBy: actor()}}',
              },
            },
          }),
        ),
      );
      assert.strictEqual(
        (result.document.data as { readBy?: string }).readBy,
        ACTOR,
        'the projection saw the invoking actor',
      );
    });

    test('a request that authenticated nobody is refused 401, not 500', async function (assert) {
      let error = await refusal(() =>
        read(
          stub({
            read: {
              base: 'read',
              deterministic: true,
              readsActor: true,
              output: {
                syntax: 'solidified',
                source: '{data: {type: "card", readBy: actor()}}',
              },
            },
          }),
          { actor: '' },
        ),
      );
      assert.strictEqual(error.status, 401, 'credentials would change this');
      assert.strictEqual(error.code, 'actor-required');
    });

    test('a program that fails is the author’s 400, and names the stage', async function (assert) {
      let error = await refusal(() =>
        read(
          stub({
            read: {
              base: 'read',
              deterministic: true,
              // `instance()` is not among the values a transform is handed, so
              // the program fails on the slot the host did not supply.
              output: {
                syntax: 'solidified',
                source: '{x: instance("title")}',
              },
            },
          }),
        ),
      );
      assert.strictEqual(error.status, 400);
      assert.strictEqual(error.code, 'invalid-params');
      assert.deepEqual(
        { operation: error.meta?.operation, stage: error.meta?.stage },
        { operation: 'read', stage: 'output' },
        'the refusal says which stage of which operation failed',
      );
    });

    test('a projection of a read that is not a document is refused', async function (assert) {
      let error = await refusal(() =>
        read(
          stub({
            read: {
              base: 'read',
              deterministic: true,
              output: {
                syntax: 'solidified',
                source: '{title: .data.attributes.title}',
              },
            },
          }),
        ),
      );
      assert.strictEqual(error.status, 400);
      assert.true(
        error.detail.includes('`data` member'),
        `the refusal says what a read's projection has to be: ${error.detail}`,
      );
    });
  });

  module('input', function () {
    const FILLED_READ: OperationDefinition = {
      base: 'read',
      deterministic: true,
      params: { view: { kind: 'field', codeRef: PERSON } },
      input: {
        syntax: 'solidified',
        source: '. + {view: (.view // "summary")}',
      },
      output: {
        syntax: 'solidified',
        source: '{data: {type: "card", id: .data.id, view: params("view")}}',
      },
    };

    test('a value the input supplies satisfies the params check', async function (assert) {
      let result = documentOf(
        await read(stub({ detail: FILLED_READ }), { name: 'detail' }),
      );
      assert.strictEqual(
        (result.document.data as { view?: string }).view,
        'summary',
        'the check ran against the payload the input produced, and the ' +
          'output saw the same one',
      );
    });

    test('the caller’s own value wins over the default', async function (assert) {
      let result = documentOf(
        await read(stub({ detail: FILLED_READ }), {
          name: 'detail',
          params: { view: 'full' },
        }),
      );
      assert.strictEqual(
        (result.document.data as { view?: string }).view,
        'full',
      );
    });

    test('the same operation without its input reports the param missing', async function (assert) {
      let { input: _input, ...withoutInput } = FILLED_READ;
      let error = await refusal(() =>
        read(stub({ detail: withoutInput as OperationDefinition }), {
          name: 'detail',
        }),
      );
      assert.strictEqual(error.code, 'invalid-params');
      assert.true(
        error.detail.includes('params("view")'),
        `the check is what the input satisfied: ${error.detail}`,
      );
    });

    test('an input that produces something other than a payload is refused', async function (assert) {
      let error = await refusal(() =>
        read(
          stub({
            detail: {
              base: 'read',
              deterministic: true,
              input: { syntax: 'solidified', source: '"summary"' },
            },
          }),
          { name: 'detail' },
        ),
      );
      assert.strictEqual(error.status, 400);
      assert.deepEqual(
        { stage: error.meta?.stage },
        { stage: 'input' },
        'the refusal names the input stage',
      );
      assert.true(
        error.detail.includes('a string'),
        `the refusal says what it produced instead: ${error.detail}`,
      );
    });
  });

  module('the headers a projected read would be served with', function () {
    test('a headers-only read projects nothing and says the body would be', async function (assert) {
      let result = headersOf(
        await read(stub({ read: REDACTING_READ }), { headersOnly: true }),
      );
      assert.true(
        result.projected,
        'a HEAD reports what the GET would answer with',
      );
      assert.strictEqual(result.indexedAt, 1700, 'the row is reported as-is');
    });

    test('an ordinary card’s headers report no projection', async function (assert) {
      let result = headersOf(await read(stub(), { headersOnly: true }));
      assert.false(
        result.projected,
        'an ordinary card is served the headers it always was',
      );
    });

    test('the projection question is answerable without assembling', async function (assert) {
      assert.strictEqual(
        await readShape(stub({ read: REDACTING_READ }), new URL(CARD)),
        'projected',
        'a type that declares an output projects',
      );
      assert.strictEqual(
        await readShape(stub(), new URL(CARD)),
        'plain',
        'a type that declares nothing does not',
      );
      assert.strictEqual(
        await readShape(
          stub({ read: { base: 'read', deterministic: true } }),
          new URL(CARD),
        ),
        'plain',
        'a declared read with no output does not either',
      );
    });

    test('a read that cannot be resolved is answered by assembling, not by a validator', async function (assert) {
      assert.strictEqual(
        await readShape(
          stub({
            read: {
              base: 'read',
              deterministic: true,
              invalid: true,
              issues: [
                {
                  code: 'invalid-program',
                  operation: 'read',
                  path: 'output',
                  message: 'the program at `output` does not parse',
                },
              ],
            },
          }),
          new URL(CARD),
        ),
        'unresolved',
        'a refusal is coming, and only the full request can report it',
      );
    });
  });

  module('the runners on their own', function () {
    const PLAIN: OperationDefinition = { base: 'read', deterministic: true };

    test('an operation with no stages is handed its values through', async function (assert) {
      let payload = { body: 'hi' };
      assert.strictEqual(
        await runInputTransform(PLAIN, payload, { name: 'read' }),
        payload,
        'the payload is the same object, not a copy of it',
      );
      let result = { data: null };
      assert.strictEqual(
        await runOutputTransform(PLAIN, result, { name: 'read' }),
        result,
      );
    });

    test('a batch entry keeps the envelope’s own members through its input', async function (assert) {
      let entry: EnvelopeEntry = {
        index: 0,
        name: 'addComment',
        href: CARD,
        data: { lid: 'draft-1', body: 'hello', meta: { x: 1 } },
        lid: 'draft-1',
      };
      let transformed = entryWithPayload(entry, { body: 'HELLO' });
      assert.deepEqual(
        transformed.data,
        { lid: 'draft-1', meta: { x: 1 }, body: 'HELLO' },
        'the payload moved and the members the envelope reads did not',
      );
      assert.deepEqual(
        paramsFor(transformed),
        { body: 'HELLO' },
        'the params the entry is staged from are the transformed ones',
      );
      assert.strictEqual(transformed.index, 0, 'the position is unchanged');
    });

    test('a batch entry’s projection has to remain a result object', async function (assert) {
      let entry: EnvelopeEntry = { index: 2, name: 'addComment', href: CARD };
      assert.deepEqual(projectedResult(entry, { ok: true }), { ok: true });
      let error = await refusal(async () => projectedResult(entry, 'done'));
      assert.strictEqual(error.status, 400);
      assert.strictEqual(
        error.meta?.entry,
        2,
        'the refusal is labelled with the entry that produced it',
      );
    });
  });
});
