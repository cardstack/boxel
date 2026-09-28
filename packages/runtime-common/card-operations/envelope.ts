import { BOXEL_OPERATIONS_EXT } from '../supported-mime-type.ts';
import { RealmPaths, type LocalPath } from '../paths.ts';
import {
  OperationFailure,
  isDocumentResult,
  isOperationFailure,
  isWrite,
  type BaseOperation,
  type EntryPosition,
  type OperationDefinition,
  type OperationError,
  type OperationResult,
  type OperationTarget,
} from './types.ts';
import type { BatchEntryResult, BatchNode } from './coordinator.ts';
import { assertParamsSupplied, type OperationScope } from './dispatch.ts';
import { runInputTransform, type TransformContext } from './transforms.ts';
import type { BatchEntry } from './executors.ts';
import type { GateDecision } from './gate.ts';
import { isCodeRef } from '../card-document-shape.ts';
import { isRelativePath } from '../code-ref.ts';
import type { CardResource } from '../resource-types.ts';
import type { SearchEntryWireFilter } from '../search-entry.ts';

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
// The entry vocabulary is a discriminated union on `op`. `invoke` names an
// operation to run; `parallel` and `serial` are groups, whose members are
// entries in their own right — so a batch is a tree, and a flat list is the
// tree with no groups in it. Everything a group means to the realm is in how
// the coordinator schedules staging; what is here is the grammar and the
// shape of the answer, both of which mirror the tree the caller sent.
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

// An entry that says which card it runs against by describing it rather than
// by naming it: the filter that finds it, and optionally one link to follow
// from what the filter matched.
//
// It stands in the same slot `href` does, and it resolves into one — see
// `find-targets.ts`, which runs the filter against the realm's index before
// anything stages. What is here is only the grammar.
export interface QueryTarget {
  // A `SearchEntryWireFilter`, the filter member of the query the realm's
  // search endpoints take. The filter alone, not a whole query: the rest of
  // that grammar addresses realms, pages and projections, none of which an
  // entry chooses. The realm decides all three, which is what makes a result
  // outside the endpoint realm impossible rather than merely refused.
  query: SearchEntryWireFilter;
  // A link to follow from each matched card, whose target the entry then runs
  // against. One immediate field name — the hop is one link, so there is no
  // path to walk.
  field?: string;
  // Whether this entry names one card or a set of them. `one` is the default,
  // and the count is held to exactly one; `many` expands the entry into one
  // per target and answers with an array, which an empty set answers as empty.
  expect: 'one' | 'many';
}

// One `invoke` entry, with the parts the wire spells resolved into the terms
// the core takes: an `href` that has been resolved against this realm and
// found to be inside it, and the local id read out of the payload.
export interface EnvelopeEntry {
  op: 'invoke';
  // Where the entry sat in the batch. Every refusal is labelled with it, so a
  // caller reading one error knows which of the entries it sent produced it.
  position: EntryPosition;
  name: string;
  // Absolute, and inside this realm. Absent on an entry that names no existing
  // resource, which is a create of a card that does not exist yet.
  href?: string;
  // The query this entry's target is described by, before it has been run.
  // Gone once it has: resolution answers entries carrying `href`, so nothing
  // downstream of it distinguishes a target that was found from one that was
  // named.
  find?: QueryTarget;
  // Set on an entry whose `href` a query produced. The one thing downstream
  // still asks about a found target: a create mints a card, so there is
  // nothing for a query to have found, and the refusal has to say that rather
  // than report the href the caller never wrote.
  found?: true;
  data?: Record<string, unknown>;
  // The caller's own id for a card this batch mints, read from `data.lid` —
  // the resource-level member JSON:API already reserves for exactly this, and
  // the key later entries link to the new card by.
  lid?: string;
  // The version the caller believes it is writing on top of, read from
  // `data.meta.baseVersion`. The result reports whether the target was still
  // at it, and the write happens either way — a moved base is something the
  // caller decides what to do about, where `If-Match` is how a caller asks for
  // the write to be refused instead.
  baseVersion?: string;
}

// A run of entries, which is itself an entry of whatever holds it.
//
// `serial` members are carried out one after another and may build on each
// other; `parallel` members are independent and are staged at the same time.
// A group carries no operation of its own — no name, no href, no payload —
// because it names no target: it says how its members are scheduled and
// nothing else.
export interface EnvelopeGroup {
  op: 'parallel' | 'serial';
  position: EntryPosition;
  members: EnvelopeNode[];
}

