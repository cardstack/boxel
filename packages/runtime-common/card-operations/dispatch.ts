import { RealmPaths, type LocalPath } from '../paths.ts';
import { urlNamesFile } from '../file-def-code-ref.ts';
import { readOperation } from './read.ts';
import {
  OperationFailure,
  type BaseOperation,
  type OperationDefinition,
  type OperationResult,
  type OperationRequest,
  type OperationTarget,
} from './types.ts';
import type { CodeRef, ResolvedCodeRef } from '../code-ref.ts';
import type { Definition } from '../definitions.ts';
import type { SingleFileMetaDocument } from '../document-types.ts';
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
// and, more importantly, so it cannot reach the realm's fetch layer: a
// `VirtualNetwork` resolves author-controlled identifiers, and none of that
// belongs behind an operation. Where a behavior does need a resolution the
// realm owns, the realm supplies it as a plain function below.
export interface OperationCore {
  // The realm every target of this core belongs to. Local paths are derived
  // from it, so a target outside it is not this core's to serve.
  realmURL: string;
  definitionLookup: OperationDefinitionLookup;
  indexQueryEngine: OperationIndexQueryEngine;
  // The target's source file as stored on disk, by local path. The index is
  // what a read serves, so this is how a behavior distinguishes "no such card"
  // from "the write landed and the index row is still coming".
  readSource(localPath: LocalPath): Promise<string | undefined>;
  // Whether the realm's ignore rules exclude this URL. An ignored path is
  // never visited, so no amount of waiting produces an index row for it.
  isIgnored(url: URL): Promise<boolean>;
  // The file-meta document for a path that holds bytes rather than a card,
  // preferring the indexed row and falling back to the file on disk — a file's
  // read is its metadata surface, so it answers with everything the row
  // carries. Undefined when the path is not a servable file, including when a
  // sibling `.json` makes it a card's source rather than a file.
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
  // Rewrite a document's instance ids into canonical prefix form, in place.
  // The mapping lives in the realm's fetch layer, so this arrives as a bound
  // function for the same reason `resolveCodeRef` does.
  unresolveInstanceIds(doc: {
    data: LooseCardResource | FileMetaResource;
    included?: (LooseCardResource | FileMetaResource)[];
  }): void;
  fetch: typeof globalThis.fetch;
}

// `CachingDefinitionLookup`, narrowed to the one read an operation makes.
export interface OperationDefinitionLookup {
  lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition | undefined>;
}

// `RealmIndexQueryEngine`, narrowed to the reads an operation makes.
export interface OperationIndexQueryEngine {
  cardDocument(
    url: URL,
    opts?: { loadLinks?: boolean },
  ): Promise<SearchResult | undefined>;
  instance(
    url: URL,
    opts?: { includeErrors?: true },
  ): Promise<InstanceOrError | undefined>;
  file(url: URL): Promise<IndexedFile | undefined>;
}

export interface RunOperationOptions {
  // A `read` that needs only the values the card+json response headers are
  // computed from, and no document. Ignored by every other behavior.
  headersOnly?: true;
}

// One request's memo of the index-row peek. Dispatch reads a target's row to
// learn its type, and a behavior often wants the same row — a headers-only
// read wants nothing else. Both go through here so one invocation costs one
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

// The def types, as the operation core distinguishes them. `Definition.type`
// draws only the card/field line, because that is the line every other
// consumer of a definition entry cares about — a file def's entry says
// `field-def`, since `FileDef` descends from `BaseDef` rather than `CardDef`.
// The distinction that matters here is drawn from the target instead, which is
// also the more reliable signal: a URL naming a registered file extension is
// the same test the realm's own read paths use to tell a file from a card.
type DefKind = 'card-def' | 'file-def' | 'field-def';

// Exhaustive over `BaseOperation` on purpose: a seventh built-in behavior has
// to say here whether a card carries it, rather than defaulting to "no".
const CARD_DEF_OPERATIONS: Readonly<Record<BaseOperation, true>> = {
  read: true,
  create: true,
  update: true,
  delete: true,
  query: true,
  transform: true,
};

const ALLOWED_BASE_OPERATIONS: Readonly<
  Record<DefKind, Partial<Record<BaseOperation, true>>>
> = {
  'card-def': CARD_DEF_OPERATIONS,
  // A file's metadata is derived from its bytes and read-only: there is no
  // JSON:API mutation surface for anything else to reach.
  'file-def': { read: true },
  // A field's instances have no URL, so nothing is invocable on one. Field
  // data is reached through the operations of the card that contains it.
  'field-def': {},
};

function isBaseOperation(name: string): name is BaseOperation {
  return Object.prototype.hasOwnProperty.call(CARD_DEF_OPERATIONS, name);
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
  let declared = definition?.operations?.[name];
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
    if (!ALLOWED_BASE_OPERATIONS[kind][declared.base]) {
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
  if (!ALLOWED_BASE_OPERATIONS[kind][name]) {
    throw notAllowed(target, name, kind, name);
  }
  // The built-in behavior, undeclared. It has no program and no params, and
  // its result is fixed by the behavior itself, so it is deterministic by
  // construction.
  return { base: name, deterministic: true };
}

export async function runOperation(
  core: OperationCore,
  request: OperationRequest,
  opts: RunOperationOptions = {},
): Promise<OperationResult> {
  let scope = newOperationScope(core);
  let definition = await resolveOperation(
    core,
    request.target,
    request.name,
    scope,
  );
  switch (definition.base) {
    case 'read':
      return await readOperation(core, request, definition, opts, scope);
    case 'query':
      // A declared query is a saved search, not work the realm carries out
      // here: an invocation resolves its markers with `lowerQueryOperation`
      // and runs the result on the search engine, which is the one place a
      // query is planned and executed.
      throw new OperationFailure({
        id: targetId(request.target),
        status: 500,
        code: 'internal-error',
        title: 'Operation not executable here',
        detail:
          `operation "${request.name}" is a query; resolve it with ` +
          `lowerQueryOperation and run it on the search engine`,
      });
    case 'create':
    case 'update':
    case 'delete':
    case 'transform':
      throw new OperationFailure({
        id: targetId(request.target),
        status: 500,
        code: 'internal-error',
        title: 'Operation not executable here',
        detail: `no executor for base operation "${definition.base}"`,
      });
  }
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
    if (!url || urlNamesFile(url)) {
      // A file's type is derived from its extension and declares no
      // operations, so there is nothing to look up.
      return undefined;
    }
    relativeTo = url;
    codeRef = await adoptsFromOf(scope, url);
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
  kind: DefKind,
  base: BaseOperation,
): OperationFailure {
  return new OperationFailure({
    id: targetId(target),
    status: 405,
    code: 'operation-not-allowed',
    title: 'Operation not allowed',
    detail:
      `operation "${name}" is a "${base}", which ${describeTarget(target)} ` +
      `does not carry: a ${kind} allows ${describeAllowed(kind)}`,
  });
}

function describeAllowed(kind: DefKind): string {
  let allowed = Object.keys(ALLOWED_BASE_OPERATIONS[kind]);
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
