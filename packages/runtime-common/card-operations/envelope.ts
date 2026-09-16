import { BOXEL_OPERATIONS_EXT } from '../supported-mime-type.ts';
import { RealmPaths, type LocalPath } from '../paths.ts';
import { callsActor } from './bxl-emit.ts';
import {
  OperationFailure,
  isDocumentResult,
  isOperationFailure,
  type BaseOperation,
  type OperationDefinition,
  type OperationError,
  type OperationResult,
  type OperationTarget,
  type OperationTemplate,
} from './types.ts';
import type { BatchEntryResult } from './coordinator.ts';
import type { BatchEntry } from './executors.ts';
import type { CodeRef } from '../code-ref.ts';
import type { CardResource } from '../resource-types.ts';

// ============================================================================
// The operations envelope: reading a batch off the wire, and writing its
// answer back.
//
// Everything here is text and plain data — a request body in, entries and
// results out. It resolves no identifier, reads no file and consults no index,
// which is what keeps it runnable wherever the operation core runs and lets it
// be tested without a realm. The two questions it cannot answer are asked by
// whoever calls it: which behavior each entry's name resolves to (the target's
// definition decides that) and whether the batch commits.
//
// The entry vocabulary is deliberately a discriminated union on `op` with one
// member. `invoke` names an operation to run; the extension also defines group
// verbs whose members are batches in their own right, and they are read here
// as verbs this endpoint does not carry rather than as malformed entries, so
// adding one is a new arm rather than a reshaping of this parse.
// ============================================================================

// A JSON:API media type carries its extensions in the `ext` parameter, as a
// space-separated list of URIs. The router matches the one spelling the
// envelope is sent under; this reads the parameter itself, so a body sent as
// plain `application/vnd.api+json` — the near miss a client makes — is told
// what it is missing instead of falling through to a route that does not
// exist.
export function carriesOperationsExt(contentType: string | null): boolean {
  if (!contentType) {
    return false;
  }
  let [mediaType, ...parameters] = contentType.split(';');
  if (mediaType.trim().toLowerCase() !== 'application/vnd.api+json') {
    return false;
  }
  for (let parameter of parameters) {
    let separator = parameter.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (parameter.slice(0, separator).trim().toLowerCase() !== 'ext') {
      continue;
    }
    let value = parameter.slice(separator + 1).trim();
    // Quoted in every spelling that carries more than one URI, since the
    // separator between them is a space.
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (value.split(/\s+/).includes(BOXEL_OPERATIONS_EXT)) {
      return true;
    }
  }
  return false;
}

// One `invoke` entry, with the parts the wire spells resolved into the terms
// the core takes: an `href` that has been resolved against this realm and
// found to be inside it, and the local id read out of the payload.
export interface EnvelopeEntry {
  // Where the entry sat in the batch. Every refusal is labelled with it, so a
  // caller reading one error knows which of the entries it sent produced it.
  index: number;
  name: string;
  // Absolute, and inside this realm. Absent on an entry that names no existing
  // resource, which is a create of a card that does not exist yet.
  href?: string;
  data?: Record<string, unknown>;
  // The caller's own id for a card this batch mints, read from `data.lid` —
  // the resource-level member JSON:API already reserves for exactly this, and
  // the key later entries link to the new card by.
  lid?: string;
}

// The request body, read as a batch.
//
// An empty list is a batch that asks for nothing, and it is carried out as
// one: the coordinator takes no lock and announces nothing for it, so the
// envelope answers with no results rather than inventing a refusal for a
// request that would change nothing either way.
export function parseOperationsEnvelope(
  body: unknown,
  realmURL: string,
): EnvelopeEntry[] {
  if (!isPlainRecord(body)) {
    throw refuse(`the request body is not a JSON:API document`);
  }
  let operations = body['boxel:operations'];
  if (!Array.isArray(operations)) {
    throw refuse(
      `the request body carries no "boxel:operations" list of operations`,
    );
  }
  let paths = new RealmPaths(new URL(realmURL));
  return operations.map((operation, index) =>
    parseEntry(operation, index, paths),
  );
}

