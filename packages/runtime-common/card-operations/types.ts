import type { Readable } from 'stream';
import type { CodeRef } from '../code-ref.ts';
import type { ScreenshotManifest } from '../capture-spec.ts';
import type {
  SingleCardDocument,
  SingleFileMetaDocument,
} from '../document-types.ts';
import type {
  SearchEntryWireFilter,
  SearchEntryWireQuery,
} from '../search-entry.ts';
import type { BaseOperationName } from '@cardstack/base/operations';

// ============================================================================
// The lowered form of a card's `@operation` declarations.
//
// A declaration as an author writes it references JavaScript — `StringField`
// the class, `ClassroomActivity` the class, `params('body')` the marker — and
// spells its work in convenience clauses. Lowering translates that into the
// plain JSON below: classes become code refs, the clauses become one
// canonical BXL program, and the query becomes an entry-wire query template.
//
// The realm executes an operation from this form alone. It is stored in the
// `operations` member of a type's definition-cache entry, which is reachable
// from a card's `adoptsFrom` without loading the card's module — the whole
// point of the shape, since card modules are author-written and the realm is
// a trusted context.
// ============================================================================

// What the caller must send, keyed by param name. `field` is a scalar the
// named field class serializes; `link` is a card identity — the URL of a
// saved card, or the `lid` of one being created in the same atomic batch.
export type OperationParamDefinition =
  | { kind: 'field'; codeRef: CodeRef }
  | { kind: 'link'; codeRef: CodeRef };

// BXL as lowering emits it: already canonical, so a consumer parses it with
// `syntax: 'solidified'` and no readable-syntax schema. Author programs are
// canonicalized on the way in, so one program shape reaches the realm
// whichever spelling produced it.
export interface OperationProgram {
  source: string;
  syntax: 'solidified';
}

// A JSON tree that still carries typed-reference markers where an invocation
// supplies the value — `{ $ref: 'params', key: 'body' }` and friends, exactly
// as the declaration wrote them. Substituting them is the invocation's job:
// only then are the payload and the actor known.
export type OperationTemplate =
  | string
  | number
  | boolean
  | null
  | OperationTemplate[]
  | { [key: string]: OperationTemplate };

// A `SearchEntryWireQuery` with the value slots an invocation fills still
// holding their markers. Defined against the realm's own wire types rather
// than restated, so a change to the search grammar reaches a declared query
// too; the only relaxation is where a marker can legally stand — a full-text
// term, and the values inside the field-keyed operators, which the wire
// grammar already types as `unknown`.
export interface OperationQueryTemplate extends Omit<
  SearchEntryWireQuery,
  'filter'
> {
  filter?: OperationQueryFilterTemplate;
}

export type OperationQueryFilterTemplate = Omit<
  SearchEntryWireFilter,
  'any' | 'every' | 'not' | 'matches'
> & {
  any?: OperationQueryFilterTemplate[];
  every?: OperationQueryFilterTemplate[];
  not?: OperationQueryFilterTemplate;
  matches?: string | OperationTemplate;
};

export interface OperationDefinition {
  // The built-in behavior that carries this operation out. The name the
  // operation is invoked under is the key it is stored under, and the two are
  // read separately: a `delete` built on `transform` is a soft delete.
  base: BaseOperationName;
  params?: Record<string, OperationParamDefinition>;
  // The transformation stage — the clauses and any raw program, lowered to a
  // single BXL mutation program.
  program?: OperationProgram;
  // Whether the program needs the target's values gathered before it runs.
  // A program reads the target's stored document, which holds neither a
  // computed value nor a linked card's fields, so an assertion over one is
  // only checkable against a snapshot. Gathering costs reads, so it is never
  // inferred: this is set only where a declaration asked for it with
  // `assert: { snapshot: true }` over a path that actually needs it.
  snapshot?: true;
  // The raw program's payload-shaping stage, and its result projection.
  input?: OperationProgram;
  output?: OperationProgram;
  // The type a `create` mints.
  of?: CodeRef;
  // The attributes a named `create` stages, as a marker-carrying template
  // rather than a program: the coordinator resolves it by substitution, and a
  // link-typed param's value becomes a relationship.
  fill?: Record<string, OperationTemplate>;
  // A saved search, as an entry-wire query whose value slots may still hold
  // markers.
  query?: OperationQueryTemplate;
  // The author's override of the client's optimistic eligibility.
  optimistic?: boolean;
  // Whether every program this operation runs yields the same result for the
  // same input. A volatile call (`NOW`, `TODAY`, `RAND`, `RANDBETWEEN`,
  // `ISAFTER`, `ISBEFORE`) is what makes one false; `params()`, `actor()` and
  // `instance()` do not, since they are fixed for a given request. The
  // client's optimistic ledger only applies a program locally when this
  // holds — a non-deterministic one would land a different value locally than
  // the server computes, and reconciliation would report a phantom conflict.
  deterministic: boolean;
  // Set when lowering found problems. The operation is stored either way, so
  // invoking it reports what is wrong with it rather than "unknown
  // operation".
  invalid?: true;
  issues?: OperationLoweringIssue[];
}

