import type { Readable } from 'stream';
import { RealmPaths, type LocalPath } from '../paths.ts';
import { urlNamesFile } from '../file-def-code-ref.ts';
import { readOperation } from './read.ts';
import { readSourceOperation } from './read-source.ts';
import {
  hasTransforms,
  runInputTransform,
  runOutputTransform,
  type TransformContext,
} from './transforms.ts';
import {
  DEFINITION_FREE_BASE_OPERATIONS,
  OperationFailure,
  isDocumentResult,
  isHeadResult,
  type BaseOperation,
  type OperationDefinition,
  type OperationResult,
  type OperationRequest,
  type OperationSourceBody,
  type OperationTarget,
} from './types.ts';
import type { CodeRef, ResolvedCodeRef } from '../code-ref.ts';
import type { Definition } from '../definitions.ts';
import type { JsonValue } from '../json-validation.ts';
import type {
  SingleCardDocument,
  SingleFileMetaDocument,
} from '../document-types.ts';
import type { LooseCardResource, FileMetaResource } from '../resource-types.ts';
import type { InstanceOrError, IndexedFile } from '../index-query-engine.ts';
import type { SearchResult } from '../realm-index-query-engine.ts';

// ============================================================================
// Running an operation.
//
// Dispatch answers one question — "given a target and a name, which built-in
// behavior is this, and is the target allowed to carry it out?" — and then
// hands the request to that behavior's executor. Everything it consults is
// data: the target's stored JSON names its type, the type's definition-cache
// entry carries the lowered operation, and the executor works from the search
// index. No card JavaScript is loaded anywhere on this path, which is the
// property the whole design exists to hold: card modules are author-written
// and the realm is a trusted context.
// ============================================================================

// The realm's collaborators, narrowed to what an operation actually uses. The
// core is handed these rather than a `Realm` so it stays testable in isolation
// and, more importantly, so no operation resolves an identifier itself: a
// `VirtualNetwork` resolves author-controlled ones, and steering a lookup is
// not something author-written code should be able to do in a trusted context.
// So the two resolutions a behavior needs arrive already done, as plain
// functions the realm binds to its own fetch layer.
//
// Nothing here is a network capability. A behavior that turns out to need one
// should add it deliberately, in the narrowest form that behavior needs, and
// say what it is for — not inherit a general `fetch`.
export interface OperationCore {
  // The realm every target of this core belongs to. Local paths are derived
  // from it, so a target outside it is not this core's to serve.
  realmURL: string;
  definitionLookup: OperationDefinitionLookup;
  indexQueryEngine: OperationIndexQueryEngine;
  // The target's source file as stored on disk, decoded as text, by local
  // path. The index is what a read serves, so this is how a behavior
  // distinguishes "no such card" from "the write landed and the index row is
  // still coming".
  readFileAsText(localPath: LocalPath): Promise<string | undefined>;
  // The stored bytes at a local path, opened the way the realm's own byte
  // serve opens them, with the realm's own refusals applied: a path it will
  // not serve — the realm root, which is a directory, or a name nothing is
  // stored under — answers undefined. It applies no refusal to a name as
  // such, which is what keeps this in step with the byte routes: they serve a
  // card's `.json` and an `_`-prefixed file alike, so a read of stored bytes
  // has to reach both.
  //
  // `content` is unread until it is touched. The adapter opens a real stream
  // on first touch, so a caller that wants only the metadata must leave it
  // alone rather than open and strand one.
  openStoredFile(
    localPath: LocalPath,
  ): Promise<OperationStoredFile | undefined>;
  // The version and creation time of the bytes at `file`, resolved by the
  // realm because it owns both its file-meta row and how a fingerprint is
  // reached for a path the row does not describe.
  //
  // `file` is the handle the caller will serve from, not just its path. The
  // realm validates its recorded hash against that handle's size, since a
  // `version` identifying bytes other than the ones it is returned with is
  // what a conditional GET would build a wrong validator from, and where it
  // has to read the file to fingerprint it, it reads bounded ranges of that
  // same handle. What it never reads is the handle's `content`: that is the
  // single-use body a full read returns and a headers-only read leaves
  // untouched, so both modes reach the same version at the same cost and
  // neither spends the other's.
  storedFileMeta(
    localPath: LocalPath,
    file: OperationStoredFile,
    opts?: { skipContentFingerprint?: boolean },
  ): Promise<OperationStoredFileMeta>;
  // The realm's own settings, as `realmConfig()` answers with them. Reached
  // only by an operation's transform stages, and only when a stage's program
  // names a setting — the coordinator has its own reader for the write path,
  // for the same value read at a different moment.
  realmConfig(): Promise<Record<string, JsonValue>>;
  // Whether the realm's ignore rules exclude this URL. An ignored path is
  // never visited, so no amount of waiting produces an index row for it.
  isIgnored(url: URL): Promise<boolean>;
  // The file-meta document for a path that holds bytes rather than a card, as
  // the card+json read serves it: derived from the bytes on disk. Undefined
  // when the path is not a servable file, including when a sibling `.json`
  // makes it a card's source rather than a file.
  fileMetaDocument(
    localPath: LocalPath,
  ): Promise<SingleFileMetaDocument | undefined>;
  // A code ref with its module absolutized against `relativeTo`. The realm
  // owns identifier resolution, so it hands the resolved ref down rather than
  // letting an operation resolve one itself.
  resolveCodeRef(
    codeRef: CodeRef,
    relativeTo: URL,
  ): ResolvedCodeRef | undefined;
  // The type of the file at this URL. A file names its type by its extension
  // rather than in stored JSON, and the mapping resolves module specifiers, so
  // the realm supplies it bound for the same reason `resolveCodeRef` is. It
  // reads nothing — the answer is a table lookup on the extension, the same one
  // that stamps `adoptsFrom` on the document a file read serves. The type it
  // names is then looked up in the definition cache like any other, so a file
  // read does cost a definition lookup even though this function costs none.
  fileDefCodeRef(url: URL): CodeRef;
  // Rewrite a document's instance ids into canonical prefix form, in place.
  // The mapping lives in the realm's fetch layer, so this arrives as a bound
  // function for the same reason `resolveCodeRef` does.
  unresolveInstanceIds(doc: {
    data: LooseCardResource | FileMetaResource;
    included?: (LooseCardResource | FileMetaResource)[];
  }): void;
}