function parseEntry(
  operation: unknown,
  index: number,
  paths: RealmPaths,
): EnvelopeEntry {
  if (!isPlainRecord(operation)) {
    throw refuse(`entry ${index} is not an operation`, index);
  }
  let op = operation.op;
  switch (op) {
    case 'invoke':
      return parseInvocation(operation, index, paths);
    case 'parallel':
    case 'serial':
      throw refuse(
        `entry ${index} is a "${op}" group, and this endpoint carries ` +
          `"invoke" entries`,
        index,
      );
    default:
      throw refuse(
        `entry ${index} names ${
          typeof op === 'string' ? `operation "${op}"` : 'no operation'
        }, and an entry in this envelope is an "invoke"`,
        index,
      );
  }
}

function parseInvocation(
  operation: Record<string, unknown>,
  index: number,
  paths: RealmPaths,
): EnvelopeEntry {
  let name = operation['boxel:name'];
  if (typeof name !== 'string' || name.length === 0) {
    throw refuse(
      `entry ${index} carries no "boxel:name" naming the operation to invoke`,
      index,
    );
  }
  let data: Record<string, unknown> | undefined;
  if (operation.data !== undefined) {
    if (!isPlainRecord(operation.data)) {
      throw refuse(
        `entry ${index} carries a "data" that is not an object`,
        index,
      );
    }
    data = operation.data;
  }
  let lid = data?.lid;
  if (lid !== undefined && typeof lid !== 'string') {
    throw refuse(
      `entry ${index} carries a local id that is not a string`,
      index,
    );
  }
  return {
    index,
    name,
    ...(operation.href === undefined
      ? {}
      : { href: hrefIn(operation.href, index, paths) }),
    ...(data ? { data } : {}),
    ...(lid === undefined ? {} : { lid }),
  };
}

// An entry's `href` as an absolute URL inside this realm.
//
// The endpoint is realm-scoped, so a relative href is relative to the realm
// rather than to its origin: `/reports/x` under a realm mounted at
// `https://…/my-realm/` is that realm's `reports/x`, not the server's. Both
// spellings are resolved through the realm's own path helper, so the one URL
// the entry ends up naming is the one the realm addresses it by.
//
// A batch commits under one realm's write lock, so an href resolving outside
// this realm is not something the endpoint can carry out rather than something
// it declines to: there is no lock it could take that would make the write
// atomic with the rest of the batch.
function hrefIn(href: unknown, index: number, paths: RealmPaths): string {
  if (typeof href !== 'string' || href.length === 0) {
    throw refuse(`entry ${index} carries an "href" that is not a URL`, index);
  }
  let absolute: URL;
  try {
    absolute = new URL(href);
  } catch {
    // Relative, so it names a path within the realm. A leading slash is the
    // spelling the extension documents and means the realm's root, not the
    // origin's, which is why this resolves through `fileURL` rather than
    // through URL resolution against the realm.
    try {
      absolute = paths.fileURL(href.replace(/^\/+/, '') as LocalPath);
    } catch {
      throw refuse(`entry ${index} carries an "href" that is not a URL`, index);
    }
  }
  try {
    paths.local(absolute);
  } catch {
    throw refuse(
      `entry ${index} targets ${absolute.href}, which realm ${paths.url} does ` +
        `not contain; a batch commits to one realm`,
      index,
      absolute.href,
    );
  }
  return absolute.href;
}

// What the entry runs against. An entry naming an href targets that resource;
// one naming none is creating a card that does not exist yet, and names the
// type it mints the same way a card's stored JSON names its own.
export function targetFor(
  entry: EnvelopeEntry,
  realmURL: string,
): OperationTarget {
  if (entry.href !== undefined) {
    return { kind: 'instance', url: entry.href };
  }
  let adoptsFrom = asRecord(asRecord(entry.data?.meta)?.adoptsFrom);
  if (!adoptsFrom) {
    throw refuse(
      `entry ${entry.index} names no "href" and no type in ` +
        `"data.meta.adoptsFrom", so there is nothing for it to run against`,
      entry.index,
    );
  }
  return {
    kind: 'type',
    codeRef: adoptsFrom as unknown as CodeRef,
    realm: realmURL,
  };
}

