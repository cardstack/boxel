import type { CodeRef } from '../code-ref.ts';
import type { Filter, Query } from '../query.ts';
import { searchEntryWireQueryFromQuery } from '../search-entry.ts';
import type { SearchEntryWireFilter } from '../search-entry.ts';
import { isWrite, type BaseOperation } from './types.ts';

// ============================================================================
// The client side of the operations envelope: what a caller says, and the
// request the realm answers.
//
// A caller reaches an operation through a bucket of callable functions —
// `operations(report).addComment({ body })` — and this is where such a call
// becomes a batch on the wire and where the batch's answer becomes the value
// the call resolves to. Nothing here reaches the network, a loader or a card
// module: the HTTP is a transport its caller supplies, and everything this
// module needs to know about a def arrives as data (`OperationsSubject`),
// which is what lets it run wherever the operation core runs and lets a test
// drive it with a transport that only records what it was handed.
//
// This module is a wire *producer*. The envelope's parse is the consumer, and
// it reads a different shape — an entry whose href it has resolved, positions
// it assigned — so the two deliberately share no types, and the shapes here
// are the JSON a client sends rather than the terms the realm reads it in.
//
// A bucket carries exactly the operations that can be invoked on what it was
// built for. A name the def does not carry, or carries in the other scope — a
// plain `create` on an instance, an `update` on a class — is absent, so it is
// TypeScript that refuses it rather than a call failing at run time; and
// stored bytes (`readSource`) have no member at all, since the card source
// and byte routes are what serve them.
// ============================================================================

export type OperationsMethod = 'POST' | 'QUERY';

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------

// One operation to carry out. `href` names an existing resource,
// `boxel:target` names one by search instead, and an entry with neither is
// scoped to a type — which is what a create of a card that does not exist yet
// is.
export interface WireInvocation {
  op: 'invoke';
  'boxel:name': string;
  href?: string;
  'boxel:target'?: WireQueryTarget;
  data?: Record<string, unknown>;
}

// A group whose members are a batch in their own right: `serial` members are
// carried out one after another, `parallel` says they are independent. The top
// level of a batch is serial, and the two nest.
export interface WireGroup {
  op: 'parallel' | 'serial';
  'boxel:operations': WireNode[];
}

export type WireNode = WireInvocation | WireGroup;

// An entry's target, found by search rather than named by URL. `query` is the
// search grammar's filter and nothing else — the realm scopes the search to
// itself and supplies the rest of the query — and `expect` is omitted for the
// singular case, which is what the realm assumes.
export interface WireQueryTarget {
  query: SearchEntryWireFilter;
  field?: string;
  expect?: 'many';
}

export interface OperationsEnvelope {
  'boxel:operations': WireNode[];
}

// One positional element of the answer: a write reports an identity, a read
// reports a document, a delete reports `null`, and a group — or an entry that
// reached several cards — reports its members' results in request order.
export type WireResult =
  | { data: Record<string, unknown> | null }
  | Record<string, unknown>;
export type WireResults = (WireResult | WireResults)[];

export interface OperationsAnswer {
  'atomic:results': WireResults;
}

// ---------------------------------------------------------------------------
// The transport
// ---------------------------------------------------------------------------

// The one thing this module cannot do for itself. The host implements it over
// its authenticated fetch; a test implements it to see what a call emits.
//
// `defaultWritableRealm` sits here rather than arriving separately because a
// class-scoped create has no instance to take a realm from, and the realm one
// defaults to is a property of the session the transport already speaks for.
export interface OperationsTransport {
  send(
    realmURL: string,
    method: OperationsMethod,
    envelope: OperationsEnvelope,
    opts?: { clientRequestId?: string },
  ): Promise<OperationsAnswer>;
  defaultWritableRealm(): string | undefined;
}

// A refusal, as the caller sees it.
//
// A batch is all-or-nothing, so the realm answers a refused one with a single
// JSON:API error and no results — nothing was written, whichever entry was
// wrong — which is why this carries that error's members rather than a list.
// `entry` is the position the realm labelled it with: an index at the top
// level of the batch, or a path (`[2].boxel:operations[0]`) to a member of a
// group.
export class OperationsError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly title: string | undefined;
  readonly detail: string | undefined;
  readonly entry: number | string | undefined;
  readonly id: string | undefined;

  constructor(args: {
    status: number;
    code?: string;
    title?: string;
    detail?: string;
    entry?: number | string;
    id?: string;
  }) {
    super(
      [args.title, args.detail].filter(Boolean).join(': ') ||
        `the realm refused the batch with status ${args.status}`,
    );
    this.name = 'OperationsError';
    this.status = args.status;
    this.code = args.code;
    this.title = args.title;
    this.detail = args.detail;
    this.entry = args.entry;
    this.id = args.id;
  }
}

// ---------------------------------------------------------------------------
// What a call resolves to
// ---------------------------------------------------------------------------