// The realm's own `FileRef`, narrowed to what a stored-bytes read uses. Stated
// here rather than imported so the core does not depend on the realm module it
// is a collaborator of.
export interface OperationStoredFile {
  path: LocalPath;
  // A lazy getter on every adapter that can stream: reading it opens the
  // stream, so the headers-only mode leaves it untouched. Typed as the body a
  // stored-bytes read answers with, since it is handed through unchanged.
  content: OperationSourceBody;
  lastModified: number;
  // The byte size where the adapter knows it from the stat it already
  // performed, and absent where knowing it would cost reading the bytes.
  size?: number;
  // A bounded read of `[start, end]`, both inclusive, present where the
  // adapter can serve one without materializing the rest. It is what lets a
  // version be read from a file without streaming it, so an adapter that
  // offers none simply has no version to report for a path the realm holds no
  // record of.
  createRangeStream?: (
    start: number,
    end: number,
  ) => ReadableStream<Uint8Array> | Readable;
}

export interface OperationStoredFileMeta {
  // The content hash of the stored bytes, absent only where the realm can
  // neither recall one nor read one within a bounded cost.
  version?: string;
  // Epoch seconds, absent where the realm holds no record of this path.
  createdAt?: number;
}

// `CachingDefinitionLookup`, narrowed to the one read an operation makes.
export interface OperationDefinitionLookup {
  lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition | undefined>;
}

// `RealmIndexQueryEngine`, narrowed to the reads an operation makes.
export interface OperationIndexQueryEngine {
  cardDocument(
    url: URL,
    opts?: {
      loadLinks?: boolean;
      skipQueryBackedExpansion?: boolean;
      resolveLinksOnly?: boolean;
      skipLinkAssemblyBudget?: boolean;
    },
  ): Promise<SearchResult | undefined>;
  instance(
    url: URL,
    opts?: { includeErrors?: true },
  ): Promise<InstanceOrError | undefined>;
  file(url: URL): Promise<IndexedFile | undefined>;
}

export interface RunOperationOptions {
  // The metadata a response's headers are computed from, and no body: for a
  // `read` the four values the card+json headers rest on and no document, for
  // a `readSource` everything but the bytes. What a `HEAD`, or a conditional
  // `GET` deciding on a validator, asks for. Ignored by every other behavior.
  headersOnly?: true;
  // Leave a query-backed field unexpanded. A render inside a prerender request
  // must not recurse back into the search that would resolve one, so a read
  // serving that request says so here — the same control the card+json GET
  // applies from `isDuringPrerenderRequest`.
  skipQueryBackedExpansion?: boolean;
  // Answer a card's links rather than side-loading them: the document names
  // what it points at and `included` stays empty. A read serving a request
  // that only needs the card's own fields says so here, and the validator the
  // caller emits has to fold it in, since it distinguishes two documents
  // assembled from the same index row.
  resolveLinksOnly?: boolean;
  // Exempt this read's link assembly from the assembled-resource budget. Set
  // for a read serving a prerender request, whose closure is rendered into HTML
  // that outlives the request: a clipped one would be cached, and the cached
  // copy carries no way to say it was clipped. Derived from the same signal as
  // `skipQueryBackedExpansion`, which is already part of the response cache's
  // key — so the two shapes never share a cache entry.
  skipLinkAssemblyBudget?: boolean;
  // Report a stored-bytes read's `version` only where the realm already
  // recorded one, rather than reading the file to fingerprint it.
  //
  // A recorded hash is free: it arrives on the same row the creation time does.
  // Computing one is not — it reads up to the whole-content limit and hashes it
  // synchronously — and the realm records a hash only for a path written
  // through its own write API, so every file that reached disk another way
  // (a deploy, a seeded realm) would pay that read on every request. A caller
  // that does not validate on `version` says so here and gets null for the
  // paths a hash would have had to be read for.
  skipContentFingerprint?: boolean;
  // Answer without the realm's record of the path at all: `created` and
  // `version` both null, and the row they come from left unread. That row is
  // the only database work a stored-bytes read does, so a caller that reads
  // neither value pays for neither.
  //
  // It is not only a saving. A caller may be holding a pinned pool connection
  // for the whole of the work the read sits inside — the coordinated module
  // compile does — and there a second checkout is what the coordination is
  // built to avoid, not merely a cost. Such a caller has to be able to say
  // that this read touches no connection.
  skipStoredFileMeta?: boolean;
}