// The behaviors that change stored state, which is what decides the permission
// the request needed and therefore which method may carry the batch.
//
// Exhaustive over the base operations on purpose: a further behavior has to
// say here whether it writes, rather than defaulting to "read" and reaching a
// commit from a request that was only authorized to read.
const WRITES: Readonly<Record<BaseOperation, boolean>> = {
  read: false,
  readSource: false,
  query: false,
  create: true,
  update: true,
  delete: true,
  transform: true,
  appendContainsMany: true,
  appendLine: true,
};

export function isWrite(base: BaseOperation): boolean {
  return WRITES[base];
}

// The two behaviors that are reached somewhere other than here.
//
// Both are refusals about the entry point rather than about the operation: a
// query is planned and run on the search engine, and stored bytes are served
// by the source and byte routes. Neither has a representation in a JSON batch
// — one answers a collection and the other answers bytes — so an entry naming
// either is told where it belongs instead of being carried out differently
// here.
export function assertTravelsInEnvelope(
  entry: EnvelopeEntry,
  definition: OperationDefinition,
): void {
  if (definition.base !== 'query' && definition.base !== 'readSource') {
    return;
  }
  throw new OperationFailure({
    ...(entry.href ? { id: entry.href } : {}),
    status: 400,
    code: 'wrong-entry-point',
    title: 'Operation not carried here',
    detail:
      definition.base === 'query'
        ? `operation "${entry.name}" is a query, which runs on the search ` +
          `engine rather than in a batch`
        : `operation "${entry.name}" reads stored bytes, which the card ` +
          `source and byte routes serve rather than a JSON batch`,
    meta: { entry: entry.index },
  });
}

// Whether carrying this operation out needs to know who the caller is.
//
// Decidable before anything runs, because every place an operation can read
// the actor is part of its stored definition: the programs it runs, and the
// template a named create fills. That is what makes it worth asking here —
// an anonymous caller on a realm that lets anyone write is told its request
// needs an identity, once for the whole batch, rather than having an entry
// refuse part-way through for a reason that reads as a payload problem.
export function needsActor(definition: OperationDefinition): boolean {
  for (let program of [
    definition.program,
    definition.input,
    definition.output,
  ]) {
    if (program && callsActor(program.source)) {
      return true;
    }
  }
  return definition.fill !== undefined && templateReadsActor(definition.fill);
}

function templateReadsActor(template: OperationTemplate): boolean {
  if (Array.isArray(template)) {
    return template.some(templateReadsActor);
  }
  if (template === null || typeof template !== 'object') {
    return false;
  }
  if ((template as Record<string, unknown>).$ref === 'actor') {
    return true;
  }
  return Object.values(template).some(templateReadsActor);
}