export type EnvelopeNode = EnvelopeEntry | EnvelopeGroup;

export function isGroup(node: EnvelopeNode): node is EnvelopeGroup {
  return node.op !== 'invoke';
}

// Every invocation in the tree, in the order the caller wrote them.
//
// Depth-first and left to right, which is the order a serial batch is carried
// out in and the order every refusal is chosen by — the entry a caller is told
// about is the earliest one it got wrong, whatever the schedule did with the
// rest.
export function invocationsIn(nodes: readonly EnvelopeNode[]): EnvelopeEntry[] {
  let entries: EnvelopeEntry[] = [];
  let walk = (nodes: readonly EnvelopeNode[]) => {
    for (let node of nodes) {
      if (isGroup(node)) {
        walk(node.members);
      } else {
        entries.push(node);
      }
    }
  };
  walk(nodes);
  return entries;
}

// The request body, read as a batch.
//
// An empty list is a batch that asks for nothing, and it is carried out as
// one: the coordinator takes no lock and announces nothing for it, so the
// envelope answers with no results rather than inventing a refusal for a
// request that would change nothing either way.
export interface ParseEnvelopeOptions {
  // A registered-prefix identifier as the absolute URL it names, and anything
  // else unchanged. Identifier resolution belongs to the realm's fetch layer,
  // so it arrives as a bound function rather than being reached from here —
  // the same reason the operation core takes its code-ref resolver bound.
  // Absent, an href is read exactly as it is written, which is what a caller
  // with no prefixes registered would get anyway.
  resolveIdentifier?: (href: string) => string;
}

export function parseOperationsEnvelope(
  body: unknown,
  realmURL: string,
  opts: ParseEnvelopeOptions = {},
): EnvelopeNode[] {
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
  return parseMembers(operations, undefined, 0, paths, opts);
}

// How deep the groups in one batch may nest.
//
// The grammar itself is unbounded, and so is anything a caller would compose:
// a handful of levels describes the most elaborate real batch. The limit is
// about the two recursive walks a body drives — this parse and the
// coordinator's staging schedule — which a body nested tens of thousands deep
// would overflow the stack of. That reads as a fault in the realm, so the
// depth is answered here as what it is: a payload nobody meant to send.
const MAX_GROUP_DEPTH = 32;

function parseMembers(
  operations: readonly unknown[],
  // Absent at the top level, whose members are named by their index alone.
  parent: EntryPosition | undefined,
  depth: number,
  paths: RealmPaths,
  opts: ParseEnvelopeOptions,
): EnvelopeNode[] {
  return operations.map((operation, index) =>
    parseNode(operation, positionIn(parent, index), depth, paths, opts),
  );
}

// Where an entry sits, in the terms a caller can point at it with.
//
// A top-level entry is its index, which is what a caller that sent a flat list
// means by "the third one". A member of a group is reached by no single
// number, so it is named by the path down to it — `[2].boxel:operations[0]` —
// which is the path through the request body itself.
function positionIn(
  parent: EntryPosition | undefined,
  index: number,
): EntryPosition {
  if (parent === undefined) {
    return index;
  }
  let prefix = typeof parent === 'number' ? `[${parent}]` : parent;
  return `${prefix}.boxel:operations[${index}]`;
}

function parseNode(
  operation: unknown,
  position: EntryPosition,
  depth: number,
  paths: RealmPaths,
  opts: ParseEnvelopeOptions,
): EnvelopeNode {
  if (!isPlainRecord(operation)) {
    throw refuse(`entry ${position} is not an operation`, position);
  }
  let op = operation.op;
  switch (op) {
    case 'invoke':
      return parseInvocation(operation, position, paths, opts);
    case 'parallel':
    case 'serial':
      return parseGroup(operation, op, position, depth, paths, opts);
    default:
      throw refuse(
        `entry ${position} names ${
          typeof op === 'string' ? `operation "${op}"` : 'no operation'
        }, and an entry is an "invoke", a "parallel" or a "serial"`,
        position,
      );
  }
}

// The members an invocation carries, which a group carries none of. Read as a
// refusal rather than ignored: a group with an `href` on it is a caller that
// believes the group targets something, and carrying it out would run its
// members against targets they never named.
const INVOCATION_MEMBERS = [
  'boxel:name',
  'href',
  'boxel:target',
  'data',
] as const;

