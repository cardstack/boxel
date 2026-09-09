import {
  isDocumentResult,
  isHeadResult,
  isOperationFailure,
  newOperationScope,
  resolveOperation,
  runOperation,
  type OperationCore,
  type OperationError,
  type OperationTarget,
} from '../card-operations/index.ts';
import type { CodeRef } from '../code-ref.ts';
import type { Definition } from '../definitions.ts';
import type { SharedTests } from '../helpers/index.ts';

// ============================================================================
// Which behavior a name resolves to, and what a refusal says.
//
// Dispatch reads a target's type out of the index, its operations out of the
// definition cache, and decides from those two alone. Both are stubbed here,
// which is the point: what is under test is the decision, not the realm's
// ability to produce the inputs, and a stub makes the cases a real realm
// cannot easily be put into — an errored index row, a card whose source has
// landed but whose row has not — as cheap as the ordinary ones.
//
// The `read` executor rides along, since its refusals come from the same
// taxonomy and its status mapping is the one thing a caller can observe about
// a card that will not read cleanly.
// ============================================================================

const REALM = 'http://example.com/test/';
const PERSON: CodeRef = {
  module: `${REALM}person`,
  name: 'Person',
} as CodeRef;

interface StubOptions {
  // What `cardDocument` answers. `undefined` is a missing row.
  document?: 'ok' | 'missing' | { errorStatus: number };
  // What the row peek answers. `undefined` is a missing row.
  row?: 'ok' | 'missing';
  // The operations the target's type declares.
  operations?: Definition['operations'];
  // The type entry itself. `undefined` is an unreadable one.
  definitionType?: Definition['type'] | 'unresolvable';
  // The source file behind the target, when there is one on disk.
  source?: string;
  fileMeta?: boolean;
  // Whether the file target has an index row.
  fileRow?: boolean;
}

interface Stub {
  core: OperationCore;
  calls: string[];
}

function stub(opts: StubOptions = {}): Stub {
  let calls: string[] = [];
  let {
    document = 'ok',
    row = 'ok',
    operations,
    definitionType = 'card-def',
    source,
    fileMeta = true,
    fileRow = false,
  } = opts;

  let core: OperationCore = {
    realmURL: REALM,
    definitionLookup: {
      async lookupDefinition(codeRef) {
        calls.push('lookupDefinition');
        if (definitionType === 'unresolvable') {
          return undefined;
        }
        return {
          type: definitionType,
          codeRef,
          displayName: 'Person',
          fields: {},
          fieldDefs: {},
          ...(operations ? { operations } : {}),
        };
      },
    },
    indexQueryEngine: {
      async cardDocument(url) {
        calls.push('cardDocument');
        if (document === 'missing') {
          return undefined;
        }
        if (typeof document === 'object') {
          return {
            type: 'error',
            error: {
              errorDetail: {
                status: document.errorStatus,
                title: 'Boom',
                message: 'the card could not be built',
              },
              scopedCssUrls: [],
              lastKnownGoodHtml: null,
              cardTitle: null,
            },
          } as any;
        }
        return {
          type: 'doc',
          doc: {
            data: {
              id: url.href,
              type: 'card',
              attributes: { title: 'Hi' },
              meta: { adoptsFrom: PERSON },
            },
          },
          generation: 7,
          indexedAt: 1700,
          deps: [],
          screenshots: null,
        } as any;
      },
      async instance(url) {
        calls.push('instance');
        if (row === 'missing') {
          return undefined;
        }
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
          screenshots: null,
        } as any;
      },
      async file() {
        calls.push('file');
        return fileRow
          ? ({
              type: 'file',
              lastModified: 1699,
              generation: 4,
              screenshots: null,
              deps: null,
              indexedAt: 1700,
            } as any)
          : undefined;
      },
    },
    async readSource() {
      calls.push('readSource');
      return source;
    },
    async isIgnored() {
      return false;
    },
    async fileMetaDocument(localPath) {
      calls.push('fileMetaDocument');
      return fileMeta
        ? ({
            data: {
              type: 'file-meta',
              id: `${REALM}${localPath}`,
              attributes: { name: localPath, lastModified: 42 },
            },
          } as any)
        : undefined;
    },
    resolveCodeRef: (codeRef) => codeRef as any,
    unresolveInstanceIds: () => {
      calls.push('unresolveInstanceIds');
    },
  };
  return { core, calls };
}

const CARD: OperationTarget = { kind: 'instance', url: `${REALM}person-1` };
const FILE: OperationTarget = { kind: 'instance', url: `${REALM}sample.md` };