// One request's memo of the index-row peek. Dispatch reads a card's row to
// learn its type — a file's comes from its extension instead — and a behavior
// often wants the same row, a headers-only read wanting nothing else. Both go through here so one invocation costs one
// read of a row rather than one per reader, and so every reader sees the same
// snapshot of it. The memo lives for the invocation and no longer: a core is
// long-lived and must never hold a card's row across requests.
export interface OperationScope {
  peekInstance(url: URL): Promise<InstanceOrError | undefined>;
}

export function newOperationScope(core: OperationCore): OperationScope {
  let rows = new Map<string, Promise<InstanceOrError | undefined>>();
  return {
    peekInstance(url: URL) {
      let cached = rows.get(url.href);
      if (!cached) {
        // Always with errors: an errored row is still a row, and the readers
        // that care about the difference check `type` themselves. Asking one
        // way keeps the memo to a single entry per URL.
        cached = core.indexQueryEngine.instance(url, { includeErrors: true });
        rows.set(url.href, cached);
      }
      return cached;
    },
  };
}

// The def types, as the operation core distinguishes them.
//
// For an instance target the file/card line is drawn from the target URL, by
// the registered-extension test `urlNamesFile`, rather than from the entry's
// own `Definition.type`. The entry does say which family a type belongs to,
// but reaching it means a definition lookup, and an instance target's URL
// settles the question without one.
//
// Reading the extension is a commitment made before the index is consulted,
// which the card+json GET does not make — it asks for a card document first
// and falls back to file metadata only when there is none. The two agree
// because a card's *id* never carries a registered extension — ids are minted
// from a UUID — which is the same assumption the index query engine's own
// file/instance split rests on. The one path that does carry one is a card's
// `.json` source spelling, and that is classified as a file deliberately: it
// names the card's stored bytes rather than the card, and a `readSource` of it
// is what serves them.
//
// A `type` target has only its ref, so its kind comes from the entry. A file
// def named that way carries nothing in practice, which is correct rather than
// a gap: what a file has are reads and writes of one file's bytes, and every
// one of them needs an instance to reach.
type DefKind = 'card-def' | 'file-def' | 'field-def';

// Every behavior the runtime knows a name for, which is a different question
// from which of them a given target carries. Exhaustive over `BaseOperation`
// on purpose: a further built-in behavior has to be named here before any
// target can be asked for it.
const ALL_BASE_OPERATIONS: Readonly<Record<BaseOperation, true>> = {
  read: true,
  readSource: true,
  create: true,
  update: true,
  delete: true,
  query: true,
  transform: true,
  appendContainsMany: true,
  appendLine: true,
};

// Keyed by kind for the lookup dispatch actually does, but built from a table
// keyed by base operation so the compiler asks where a tenth behavior belongs
// rather than letting it default to "carried by nothing" — which reads as a
// 405 at invocation with nothing red anywhere.
const CARRIED_BY: Readonly<Record<BaseOperation, readonly DefKind[]>> = {
  read: ['card-def', 'file-def'],
  readSource: ['card-def', 'file-def'],
  create: ['card-def'],
  update: ['card-def', 'file-def'],
  delete: ['card-def'],
  query: ['card-def'],
  transform: ['card-def'],
  appendContainsMany: ['card-def'],
  appendLine: ['file-def'],
};

function carriedBy(kind: DefKind): Partial<Record<BaseOperation, true>> {
  let carried: Partial<Record<BaseOperation, true>> = {};
  for (let base of Object.keys(CARRIED_BY) as BaseOperation[]) {
    if (CARRIED_BY[base].includes(kind)) {
      carried[base] = true;
    }
  }
  return carried;
}

const ALLOWED_BASE_OPERATIONS: Readonly<
  Record<DefKind, Partial<Record<BaseOperation, true>>>
> = {
  // Everything but the one behavior that appends a line of text: a card's
  // stored bytes are a JSON:API document, and a line appended to one leaves
  // behind a file that is no longer a card.
  'card-def': carriedBy('card-def'),
  // A file's metadata is derived from its bytes and read-only, so there is no
  // JSON:API mutation surface for anything to reach — and no field schema, so
  // no `containsMany` to append to. Its bytes are the representation a file is
  // for, though, and both writes here work on them: an `update` replaces the
  // content wholesale and an `appendLine` adds one line to the end of a text
  // file without reading what is already there.
  'file-def': carriedBy('file-def'),
  // A field's instances have no URL, so nothing is invocable on one. Field
  // data is reached through the operations of the card that contains it.
  'field-def': carriedBy('field-def'),
};

// The file-only behaviors an instance target carries whatever its URL is
// classified as.
//
// `defKindFor` classifies an instance target by its extension, and the
// registered-extension table does not name every stored file: a `.log`, a
// `.css`, a `.yml` holds bytes and serves them, and each classifies `card-def`.
// A `read` survives that because a card carries a read too and its executor
// falls back to the file-metadata document for exactly those paths. A
// file-only write has no such overlap, so it is admitted here and the
// discrimination is made where the answer is available: the executor, which
// reads whether the path holds a card's `.json` or plain bytes and already has
// to judge the content type to decide whether a line may be appended at all.
//
// Only an instance target, and only for what a URL can under-report. A type
// target's kind comes from its definition rather than from an extension, so
// nothing about it is uncertain, and there is no instance behind it for a
// stored-bytes write to reach.
const FILE_WRITES_ON_ANY_INSTANCE: Readonly<
  Partial<Record<BaseOperation, true>>