// What a write reports: the card it wrote and the version that card now
// holds. The caller supplied the state, so reprinting it would cost an
// assembly nobody asked for, and reconciling against the version is the
// common case.
export interface OperationWriteResult {
  id: string;
  version: string;
  generation: number;
  lastModified: number;
  // The caller's own id for a card the batch minted, beside the id the realm
  // gave it. Present only for a create that named one, which is every create
  // a batch stages.
  lid?: string;
}

// A read reports the document it was asked for. An author's `output` program
// may reshape one, so what a projected read answers is not knowable from the
// declaration — which is why this stays the document rather than a type
// derived from the card.
export type OperationDocument = Record<string, unknown>;

export type OperationValueResult =
  | OperationWriteResult
  | OperationDocument
  | null;

// A batch's answers, shaped like the batch: an entry's result sits where the
// entry did, a group's position holds its members' results, and an entry that
// reached several cards holds one result per card it reached.
export type OperationResultTree = (
  | OperationValueResult
  | OperationResultTree
)[];

// ---------------------------------------------------------------------------
// What the caller's module tells this one about a def
// ---------------------------------------------------------------------------

export interface CarriedOperationInfo {
  base: BaseOperation;
  // Whether an author declared it, as against the def carrying it as one of
  // its own base behaviors. The distinction decides scope for one behavior: a
  // declared create is anchored on an instance for context and invocable
  // there, while the base create it builds on targets a type and has no
  // instance to read.
  declared: boolean;
}

// A def, or an instance of one, in the terms this module works in. Produced by
// the card-facing module, which is the one that can read a class's
// declarations and an instance's identity — reading either from here would
// mean loading a card module, which the operation path never does.
export interface OperationsSubject {
  // An instance is addressed by URL; a type is named by code ref.
  scope: 'instance' | 'type';
  // Which base behaviors the def carries, which is what decides the shape of
  // its bucket: a file's writes work on its bytes, a card's reach its
  // document.
  family: 'card' | 'file' | 'base';
  // How the def names itself in a refusal.
  displayName: string;
  operations: Record<string, CarriedOperationInfo>;
  // Instance scope: what the entry targets, and the realm a batch anchored on
  // it commits to. Either being absent is a refusal rather than a default —
  // an instance that was never saved has no stored state to operate on.
  id?: string;
  realmURL?: string;
  // Type scope: the type an entry names in `meta.adoptsFrom`.
  codeRef?: CodeRef;
}

export interface OperationsEnvironment {
  transport: OperationsTransport;
  // What a def or an instance is, in this module's terms. Throws when handed
  // something that is neither.
  subject(target: unknown): OperationsSubject;
  // A def class, or a thunk deferring one, as the code ref that names it —
  // the same reading a declaration's type clauses get when they are lowered.
  codeRef(value: unknown): CodeRef | undefined;
}

// ---------------------------------------------------------------------------
// Which operations a bucket carries
// ---------------------------------------------------------------------------

// Whether a behavior runs against an existing resource or against a type.
// Exhaustive over the base operations by type, so a tenth behavior has to say
// which scope it belongs in rather than defaulting into one.
const SCOPE: Readonly<Record<BaseOperation, 'instance' | 'type'>> = {
  read: 'instance',
  readSource: 'instance',
  update: 'instance',
  delete: 'instance',
  transform: 'instance',
  appendLine: 'instance',
  appendContainsMany: 'instance',
  create: 'type',
  query: 'type',
};

// The behaviors a batch does not carry, and where each is reached instead.
// Both are refusals about the entry point rather than about the operation, so
// they say the same thing the realm's own refusal says.
const NOT_CARRIED: Partial<Record<BaseOperation, string>> = {
  readSource: `stored bytes are served by the card source and byte routes rather than by a batch of operations`,
  query: `a query runs on the search engine rather than in a batch; reach it through the entry search API`,
};

// A base behavior with no declaration on it runs whatever the realm's own
// executor does, and a transform's executor runs a program — which a batch
// entry has no member to carry. So the behavior is reachable only under the
// name a declaration gives it, and a bucket leaves the bare name out rather
// than offering a call the realm can only refuse.
const NEEDS_DECLARATION: readonly BaseOperation[] = ['transform'];

// Whether a name is invocable on a bucket built for this subject.
//
// A declared create is the one behavior invocable in both scopes: invoked on
// the class it mints a card outright, and invoked on an instance that instance
// is the context its declaration reads.
function carriesMember(
  subject: OperationsSubject,
  info: CarriedOperationInfo,
): boolean {
  if (info.base === 'readSource') {
    return false;
  }
  if (!info.declared && NEEDS_DECLARATION.includes(info.base)) {
    return false;
  }
  if (info.base === 'query') {
    // Only a name an author wrote. A member that says where a query is
    // reached is worth having for a name the author can see in their own
    // card, and `operations(Type).query(…)` was never how one is run.
    return info.declared && subject.scope === 'type';
  }
  if (info.base === 'create') {
    return subject.scope === 'type' || info.declared;
  }
  return SCOPE[info.base] === subject.scope;
}