function parseGroup(
  operation: Record<string, unknown>,
  op: 'parallel' | 'serial',
  position: EntryPosition,
  depth: number,
  paths: RealmPaths,
  opts: ParseEnvelopeOptions,
): EnvelopeGroup {
  for (let member of INVOCATION_MEMBERS) {
    if (operation[member] !== undefined) {
      throw refuse(
        `entry ${position} is a "${op}" group and carries "${member}"; a ` +
          `group schedules the entries it holds and invokes nothing itself`,
        position,
      );
    }
  }
  let members = operation['boxel:operations'];
  if (!Array.isArray(members)) {
    throw refuse(
      `entry ${position} is a "${op}" group and carries no ` +
        `"boxel:operations" list of members`,
      position,
    );
  }
  if (members.length === 0) {
    // A group says how the entries it holds are run, so one holding none says
    // nothing at all. Refused rather than carried out as a no-op, because the
    // shape it produces is indistinguishable from success: an empty group
    // answers with an empty array of results, which reads as "these all
    // carried out" rather than as "you sent none" — and the likeliest way to
    // send one is a caller that built its members from a list and got back
    // fewer than it meant to.
    throw refuse(
      `entry ${position} is a "${op}" group holding no members; a group ` +
        `carries the entries it schedules`,
      position,
    );
  }
  if (depth >= MAX_GROUP_DEPTH) {
    throw refuse(
      `entry ${position} nests groups more than ${MAX_GROUP_DEPTH} deep`,
      position,
    );
  }
  return {
    op,
    position,
    members: parseMembers(members, position, depth + 1, paths, opts),
  };
}

function parseInvocation(
  operation: Record<string, unknown>,
  position: EntryPosition,
  paths: RealmPaths,
  opts: ParseEnvelopeOptions,
): EnvelopeEntry {
  // The mirror of the group-side check, and refused for the same reason: an
  // entry carrying members is a caller that believes those members will run.
  // Read as a refusal rather than ignored, because ignoring them is the one
  // outcome with no signal in it — a group mislabelled as an invocation would
  // answer 200 having carried out the parent operation and none of the batch
  // the caller wrapped in it.
  if (operation['boxel:operations'] !== undefined) {
    throw refuse(
      `entry ${position} is an "invoke" and carries "boxel:operations"; ` +
        `members belong to a "parallel" or a "serial" group, and an ` +
        `invocation runs one operation`,
      position,
    );
  }
  let name = operation['boxel:name'];
  if (typeof name !== 'string' || name.length === 0) {
    throw refuse(
      `entry ${position} carries no "boxel:name" naming the operation to ` +
        `invoke`,
      position,
    );
  }
  let data: Record<string, unknown> | undefined;
  if (operation.data !== undefined) {
    if (!isPlainRecord(operation.data)) {
      throw refuse(
        `entry ${position} carries a "data" that is not an object`,
        position,
      );
    }
    data = operation.data;
  }
  let lid = data?.lid;
  if (lid !== undefined && typeof lid !== 'string') {
    throw refuse(
      `entry ${position} carries a local id that is not a string`,
      position,
    );
  }
  let baseVersion = baseVersionIn(data, position);
  if (baseVersion !== undefined && data) {
    // Lifted out of the payload, not merely read from it. `data` reaches the
    // document arms of `batchEntryFor` as the JSON:API resource itself — a
    // patch to merge, or a card to mint — so a member left on `meta` would be
    // merged into the card's stored source, where `meta` legitimately carries
    // `adoptsFrom` and `fields` and so cannot be dropped wholesale. It would
    // also make an otherwise no-op patch look like a change.
    //
    // `meta` survives as an object even when the base version was all it held:
    // a patch has to carry `adoptsFrom` to be read as a card resource at all,
    // and the arms that take params drop `meta` themselves.
    let { baseVersion: _lifted, ...meta } = data.meta as Record<
      string,
      unknown
    >;
    data = { ...data, meta };
  }
  if (operation.href !== undefined && operation['boxel:target'] !== undefined) {
    // Both spellings of the same slot. Refused rather than resolved by a
    // precedence rule, because the two disagree about something the caller
    // knows and this does not: an href is the card the caller already has,
    // and a query is the caller saying it does not know which card it means.
    throw refuse(
      `entry ${position} carries both an "href" and a "boxel:target"; an ` +
        `entry either names the card it runs against or describes it, and ` +
        `not both`,
      position,
    );
  }
  return {
    op: 'invoke',
    position,
    name,
    ...(operation.href === undefined
      ? {}
      : { href: hrefIn(operation.href, position, paths, opts) }),
    ...(operation['boxel:target'] === undefined
      ? {}
      : { find: queryTargetIn(operation['boxel:target'], position) }),
    ...(data ? { data } : {}),
    ...(lid === undefined ? {} : { lid }),
    ...(baseVersion === undefined ? {} : { baseVersion }),
  };
}