> = { appendLine: true };

function carries(
  target: OperationTarget,
  kind: DefKind,
  base: BaseOperation,
): boolean {
  if (own(ALLOWED_BASE_OPERATIONS[kind], base)) {
    return true;
  }
  return (
    target.kind === 'instance' && own(FILE_WRITES_ON_ANY_INSTANCE, base) != null
  );
}

// The base operations that resolve without consulting a definition.
//
// A definition is consulted for two reasons — to find a declaration of the
// requested name, and to learn a type target's def kind — and a stored-bytes
// read needs neither. An instance target's kind comes from its URL, and
// nothing may declare one of these names, so there is nothing in a definition
// that could change the answer.
//
// What skipping the lookup buys is the lookup: a byte read is the hottest
// path the realm has, and resolving a definition for one costs a cache read
// that cannot affect the outcome — for a `.gts` it is a read of the file def
// its extension names. It also fixes the addressing before anything reads,
// which is what lets `runOperation` tell a path read from a card read by name
// alone.
//
// It is not what makes the answer correct. The ordinary path reaches the same
// built-in for an instance target whether or not a definition resolves, since
// `defKindFor` never consults one. What makes *skipping* safe is the name
// reservation: were a declaration able to take one of these names, resolving
// before the lookup would run the built-in in its place.
// A null-prototype record over the shared list, so a wire-supplied name is
// looked up the same prototype-safe way every other name on this path is.
const DEFINITION_FREE_OPERATIONS: Readonly<
  Partial<Record<BaseOperation, true>>
> = Object.assign(
  Object.create(null) as Partial<Record<BaseOperation, true>>,
  Object.fromEntries(
    DEFINITION_FREE_BASE_OPERATIONS.map((name) => [name, true]),
  ),
);

function isBaseOperation(name: string): name is BaseOperation {
  return own(ALL_BASE_OPERATIONS, name) !== undefined;
}

function isDefinitionFreeOperation(name: string): name is BaseOperation {
  return own(DEFINITION_FREE_OPERATIONS, name) !== undefined;
}

// Read a record by a key that arrived over the wire. Every name-keyed lookup
// on this path goes through here: a plain object answers `toString` and
// `constructor` with something that is not an operation, and reading one of
// those as a declaration gets as far as dispatching on a `base` of
// `"undefined"`. The authoring API builds its own declaration records with a
// null prototype for this reason, but a lowered one has been through JSON and
// carries `Object.prototype` again.
function own<T>(
  record: Record<string, T> | undefined,
  key: string,
): T | undefined {
  if (!record || !Object.prototype.hasOwnProperty.call(record, key)) {
    return undefined;
  }
  return record[key];
}

// Which built-in behavior `name` means for `target`, as the definition the
// executor works from.
//
// A declaration wins over the built-in of the same name — that is how an
// author specializes `read` or rebinds `delete` onto `transform` — so the
// type's entry is consulted whichever name arrived. A type whose entry cannot
// be read is not fatal for a base name against an instance target: the card
// is in the index, the built-in behavior does not consult its definition, and
// refusing here would make a broken module's cards unreadable.
export async function resolveOperation(
  core: OperationCore,
  target: OperationTarget,
  name: string,
  scope: OperationScope = newOperationScope(core),
): Promise<OperationDefinition> {
  assertInRealm(core, target);
  if (isDefinitionFreeOperation(name)) {
    // Before the lookup, not merely without it — see
    // `DEFINITION_FREE_OPERATIONS` for what that rests on. The kind still
    // decides whether the target carries the operation, so it comes from the
    // target alone, which is where an instance target's kind comes from
    // anyway.
    let kind = definitionFreeKind(target);
    if (!kind || !own(ALLOWED_BASE_OPERATIONS[kind], name)) {
      throw notAllowed(target, name, kind, name);
    }
    return { base: name, deterministic: true };
  }
  let definition = await definitionFor(core, target, scope);
  if (target.kind === 'type' && !definition) {
    // Nothing else can be said about a type nobody can resolve: whether it
    // carries the operation is a question about a definition that is not
    // there.
    throw new OperationFailure({
      status: 404,
      code: 'target-not-found',
      title: 'Unknown type',
      detail: `no definition for ${JSON.stringify(target.codeRef)} in realm ${target.realm}`,
    });
  }
  let kind = defKindFor(target, definition);
  let declared = own(definition?.operations, name);
  if (declared) {
    if (declared.invalid) {
      throw new OperationFailure({
        id: targetId(target),
        status: 422,
        code: 'invalid-operation',
        title: 'Invalid operation',
        detail:
          `operation "${name}" is declared but could not be lowered to a ` +
          `runnable form: ${describeIssues(declared)}`,
        meta: { issues: declared.issues ?? [] },
      });
    }
    if (own(DEFINITION_FREE_OPERATIONS, declared.base)) {
      // A declaration wins over the built-in of the same name, which is what
      // lets an author specialize `read` or rebind `delete` onto `transform`.
      // A definition-free behavior is the one thing that cannot be won that
      // way: it serves the bytes on disk, so there is no payload to reshape
      // and no stage to run, and dispatching a declared name to it would
      // answer under the author's name without doing what the author wrote.
      // The authoring decorator refuses such a declaration; this refuses one
      // that reached a stored definition regardless.
      throw new OperationFailure({
        id: targetId(target),
        status: 405,
        code: 'operation-not-allowed',
        title: 'Operation not allowed',
        detail:
          `operation "${name}" is declared on "${declared.base}", which is ` +
          `not a behavior a declaration may build on: a "${declared.base}" ` +
          `serves the bytes stored at the target's URL`,
      });
    }
    if (!carries(target, kind, declared.base)) {
      throw notAllowed(target, name, kind, declared.base);
    }
    return declared;
  }
  if (!isBaseOperation(name)) {
    throw new OperationFailure({
      id: targetId(target),
      status: 404,
      code: 'unknown-operation',
      title: 'Unknown operation',
      detail: `there is no operation named "${name}" on ${describeTarget(target)}`,
    });
  }
  if (!carries(target, kind, name)) {
    throw notAllowed(target, name, kind, name);
  }
  // The built-in behavior, undeclared. It has no program and no params, and
  // its result is fixed by the behavior itself, so it is deterministic by
  // construction.
  return { base: name, deterministic: true };
}