// Which of a subject's operations a *batch* registers. A batch runs in one
// realm under one lock, so it carries neither of the behaviors reached
// elsewhere, and a card the batch mints is registered with `create(Type, …)`
// rather than through the bucket of the card the batch is anchored on.
function carriesEntry(
  subject: OperationsSubject,
  info: CarriedOperationInfo,
): boolean {
  if (!carriesMember(subject, info) || NOT_CARRIED[info.base]) {
    return false;
  }
  return !(info.base === 'create' && !info.declared);
}

// ---------------------------------------------------------------------------
// Building a bucket
// ---------------------------------------------------------------------------

// The callable form of everything a def carries, for one instance or one
// class. A card instance also carries `atomic`, which is the only member that
// is not an operation: a batch commits in one realm, and it takes that realm
// from the instance it is anchored on.
export function buildOperations(
  subject: OperationsSubject,
  env: OperationsEnvironment,
): Record<string, unknown> {
  let bucket: Record<string, unknown> = Object.create(null);
  for (let [name, info] of Object.entries(subject.operations)) {
    if (!carriesMember(subject, info)) {
      continue;
    }
    bucket[name] = (payload?: unknown, opts?: unknown) =>
      invokeOne(subject, env, name, info, payload, opts);
  }
  if (subject.scope === 'instance' && subject.family === 'card') {
    bucket.atomic = (build: unknown) => runAtomic(subject, env, build);
  }
  return bucket;
}

export interface InvokeOptions {
  // Where a class-scoped call lands. An instance-scoped call runs in the realm
  // that holds its target, so it takes no realm.
  realm?: string | URL;
  // Links to cards that already exist, for a create, as JSON:API
  // relationships. A link to a card the same batch mints is made by passing
  // that create's handle where the link is expected.
  relationships?: Record<string, unknown>;
}

async function invokeOne(
  subject: OperationsSubject,
  env: OperationsEnvironment,
  name: string,
  info: CarriedOperationInfo,
  payload: unknown,
  opts: unknown,
): Promise<OperationValueResult> {
  let notCarried = NOT_CARRIED[info.base];
  if (notCarried) {
    throw new Error(
      `operation "${name}" on ${subject.displayName} is built on ${info.base}, and ${notCarried}`,
    );
  }
  let options = (opts ?? {}) as InvokeOptions;
  let realmURL =
    subject.scope === 'instance'
      ? instanceRealm(subject, name)
      : writableRealm(env, options.realm, name);
  let entry: WireInvocation = {
    op: 'invoke',
    'boxel:name': name,
    ...(subject.scope === 'instance'
      ? { href: instanceHref(subject, name) }
      : {}),
    ...entryData(subject, name, info, payload, options),
  };
  if (entry.data) {
    // A handle stands for a position in a batch, so it means nothing to a call
    // that is not one — it would reach the wire as an empty object and be
    // refused as a malformed param, which describes the payload rather than
    // what the caller did.
    assertNoHandles(entry.data, name);
  }
  let answer = await env.transport.send(
    realmURL,
    isWrite(info.base) ? 'POST' : 'QUERY',
    { 'boxel:operations': [entry] },
  );
  return valueResult(
    answer['atomic:results']?.[0],
    resultKindOf(info.base),
    name,
  );
}

// The payload, as the behavior in hand reads it.
//
// A base create describes the card to mint, so it travels as the JSON:API
// resource a `POST` of a new card carries — with its type in
// `meta.adoptsFrom`, filled from the class rather than written by the caller.
// Everything else hands `data` over as the operation's own payload, which for
// a declared operation is what its `params` schema types, and for a base
// `update` is the patch or the file content the executor reads.
function entryData(
  subject: OperationsSubject,
  name: string,
  info: CarriedOperationInfo,
  payload: unknown,
  opts: InvokeOptions,
  lid?: string,
): { data?: Record<string, unknown> } {
  if (info.base === 'create' && !info.declared) {
    return {
      data: createResource(subject, name, payload, opts.relationships, lid),
    };
  }
  if (payload !== undefined && !isPlainRecord(payload)) {
    throw new Error(
      `operation "${name}" on ${subject.displayName} takes its payload as an object`,
    );
  }
  let data: Record<string, unknown> = {
    ...(lid === undefined ? {} : { lid }),
    ...(payload as Record<string, unknown> | undefined),
  };
  if (subject.scope === 'type') {
    // A type-scoped entry names no existing resource, so the type whose
    // operations it invokes travels in `meta.adoptsFrom` — the same member a
    // card's stored JSON names its own type in, and the one the realm reads to
    // resolve the name against a definition. The envelope reads it as its own
    // member rather than as a param, so it never reaches the operation's
    // payload.
    data.meta = { adoptsFrom: typeRef(subject, name) };
  } else if (
    info.base === 'update' &&
    subject.family === 'card' &&
    data.meta === undefined
  ) {
    // An update of a card is a patch of its document, which is a card
    // resource — so it names the type it patches. Filled from the class of the
    // instance being patched rather than written by the caller, who is naming
    // field values and has no reason to restate what the card already is.
    data.meta = { adoptsFrom: typeRef(subject, name) };
  }
  return Object.keys(data).length === 0 ? {} : { data };
}