// The base version out of an entry's `data.meta`, which is where the wire
// carries the members that describe the resource rather than the operation's
// own params — `meta` is already subtracted from the params for that reason.
//
// A non-string is refused rather than ignored, because the thing a caller does
// with a base version is read the `baseMatched` that comes back: an ignored one
// answers with no `baseMatched` at all, which a caller reads as "the realm does
// not report on this" and not as "you sent the wrong shape". An empty string is
// refused for the same reason and separately, since it is a caller that
// interpolated a version it never had — and it would otherwise be compared
// against the file's real hash and answer a confident `false`.
function baseVersionIn(
  data: Record<string, unknown> | undefined,
  position: EntryPosition,
): string | undefined {
  if (!data || !isPlainRecord(data.meta)) {
    return undefined;
  }
  let baseVersion = data.meta.baseVersion;
  if (baseVersion === undefined) {
    return undefined;
  }
  if (typeof baseVersion !== 'string' || baseVersion.length === 0) {
    throw refuse(
      `entry ${position} carries a "meta.baseVersion" that is not a ` +
        `non-empty string; a base version is the version the caller last saw ` +
        `the target at`,
      position,
    );
  }
  return baseVersion;
}

// The members a query target carries. Read as a closed set, unlike `data`,
// whose unread members are the operation's own params: nothing here is passed
// through to anything, so a member this does not know is a member nobody
// reads — and the one a caller is likeliest to write, `expects`, would
// silently leave the entry demanding exactly one match.
const QUERY_TARGET_MEMBERS = ['query', 'field', 'expect'] as const;

function queryTargetIn(target: unknown, position: EntryPosition): QueryTarget {
  if (!isPlainRecord(target)) {
    throw refuse(
      `entry ${position} carries a "boxel:target" that is not an object`,
      position,
    );
  }
  for (let member of Object.keys(target)) {
    if (!(QUERY_TARGET_MEMBERS as readonly string[]).includes(member)) {
      throw refuse(
        `entry ${position} carries "${member}" in its "boxel:target", which ` +
          `describes a target with ${QUERY_TARGET_MEMBERS.map(
            (known) => `"${known}"`,
          ).join(', ')}`,
        position,
      );
    }
  }
  // The filter's own grammar is the realm's, and it is checked where the
  // query is assembled — here there is no realm to check it against, and
  // restating the search parser's rules would be a second grammar to keep in
  // step with the first.
  if (!isPlainRecord(target.query)) {
    throw refuse(
      `entry ${position} carries a "boxel:target" with no "query" filter ` +
        `saying which card it runs against`,
      position,
    );
  }
  if (
    target.field !== undefined &&
    (typeof target.field !== 'string' || target.field.length === 0)
  ) {
    throw refuse(
      `entry ${position} carries a "boxel:target" whose "field" is not the ` +
        `name of a field`,
      position,
    );
  }
  if (
    target.expect !== undefined &&
    target.expect !== 'one' &&
    target.expect !== 'many'
  ) {
    throw refuse(
      `entry ${position} carries a "boxel:target" expecting ` +
        `${JSON.stringify(target.expect)}; an entry expects "one" card or ` +
        `"many"`,
      position,
    );
  }
  return {
    query: target.query as SearchEntryWireFilter,
    ...(target.field === undefined ? {} : { field: target.field as string }),
    expect: (target.expect as 'one' | 'many') ?? 'one',
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
function hrefIn(
  href: unknown,
  position: EntryPosition,
  paths: RealmPaths,
  opts: ParseEnvelopeOptions,
): string {
  if (typeof href !== 'string' || href.length === 0) {
    throw refuse(
      `entry ${position} carries an "href" that is not a URL`,
      position,
    );
  }
  // A realm reached through a registered prefix is addressed by that prefix
  // everywhere else — it is the form a result's id comes back in — so an href
  // written that way names the card it appears to name rather than a path
  // under the realm root that happens to start with it.
  let resolved = opts.resolveIdentifier?.(href) ?? href;
  let absolute: URL;
  try {
    absolute = new URL(resolved);
  } catch {
    // Relative, so it names a path within the realm. A leading slash is the
    // spelling the extension documents and means the realm's root, not the
    // origin's, which is why this resolves through `fileURL` rather than
    // through URL resolution against the realm.
    try {
      absolute = paths.fileURL(resolved.replace(/^\/+/, '') as LocalPath);
    } catch {
      throw refuse(
        `entry ${position} carries an "href" that is not a URL`,
        position,
      );
    }
  }
  try {
    paths.local(absolute);
  } catch {
    throw refuse(
      `entry ${position} targets ${absolute.href}, which realm ${paths.url} ` +
        `does not contain; a batch commits to one realm`,
      position,
      absolute.href,
    );
  }
  return absolute.href;
}

// What the entry runs against.
//
// An entry naming an href targets that resource. One naming none is scoped to
// a type rather than to an instance — a create, which has no existing card to
// bind to — and names that type in `data.meta.adoptsFrom`, the same member a
// card's stored JSON names its own type in. The type named is the one whose
// operations are being invoked; what a named create actually mints is its
// declaration's, which the realm reads from the definition rather than from
// the wire.
//
// The ref's shape is checked here, recursively. Whether the type it names
// exists is the lookup's answer and comes back as a type that cannot be
// resolved; whether the thing is a code ref at all is not, and an object that
// is not one reaches the resolver's `'type' in ref` recursion and throws out of
// it — a malformed payload answered as a fault in the realm.
//
// The realm a type target is scoped to is the one the entry's resource names
// in `data.meta.realmURL`, where it names one, and this realm otherwise. A
// create naming another realm is then refused where every target is checked
// against the realm, before its type is looked up or its operation judged.
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
      `entry ${entry.position} names no "href" and no type in ` +
        `"data.meta.adoptsFrom", so there is nothing for it to run against`,
      entry.position,
    );
  }
  if (!isCodeRef(adoptsFrom)) {
    throw refuse(
      `entry ${entry.position} names a type in "data.meta.adoptsFrom" that ` +
        `is not a code reference`,
      entry.position,
    );
  }
  let named = asRecord(entry.data?.meta)?.realmURL;
  return {
    kind: 'type',
    codeRef: adoptsFrom,
    realm: typeof named === 'string' && named ? named : realmURL,
  };
}