// Whether a `read` of this target may be answered without running it, asked
// before anything is read.
//
// The card+json `GET` has to know this before it answers, because a projected
// body is not the representation its validator describes: the ETag is built
// from the index row, and a row says nothing about which projection a type
// declares — so a card whose type gains an `output` keeps the validator it had
// and a conditional request would be answered 304 with the unprojected body
// still in the client's cache. The handler therefore asks here, ahead of its
// own conditional fast path, rather than learning it from the assembly.
//
// It costs the definition lookup the assembly would have made anyway; the row
// peek is shared with the caller's through `scope`.
//
// Only `plain` may be answered from the validator, and the other two answers
// are the two ways a read stops being answerable that way.
//
// `staged` covers a read carrying either stage, not only a projecting one. An
// `input` changes no byte of the document — a read serves the target's indexed
// view and ignores its payload — but it can *refuse*: the program can fail,
// the `params` check runs against what it produced, and a stage that reads
// `actor()` turns an anonymous request away. A 304 answers as though none of
// that happened.
//
// `unresolved` is a target whose read cannot be resolved at all — a
// declaration lowering flagged invalid. It has a refusal coming, and reporting
// it as plain would hand a caller holding a validator a 304 for a card the
// full request refuses.
//
// Both send the request down the assembling path, which has the whole request
// in hand and answers what is actually true of it. Neither says anything about
// the *body*: whether it was projected is reported by the assembly, since only
// the `output` stage decides that.
export type ReadShape = 'plain' | 'staged' | 'unresolved';

export async function readShape(
  core: OperationCore,
  url: URL,
  scope: OperationScope = newOperationScope(core),
): Promise<ReadShape> {
  let definition: OperationDefinition;
  try {
    definition = await resolveOperation(
      core,
      { kind: 'instance', url: url.href },
      'read',
      scope,
    );
  } catch {
    return 'unresolved';
  }
  return hasTransforms(definition) ? 'staged' : 'plain';
}

export async function runOperation(
  core: OperationCore,
  request: OperationRequest,
  opts: RunOperationOptions = {},
): Promise<OperationResult> {
  // A definition-free name is a read of stored bytes, which addresses a path
  // rather than a card — so the realm root stays the realm root rather than
  // resolving to the index card. Reading the addressing off the name is sound
  // for the same reason answering it without a definition is: no declaration
  // can take one of these names, so the name settles which behavior this is
  // before anything is read.
  let target = canonicalizeTarget(core, request.target, {
    rootNamesIndexCard: !isDefinitionFreeOperation(request.name),
  });
  let canonical: OperationRequest =
    target === request.target ? request : { ...request, target };
  let scope = newOperationScope(core);
  let definition = await resolveOperation(core, target, canonical.name, scope);
  // The four stages of an invocation, in the one order they run: the `input`
  // transform over the payload, the `params` check against what it produced,
  // the behavior, and the `output` transform over its result. The check runs
  // against the input's result rather than the caller's payload because that
  // is what lets an `input` supply a declared param the caller left out.
  //
  // Both stages are here rather than inside an executor so that adding a
  // behavior cannot quietly add one that ignores them — an operation whose
  // `output` was skipped answers with more than its author said it would,
  // which is the one failure a projection must not have.
  refuseAnonymousActor(canonical, definition);
  if (definition.input) {
    canonical = {
      ...canonical,
      params: await runInputTransform(
        definition,
        canonical.params ?? {},
        transformContext(core, canonical),
      ),
    };
  }
  validateParams(canonical, definition);
  let result = await runBaseOperation(core, canonical, definition, opts, scope);
  return await projectResult(core, canonical, definition, result);
}

// A stage that reads `actor()` cannot run for a request that authenticated
// nobody, which a realm anyone may read allows. Refused before the behavior
// runs, and answered 401 rather than letting the program fail on the missing
// slot: credentials would change the outcome, and that is what a 401 says and
// a 500 does not. Read off the definition, where lowering recorded it, so the
// answer does not depend on reaching the program text.
function refuseAnonymousActor(
  request: OperationRequest,
  definition: OperationDefinition,
): void {
  if (!hasTransforms(definition) || !definition.readsActor || request.actor) {
    return;
  }
  throw new OperationFailure({
    id: targetId(request.target),
    status: 401,
    code: 'actor-required',
    title: 'Operation needs an identity',
    detail:
      `operation "${request.name}" reads the invoking actor, and this ` +
      `request authenticated nobody`,
  });
}