function typeRef(type: OperationsSubject, name: string): CodeRef {
  if (!type.codeRef) {
    throw new Error(
      `operation "${name}" runs against the ${type.displayName} type, and no module exports that class, so there is no type to name it by`,
    );
  }
  return type.codeRef;
}

// The resource a base create mints a card from: the field values the caller
// supplied, the links they named, and the type — which comes from the class
// the call was made on, since that is the whole of what a plain create knows
// about what it is making.
function createResource(
  type: OperationsSubject,
  name: string,
  attributes: unknown,
  relationships: Record<string, unknown> | undefined,
  lid: string | undefined,
): Record<string, unknown> {
  let codeRef = typeRef(type, name);
  if (attributes !== undefined && !isPlainRecord(attributes)) {
    throw new Error(
      `operation "${name}" takes the new ${type.displayName}'s field values as an object`,
    );
  }
  return {
    ...(lid === undefined ? {} : { lid }),
    ...(attributes ? { attributes } : {}),
    ...(relationships ? { relationships } : {}),
    meta: { adoptsFrom: codeRef },
  };
}

function instanceHref(subject: OperationsSubject, name: string): string {
  if (!subject.id) {
    throw new Error(
      `operation "${name}" runs against a stored ${subject.displayName}, and this one has never been saved`,
    );
  }
  return subject.id;
}

function instanceRealm(subject: OperationsSubject, name: string): string {
  if (!subject.realmURL) {
    throw new Error(
      `operation "${name}" runs in the realm that holds the ${subject.displayName} it targets, and this one is in no realm yet`,
    );
  }
  return realmHref(subject.realmURL);
}

// Where a class-scoped call lands: the realm the caller named, or the realm
// the session writes to by default — the same realm a card created through the
// store lands in when nothing says otherwise.
function writableRealm(
  env: OperationsEnvironment,
  realm: string | URL | undefined,
  name: string,
): string {
  if (realm) {
    return realmHref(realm);
  }
  let fallback = env.transport.defaultWritableRealm();
  if (!fallback) {
    throw new Error(
      `operation "${name}" targets a type rather than an instance, so it needs a realm to run in, and could not find a writable realm`,
    );
  }
  return realmHref(fallback);
}

// A realm's URL names a directory and a batch is sent to a path under it, so a
// spelling without the trailing slash would resolve against the realm's
// parent.
function realmHref(realm: string | URL): string {
  let href = typeof realm === 'string' ? realm : realm.href;
  return href.endsWith('/') ? href : `${href}/`;
}

// ---------------------------------------------------------------------------
// Reading the answer
// ---------------------------------------------------------------------------

// How a result is read. A write reports an identity and a read reports a
// document, both settled by the behavior the name is built on. An entry whose
// target is a search is `opaque`: which behavior its name resolves to is the
// matched card's own type to decide, so its result is handed back as the realm
// reported it rather than read as something it may not be.
type ResultKind = 'write' | 'read' | 'opaque';

function resultKindOf(base: BaseOperation): ResultKind {
  return isWrite(base) ? 'write' : 'read';
}

function valueResult(
  result: WireResult | WireResults | undefined,
  kind: ResultKind,
  name: string,
): OperationValueResult {
  if (result === undefined) {
    throw new Error(
      `the realm answered the batch without a result for operation "${name}"`,
    );
  }
  if (Array.isArray(result)) {
    throw new Error(
      `operation "${name}" named one target, and the realm answered it with several results`,
    );
  }
  if (kind !== 'write') {
    return result as OperationDocument;
  }
  let data = (result as { data?: Record<string, unknown> | null }).data;
  if (data === null || data === undefined) {
    // What a delete reports: there is no state left to describe.
    return null;
  }
  return writeResult(data, name);
}

function writeResult(
  data: Record<string, unknown>,
  name: string,
): OperationWriteResult {
  let meta = (data.meta ?? {}) as Record<string, unknown>;
  if (typeof data.id !== 'string') {
    throw new Error(
      `the realm's result for operation "${name}" names no card it wrote`,
    );
  }
  return {
    id: data.id,
    version: String(meta.version ?? ''),
    generation: Number(meta.generation ?? 0),
    lastModified: Number(meta.lastModified ?? 0),
    ...(typeof data.lid === 'string' ? { lid: data.lid } : {}),
  };
}