// One entry with the behavior its name resolved to. The name is the whole of
// what the wire says; which behavior that is comes from the target's own
// definition, so an entry is only actionable once the two are together.
export interface ResolvedEnvelopeEntry {
  entry: EnvelopeEntry;
  target: OperationTarget;
  definition: OperationDefinition;
  // What the policy gate decided about this entry. A `pending` write is one
  // whose admission still rests on a predicate.
  decision: GateDecision;
  // This entry's own view of the batch's scope: the batch's caller and row
  // memo, and — once `stageWriteEntry` has run — the document a create would
  // write.
  scope: OperationScope;
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
    meta: { entry: entry.position },
  });
}

// A base version names the state a write is computed on top of, so an entry
// that does not write has nothing to compare one against.
//
// Refused rather than ignored, and refused here rather than left to the
// coordinator, because the coordinator only ever sees the entries that write:
// a `read`, a `readSource` or a `query` — the three bases that write nothing —
// is answered before the batch is staged. An ignored
// base version answers with no `baseMatched` at all, which is exactly the
// reading a caller cannot distinguish from "the realm does not report on
// this" — so a well-formed value on a read would be silently dropped while a
// malformed one on the same read is a refusal, which is the inconsistency the
// shape check exists to avoid.
//
// Which *writing* behaviors carry a base stays the coordinator's rule, since
// it owns the comparison; this covers only the entries that never reach it.
export function assertVersionableEntry(
  entry: EnvelopeEntry,
  definition: OperationDefinition,
): void {
  if (entry.baseVersion === undefined || isWrite(definition.base)) {
    return;
  }
  throw new OperationFailure({
    ...(entry.href ? { id: entry.href } : {}),
    status: 400,
    code: 'invalid-params',
    title: 'Invalid base version',
    detail:
      `entry ${entry.position} invokes "${entry.name}", which is a ` +
      `"${definition.base}" and writes nothing, and names a base version; ` +
      `a base version describes the state a write is computed on top of`,
    meta: { entry: entry.position },
  });
}