function transformContext(
  core: OperationCore,
  request: OperationRequest,
): TransformContext {
  return {
    name: request.name,
    realmConfig: () => core.realmConfig(),
    ...(request.actor ? { actor: request.actor } : {}),
    ...(request.params ? { params: request.params } : {}),
    ...(request.target.kind === 'instance' ? { id: request.target.url } : {}),
  };
}

// The `output` stage over what the behavior answered.
//
// A read is the only behavior that reaches this carrying a declaration today —
// `readSource` is resolved without one, a `query` is refused before it runs,
// and the writes are the coordinator's — so the two read shapes are the two
// arms. A headers-only read projects nothing and says that the full read
// would, because a `HEAD` states the headers a `GET` would send and a
// projected body is not cacheable the way an unprojected one is.
async function projectResult(
  core: OperationCore,
  request: OperationRequest,
  definition: OperationDefinition,
  result: OperationResult,
): Promise<OperationResult> {
  if (!definition.output) {
    return result;
  }
  if (isHeadResult(result)) {
    return { ...result, projected: true };
  }
  if (isDocumentResult(result)) {
    let projection = await runOutputTransform(
      definition,
      result.document,
      transformContext(core, request),
    );
    return {
      ...result,
      projected: true,
      document: asDocument(request, projection),
    };
  }
  throw new OperationFailure({
    id: targetId(request.target),
    status: 500,
    code: 'internal-error',
    title: 'Unprojectable result',
    detail:
      `operation "${request.name}" declares an \`output\`, and the ` +
      `"${definition.base}" behavior answered with something a projection ` +
      `has no defined meaning over`,
  });
}

// A read answers with a JSON:API document, and a projection of one has to
// remain one: the card+json response it is served in carries a `data` member
// and every client reads it. Held to the shape, not to the contents — what an
// author leaves out below `data` is the whole point of projecting.
function asDocument(
  request: OperationRequest,
  projection: unknown,
): SingleCardDocument | SingleFileMetaDocument {
  if (
    typeof projection !== 'object' ||
    projection === null ||
    Array.isArray(projection) ||
    typeof (projection as { data?: unknown }).data !== 'object' ||
    (projection as { data?: unknown }).data === null ||
    Array.isArray((projection as { data?: unknown }).data)
  ) {
    throw new OperationFailure({
      id: targetId(request.target),
      status: 400,
      code: 'invalid-params',
      title: 'Cannot run transform',
      detail:
        `the \`output\` stage of operation "${request.name}" projects a read, ` +
        `which answers a JSON:API document, and this program produced ` +
        `something with no \`data\` member`,
      meta: { operation: request.name, stage: 'output' },
    });
  }
  return projection as SingleCardDocument | SingleFileMetaDocument;
}

async function runBaseOperation(
  core: OperationCore,
  canonical: OperationRequest,
  definition: OperationDefinition,
  opts: RunOperationOptions,
  scope: OperationScope,
): Promise<OperationResult> {
  switch (definition.base) {
    case 'read':
      return await readOperation(core, canonical, definition, opts, scope);
    case 'readSource':
      // No definition and no scope: the operation is resolved without either,
      // and an executor that peeked a row would put back the index read
      // resolving it definition-free just took out.
      return await readSourceOperation(core, canonical, opts);
    case 'query':
      // A declared query is a saved search, not work the realm carries out
      // here: an invocation resolves its markers with `lowerQueryOperation`
      // and runs the result on the search engine, which is the one place a
      // query is planned and executed. Reaching this with a perfectly valid
      // declaration means the caller used the wrong entry point, so it is
      // theirs to correct rather than a fault to page someone about.
      throw new OperationFailure({
        id: targetId(canonical.target),
        status: 400,
        code: 'wrong-entry-point',
        title: 'Operation not executable here',
        detail:
          `operation "${canonical.name}" is a query; resolve it with ` +
          `lowerQueryOperation and run it on the search engine`,
      });
    case 'create':
    case 'update':
    case 'delete':
    case 'transform':
    case 'appendContainsMany':
    case 'appendLine':
      throw new OperationFailure({
        id: targetId(canonical.target),
        status: 501,
        code: 'internal-error',
        title: 'Operation not implemented',
        detail: `no executor for base operation "${definition.base}"`,
      });
    default:
      // Unreachable while `base` holds a base-operation name, which the
      // allow-table check above already required. Present because falling off
      // an exhaustive switch returns `undefined`, which is not an
      // `OperationResult` and which every result guard quietly reports false
      // for — a wrong answer is worse than a refusal.
      throw new OperationFailure({
        id: targetId(canonical.target),
        status: 500,
        code: 'internal-error',
        title: 'Unknown base operation',
        detail: `operation "${canonical.name}" names a base operation the core does not implement`,
      });
  }
}