export type OperationLoweringIssueCode =
  // A clause names a field the type does not have.
  | 'unknown-field'
  // A clause appends to, or asserts uniqueness over, a field that holds one
  // value rather than a collection.
  | 'not-a-collection'
  // `params('x')` for a key the `params` schema does not declare.
  | 'undeclared-param'
  // A write into a computed field. Its value comes from its `computeVia`, so
  // a write would be overwritten by the next read.
  | 'computed-write'
  // A write into a field nothing may write: one whose value is resolved by a
  // `query`, or the card's own `id`.
  | 'read-only-write'
  // A `set` that would replace a whole link collection. A relationship
  // collection is changed one edge at a time, so this is `append`'s job.
  | 'link-collection-replace'
  // A dotted path that crosses a collection. Which item it means is not
  // something a declaration can say, so the path addresses nothing.
  | 'path-crosses-collection'
  // A value in a link position that is not a card identity. A link holds the
  // identity of a card — a URL, or a marker resolving to one — and the
  // executor requires that for a relationship write, so anything else would
  // fail on every invocation. It also covers the comparison side: a value
  // that is not an identity can never equal one, so an `assert` over a link
  // collection would hold for every item and guard nothing.
  | 'link-requires-identity'
  // A write whose path crosses a `linksTo` / `linksToMany`. An operation
  // binds only to the target card's own stored values; the linked card is a
  // separate document with its own operations.
  | 'write-through-link'
  // A read that crosses a link not marked `searchable`. Those values are not
  // available to an operation, so the read yields nothing.
  | 'unsearchable-read'
  // An `assert` over a computed or linked path that did not declare
  // `{ snapshot: true }`. The program reads the target's stored document,
  // which holds neither a computed value nor a linked card's fields, so the
  // assertion needs the author to ask for the values to be gathered first.
  | 'unsnapshotted-assert'
  // A class reference that no module exports under a name, so there is no
  // code ref to store.
  | 'unresolved-type'
  // A raw BXL program that does not parse.
  | 'invalid-program'
  // A declared query the realm's own query grammar refuses.
  | 'invalid-query';

// A problem found while lowering one operation. Recorded, never thrown:
// definition build is decoupled in time from the edit that introduced the
// problem, so a throw would fail the whole module's definitions over one bad
// declaration and surface at a confusing moment.
export interface OperationLoweringIssue {
  code: OperationLoweringIssueCode;
  // The operation the problem is in.
  operation: string;
  // Where in the declaration, as a dotted path — `append.to`, `set.status`,
  // `query.filter`.
  path: string;
  message: string;
}

export interface LowerOperationDeclarationsResult {
  operations: Record<string, OperationDefinition>;
  // Every issue across every operation, in the order they were found. The
  // same issues are on the operations that carry them; this is the flat view
  // a module's diagnostics are built from.
  issues: OperationLoweringIssue[];
}

// ============================================================================
// Invoking an operation.
//
// Everything above describes an operation as it is *stored*. What follows
// describes one being *run*: what a caller names, what comes back, and how a
// refusal is spelled. The two are separate on purpose — a stored definition is
// built once when a module is indexed, while a request carries the actor and
// the payload, which are known only at invocation.
// ============================================================================

// The built-in behaviors, under the operation runtime's own name. The
// authoring API owns the list because that is where a declaration names one;
// re-stating it here lets a consumer of the runtime types stay clear of the
// card authoring surface, which only loads inside a card module.
export type BaseOperation = BaseOperationName;