// Whether carrying this operation out needs to know who the caller is.
//
// Read off the stored definition, where lowering recorded it with the whole
// declaration in hand. Asking it here would mean reading program text, which
// would put this module — and so every package that reaches the realm through
// it — in the BXL package's typecheck program; and it would mean keeping a
// list of the members a marker can hide in, which is the list lowering already
// walks.
//
// The point of asking at all is that it is answerable before anything runs: an
// anonymous caller on a realm that lets anyone write is told the request needs
// an identity once, for the whole batch, rather than by whichever entry
// reached the actor first for a reason that reads as a payload problem.
export function needsActor(definition: OperationDefinition): boolean {
  return definition.readsActor === true;
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
  let { position, name } = entry;
  // Every entry the coordinator stages carries the position the caller sent it
  // under, so a batch holding only some of an envelope's entries — and one
  // whose entries sat inside groups — still reports refusals against the
  // envelope's own numbering.
  //
  // The base version rides along on every arm rather than only on the two that
  // can report a match. Which behaviors have a base to compare is the
  // coordinator's rule and it already enforces it for in-process callers, so
  // handing it through uniformly is what makes a `create` that names one answer
  // the same refusal however it arrived, instead of one that silently drops it.
  let common = {
    definition,
    label: position,
    ...(entry.baseVersion === undefined
      ? {}
      : { baseVersion: entry.baseVersion }),
  };
  switch (definition.base) {
    case 'create': {
      if (entry.found) {
        // A query says which existing card the entry runs against, and a
        // create has none — the card it acts on is the one it is about to
        // mint. Refused here rather than at parse, because the wire never
        // says an entry creates: the operation's name does, and what that
        // name means is read off the type the entry resolved against, which
        // is a card the query had to find first.
        throw refuse(
          `entry ${position} invokes "${name}", which mints a card, and ` +
            `takes its target from a query; a create has no existing card ` +
            `for one to find`,
          position,
        );
      }
      if (definition.of) {
        // A named create stages its card from the type and template its
        // declaration carries, so its payload is the operation's params and
        // its href — when it has one — is the card it reads for context.
        return {
          op: 'create',
          ...common,
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
          `entry ${position} invokes "${name}", which mints a card, and ` +
            `names an href; a create has no existing resource to target`,
          position,
          entry.href,
        );
      }
      // The realm resolved the type this entry names against its own root,
      // which is where it found the operation and judged the caller. The card
      // is stored beneath that root and reads a relative module against its
      // own file, so a relative one would name one type to the resolution and
      // another to the card it mints.
      let module = asRecord(asRecord(entry.data?.meta)?.adoptsFrom)?.module;
      if (isRelativePath(module)) {
        throw refuse(
          `entry ${position} names the type it mints by the relative module ` +
            `"${module}"; a card that is not stored yet has no location for ` +
            `a module to be relative to, so a create names its type by URL ` +
            `or registered prefix`,
          position,
        );
      }
      return {
        op: 'create',
        ...common,
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
            `entry ${position} replaces the content of ${href} with ` +
              `something that is not text`,
            position,
            href,
          );
        }
        return { op: 'update', ...common, href, content };
      }
      return {
        op: 'update',
        ...common,
        href,
        document: { data: entry.data as unknown as CardResource },
      };
    }
    case 'delete':
      return {
        op: 'delete',
        ...common,
        href: hrefRequired(entry, 'delete'),
      };
    case 'transform':
      return {
        op: 'transform',
        ...common,
        params: paramsFor(entry),
        href: hrefRequired(entry, 'transform'),
        name,
      };
    case 'appendLine':
      return {
        op: 'appendLine',
        ...common,
        params: paramsFor(entry),
        href: hrefRequired(entry, 'appendLine'),
      };
    case 'appendContainsMany':
      if (definition.items) {
        // A declaration says what it appends, so `field`, `items` and
        // `fields` are not read off the wire for one — which means they are
        // ordinary param names here, and subtracting them would make a
        // declaration naming one of them uninvokable. The endpoint checks the
        // payload against the same unsubtracted map before staging.
        return {
          op: 'appendContainsMany',
          ...common,
          params: paramsFor(entry),
          href: hrefRequired(entry, 'appendContainsMany'),
        };
      }
      return {
        op: 'appendContainsMany',
        ...common,
        params: paramsFor(entry, ['field', 'items', 'fields']),
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
        meta: { entry: position },
      });
  }
}