function invoke(target: OperationTarget, name: string) {
  return {
    target,
    name,
    actor: '@test-actor:localhost',
    clientRequestId: 'dispatch-test',
  };
}

// Rethrows anything that is not an operation failure, so a genuine bug reports
// itself rather than being read as the refusal under test.
async function refusalFrom(
  run: () => Promise<unknown>,
): Promise<OperationError> {
  try {
    await run();
  } catch (err) {
    if (isOperationFailure(err)) {
      return err.error;
    }
    throw err;
  }
  throw new Error('expected the operation to be refused, but it succeeded');
}

const tests = Object.freeze({
  'a base operation with no declaration resolves to its built-in behavior':
    async (assert) => {
      let { core } = stub();
      let definition = await resolveOperation(core, CARD, 'read');
      assert.strictEqual(definition.base, 'read');
      assert.true(
        definition.deterministic,
        'a built-in has no program, so it is deterministic by construction',
      );
      assert.strictEqual(
        definition.program,
        undefined,
        'and it carries no program',
      );
    },

  'a declaration wins over the built-in of the same name': async (assert) => {
    let { core } = stub({
      operations: {
        // The rebinding the design exists for: asking this card to delete
        // itself runs a transform, which is how a soft delete is spelled.
        delete: {
          base: 'transform',
          deterministic: true,
          program: { source: 'del(.x);', syntax: 'solidified' },
        },
      },
    });
    let definition = await resolveOperation(core, CARD, 'delete');
    assert.strictEqual(
      definition.base,
      'transform',
      'the name is what a caller invokes; the base is what carries it out',
    );
  },

  'a name that is neither declared nor a base operation is refused': async (
    assert,
  ) => {
    let { core } = stub();
    let error = await refusalFrom(() =>
      runOperation(core, invoke(CARD, 'addComment')),
    );
    assert.strictEqual(error.code, 'unknown-operation');
    assert.strictEqual(error.status, 404);
  },

  'a def type that does not carry the behavior refuses it': async (assert) => {
    let file = stub();
    let onFile = await refusalFrom(() =>
      runOperation(file.core, invoke(FILE, 'transform')),
    );
    assert.strictEqual(onFile.code, 'operation-not-allowed');
    assert.strictEqual(onFile.status, 405);
    assert.true(
      onFile.detail.includes('read'),
      `the refusal names what a file does carry: ${onFile.detail}`,
    );

    // A field's instances have no URL, so nothing is invocable on one — which
    // only a type target can even express.
    let field = stub({ definitionType: 'field-def' });
    let onField = await refusalFrom(() =>
      resolveOperation(
        field.core,
        { kind: 'type', codeRef: PERSON, realm: REALM },
        'create',
      ),
    );
    assert.strictEqual(onField.code, 'operation-not-allowed');
  },

  'a declaration lowering flagged invalid reports its findings': async (
    assert,
  ) => {
    let { core } = stub({
      operations: {
        addComment: {
          base: 'transform',
          deterministic: true,
          invalid: true,
          issues: [
            {
              code: 'unknown-field',
              operation: 'addComment',
              path: 'append.to',
              message: '"comments" is not a field on Person',
            },
          ],
        },
      },
    });
    let error = await refusalFrom(() =>
      runOperation(core, invoke(CARD, 'addComment')),
    );
    assert.strictEqual(
      error.code,
      'invalid-operation',
      'a declaration with findings is not the same as no declaration',
    );
    assert.true(
      error.detail.includes('"comments" is not a field on Person'),
      `the refusal carries the finding: ${error.detail}`,
    );
  },

  'a read serves the indexed document with its generation joined on': async (
    assert,
  ) => {
    let { core } = stub();
    let result = await runOperation(core, invoke(CARD, 'read'));
    assert.true(isDocumentResult(result), 'a read answers with a document');
    if (!isDocumentResult(result)) {
      return;
    }
    assert.strictEqual(result.document.data.links?.self, `${REALM}person-1`);
    assert.strictEqual(
      (result.document.data.meta as { generation?: number }).generation,
      7,
      'the index-data generation is joined at serve time',
    );
  },

  'a headers-only read shares dispatch read of the index row': async (
    assert,
  ) => {
    let { core, calls } = stub();
    let result = await runOperation(core, invoke(CARD, 'read'), {
      headersOnly: true,
    });
    assert.true(isHeadResult(result), 'it answers with the header values');
    assert.strictEqual(
      calls.filter((call) => call === 'cardDocument').length,
      0,
      'no document is assembled',
    );
    assert.strictEqual(
      calls.filter((call) => call === 'instance').length,
      1,
      'dispatch and the executor read the row once between them',
    );
  },

  'an errored index row carries its own status through': async (assert) => {
    let forbidden = await refusalFrom(() =>
      runOperation(
        stub({ document: { errorStatus: 403 } }).core,
        invoke(CARD, 'read'),
      ),
    );
    assert.strictEqual(forbidden.status, 403, 'a real HTTP status is mirrored');
    assert.strictEqual(forbidden.code, 'target-errored');

    // 404 is the one status never mirrored: an existing-but-errored card is
    // not "not found", and that code is reserved for a missing row so a 404
    // from a read is an unambiguous "this card no longer exists".
    let recorded404 = await refusalFrom(() =>
      runOperation(
        stub({ document: { errorStatus: 404 } }).core,
        invoke(CARD, 'read'),
      ),
    );
    assert.strictEqual(recorded404.status, 500);

    let nonHttp = await refusalFrom(() =>
      runOperation(
        stub({ document: { errorStatus: 0 } }).core,
        invoke(CARD, 'read'),
      ),
    );
    assert.strictEqual(nonHttp.status, 500);
  },

  'a read tells a missing card from one still being indexed': async (
    assert,
  ) => {
    let gone = await refusalFrom(() =>
      runOperation(
        stub({ document: 'missing', row: 'missing', fileMeta: false }).core,
        invoke(CARD, 'read'),
      ),
    );
    assert.strictEqual(gone.code, 'target-not-found');

    let pending = await refusalFrom(() =>
      runOperation(
        stub({
          document: 'missing',
          row: 'missing',
          fileMeta: false,
          source: JSON.stringify({
            data: {
              type: 'card',
              attributes: {},
              meta: { adoptsFrom: PERSON },
            },
          }),
        }).core,
        invoke(CARD, 'read'),
      ),
    );
    assert.strictEqual(
      pending.code,
      'target-not-indexed',
      'a `.json` on disk with no row is a write this realm has not caught up with',
    );

    // A source file that will never become an instance row is not a card in
    // waiting, whatever else it is.
    let notACard = await refusalFrom(() =>
      runOperation(
        stub({
          document: 'missing',
          row: 'missing',
          fileMeta: false,
          source: JSON.stringify({ data: [] }),
        }).core,
        invoke(CARD, 'read'),
      ),
    );
    assert.strictEqual(notACard.code, 'target-not-found');
  },

  'a target outside the realm is refused before anything is read': async (
    assert,
  ) => {
    let { core, calls } = stub();
    let error = await refusalFrom(() =>
      runOperation(
        core,
        invoke(
          { kind: 'instance', url: 'http://example.com/other/person-1' },
          'read',
        ),
      ),
    );
    assert.strictEqual(error.code, 'target-not-found');
    assert.strictEqual(
      calls.filter((call) => call === 'cardDocument').length,
      0,
      'the document is never assembled for a target this core cannot serve',
    );
  },

  'a type nobody can resolve is refused as a missing target': async (
    assert,
  ) => {
    let { core } = stub({ definitionType: 'unresolvable' });
    let error = await refusalFrom(() =>
      resolveOperation(
        core,
        { kind: 'type', codeRef: PERSON, realm: REALM },
        'create',
      ),
    );
    assert.strictEqual(error.code, 'target-not-found');
  },

  'a card whose type entry is unreadable still reads': async (assert) => {
    // The built-in `read` consults no definition, so refusing here would make
    // every card of a broken module unreadable.
    let { core } = stub({ definitionType: 'unresolvable' });
    let result = await runOperation(core, invoke(CARD, 'read'));
    assert.true(isDocumentResult(result), 'the card still reads');
  },

  'a target is canonicalized before anything is read': async (assert) => {
    // The realm root names the realm's index card, and a query string, a
    // fragment or a `.json` spelling all name the card they hang off. None of
    // them may reach the index lookup or `links.self` as written.
    for (let [spelling, expected] of [
      [`${REALM}`, `${REALM}index`],
      [`${REALM}person-1?vary=1`, `${REALM}person-1`],
      [`${REALM}person-1#section`, `${REALM}person-1`],
      [`${REALM}person-1.json`, `${REALM}person-1`],
    ] as [string, string][]) {
      let { core } = stub();
      let result = await runOperation(
        core,
        invoke({ kind: 'instance', url: spelling }, 'read'),
      );
      assert.true(isDocumentResult(result), `${spelling} reads`);
      if (isDocumentResult(result)) {
        assert.strictEqual(
          result.document.data.links?.self,
          expected,
          `${spelling} resolves to ${expected}`,
        );
      }
    }
  },

  'a declared read the executor cannot carry out is refused': async (
    assert,
  ) => {
    // Serving the plain document would be a well-formed answer to a different
    // question than the declaration asked.
    let { core } = stub({
      operations: {
        summary: {
          base: 'read',
          deterministic: true,
          output: { source: 'PROJECT(.title)', syntax: 'solidified' },
        },
      },
    });
    let error = await refusalFrom(() =>
      runOperation(core, invoke(CARD, 'summary')),
    );
    assert.strictEqual(error.status, 501);
    assert.true(
      error.detail.includes('output'),
      `the refusal names the stage: ${error.detail}`,
    );
  },

  'a payload missing a declared param is refused before any behavior runs':
    async (assert) => {
      let { core, calls } = stub({
        operations: {
          summary: {
            base: 'read',
            deterministic: true,
            params: {
              locale: { kind: 'field', codeRef: PERSON },
            },
          },
        },
      });
      let error = await refusalFrom(() =>
        runOperation(core, invoke(CARD, 'summary')),
      );
      assert.strictEqual(error.code, 'invalid-params');
      assert.true(
        error.detail.includes('locale'),
        `the refusal names the param: ${error.detail}`,
      );
      assert.strictEqual(
        calls.filter((call) => call === 'cardDocument').length,
        0,
        'nothing is read for a payload that cannot satisfy the operation',
      );
    },

  'a name every object answers to is unknown, not a dispatchable operation':
    async (assert) => {
      // A lowered `operations` record has been through JSON, so it carries
      // `Object.prototype` and answers these names with something that is not
      // an operation. Reading one as a declaration reaches a `base` of
      // `undefined`.
      for (let name of [
        'toString',
        'constructor',
        '__proto__',
        'valueOf',
        'hasOwnProperty',
      ]) {
        let { core } = stub();
        let error = await refusalFrom(() =>
          runOperation(core, invoke(CARD, name)),
        );
        assert.strictEqual(
          error.code,
          'unknown-operation',
          `"${name}" is not an operation`,
        );
      }
    },

  'a headers-only read of a file answers from the file row': async (assert) => {
    let indexed = stub({ fileRow: true });
    let fromRow = await runOperation(indexed.core, invoke(FILE, 'read'), {
      headersOnly: true,
    });
    assert.deepEqual(fromRow, {
      indexedAt: 1700,
      lastModified: 1699,
      generation: 4,
      screenshots: null,
      deps: null,
    });
    assert.strictEqual(
      indexed.calls.filter((call) => call === 'fileMetaDocument').length,
      0,
      'an indexed file needs no document assembled',
    );

    // A file the realm serves but has not indexed still has a modification
    // time to report.
    let unindexed = stub({ fileRow: false });
    let fromDisk = await runOperation(unindexed.core, invoke(FILE, 'read'), {
      headersOnly: true,
    });
    assert.deepEqual(fromDisk, {
      indexedAt: null,
      lastModified: 42,
      generation: null,
      screenshots: null,
      deps: null,
    });
  },

  'a read needs an instance to read': async (assert) => {
    let { core } = stub();
    let onType = await refusalFrom(() =>
      runOperation(
        core,
        invoke({ kind: 'type', codeRef: PERSON, realm: REALM }, 'read'),
      ),
    );
    assert.strictEqual(onType.code, 'invalid-params');

    let notAURL = await refusalFrom(() =>
      runOperation(
        core,
        invoke({ kind: 'instance', url: 'not a url' }, 'read'),
      ),
    );
    assert.strictEqual(notAURL.code, 'invalid-params');
  },

  'the row peek is memoized for one invocation and no longer': async (
    assert,
  ) => {
    let { core, calls } = stub();
    let url = new URL(`${REALM}person-1`);
    let scope = newOperationScope(core);
    await scope.peekInstance(url);
    await scope.peekInstance(url);
    assert.strictEqual(
      calls.filter((call) => call === 'instance').length,
      1,
      'a scope reads a row once',
    );
    await newOperationScope(core).peekInstance(url);
    assert.strictEqual(
      calls.filter((call) => call === 'instance').length,
      2,
      'and a fresh scope reads it again, so no row outlives its request',
    );
  },
}) as SharedTests<Record<string, never>>;

export default tests;