// What an operation runs against. An `instance` target is an existing card or
// file, addressed by URL — the identity of a thing that already has stored
// state. A `type` target names a class instead, for the operations that have
// no instance to bind to yet: a plain `create` mints a card of that type in
// that realm, and a `query` is rooted in the type it searches for.
//
// `url` is an absolute, unmapped URL. A result's ids are canonicalized to
// registered-prefix form on the way out (`@cardstack/skills/foo`), so an id
// read off one response is not usable as the next request's target without
// resolving it back — which the caller does, since resolving a prefix is the
// realm's own fetch-layer concern and no operation reaches that.
export type OperationTarget =
  | { kind: 'instance'; url: string }
  | { kind: 'type'; codeRef: CodeRef; realm: string };

export interface OperationRequest {
  target: OperationTarget;
  // The name the operation is invoked under — a declared name, or a base name
  // for the built-in behavior. Never `base`: a `delete` built on `transform`
  // is invoked as `delete`.
  name: string;
  // The payload, keyed the way the definition's `params` schema declares it.
  params?: Record<string, unknown>;
  // The invoking user, as the identity `actor()` resolves to.
  actor: string;
  // The caller's own id for this request. Echoed on the realm's index event so
  // a client can tell its own write's event from anyone else's, which is what
  // lets it retire the matching optimistic entry rather than reloading.
  clientRequestId: string;
  // The version the caller believes it is writing on top of. Absent means an
  // unconditional write; present makes the write conditional, and the result's
  // `baseMatched` reports whether the target was still at that version.
  baseVersion?: string;
}

// A read's answer: the assembled JSON:API document, exactly as the card+json
// GET serves it.
export interface OperationDocumentResult {
  document: SingleCardDocument | SingleFileMetaDocument;
}

// A headers-only read's answer. These are the values the card+json response
// headers are computed from — the validator, the modification time, and the
// index-data generation and screenshot manifest that go into it. No body is
// assembled to produce them.
export interface OperationHeadResult {
  indexedAt: number | null;
  lastModified: number | null;
  generation: number | null;
  screenshots: ScreenshotManifest | null;
  // The target's index-row dependencies. Carried because a validator is only
  // safe when none of them live in another realm: cross-realm invalidation
  // does not cascade `indexed_at`, so a stable local one does not mean the
  // assembled `included[]` is current, and a caller that emitted an ETag
  // anyway would serve a 304 against stale foreign content. Whoever computes
  // the headers makes that call, so they need what it rests on.
  deps: string[] | null;
}

// The stored bytes of a resource, and what the byte-serve headers are computed
// from. This is the representation the source and byte-serve routes answer
// with: a card instance's `.json`, a module's text, an image's bytes — the
// resource exactly as it sits on disk, with no assembly and no index read
// behind it.
export interface OperationSourceResult {
  // Inferred from the path's extension by `inferContentType`, which is what
  // both byte routes infer theirs with. A path with no extension the platform
  // knows resolves to `application/octet-stream`, the byte-preserving
  // default.
  contentType: string;
  lastModified: number;
  // When the realm first saw this path, in epoch seconds, and null where it
  // holds no record of it — a file written outside the realm's own write path,
  // say. The byte serve omits `x-created` in that case rather than
  // substituting the modification time, so this reports the absence rather
  // than filling it in.
  created: number | null;
  // The content hash of the stored bytes — the same identity the rest of the
  // project calls `version`. It identifies these bytes and no others, which is
  // what a validator needs, but it is not by itself the byte routes' `ETag`:
  // the source route builds one from a content hash for a `.json` or an
  // executable extension and from `lastModified` for everything else, so a
  // facade reproducing those validators chooses between the two. Null only
  // where the realm can neither recall nor compute a hash.
  version: string | null;
  // The byte size, where the adapter knew it from the stat it already
  // performed, and absent where knowing it would cost reading the bytes. A
  // facade needs it for `Content-Length` and to decide whether it can offer a
  // `Range` at all. The bounded-read capability itself does not travel here —
  // it is a function on the adapter's handle — so a facade serving 206s reads
  // from the handle rather than from this result.
  size?: number;
  // The bytes. Absent in the headers-only mode, which is the whole difference
  // between the two: a `HEAD` reports the metadata above and would discard
  // this. Whatever form the realm's file adapter produced — a string, a byte
  // array, or an unread stream — so a caller hands it to a response body
  // rather than materializing it.
  //
  // The metadata above describes the handle as it opened; the bytes are read
  // from it afterwards. A write landing in between pairs one with the other,
  // the same way it does for a byte route reading the same handle.
  body?: OperationSourceBody;
}