// The payload an operation's own params are read from.
//
// `data` carries two kinds of thing at once: the values an operation declares
// as params, and the members the envelope itself reads to work out what the
// entry is. The second kind is never a param, so an operation declaring one
// under the same name would be handed the envelope's value instead of the
// caller's.
//
// Subtracted per entry rather than as one flat set, because which members the
// envelope reads depends on the behavior in hand. Two are read for every
// entry: the local id a later entry links by, and the type a class-scoped
// entry is scoped to. The rest belong to one arm, and taking them out
// everywhere would make an operation declaring a param under one of those
// names uninvokable — its executor would refuse a value the caller did send,
// which is the failure the unserved-stage refusal exists to avoid.
const ENVELOPE_MEMBERS = ['lid', 'meta'] as const;

export function paramsFor(
  entry: EnvelopeEntry,
  // The members this entry's own arm reads out of `data`, on top of the two
  // every entry carries.
  alsoRead: readonly string[] = [],
): Record<string, unknown> {
  if (!entry.data) {
    return {};
  }
  let envelopeMembers = [...ENVELOPE_MEMBERS, ...alsoRead];
  let params: Record<string, unknown> = {};
  for (let [key, value] of Object.entries(entry.data)) {
    if (envelopeMembers.includes(key)) {
      continue;
    }
    params[key] = value;
  }
  return params;
}

// The entry as its `input` stage left it.
//
// The stage sees the payload — `data` without the members the envelope reads
// for itself — and produces the payload the entry is staged from, so every arm
// of `batchEntryFor` reads the transformed values wherever it reads `data`.
// The envelope's own members are carried through rather than passed to the
// program, and they win over what it produced: a `lid` is how a later entry
// links to the card this one mints, and it is read off `data` into the entry
// before a stage runs — so a program emitting one would leave the staged
// resource and the key the coordinator is given naming different cards. The
// program is handed neither member, so anything it emits under those names is
// overwriting a value it could not read.
export function entryWithPayload(
  entry: EnvelopeEntry,
  payload: Record<string, unknown>,
): EnvelopeEntry {
  let carried: Record<string, unknown> = {};
  for (let member of ENVELOPE_MEMBERS) {
    if (entry.data && own(entry.data, member) !== undefined) {
      carried[member] = entry.data[member];
    }
  }
  return { ...entry, data: { ...payload, ...carried } };
}

// A write entry's two steps before it is staged, in the order `runOperation`
// runs them for a read: the `input` stage over the payload, then the `params`
// check against what it produced. A value an `input` supplies is what the
// check then sees, which is most of what an `input` is for.
//
// The check belongs here and not in the executors: a declared param with no
// value is the caller's mistake, and the behaviors read the payload
// differently enough that some would never notice — a `delete` reads no
// payload at all, so a declaration requiring one would be carried out over a
// card the caller had not said enough to remove.
//
// A create's scope comes back carrying the payload as these two steps left it,
// since that — not what the caller sent — is what the card would be minted
// from. The transformed entry keeps its `position` and the envelope's own
// members; only the payload moves.
export async function stageWriteEntry(
  write: ResolvedEnvelopeEntry,
  ctx: TransformContext,
): Promise<ResolvedEnvelopeEntry> {
  let { entry, definition, scope } = write;
  if (definition.input) {
    entry = entryWithPayload(
      entry,
      await runInputTransform(definition, paramsFor(entry), ctx),
    );
  }
  assertParamsSupplied(definition, paramsFor(entry), {
    name: entry.name,
    ...(entry.href ? { id: entry.href } : {}),
  });
  if (definition.base === 'create') {
    // Read the way `batchEntryFor` stages it: a named create is filled from
    // its params, which leave out the members the envelope reads for itself,
    // and a plain create is minted from the whole resource, local id included.
    scope = scope.derive({
      proposed: definition.of ? paramsFor(entry) : (entry.data ?? {}),
    });
  }
  return { ...write, entry, scope };
}