// ---------------------------------------------------------------------------
// The batch builder
// ---------------------------------------------------------------------------

const HANDLE = Symbol.for('cardstack-operations-handle');
const TARGET = Symbol.for('cardstack-operations-target');

// What the caller holds onto after registering an entry: the position its
// result will sit in, how that result is read, and — for a create — the `lid`
// a later entry links the new card by.
interface HandleState {
  // Which batch registered it, so a handle from another one is refused rather
  // than read against positions it does not name.
  batch: BatchState;
  path: number[];
  name: string;
  kind: ResultKind;
  // A group's result is its members', read through the handles registered
  // inside it. Absent on an invocation.
  members?: BatchMember[];
  // An entry whose target is a search for several cards is answered with one
  // result per card the search reached.
  many?: true;
  lid?: string;
}

export interface OperationHandle {
  readonly [HANDLE]: HandleState;
}

export interface QueryTargetHandle {
  readonly [TARGET]: { wire: WireQueryTarget; many: boolean };
}

export function isOperationHandle(value: unknown): value is OperationHandle {
  return (
    typeof value === 'object' && value !== null && HANDLE in (value as object)
  );
}

export function isQueryTargetHandle(
  value: unknown,
): value is QueryTargetHandle {
  return (
    typeof value === 'object' && value !== null && TARGET in (value as object)
  );
}

interface BatchMember {
  wire: WireNode;
  handle: HandleState;
}

interface BatchState {
  realmURL: string;
  lids: number;
}

interface BatchScope {
  batch: BatchState;
  path: number[];
  members: BatchMember[];
  writes: boolean;
}

// A batch, built by calling operations on it in the order they should run.
//
// The builder runs synchronously: an entry's position is where the call that
// registered it fell, so a builder that awaited something would register the
// rest of its entries after the batch had already been sent. Handing back a
// promise is refused rather than left to produce a batch missing its later
// half.
// Async so that a builder's own refusal — a card in another realm, a filter
// that names nothing — reaches the caller as a rejected promise rather than as
// a throw from a call that looks like it returns one.
async function runAtomic(
  subject: OperationsSubject,
  env: OperationsEnvironment,
  build: unknown,
): Promise<unknown> {
  if (typeof build !== 'function') {
    throw new Error(
      `atomic() takes a function that builds the batch by calling operations on the builder it is handed`,
    );
  }
  let batch: BatchState = {
    realmURL: instanceRealm(subject, 'atomic'),
    lids: 0,
  };
  let root: BatchScope = { batch, path: [], members: [], writes: false };
  let returned = (build as (builder: unknown) => unknown)(
    builderFor(root, subject, env),
  );
  if (isPromise(returned)) {
    throw new Error(
      `atomic() builds its batch synchronously, in the order its entries are registered; an async builder would register its later entries after the batch had been sent`,
    );
  }
  return sendBatch(root, env, returned);
}

async function sendBatch(
  root: BatchScope,
  env: OperationsEnvironment,
  returned: unknown,
): Promise<unknown> {
  // Read before the batch is sent: what the builder handed back says which
  // results the caller wants, and a batch that writes should not commit
  // because the caller asked for its answer in a shape nothing can read.
  let projection = projectionOf(root, returned);
  let answer = await env.transport.send(
    root.batch.realmURL,
    root.writes ? 'POST' : 'QUERY',
    { 'boxel:operations': root.members.map((member) => member.wire) },
  );
  let results = answer['atomic:results'] ?? [];
  if (!projection) {
    return resultsOf(root.members, results);
  }
  return projection.map((handle) => resultFor(handle, results));
}

// The handles whose results the caller asked for, or nothing when the builder
// returned nothing and the answer is every entry's result in order.
function projectionOf(
  root: BatchScope,
  returned: unknown,
): HandleState[] | undefined {
  if (returned === undefined) {
    return undefined;
  }
  if (!Array.isArray(returned)) {
    throw new Error(
      `an atomic() builder either returns nothing, and every entry's result comes back in the order the entries were registered, or returns the handles whose results it wants`,
    );
  }
  return returned.map((handle) => {
    if (!isOperationHandle(handle) || handle[HANDLE].batch !== root.batch) {
      throw new Error(
        `an atomic() builder returns handles its own calls produced; this one returned something else`,
      );
    }
    return handle[HANDLE];
  });
}

// Every member's result, read where the member sat. A group's position holds
// its own members' results, which are read the same way — so the answer comes
// back shaped like the batch that asked for it.
function resultsOf(
  members: BatchMember[],
  results: WireResults,
): OperationResultTree {
  return members.map((member, index) =>
    memberResult(member.handle, results[index]),
  );
}