// One entry as the batch coordinator takes it.
//
// The wire never names a base operation — an entry names the operation and the
// target's definition says what it is — so this is where the one `data` member
// the envelope carries is read as whatever that behavior expects of it. Each
// arm reads only what the envelope alone can decide; how well the payload fits
// the behavior is the executor's to judge, and it judges it against the state
// it reads under the write lock.
export function batchEntryFor(
  entry: EnvelopeEntry,
  definition: OperationDefinition,
): BatchEntry {
  let { index, name } = entry;
  switch (definition.base) {
    case 'create': {
      if (definition.of) {
        // A named create stages its card from the type and template its
        // declaration carries, so its payload is the operation's params and
        // its href — when it has one — is the card it reads for context.
        return {
          op: 'create',
          definition,
          params: paramsFor(entry),
          ...(entry.href ? { href: entry.href } : {}),
          ...(entry.lid === undefined ? {} : { lid: entry.lid }),
        };
      }
      // The base behavior mints the card the payload describes, so the payload
      // is a JSON:API resource — the same one a `POST` of a new card carries,
      // local id included. Handed over as it arrived: what makes a resource a
      // card is the executor's to judge, against the type it resolves.
      if (entry.href !== undefined) {
        throw refuse(
          `entry ${index} invokes "${name}", which mints a card, and names an ` +
            `href; a create has no existing resource to target`,
          index,
          entry.href,
        );
      }
      return {
        op: 'create',
        definition,
        document: { data: entry.data as unknown as CardResource },
      };
    }
    case 'update': {
      let href = hrefRequired(entry, definition.base);
      let content = entry.data?.content;
      if (content !== undefined) {
        // A file's content replaces its bytes wholesale. It travels as UTF-8
        // text, which is the only form a JSON body can carry — the facade's
        // upload routes are where bytes that are not text are replaced, and
        // they are also the only callers that replace bytes verbatim, so
        // nothing here asks for that.
        if (typeof content !== 'string') {
          throw refuse(
            `entry ${index} replaces the content of ${href} with something ` +
              `that is not text`,
            index,
            href,
          );
        }
        return { op: 'update', definition, href, content };
      }
      return {
        op: 'update',
        definition,
        href,
        document: { data: entry.data as unknown as CardResource },
      };
    }
    case 'delete':
      return {
        op: 'delete',
        definition,
        href: hrefRequired(entry, 'delete'),
      };
    case 'transform':
      return {
        op: 'transform',
        definition,
        params: paramsFor(entry),
        href: hrefRequired(entry, 'transform'),
        name,
      };
    case 'appendLine':
      return {
        op: 'appendLine',
        definition,
        params: paramsFor(entry),
        href: hrefRequired(entry, 'appendLine'),
      };
    case 'appendContainsMany':
      return {
        op: 'appendContainsMany',
        definition,
        params: paramsFor(entry),
        href: hrefRequired(entry, 'appendContainsMany'),
        // Named the way the append executor names them, so the fields and
        // their items are handed through rather than restated.
        ...(entry.data?.field === undefined
          ? {}
          : { field: entry.data.field as string }),
        ...(entry.data?.items === undefined
          ? {}
          : { items: entry.data.items as unknown[] }),
        ...(entry.data?.fields === undefined
          ? {}
          : { fields: entry.data.fields as Record<string, unknown[]> }),
      };
    default:
      // Unreachable for a base that writes, which is the only kind of entry
      // staged. Present because falling off the switch returns `undefined`,
      // and an undefined entry reaches the coordinator as an entry naming no
      // operation — a refusal that describes the realm rather than the request.
      throw new OperationFailure({
        status: 500,
        code: 'internal-error',
        title: 'Unstageable entry',
        detail:
          `operation "${name}" is a "${definition.base}", which is not a ` +
          `behavior a batch stages`,
        meta: { entry: index },
      });
  }
}

// The payload an operation's own params are read from.
//
// `lid` is the one member of `data` that is never a param: it is the caller's
// id for the card the entry mints, which is what other entries link to it by,
// and an operation declaring a param under that name would have the two
// meanings arrive in one key.
export function paramsFor(entry: EnvelopeEntry): Record<string, unknown> {
  if (entry.lid === undefined) {
    return entry.data ?? {};
  }
  let { lid: _lid, ...params } = entry.data ?? {};
  return params;
}