export type OperationSourceBody =
  | string
  | Uint8Array
  | ReadableStream<Uint8Array>
  | Readable;

// A write's answer: the identity of what was written and the version it now
// holds, without reprinting the document. A caller that wants the new state
// reads it; a caller that wrote it already has it, and the common case is a
// client reconciling its own optimistic entry, which needs the version and
// nothing else.
export interface OperationIdentityResult {
  id: string;
  meta: {
    // The token a later request passes as `baseVersion`.
    version: string;
    generation: number | null;
    lastModified: number | null;
    // Present only on a conditional write: whether the target was still at
    // the `baseVersion` the request named. A false here is not an error — the
    // write happened, and the caller decides what a moved base means.
    baseMatched?: boolean;
  };
}

// A `delete` answers with `null`: there is no state left to describe.
export type OperationResult =
  | OperationDocumentResult
  | OperationHeadResult
  | OperationIdentityResult
  | OperationSourceResult
  | null;

export function isDocumentResult(
  result: OperationResult,
): result is OperationDocumentResult {
  return result != null && 'document' in result;
}

export function isHeadResult(
  result: OperationResult,
): result is OperationHeadResult {
  return result != null && 'indexedAt' in result;
}

export function isIdentityResult(
  result: OperationResult,
): result is OperationIdentityResult {
  return result != null && 'id' in result;
}

// Keyed on `contentType` rather than on `body`, which the headers-only mode
// leaves out: a guard that read the body would report false for exactly the
// result a `HEAD` asks for.
export function isSourceResult(
  result: OperationResult,
): result is OperationSourceResult {
  return result != null && 'contentType' in result;
}

export type OperationErrorCode =
  // No operation of that name, and the name is not a base operation the
  // target's def type carries.
  | 'unknown-operation'
  // The name resolves to a behavior the target's def type does not carry — a
  // `transform` on a file, anything at all on a field.
  | 'operation-not-allowed'
  // The stored definition is flagged `invalid`: lowering recorded findings
  // against the declaration, so there is an operation by that name but no
  // runnable form of it. Distinct from `unknown-operation` so an author sees
  // what is wrong with the declaration rather than being told it does not
  // exist.
  | 'invalid-operation'
  // The payload does not satisfy the definition's `params` schema, or a
  // marker in the operation references something this invocation cannot
  // supply.
  | 'invalid-params'
  // Nothing at the target's URL.
  | 'target-not-found'
  // The target's source file is on disk but the realm has not indexed it yet.
  // Separate from `target-not-found` because waiting resolves it: the write
  // landed and the index row is coming.
  | 'target-not-indexed'
  // The target exists but its index row is an error row, so there is no clean
  // state to work from. The row's own HTTP status carries through, which is
  // why this is distinct from `internal-error`: a recorded 403 is the caller's
  // to act on, not the realm's.
  | 'target-errored'
  // A precondition the operation's program asserts did not hold.
  | 'assertion-failed'
  // The request named a `baseVersion` the target is no longer at, on an
  // operation that requires the base to match.
  | 'version-conflict'
  // The operation is sound but is not carried out here. A `query` is the case:
  // it is planned and run on the search engine, so reaching the operation core
  // with one means the caller used the wrong entry point.
  | 'wrong-entry-point'
  // The operation could not be carried out for a reason that is not the
  // caller's — an unreadable definition, an errored index row, a failure
  // inside the executor.
  | 'internal-error';

// A refusal, shaped like a JSON:API error object so an HTTP surface can put it
// straight into an `errors` array. `status` is the number the realm's own
// error bodies carry rather than JSON:API's string, so the two agree.
export interface OperationError {
  // The target the operation ran against, where there was one.
  id?: string;
  status: number;
  code: OperationErrorCode;
  title: string;
  detail: string;
  meta?: Record<string, unknown>;
}

// How a refusal travels. Thrown rather than returned: a batch of operations is
// all-or-nothing, so the first refusal has to abandon the rest, and an
// exception is what unwinds the work already staged.
export class OperationFailure extends Error {
  readonly error: OperationError;

  constructor(error: OperationError) {
    super(`${error.code}: ${error.detail}`);
    this.name = 'OperationFailure';
    this.error = error;
  }
}

export function isOperationFailure(err: unknown): err is OperationFailure {
  return err instanceof OperationFailure;
}
