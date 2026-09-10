import {
  isDocumentResult,
  isHeadResult,
  isOperationFailure,
  isSourceResult,
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
// a card that will not read cleanly. So does `readSource`, whose whole
// contract is about what dispatch does *not* consult: the stub records every
// collaborator call, which is what makes "definition-free" checkable rather
// than merely asserted.
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
  // The bytes the realm holds, by local path. A path absent from this is one
  // the realm has nothing to open at: a missing file, a directory, a path it
  // serves no bytes from. Those refusals live on the realm's side of
  // `openStoredFile`, so the stub expresses all of them the one way the core
  // can observe.
  stored?: Record<string, string | Uint8Array>;
  // The content hash the realm recorded for a path. Absent means it recorded
  // none, which is a case the executor has to report rather than invent a
  // value for.
  storedVersions?: Record<string, string>;
  storedCreatedAt?: Record<string, number>;
}

interface Stub {
  core: OperationCore;
  calls: string[];
  // What each `storedFileMeta` call was asked about, for the one part of the
  // version contract that is the core's: handing the realm the size of the
  // handle whose bytes it is returning.
  metaCalls: { localPath: string; observedSize: number | undefined }[];
}

// `getInstance` matches `i.url` / `i.file_alias`, so a row answers to the
// card's canonical URL and to nothing else — not to a query string, a
// fragment, a trailing slash, or the `.json` source spelling. The stub holds
// itself to the same rule so a target that reaches the index uncanonicalized
// misses, the way it would against Postgres.
function isCanonicalKey(url: URL): boolean {
  return (
    url.search === '' &&
    url.hash === '' &&
    !url.pathname.endsWith('.json') &&
    !url.pathname.endsWith('/')
  );
}