function memberResult(
  handle: HandleState,
  at: WireResult | WireResults | undefined,
): OperationValueResult | OperationResultTree {
  if (handle.members) {
    return resultsOf(handle.members, asResults(at, handle));
  }
  if (handle.many) {
    return asResults(at, handle).map((one) =>
      valueResult(one, handle.kind, handle.name),
    );
  }
  return valueResult(at, handle.kind, handle.name);
}

// One handle's result, found at the position its entry sat in.
function resultFor(
  handle: HandleState,
  results: WireResults,
): OperationValueResult | OperationResultTree {
  let at: WireResult | WireResults | undefined;
  let level: WireResults = results;
  for (let [depth, index] of handle.path.entries()) {
    at = level[index];
    if (depth === handle.path.length - 1) {
      break;
    }
    level = asResults(at, handle);
  }
  return memberResult(handle, at);
}

function asResults(
  at: WireResult | WireResults | undefined,
  handle: HandleState,
): WireResults {
  if (!Array.isArray(at)) {
    throw new Error(
      `the realm answered "${handle.name}" with one result where the batch asked for the results of several operations`,
    );
  }
  return at;
}

// ---------------------------------------------------------------------------
// The builder's surface
// ---------------------------------------------------------------------------

function builderFor(
  scope: BatchScope,
  subject: OperationsSubject,
  env: OperationsEnvironment,
): Record<string, unknown> {
  let builder: Record<string, unknown> = Object.create(null);
  // The batch card's own operations, registering an entry instead of sending
  // one.
  Object.assign(builder, entryMembers(scope, subject));
  builder.on = (target: unknown) => onTarget(scope, env, target);
  builder.create = (cls: unknown, attributes?: unknown, opts?: unknown) =>
    registerCreate(scope, env, cls, attributes, opts as InvokeOptions);
  builder.find = (filter: unknown, opts?: unknown) =>
    queryTarget(env, filter, opts as FindOptions | undefined);
  builder.parallel = (build: unknown) =>
    registerGroup(scope, subject, env, 'parallel', build);
  builder.serial = (build: unknown) =>
    registerGroup(scope, subject, env, 'serial', build);
  return builder;
}

// One card's operations, each registering an entry in the batch.
function entryMembers(
  scope: BatchScope,
  subject: OperationsSubject,
): Record<string, unknown> {
  let members: Record<string, unknown> = Object.create(null);
  for (let [name, info] of Object.entries(subject.operations)) {
    if (!carriesEntry(subject, info)) {
      continue;
    }
    members[name] = (payload?: unknown, opts?: unknown) => {
      // A create in a batch is named with a local id whether or not the
      // caller links it, since the handle it answers with is that id and a
      // later entry may link the new card by it.
      let lid = info.base === 'create' ? mintLid(scope) : undefined;
      let { data } = entryData(
        subject,
        name,
        info,
        payload,
        (opts ?? {}) as InvokeOptions,
        lid,
      );
      return registerEntry(scope, {
        name,
        kind: resultKindOf(info.base),
        writes: isWrite(info.base),
        href: instanceHref(subject, name),
        data: data === undefined ? undefined : linkHandles(data, name),
        lid,
      });
    };
  }
  return members;
}

// The operations of another card in the batch's realm, or of whatever a search
// resolves to.
//
// A batch commits under one realm's write lock, so an entry targeting another
// realm is not something the batch could carry out atomically — refused here,
// before anything is sent, rather than by the realm once the rest of the batch
// has already been described to it.
function onTarget(
  scope: BatchScope,
  env: OperationsEnvironment,
  target: unknown,
): Record<string, unknown> {
  if (isQueryTargetHandle(target)) {
    return queriedMembers(scope, target[TARGET]);
  }
  if (isOperationHandle(target)) {
    throw new Error(
      `a card this batch is creating has no URL to target until the batch commits; link it into another card by passing its handle where a link is expected`,
    );
  }
  let other = env.subject(target);
  if (other.scope !== 'instance') {
    throw new Error(
      `on() takes a card in this batch's realm, or a target found with find(); a class has no stored state for an entry to run against`,
    );
  }
  if (!other.realmURL || realmHref(other.realmURL) !== scope.batch.realmURL) {
    throw new Error(
      `on() takes a card in ${scope.batch.realmURL}, and this ${
        other.displayName
      } is in ${other.realmURL ? realmHref(other.realmURL) : 'no realm'}; a batch commits to one realm`,
    );
  }
  return entryMembers(scope, other);
}

// The operations of the cards a search resolves to.
//
// Which operations those cards carry is their own types' to say, and the realm
// resolves each name against the card it matched — so the names are not
// knowable here and any of them is passed through. For the same reason the
// entry's result is opaque: what the name is built on decides whether an
// identity or a document comes back, and that is the matched card's answer.
function queriedMembers(
  scope: BatchScope,
  target: { wire: WireQueryTarget; many: boolean },
): Record<string, unknown> {
  return new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_bucket, name) {
      if (typeof name !== 'string') {
        return undefined;
      }
      return (payload?: unknown) =>
        registerEntry(scope, {
          name,
          kind: 'opaque',
          // A batch reaching for a queried target is sent as a write, which is
          // the method that carries both: whether the name writes is the
          // matched card's definition to decide, and a read sent as a write
          // costs a permission the caller has when the realm accepts it.
          writes: true,
          queryTarget: target.wire,
          many: target.many,
          data: isPlainRecord(payload) ? linkHandles(payload, name) : undefined,
        });
    },
  });
}