function hrefRequired(entry: EnvelopeEntry, base: BaseOperation): string {
  if (entry.href === undefined) {
    throw refuse(
      `entry ${entry.index} invokes "${entry.name}", which is a "${base}" and ` +
        `runs against an existing resource, and names no href`,
      entry.index,
    );
  }
  return entry.href;
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

// One positional element of `atomic:results`.
//
// A write reports an identity rather than a document: the caller wrote the
// state and the common case is reconciling against the version, so reprinting
// what was written costs an assembly nobody asked for. A read reports the
// document, which is the whole of what it was asked for. A delete reports
// `null`, since there is no state left to describe.
export type EnvelopeResult =
  | { data: Record<string, unknown> | null }
  | Record<string, unknown>;

export function writeResult(result: BatchEntryResult): EnvelopeResult {
  if (!result) {
    return { data: null };
  }
  // Built member by member rather than by spreading what the coordinator
  // reports. The result the core carries between its own collaborators grows
  // members as behaviors need them, and the wire is a contract with clients:
  // a member reaches it because it was put here, not because it happened to
  // be in scope.
  return {
    data: {
      type: 'card',
      id: result.id,
      ...(result.lid === undefined ? {} : { lid: result.lid }),
      meta: {
        version: result.meta.version,
        generation: result.meta.generation,
        lastModified: result.meta.lastModified,
        ...(result.meta.baseMatched === undefined
          ? {}
          : { baseMatched: result.meta.baseMatched }),
      },
    },
  };
}

export function readResult(
  entry: EnvelopeEntry,
  result: OperationResult,
): EnvelopeResult {
  if (!isDocumentResult(result)) {
    throw new OperationFailure({
      ...(entry.href ? { id: entry.href } : {}),
      status: 500,
      code: 'internal-error',
      title: 'Unreadable result',
      detail: `the read in entry ${entry.index} answered with no document`,
      meta: { entry: entry.index },
    });
  }
  return result.document as unknown as Record<string, unknown>;
}

// Every entry answers, and its answer sits where the entry did.
//
// An unfilled position would serialize as `null`, which is what a delete
// reports — so a batch that ran fewer entries than it read would answer with a
// removal nobody asked for rather than saying that something did not run.
export function answered(
  result: EnvelopeResult | undefined,
  index: number,
): EnvelopeResult {
  if (result === undefined) {
    throw new OperationFailure({
      status: 500,
      code: 'internal-error',
      title: 'Missing result',
      detail: `entry ${index} was read from the batch and produced no result`,
      meta: { entry: index },
    });
  }
  return result;
}

// A refusal as a JSON:API error document. The batch is all-or-nothing, so one
// error is the whole answer: there is no partial outcome to describe alongside
// it and nothing was written.
export function errorsDocument(error: OperationError): {
  errors: [OperationError];
} {
  return { errors: [error] };
}

// Label a refusal with the position of the entry that produced it, so a caller
// reading one error knows which of the entries it sent is wrong.
//
// A refusal that already carries a position keeps it. The coordinator labels
// what it stages with the position in the batch it was handed, which is not
// the position in the envelope when the batch holds only the entries that
// write — so `at` is what the two are reconciled through, and relabelling one
// that arrived correct would overwrite an answer with a guess.
export function labelEntry(
  err: unknown,
  at: (index: number) => number,
): unknown {
  if (!isOperationFailure(err)) {
    return err;
  }
  let entry = err.error.meta?.entry;
  if (typeof entry !== 'number') {
    return err;
  }
  return new OperationFailure({
    ...err.error,
    meta: { ...err.error.meta, entry: at(entry) },
  });
}

// The same, for a refusal raised where the position is known outright — an
// entry parsed, resolved or staged one at a time.
export function atEntry(err: unknown, index: number): unknown {
  if (!isOperationFailure(err)) {
    return err;
  }
  if (typeof err.error.meta?.entry === 'number') {
    return err;
  }
  return new OperationFailure({
    ...err.error,
    meta: { ...err.error.meta, entry: index },
  });
}

function refuse(detail: string, index?: number, id?: string): OperationFailure {
  return new OperationFailure({
    ...(id ? { id } : {}),
    status: 400,
    code: 'invalid-params',
    title: 'Invalid operations envelope',
    detail,
    ...(index === undefined ? {} : { meta: { entry: index } }),
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainRecord(value) ? value : undefined;
}