// The payload has to satisfy the schema the definition declares before any
// behavior runs on it. A declared param with no value is the caller's mistake,
// and finding out inside an executor means finding out after work has started.
//
// Exported because the behaviors that write never reach `runOperation` — a
// batch stages them through the coordinator instead — and the check has to run
// on that path too. It cannot be left to the executors: they read the payload
// differently enough that some would never notice, and a `delete` reads none
// at all, so a declaration requiring one would be carried out over a card the
// caller had not said enough to remove.
export function assertParamsSupplied(
  definition: OperationDefinition,
  params: Record<string, unknown> | undefined,
  // What the refusal names: the operation as it was invoked, and the target
  // where there is one. Taken as data rather than as a request, since the two
  // callers hold the same facts in different shapes.
  invocation: { name: string; id?: string },
): void {
  for (let key of Object.keys(definition.params ?? {})) {
    if (own(params, key) === undefined) {
      throw new OperationFailure({
        ...(invocation.id ? { id: invocation.id } : {}),
        status: 400,
        code: 'invalid-params',
        title: 'Invalid params',
        detail: `operation "${invocation.name}" requires a value for params("${key}")`,
      });
    }
  }
}

function validateParams(
  request: OperationRequest,
  definition: OperationDefinition,
): void {
  let id = targetId(request.target);
  assertParamsSupplied(definition, request.params, {
    name: request.name,
    ...(id ? { id } : {}),
  });
}

// One `RealmPaths` per core. It is derived entirely from the realm URL, which
// does not change over a core's life, so rebuilding it on every operation
// would be pure waste on the hottest path the realm has.
const pathsByCore = new WeakMap<OperationCore, RealmPaths>();

export function pathsFor(core: OperationCore): RealmPaths {
  let paths = pathsByCore.get(core);
  if (!paths) {
    paths = new RealmPaths(new URL(core.realmURL));
    pathsByCore.set(core, paths);
  }
  return paths;
}

// The target as this realm addresses it. A card can be named with a trailing
// slash, a query string or a fragment, and the realm root names the realm's
// index card — none of those are a different card, and every one of them has to
// resolve to the same thing before anything reads it. A `.json` path is the
// exception and is left as written; see below.
//
// This runs once, in `runOperation`, and everything downstream sees the result:
// dispatch resolves the type from it, the row memo is keyed on it, and the
// executor reads it. Canonicalizing in only one of those places is worse than
// canonicalizing in none, because the two then disagree about which card the
// request names — the type is resolved for one card and the document assembled
// for another.
//
// Idempotent, and deliberately tolerant: a URL that does not parse, or that
// belongs to another realm, is returned untouched so the refusal for it comes
// from the code that has something to say about it.
export interface CanonicalizeOptions {
  // Whether the realm root names the realm's index card. It does for a read of
  // a card, which is what makes the root readable at all. It does not for a
  // read of stored bytes, which addresses a path: the root is the realm's
  // directory, so resolving it to `index` there would serve whatever file
  // happens to carry that bare name in answer to a request for a directory.
  // Defaults to true — a caller addressing paths says so.
  rootNamesIndexCard?: boolean;
}

export function canonicalizeTarget(
  core: OperationCore,
  target: OperationTarget,
  opts: CanonicalizeOptions = {},
): OperationTarget {
  if (target.kind !== 'instance') {
    return target;
  }
  let url = parseTargetURL(target.url);
  if (!url) {
    return target;
  }
  let paths = pathsFor(core);
  let localPath: LocalPath;
  try {
    localPath = paths.local(url);
  } catch {
    return target;
  }
  if (localPath === '' && (opts.rootNamesIndexCard ?? true)) {
    localPath = 'index' as LocalPath;
  }
  // A `.json` path is deliberately left alone. It names a card's stored source
  // rather than the card, and the stored bytes of an instance are a different
  // read from the instance itself — the `readSource` this spelling routes to.
  // Resolving it to the card instead would answer a question nobody asked, and
  // would be the one spelling where the extension test and the rest of the
  // core disagreed.
  //
  // Everything else here is common to both addressings: a trailing slash, a
  // query string and a fragment all name the thing they hang off, whether that
  // thing is a card or a file.
  let canonical = paths.fileURL(localPath).href;
  return canonical === target.url
    ? target
    : { kind: 'instance', url: canonical };
}

// The local path a target addresses within this core's realm. A target outside
// it is not this core's to serve, and says so as a missing target rather than
// as an internal failure.
export function localPathFor(core: OperationCore, url: URL): LocalPath {
  try {
    return pathsFor(core).local(url);
  } catch {
    throw new OperationFailure({
      id: url.href,
      status: 404,
      code: 'target-not-found',
      title: 'Not found',
      detail: `realm ${core.realmURL} does not contain ${url.href}`,
    });
  }
}

export function instanceTargetURL(request: OperationRequest): URL {
  let { target } = request;
  if (target.kind !== 'instance') {
    throw new OperationFailure({
      status: 400,
      code: 'invalid-params',
      title: 'Invalid target',
      detail: `operation "${request.name}" runs against an existing card, so it needs an instance target`,
    });
  }
  try {
    return new URL(target.url);
  } catch {
    throw new OperationFailure({
      id: target.url,
      status: 400,
      code: 'invalid-params',
      title: 'Invalid target',
      detail: `target "${target.url}" is not a URL`,
    });
  }
}