// A card the batch mints. The handle it answers with is the `lid` a later
// entry links the new card by, so a link to a card that does not exist yet is
// a value the caller holds rather than a token they have to invent and keep
// consistent by hand.
function registerCreate(
  scope: BatchScope,
  env: OperationsEnvironment,
  cls: unknown,
  attributes: unknown,
  opts: InvokeOptions | undefined,
): OperationHandle {
  let type = env.subject(cls);
  if (type.scope !== 'type') {
    throw new Error(
      `create() takes the class of the card to mint, not an instance of one`,
    );
  }
  if (type.family !== 'card') {
    throw new Error(
      `create() mints a card; a ${type.displayName} is created through the realm's file routes`,
    );
  }
  let lid = mintLid(scope);
  return registerEntry(scope, {
    name: 'create',
    kind: 'write',
    writes: true,
    data: linkHandles(
      createResource(type, 'create', attributes, opts?.relationships, lid),
      'create',
    ),
    lid,
  });
}

export interface FindOptions {
  // A `linksTo` or `linksToMany` field of the matched card, for when what the
  // entry runs against is what that field points at rather than the match
  // itself.
  field?: string;
  // How many cards the target names. `one` is the default, and an entry under
  // it names exactly one card.
  //
  // Under `many` the entry runs against every card the search reached and its
  // result holds one per card. Without a `field` that is one per match. With
  // one it is one per *distinct* card the hop reached, which is fewer when
  // several matches link to the same card — the count is of cards run against,
  // not of matches.
  expect?: 'one' | 'many';
}

// A target named by search rather than by reference.
//
// The filter is the card-rooted spelling an author writes everywhere else in
// this API, and it is translated to the search engine's own grammar here so
// there is one spelling to learn. The realm scopes the search to itself and
// supplies the rest of the query, so nothing but the filter travels.
//
// A filter that names nothing is refused: it is legal, and it matches every
// card in the realm — which under `expect: 'many'` is a batch nobody meant to
// send.
function queryTarget(
  env: OperationsEnvironment,
  filter: unknown,
  opts: FindOptions | undefined,
): QueryTargetHandle {
  if (!isPlainRecord(filter) || Object.keys(filter).length === 0) {
    throw new Error(
      `find() takes a filter naming the cards to target; a filter that names nothing would target every card in the realm`,
    );
  }
  let wire = searchEntryWireQueryFromQuery({
    filter: defRefs(filter, env) as Filter,
  } as Query).filter;
  if (!wire) {
    throw new Error(`find() takes a filter naming the cards to target`);
  }
  let many = opts?.expect === 'many';
  return {
    [TARGET]: {
      wire: {
        query: wire,
        ...(opts?.field === undefined ? {} : { field: opts.field }),
        ...(many ? { expect: 'many' as const } : {}),
      },
      many,
    },
  };
}

// The markers a declaration's clauses are written with. They stand for values
// an invocation supplies — the caller's identity, a member of the payload, the
// target's stored source — and lowering resolves them against the invocation
// for a declared operation.
//
// A target written at the call site resolves none of them, because the caller
// is the invocation and already holds the values. The two surfaces look alike
// enough that an author will reach for one in the other, and a marker left in
// a filter is a well-formed search operand: it would be compared against
// stored values as a literal object, match nothing, and read as a filter that
// genuinely found nothing. So it is refused by name, before anything is sent.
const MARKER_KEYS = ['$ref', '$bxl'] as const;

function markerIn(value: Record<string, unknown>): string | undefined {
  for (let key of MARKER_KEYS) {
    if (key in value) {
      let named = value[key];
      return typeof named === 'string' ? named : key;
    }
  }
  return undefined;
}

// A filter as an author writes it names types with the classes themselves —
// `on: Person` — so they are read as the code refs that name them, the same
// reading a declaration's type clauses get when they are lowered. A thunk is
// how an author names a class declared later in the module.
function defRefs(value: unknown, env: OperationsEnvironment): unknown {
  if (typeof value === 'function') {
    let codeRef = env.codeRef(value);
    if (!codeRef) {
      throw new Error(
        `find() names a class that no module exports, so there is no type to search for`,
      );
    }
    return codeRef;
  }
  if (Array.isArray(value)) {
    return value.map((member) => defRefs(member, env));
  }
  if (isPlainRecord(value)) {
    let marker = markerIn(value);
    if (marker) {
      throw new Error(
        `find() names the cards to target with values the caller holds, and this filter contains ${marker}(), which stands for a value a declared operation is supplied when it is invoked`,
      );
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, member]) => [key, defRefs(member, env)]),
    );
  }
  return value;
}