function stub(opts: StubOptions = {}): Stub {
  let calls: string[] = [];
  let metaCalls: Stub['metaCalls'] = [];
  let {
    document = 'ok',
    row = 'ok',
    operations,
    definitionType = 'card-def',
    source,
    fileMeta = true,
    fileRow = false,
    stored = {},
    storedVersions = {},
    storedCreatedAt = {},
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
        if (document === 'missing' || !isCanonicalKey(url)) {
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
        if (row === 'missing' || !isCanonicalKey(url)) {
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
    async readFileAsText() {
      calls.push('readFileAsText');
      return source;
    },
    async openStoredFile(localPath) {
      calls.push('openStoredFile');
      let content = Object.prototype.hasOwnProperty.call(stored, localPath)
        ? stored[localPath]
        : undefined;
      if (content === undefined) {
        return undefined;
      }
      return {
        path: localPath,
        // A getter, as every streaming adapter's is, and it records the touch:
        // the headers-only mode has to leave the bytes alone rather than open
        // a stream it discards, and only reading the read tells us it did.
        get content() {
          calls.push('storedContent');
          return content;
        },
        lastModified: 1699,
        size: typeof content === 'string' ? content.length : content.byteLength,
      };
    },
    async storedFileMeta(localPath, observedSize) {
      calls.push('storedFileMeta');
      // Recorded rather than acted on: deciding whether a recorded hash still
      // describes the file is the realm's, so what the core owes is passing
      // the size of the handle it is reading from. The realm-server suite
      // holds the realm to the decision.
      metaCalls.push({ localPath, observedSize });
      return {
        version: storedVersions[localPath],
        createdAt: storedCreatedAt[localPath],
      };
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
    // The realm derives a file's type from its extension; the stub answers the
    // one file def the cases need.
    fileDefCodeRef: () => MARKDOWN,
    unresolveInstanceIds: () => {
      calls.push('unresolveInstanceIds');
    },
  };
  return { core, calls, metaCalls };
}

const MARKDOWN: CodeRef = {
  module: 'https://cardstack.com/base/markdown-file-def',
  name: 'MarkdownDef',
} as CodeRef;

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
    // The realm root names the realm's index card; a query string, a fragment
    // and a trailing slash all name the card they hang off. None of them may
    // reach the index lookup or `links.self` as written. A `.json` spelling is
    // not in this set — it names the card's source, which is a different read.
    for (let [spelling, expected] of [
      [`${REALM}`, `${REALM}index`],
      [`${REALM}person-1?vary=1`, `${REALM}person-1`],
      [`${REALM}person-1#section`, `${REALM}person-1`],
      [`${REALM}person-1/`, `${REALM}person-1`],
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

  'a declared operation resolves the same however the target is spelled':
    async (assert) => {
      // Dispatch resolves the type from the target and the executor reads from
      // it, so both have to be looking at the same card. Canonicalizing in only
      // one of them is worse than canonicalizing in neither: the type is
      // resolved for one card and the document assembled for another, and a
      // declared operation silently degrades to the built-in.
      let declared = {
        read: {
          base: 'read' as const,
          deterministic: true,
          output: { source: 'PROJECT(.title)', syntax: 'solidified' as const },
        },
      };
      for (let spelling of [
        `${REALM}person-1`,
        `${REALM}person-1?vary=1`,
        `${REALM}person-1#section`,
        `${REALM}person-1/`,
      ]) {
        let { core, calls } = stub({ operations: declared });
        let error = await refusalFrom(() =>
          runOperation(
            core,
            invoke({ kind: 'instance', url: spelling }, 'read'),
          ),
        );
        assert.strictEqual(
          error.status,
          501,
          `${spelling} resolves the declared read, not the built-in`,
        );
        assert.strictEqual(
          calls.filter((call) => call === 'instance').length,
          1,
          `${spelling} costs one row read, shared by dispatch and the executor`,
        );
      }
    },

  'a card source spelling names the source, not the card': async (assert) => {
    // `<card>.json` names the card's stored bytes. That is a different read
    // from the card, so the target routes as a file rather than resolving to
    // the instance — and a file carries neither `update` nor anything else
    // that writes.
    let { core, calls } = stub();
    let error = await refusalFrom(() =>
      runOperation(
        core,
        invoke({ kind: 'instance', url: `${REALM}person-1.json` }, 'update'),
      ),
    );
    assert.strictEqual(error.code, 'operation-not-allowed');
    assert.strictEqual(
      calls.filter((call) => call === 'instance').length,
      0,
      'a source target is never resolved through the instance index',
    );
  },

  'a file def declaration is resolved the same as a card def one': async (
    assert,
  ) => {
    // A file names its type by its extension rather than in stored JSON, but
    // the type's entry carries declarations either way, so a `read` declared
    // on a file def subclass has to be found.
    let { core, calls } = stub({
      operations: {
        readRedacted: { base: 'read' as const, deterministic: true },
      },
    });
    let result = await runOperation(core, invoke(FILE, 'readRedacted'));
    assert.true(isDocumentResult(result), 'the declared file read resolves');
    assert.true(
      calls.includes('lookupDefinition'),
      'the file def type entry is consulted',
    );

    // The allowance still holds: a file carries its two reads and nothing
    // else, whatever it declares.
    let mutating = stub({
      operations: {
        touch: { base: 'transform' as const, deterministic: true },
      },
    });
    let error = await refusalFrom(() =>
      runOperation(mutating.core, invoke(FILE, 'touch')),
    );
    assert.strictEqual(error.code, 'operation-not-allowed');
  },

  'a foreign target is refused without reading the index': async (assert) => {
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
    assert.deepEqual(
      calls,
      [],
      'a URL this realm does not contain settles before any read',
    );
  },

  'both read modes answer for a file whose extension is not registered': async (
    assert,
  ) => {
    // `urlNamesFile` only knows the extensions the platform maps to a file def,
    // so a `.css`, a `.yaml` or an extensionless name reaches the card branch
    // and misses the index. Both modes have to make the same fallback, or one
    // path answers with a body and refuses its own headers.
    let unregistered: OperationTarget = {
      kind: 'instance',
      url: `${REALM}styles.css`,
    };

    let doc = await runOperation(
      stub({ document: 'missing', row: 'missing' }).core,
      invoke(unregistered, 'read'),
    );
    assert.true(isDocumentResult(doc), 'the document mode serves the file');

    let headers = await runOperation(
      stub({ document: 'missing', row: 'missing' }).core,
      invoke(unregistered, 'read'),
      { headersOnly: true },
    );
    assert.true(isHeadResult(headers), 'and the headers mode answers too');
    if (isHeadResult(headers)) {
      assert.strictEqual(
        headers.lastModified,
        42,
        'reporting what the file itself can say',
      );
      assert.strictEqual(
        headers.indexedAt,
        null,
        'and nothing an index row would have carried',
      );
    }
  },

  'a malformed type realm is a refusal, not a raw throw': async (assert) => {
    let { core } = stub();
    let error = await refusalFrom(() =>
      resolveOperation(
        core,
        { kind: 'type', codeRef: PERSON, realm: 'not-a-url' },
        'create',
      ),
    );
    assert.strictEqual(error.code, 'invalid-params');
    assert.strictEqual(error.status, 400);
  },

  'a read refuses any clause it does not carry out': async (assert) => {
    // Not only the program stages: a declaration rebound onto `read` may carry
    // a clause belonging to the base it came from, and ignoring it is the same
    // failure as ignoring a projection.
    for (let clause of ['program', 'input', 'output', 'fill', 'of', 'query']) {
      let { core } = stub({
        operations: {
          look: {
            base: 'read' as const,
            deterministic: true,
            [clause]: clause === 'fill' ? {} : ({ x: 1 } as any),
          } as any,
        },
      });
      let error = await refusalFrom(() =>
        runOperation(core, invoke(CARD, 'look')),
      );
      assert.strictEqual(
        error.status,
        501,
        `a read carrying \`${clause}\` is refused rather than flattened`,
      );
    }
  },

  'a stored-bytes read serves the bytes and infers their content type': async (
    assert,
  ) => {
    let cases = [
      // A card's stored source. The `.json` spelling names the bytes rather
      // than the card, which is why dispatch leaves it as written.
      {
        path: 'person-1.json',
        content: '{"data":{"type":"card"}}',
        contentType: 'application/json',
      },
      // A module, which has no `adoptsFrom` and no definition entry — the
      // case the whole definition-free path exists for.
      {
        path: 'person.gts',
        content: 'export class Person {}',
        contentType: 'text/typescript+glimmer',
      },
      // Bytes rather than text, handed back as the adapter produced them: a
      // read of an image must not decode them.
      {
        path: 'logo.png',
        content: new Uint8Array([137, 80, 78, 71]),
        contentType: 'image/png',
      },
      // An `_`-prefixed name. Only the specific registered `_` endpoints are
      // realm endpoints; a file stored under such a name is one the byte
      // routes serve, so a read of its bytes has to reach it rather than
      // reporting it missing.
      {
        path: '_notes.md',
        content: '# notes',
        contentType: 'text/markdown',
      },
    ];
    for (let { path, content, contentType } of cases) {
      let { core, metaCalls } = stub({ stored: { [path]: content } });
      let result = await runOperation(
        core,
        invoke({ kind: 'instance', url: `${REALM}${path}` }, 'readSource'),
      );
      assert.deepEqual(
        metaCalls,
        [
          {
            localPath: path,
            observedSize:
              typeof content === 'string' ? content.length : content.byteLength,
          },
        ],
        `${path} asks for its version against the handle being read`,
      );
      assert.true(isSourceResult(result), `${path} reads as stored bytes`);
      if (isSourceResult(result)) {
        assert.strictEqual(
          result.contentType,
          contentType,
          `${path} carries the content type its extension names`,
        );
        assert.strictEqual(
          result.body,
          content,
          `${path} hands back exactly what the adapter produced`,
        );
        assert.strictEqual(result.lastModified, 1699);
        assert.strictEqual(
          result.size,
          typeof content === 'string' ? content.length : content.byteLength,
          `${path} carries the size a Content-Length is set from`,
        );
      }
    }
  },

  'a stored-bytes read consults neither a definition nor the index': async (
    assert,
  ) => {
    // The hard constraint, as the only thing that can check it: a module has
    // no definition entry, so a read that reached the cache for one would
    // refuse bytes that are on disk. `.gts` is a registered extension, so this
    // is the path that would otherwise resolve a file def's type and look it
    // up.
    let { core, calls } = stub({
      stored: { 'person.gts': 'export class Person {}' },
    });
    await runOperation(
      core,
      invoke({ kind: 'instance', url: `${REALM}person.gts` }, 'readSource'),
    );
    assert.deepEqual(
      calls,
      ['openStoredFile', 'storedFileMeta', 'storedContent'],
      'one file open, one file-meta row, one touch of the bytes — and no ' +
        'definition lookup and no index read at all',
    );
  },

  'the headers-only mode reports the metadata without touching the bytes':
    async (assert) => {
      let { core, calls } = stub({
        stored: { 'sample.md': '# hi' },
        storedVersions: { 'sample.md': 'abc123' },
        storedCreatedAt: { 'sample.md': 1600 },
      });
      let target: OperationTarget = {
        kind: 'instance',
        url: `${REALM}sample.md`,
      };
      let headers = await runOperation(core, invoke(target, 'readSource'), {
        headersOnly: true,
      });
      assert.true(isSourceResult(headers), 'the metadata comes back');
      if (isSourceResult(headers)) {
        assert.strictEqual(headers.body, undefined, 'and no bytes with it');
        assert.deepEqual(
          {
            contentType: headers.contentType,
            lastModified: headers.lastModified,
            created: headers.created,
            version: headers.version,
          },
          {
            contentType: 'text/markdown',
            lastModified: 1699,
            created: 1600,
            version: 'abc123',
          },
        );
      }
      assert.false(
        calls.includes('storedContent'),
        'the adapter opens a stream on first touch, so a HEAD must not touch it',
      );

      // Identical metadata either way, which is what lets a `HEAD` and a
      // conditional `GET` agree on a validator for the same file.
      let bytes = await runOperation(core, invoke(target, 'readSource'));
      assert.true(isSourceResult(bytes));
      if (isSourceResult(bytes) && isSourceResult(headers)) {
        let { body: _body, ...metadata } = bytes;
        assert.deepEqual(metadata, headers);
      }
    },

  'a stored-bytes read reports a version the realm never recorded as absent':
    async (assert) => {
      // The realm resolves the hash — from its own row, or by hashing the
      // bytes when the row carries none — so a null here means it could do
      // neither. Reporting the absence is what lets the facade omit an `ETag`
      // rather than emit one that identifies nothing.
      let { core } = stub({ stored: { 'sample.md': '# hi' } });
      let result = await runOperation(
        core,
        invoke({ kind: 'instance', url: `${REALM}sample.md` }, 'readSource'),
      );
      assert.true(isSourceResult(result));
      if (isSourceResult(result)) {
        assert.strictEqual(result.version, null);
        assert.strictEqual(
          result.created,
          null,
          'and the same for a path the realm has no record of',
        );
      }
    },

  'a path with no stored bytes is not found, never not-indexed': async (
    assert,
  ) => {
    // Every way there is nothing to read answers alike, because the realm
    // applies its own refusals inside `openStoredFile` and the core cannot
    // tell them apart: a missing file, a directory, a path it serves no bytes
    // from.
    for (let path of ['does-not-exist', 'dir']) {
      let { core } = stub({ stored: { 'sample.md': '# hi' } });
      let error = await refusalFrom(() =>
        runOperation(
          core,
          invoke({ kind: 'instance', url: `${REALM}${path}` }, 'readSource'),
        ),
      );
      assert.strictEqual(error.code, 'target-not-found', `${path} is 404`);
      assert.strictEqual(error.status, 404);
    }

    // `target-not-indexed` says waiting will resolve the absence, and what it
    // waits for is the index. A read of bytes has nothing to wait for, so a
    // source file already on disk does not change the answer for a path whose
    // own bytes are missing.
    let { core } = stub({ source: '{"data":{"type":"card"}}' });
    let error = await refusalFrom(() =>
      runOperation(
        core,
        invoke(
          { kind: 'instance', url: `${REALM}person-1.json` },
          'readSource',
        ),
      ),
    );
    assert.strictEqual(error.code, 'target-not-found');
  },

  'the realm root is a directory, not a stored file': async (assert) => {
    // A card read resolves the realm root to the realm's index card, which is
    // what makes the root readable at all. A stored-bytes read addresses a
    // path, and the root is the realm's own directory — so it must not resolve
    // to `index` and serve whatever file happens to carry that bare name.
    let { core } = stub({ stored: { index: 'not the index card' } });
    for (let url of [REALM, REALM.replace(/\/$/, '')]) {
      let error = await refusalFrom(() =>
        runOperation(core, invoke({ kind: 'instance', url }, 'readSource')),
      );
      assert.strictEqual(
        error.code,
        'target-not-found',
        `${url} names a directory: ${error.detail}`,
      );
    }

    // The bare name still reads when it is asked for by name.
    let byName = await runOperation(
      core,
      invoke({ kind: 'instance', url: `${REALM}index` }, 'readSource'),
    );
    assert.true(isSourceResult(byName), 'the file itself is readable');
    if (isSourceResult(byName)) {
      assert.strictEqual(byName.body, 'not the index card');
    }

    // And the card read still resolves the root to the index card, which is
    // the behavior the two addressings differ on.
    let card = await runOperation(
      core,
      invoke({ kind: 'instance', url: REALM }, 'read'),
    );
    assert.true(
      isDocumentResult(card),
      'a card read of the root serves the index card',
    );
  },

  'a type has no stored bytes to read': async (assert) => {
    let { core, calls } = stub();
    let error = await refusalFrom(() =>
      resolveOperation(
        core,
        { kind: 'type', codeRef: PERSON, realm: REALM },
        'readSource',
      ),
    );
    assert.strictEqual(error.code, 'operation-not-allowed');
    assert.strictEqual(error.status, 405);
    assert.deepEqual(
      calls,
      [],
      'and the refusal costs no definition lookup: the answer does not ' +
        'depend on which kind of def the type turns out to be',
    );

    // A field def type refuses for the same reason rather than because a
    // field carries nothing — the stub is set up to say `field-def`, and the
    // refusal still arrives without the entry being read.
    let field = stub({ definitionType: 'field-def' });
    let onField = await refusalFrom(() =>
      resolveOperation(
        field.core,
        { kind: 'type', codeRef: PERSON, realm: REALM },
        'readSource',
      ),
    );
    assert.strictEqual(onField.code, 'operation-not-allowed');
    assert.deepEqual(field.calls, []);
  },

  'a declaration may not build on a stored-bytes read': async (assert) => {
    // A declaration wins over the built-in of the same name, which is how a
    // `read` is specialized and how a `delete` is rebound onto `transform`.
    // A stored-bytes read is the one behavior that cannot be won that way:
    // there is no payload to reshape and no stage to run, so dispatching a
    // declared name to it would answer under the author's name without doing
    // what the author wrote. The authoring decorator refuses such a
    // declaration; this is the realm refusing one that reached a stored
    // definition regardless.
    let { core } = stub({
      operations: {
        exportBytes: { base: 'readSource' as const, deterministic: true },
      },
    });
    let error = await refusalFrom(() =>
      runOperation(core, invoke(CARD, 'exportBytes')),
    );
    assert.strictEqual(error.code, 'operation-not-allowed');
    assert.strictEqual(error.status, 405);
    assert.true(
      error.detail.includes('readSource'),
      `the refusal names the base it was built on: ${error.detail}`,
    );
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