function own(
  record: Record<string, unknown>,
  key: string,
): unknown | undefined {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

function hrefRequired(entry: EnvelopeEntry, base: BaseOperation): string {
  if (entry.href === undefined) {
    throw refuse(
      `entry ${entry.position} invokes "${entry.name}", which is a "${base}" ` +
        `and runs against an existing resource, and names no href`,
      entry.position,
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

// `atomic:results`, which mirrors the shape of the batch it answers: a group's
// position holds the array of its members' results, in request order, all the
// way down. A caller that composed a tree reads its answers back where it put
// the entries.
export type EnvelopeResults = (EnvelopeResult | EnvelopeResults)[];

export function writeResult(
  result: BatchEntryResult,
  // The card's id in the form the realm serves ids in. A realm reached through
  // a registered prefix answers every other surface's ids in that form — a
  // read's document, a created card's `POST` response — so a batch result
  // spelling the same card differently would hand back an id the caller cannot
  // send back as a target. Supplied by the realm, which owns identifier
  // resolution; nothing here resolves one.
  canonical: (url: string) => string,
): EnvelopeResult {
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
      id: canonical(result.id),
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

// One entry's result as its `output` stage left it.
//
// `atomic:results` is a positional list of JSON:API result objects, so a
// projection has to remain an object: a caller reading the list by position
// would otherwise find a bare string where the entry it sent reports its
// outcome. What the author leaves out of the object is the whole point of
// projecting and is not checked.
export function projectedResult(
  entry: EnvelopeEntry,
  projection: unknown,
): EnvelopeResult {
  if (
    typeof projection !== 'object' ||
    projection === null ||
    Array.isArray(projection)
  ) {
    throw new OperationFailure({
      ...(entry.href ? { id: entry.href } : {}),
      status: 400,
      code: 'invalid-params',
      title: 'Cannot run transform',
      detail:
        `the \`output\` stage of operation "${entry.name}" produced ` +
        `something other than a result object, and entry ${entry.position} ` +
        `answers with one`,
      meta: { entry: entry.position, operation: entry.name, stage: 'output' },
    });
  }
  return projection as Record<string, unknown>;
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
      detail: `the read in entry ${entry.position} answered with no document`,
      meta: { entry: entry.position },
    });
  }
  return result.document as unknown as Record<string, unknown>;
}

// Every entry answers, and its answer sits where the entry did.
//
// An unfilled position would serialize as `null`, which is what a delete
// reports — so a batch that ran fewer entries than it read would answer with a
// removal nobody asked for rather than saying that something did not run.
export function resultsTree(
  nodes: readonly EnvelopeNode[],
  results: ReadonlyMap<EntryPosition, EnvelopeResult>,
): EnvelopeResults {
  return nodes.map((node) =>
    isGroup(node)
      ? resultsTree(node.members, results)
      : answered(results.get(node.position), node.position),
  );
}

function answered(
  result: EnvelopeResult | undefined,
  position: EntryPosition,
): EnvelopeResult {
  if (result === undefined) {
    throw new OperationFailure({
      status: 500,
      code: 'internal-error',
      title: 'Missing result',
      detail: `entry ${position} was read from the batch and produced no result`,
      meta: { entry: position },
    });
  }
  return result;
}

// The batch the coordinator stages: the request tree with the entries that
// only read taken out of it, and each remaining entry as the coordinator takes
// one.
//
// The tree is kept rather than flattened because it is the schedule — which
// entries may stage at the same time and which must follow one another — and
// pruning cannot change that: a read entry stages nothing, so removing one
// leaves the remaining members exactly as independent, or as dependent, as the
// caller wrote them. A group all of whose members only read is dropped whole;
// keeping it would hand the coordinator a group with nothing in it.
export function stagedTree(
  nodes: readonly EnvelopeNode[],
  staged: ReadonlyMap<EntryPosition, BatchEntry>,
): BatchNode[] {
  let batch: BatchNode[] = [];
  for (let node of nodes) {
    if (!isGroup(node)) {
      let entry = staged.get(node.position);
      if (entry) {
        batch.push(entry);
      }
      continue;
    }
    let members = stagedTree(node.members, staged);
    if (members.length > 0) {
      batch.push({ op: node.op, members });
    }
  }
  return batch;
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
// For a refusal raised where the position is known outright — an entry parsed
// or resolved one at a time. A staged entry carries its position into the
// coordinator instead, which writes it everywhere a position appears rather
// than leaving one key to be corrected afterwards.
export function atEntry(err: unknown, position: EntryPosition): unknown {
  if (!isOperationFailure(err)) {
    return err;
  }
  if (err.error.meta?.entry !== undefined) {
    return err;
  }
  return new OperationFailure({
    ...err.error,
    meta: { ...err.error.meta, entry: position },
  });
}

function refuse(
  detail: string,
  position?: EntryPosition,
  id?: string,
): OperationFailure {
  return new OperationFailure({
    ...(id ? { id } : {}),
    status: 400,
    code: 'invalid-params',
    title: 'Invalid operations envelope',
    detail,
    ...(position === undefined ? {} : { meta: { entry: position } }),
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainRecord(value) ? value : undefined;
}