function registerGroup(
  scope: BatchScope,
  subject: OperationsSubject,
  env: OperationsEnvironment,
  op: 'parallel' | 'serial',
  build: unknown,
): OperationHandle {
  if (typeof build !== 'function') {
    throw new Error(
      `${op}() takes a function that registers the group's members on the builder it is handed`,
    );
  }
  let index = scope.members.length;
  let inner: BatchScope = {
    batch: scope.batch,
    path: [...scope.path, index],
    members: [],
    writes: false,
  };
  let returned = (build as (builder: unknown) => unknown)(
    builderFor(inner, subject, env),
  );
  if (isPromise(returned)) {
    throw new Error(
      `${op}() registers its members synchronously; an async builder would register them after the batch had been sent`,
    );
  }
  scope.writes = scope.writes || inner.writes;
  let handle: HandleState = {
    batch: scope.batch,
    path: inner.path,
    name: op,
    kind: 'opaque',
    members: inner.members,
  };
  scope.members.push({
    wire: {
      op,
      'boxel:operations': inner.members.map((member) => member.wire),
    },
    handle,
  });
  return { [HANDLE]: handle };
}

function registerEntry(
  scope: BatchScope,
  entry: {
    name: string;
    kind: ResultKind;
    writes: boolean;
    href?: string;
    queryTarget?: WireQueryTarget;
    data?: Record<string, unknown>;
    many?: boolean;
    lid?: string;
  },
): OperationHandle {
  let handle: HandleState = {
    batch: scope.batch,
    path: [...scope.path, scope.members.length],
    name: entry.name,
    kind: entry.kind,
    ...(entry.many ? { many: true as const } : {}),
    ...(entry.lid === undefined ? {} : { lid: entry.lid }),
  };
  scope.writes = scope.writes || entry.writes;
  scope.members.push({
    wire: {
      op: 'invoke',
      'boxel:name': entry.name,
      ...(entry.href === undefined ? {} : { href: entry.href }),
      ...(entry.queryTarget === undefined
        ? {}
        : { 'boxel:target': entry.queryTarget }),
      ...(entry.data === undefined ? {} : { data: entry.data }),
    },
    handle,
  });
  return { [HANDLE]: handle };
}

// Every card the batch mints needs a local id no other entry uses, and the
// tokens appear in the request — so they are the batch's own sequence rather
// than anything derived from the card, which has nothing to derive one from
// yet.
function mintLid(scope: BatchScope): string {
  scope.batch.lids += 1;
  return `l${scope.batch.lids}`;
}

// A handle passed where a value is expected is a link to the card its entry
// mints, which the wire spells as the `lid` the batch named that card with.
// Substituted wherever it sits in the payload, since a link can be a member of
// an item appended to a collection as readily as a member of the payload
// itself.
function linkHandles(
  data: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  return substituteHandles(data, name, new Set(), true) as Record<
    string,
    unknown
  >;
}

// Reads the payload for a handle without substituting one, for the calls that
// are not batches and so have no entry a handle could stand for.
function assertNoHandles(data: Record<string, unknown>, name: string): void {
  substituteHandles(data, name, new Set(), false);
}

function substituteHandles(
  value: unknown,
  name: string,
  seen: Set<object>,
  inBatch: boolean,
): unknown {
  if (isOperationHandle(value)) {
    if (!inBatch) {
      throw new Error(
        `operation "${name}" was handed the handle of a batch entry; a handle stands for a card the batch mints, so it is passed inside the same atomic() call rather than to a single operation`,
      );
    }
    let { lid } = value[HANDLE];
    if (!lid) {
      throw new Error(
        `operation "${name}" was handed the handle of an entry that mints no card, so there is nothing for a link to point at`,
      );
    }
    return { lid };
  }
  if (isQueryTargetHandle(value)) {
    throw new Error(
      `operation "${name}" was handed a target found with find(); a target says which card an entry runs against, so it is passed to on() rather than as a value`,
    );
  }
  if (Array.isArray(value)) {
    guardCycle(value, name, seen);
    return value.map((member) =>
      substituteHandles(member, name, seen, inBatch),
    );
  }
  if (isPlainRecord(value)) {
    guardCycle(value, name, seen);
    return Object.fromEntries(
      Object.entries(value).map(([key, member]) => [
        key,
        substituteHandles(member, name, seen, inBatch),
      ]),
    );
  }
  return value;
}

function guardCycle(value: object, name: string, seen: Set<object>): void {
  if (seen.has(value)) {
    throw new Error(
      `operation "${name}" was handed a payload that contains itself`,
    );
  }
  seen.add(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPromise(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