// A target this realm does not contain is refused here, before anything reads
// it: a foreign URL is not this core's to answer for, and peeking the index for
// one would be a read taken on a question already settled. A URL that does not
// parse is left alone — the executor has the better refusal for that.
function assertInRealm(core: OperationCore, target: OperationTarget): void {
  if (target.kind === 'type') {
    // A type target names the realm its operation is scoped to. Nothing reads
    // it here, but it is resolved against later, so an unparseable one is the
    // caller's mistake rather than something to throw out of a URL constructor
    // deeper in.
    if (!parseTargetURL(target.realm)) {
      throw new OperationFailure({
        status: 400,
        code: 'invalid-params',
        title: 'Invalid target',
        detail: `target realm "${target.realm}" is not a URL`,
      });
    }
    return;
  }
  let url = parseTargetURL(target.url);
  if (url) {
    localPathFor(core, url);
  }
}

// The type entry a target's operations are declared on. Undefined where it
// cannot be read — an unresolvable ref, an index row with no `adoptsFrom`, an
// unreachable module. Callers decide what that means for them.
async function definitionFor(
  core: OperationCore,
  target: OperationTarget,
  scope: OperationScope,
): Promise<Definition | undefined> {
  let codeRef: CodeRef | undefined;
  let relativeTo: URL;
  if (target.kind === 'type') {
    codeRef = target.codeRef;
    relativeTo = new URL(target.realm);
  } else {
    let url = parseTargetURL(target.url);
    if (!url) {
      return undefined;
    }
    relativeTo = url;
    // A file names its type by its extension; a card names its own in the
    // stored JSON the index holds. Either way the type's entry is what carries
    // the declarations, so a `read` declared on a file def subclass resolves
    // the same as one declared on a card.
    codeRef = urlNamesFile(url)
      ? core.fileDefCodeRef(url)
      : await adoptsFromOf(scope, url);
  }
  if (!codeRef) {
    return undefined;
  }
  let resolved = core.resolveCodeRef(codeRef, relativeTo);
  if (!resolved) {
    return undefined;
  }
  try {
    return await core.definitionLookup.lookupDefinition(resolved);
  } catch {
    return undefined;
  }
}

// The type a stored card names, read off the index row rather than the source
// file: the row is the realm's canonical view and the peek costs no link
// expansion.
async function adoptsFromOf(
  scope: OperationScope,
  url: URL,
): Promise<CodeRef | undefined> {
  let row = await scope.peekInstance(url);
  if (row?.type !== 'instance') {
    return undefined;
  }
  return row.instance.meta?.adoptsFrom;
}

// The target's kind as far as the target itself can say, for a behavior that
// will not read a definition to find out. An instance target's kind never
// needed one — it comes from the URL — so the only answer lost is a type
// target's, which is `undefined` here rather than guessed. That is the whole
// answer for a stored-bytes read: a type has no stored bytes, so it carries no
// operation that serves them, and saying so does not depend on which kind of
// def the type turns out to be. A `FieldDef` type refuses for that reason and
// not because a field def carries nothing.
function definitionFreeKind(target: OperationTarget): DefKind | undefined {
  return target.kind === 'instance' ? defKindFor(target, undefined) : undefined;
}

function defKindFor(
  target: OperationTarget,
  definition: Definition | undefined,
): DefKind {
  if (target.kind === 'instance') {
    // Anything addressable by URL that is not a file is a card. Fields have no
    // URL, so an instance target can never be one, and a card whose type entry
    // is unreadable is still a card — which is what keeps a broken module's
    // cards readable.
    let url = parseTargetURL(target.url);
    return url && urlNamesFile(url) ? 'file-def' : 'card-def';
  }
  // A type target has nothing but its ref to go on, so an entry that cannot be
  // read leaves the kind genuinely unknown. That is reported where the ref is
  // resolved rather than being read as a field def here.
  return definition!.type;
}

function parseTargetURL(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function notAllowed(
  target: OperationTarget,
  name: string,
  // Absent only for a type target reached by a behavior that reads no
  // definition, and unread in that case: the message below takes a type
  // target's own terms instead.
  kind: DefKind | undefined,
  base: BaseOperation,
): OperationFailure {
  // A type target's kind is inferred from an entry that cannot say `file-def`,
  // so naming the kind there would report a file def as a field def. The
  // target's own terms are accurate either way.
  let because =
    target.kind === 'instance' && kind
      ? `a ${kind} allows ${describeAllowed(kind, target)}`
      : `a "${base}" runs against an instance, and a type is not one`;
  return new OperationFailure({
    id: targetId(target),
    status: 405,
    code: 'operation-not-allowed',
    title: 'Operation not allowed',
    detail:
      `operation "${name}" is a "${base}", which ${describeTarget(target)} ` +
      `does not carry: ${because}`,
  });
}

function describeAllowed(kind: DefKind, target: OperationTarget): string {
  // Asked through `carries` rather than read off the table, so a refusal lists
  // what this target actually carries — which for an instance target includes
  // the file writes the table admits on top of its kind.
  let allowed = (Object.keys(ALL_BASE_OPERATIONS) as BaseOperation[]).filter(
    (base) => carries(target, kind, base),
  );
  return allowed.length > 0 ? allowed.join(', ') : 'no operations';
}

function describeTarget(target: OperationTarget): string {
  return target.kind === 'instance'
    ? target.url
    : JSON.stringify(target.codeRef);
}

function targetId(target: OperationTarget): string | undefined {
  return target.kind === 'instance' ? target.url : undefined;
}

function describeIssues(definition: OperationDefinition): string {
  let issues = definition.issues ?? [];
  if (issues.length === 0) {
    return 'no findings were recorded';
  }
  return issues
    .map((issue) => `${issue.code} at ${issue.path} — ${issue.message}`)
    .join('; ');
}
