import { RealmPaths } from '../paths.ts';
import { getImmediateFieldDef, type Definition } from '../definitions.ts';
import {
  parseSearchEntryQueryFromPayload,
  type SearchEntryWireQuery,
} from '../search-entry.ts';
import type { CardResource, Relationship } from '../resource-types.ts';
import { OperationFailure, type EntryPosition } from './types.ts';
import { STAGING_WIDTH } from './coordinator.ts';
import type { OperationCore, OperationScope } from './dispatch.ts';
import {
  invocationsIn,
  isGroup,
  type EnvelopeEntry,
  type EnvelopeNode,
  type ParseEnvelopeOptions,
  type QueryTarget,
} from './envelope.ts';

// ============================================================================
// Query-defined targets: the cards an entry describes rather than names.
//
// An entry carrying `boxel:target` says which card it runs against with a
// filter, and this is where that filter becomes one or more cards. It runs
// once for the whole batch, before any entry's definition is resolved and well
// before anything stages, and it answers with the same tree it was handed —
// every query target replaced by entries carrying an ordinary `href`.
//
// That replacement is the whole design. Nothing downstream of here knows a
// target was found rather than named: a found target takes the batch's write
// lock, collides with a parallel sibling under the same `conflicting-targets`
// rule, resolves its operation against its own card's type and rolls back with
// the rest. There is no second code path for query-defined targets, which is
// what keeps the guarantees the batch already makes from having to be restated
// for them.
//
// **Pre-batch state, like everything else a batch reads.** The filter runs
// against the realm's index as it stands when the request arrives, so a card
// an earlier entry in the same batch creates is not findable — it has not been
// written, let alone indexed. The zero-match refusal says so when the batch is
// one that mints cards, because that is the mistake the shape invites.
//
// **An entry that matched nothing is gone by the time the definition gates
// run.** Those gates — whether a `QUERY` batch holds a write, whether an
// anonymous caller invoked something that reads the actor — are answered from
// an entry's definition, and a definition comes from the type of the card the
// entry targets. With no match there is no card, so there is no question to
// answer: a `QUERY` batch holding an `expect: "many"` entry that matched
// nothing answers 200 with `[]` rather than the refusal it would earn if the
// query had matched. Nothing is written either way and the realm's own
// permission check ran as it always does; what differs is which answer a
// caller sees for a request whose entry did nothing.
// ============================================================================

// What one entry's `boxel:target` resolved to: the card URLs, in the order the
// index returned them, that the entry will run against.
type FoundTargets = string[];

export async function resolveQueryTargets(
  core: OperationCore,
  scope: OperationScope,
  nodes: readonly EnvelopeNode[],
  opts: ParseEnvelopeOptions = {},
): Promise<EnvelopeNode[]> {
  let queried = invocationsIn(nodes).filter((entry) => entry.find);
  if (queried.length === 0) {
    // The common batch, which names every target it touches. It costs nothing
    // — no search, no row read — and reaches the rest of the request holding
    // the tree it was parsed into.
    return nodes as EnvelopeNode[];
  }
  let paths = new RealmPaths(new URL(core.realmURL));
  let mintsCards = batchMintsCards(nodes);
  // Settled rather than raced, for the reason every other pass over a batch's
  // entries is: a batch with two bad entries would otherwise name a different
  // one run to run, decided by which search came back first.
  //
  // Bounded by the same width staging is, and for the same reason: how many
  // entries a batch carries is as much the caller's number as how many cards
  // one of them matches, and each resolution here costs a search — two
  // statements, since the engine runs the rows and the count together. An
  // unbounded fan-out would let one authorized request decide how much of the
  // realm's connection pool it holds, which is the decision the width exists
  // to keep out of a caller's hands.
  let outcomes = await settledWithin(STAGING_WIDTH, queried, (entry) =>
    resolveOne(entry, { core, scope, paths, opts, mintsCards }),
  );
  let refused = outcomes.find((outcome) => outcome.status === 'rejected');
  if (refused) {
    throw refused.reason;
  }
  let resolved = new Map<EntryPosition, EnvelopeNode>();
  for (let [index, outcome] of outcomes.entries()) {
    let entry = queried[index];
    resolved.set(
      entry.position,
      nodeFor(entry, (outcome as PromiseFulfilledResult<FoundTargets>).value),
    );
  }
  return substitute(nodes, resolved);
}

// One resolved entry, in the shape the rest of the batch reads.
//
// Expecting one card answers one entry, standing where the caller's did and
// keeping its position — so `meta.entry` on anything it later refuses is the
// number the caller sent.
//
// Expecting many answers a `serial` group of one entry per target. It is a
// group because a group is already how the envelope spells "these results go
// in an array at this position", and it is serial because the targets are
// carried out in the order the index returned them. The group is the caller's
// entry expanded in place, so where the caller put it inside a `parallel`
// group, its targets are one branch of that group and still collide with the
// siblings beside it.
//
// No targets is an empty group, which stages nothing and answers `[]` — the
// valid empty result, not a refusal. The envelope refuses an empty group off
// the wire, because a caller that sent one meant to send members; one that
// resolution produced means exactly what it says.
function nodeFor(entry: EnvelopeEntry, targets: FoundTargets): EnvelopeNode {
  let { find: _dropped, ...rest } = entry;
  if (entry.find!.expect === 'one') {
    return { ...rest, href: targets[0], found: true };
  }
  return {
    op: 'serial',
    position: entry.position,
    members: targets.map((href, index) => ({
      ...rest,
      position: foundPosition(entry.position, index),
      href,
      found: true,
    })),
  };
}

// Where one of an expansion's entries sits, in the terms a caller can point at
// it with. There is no array in the request body for it to be an index into —
// the caller wrote one entry — so it is named by the member that produced it
// and its place in what that member found, in the same path spelling a group's
// members are named by.
function foundPosition(parent: EntryPosition, index: number): EntryPosition {
  let prefix = typeof parent === 'number' ? `[${parent}]` : parent;
  return `${prefix}.boxel:target[${index}]`;
}

// Every item's outcome, with at most `width` of them in flight at a time.
//
// `Promise.allSettled` over a mapped array is the shape this replaces, and the
// two differ only in how many run at once: results still sit at their item's
// index, and a rejection is still carried rather than thrown, so the earliest
// refusal in request order is the one the caller is told about however the
// work interleaved.
async function settledWithin<T, R>(
  width: number,
  items: readonly T[],
  run: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  let outcomes: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  let worker = async () => {
    while (next < items.length) {
      let at = next++;
      try {
        outcomes[at] = { status: 'fulfilled', value: await run(items[at]) };
      } catch (reason: unknown) {
        outcomes[at] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, worker),
  );
  return outcomes;
}

// The tree with each query target replaced by what it resolved to.
function substitute(
  nodes: readonly EnvelopeNode[],
  resolved: ReadonlyMap<EntryPosition, EnvelopeNode>,
): EnvelopeNode[] {
  return nodes.map((node) => {
    if (isGroup(node)) {
      return { ...node, members: substitute(node.members, resolved) };
    }
    return resolved.get(node.position) ?? node;
  });
}

interface Resolution {
  core: OperationCore;
  scope: OperationScope;
  paths: RealmPaths;
  opts: ParseEnvelopeOptions;
  mintsCards: boolean;
}

async function resolveOne(
  entry: EnvelopeEntry,
  context: Resolution,
): Promise<FoundTargets> {
  let find = entry.find!;
  let { urls, total } = await runFilter(entry, find, context);
  if (find.expect === 'one') {
    heldToOneMatch(entry, urls, total, context);
  }
  if (!find.field) {
    return urls;
  }
  // One match at a time, rather than all of them at once. Each hop reads the
  // matched card's index row, so a wide `many` would otherwise decide for
  // itself how much of the realm's connection pool one request holds — the
  // thing the staging width downstream exists to stop a caller choosing. It
  // also settles which refusal is reported without having to sort them: the
  // earliest match that cannot be followed is the one that throws.
  //
  // Each card once, in the order it was first reached. A hop converges —
  // every open report may name one owner — and the entry names the cards it
  // runs against, not the routes by which it found them, so a card reached
  // three ways is one target. Nothing downstream would catch the duplicate
  // either: the expansion is `serial`, and serial composes two changes to one
  // file rather than refusing them, so `conflicting-targets` sees nothing
  // wrong. An idempotent `update` would hide it; an append would land three
  // times.
  let targets: string[] = [];
  let reached = new Set<string>();
  for (let match of urls) {
    for (let target of await hop(entry, find, match, context)) {
      if (!reached.has(target)) {
        reached.add(target);
        targets.push(target);
      }
    }
  }
  if (find.expect === 'one' && targets.length > 1) {
    // The one match's link field holds a collection, so the entry names as
    // many cards as that collection has members. Refused rather than answered
    // with the first, and refused here rather than by widening the entry to
    // all of them: which shape the result takes is the caller's to choose —
    // `expect` decides whether this entry answers with a result or an array of
    // them — and the field's arity is not something the caller stated.
    throw refuse(
      `entry ${entry.position} follows "${find.field}" from ${urls[0]}, ` +
        `which links to ${targets.length} cards; an entry expecting one ` +
        `card is refused rather than run against one picked from several — ` +
        `send \`"expect": "many"\` to run against all of them`,
      entry.position,
      urls[0],
    );
  }
  return targets;
}

// The count rule, applied to what the filter matched. `many` takes whatever
// there is, none included; `one` holds out for exactly one match and names the
// count it got instead.
//
// Decided on the rows, not on the count. The engine runs the data statement
// and the `COUNT(*)` concurrently, as two statements on two connections, so an
// index update landing between them leaves the two describing different
// snapshots. Trusting the count is then wrong in both directions: a count of
// one beside two returned rows would pass this rule and run the entry against
// whichever row came first, and a count of one beside no rows would pass it
// with nothing to target. The rows are what the entry can actually act on, and
// the page holds two, which is all this rule needs to tell none from one from
// several.
//
// The count is still what a refusal reports, because the rows cannot say how
// many there are once the page is full — but never as less than the rows
// themselves, so the number is never smaller than what was seen.
function heldToOneMatch(
  entry: EnvelopeEntry,
  urls: readonly string[],
  reported: number,
  { mintsCards }: Resolution,
): void {
  if (urls.length === 1) {
    return;
  }
  let total = Math.max(urls.length, reported);
  if (urls.length === 0) {
    throw refuse(
      `entry ${entry.position} describes the card it runs against with a ` +
        `query, and the query matched no card; an entry expecting one card ` +
        `is refused rather than run against none` +
        (mintsCards
          ? `. A query runs against the realm's index as this batch found ` +
            `it, so a card another entry of this batch creates is not one ` +
            `it can match — nothing this batch writes exists yet, let alone ` +
            `is indexed`
          : ``),
      entry.position,
    );
  }
  throw refuse(
    `entry ${entry.position} describes the card it runs against with a ` +
      `query, and ${total} cards answer to it; an entry expecting one card ` +
      `is refused rather than run against one picked from several — send ` +
      `\`"expect": "many"\` to run against all of them`,
    entry.position,
  );
}

// The filter, run against this realm's own index.
//
// Three things about the query are the realm's rather than the caller's, and
// all three are what keep a match meaning one thing. The realm is this one, so
// a result outside it is impossible rather than refused. The scope is cards,
// so a card's `.json` file row — which a realm-wide query returns alongside
// the card's own row — cannot be counted as a second match for the same card.
// And the fieldset asks for an item field rather than the default, which is
// the selected renderings: resolution reads identities, and the default would
// have the realm assemble every match's HTML and side-load its links to answer
// a question about which cards exist.
async function runFilter(
  entry: EnvelopeEntry,
  find: QueryTarget,
  { core }: Resolution,
): Promise<{ urls: string[]; total: number }> {
  let wire: SearchEntryWireQuery = {
    filter: find.query,
    scope: 'cards',
    fields: { entry: [IDENTITY_FIELDSET] },
    // An entry expecting one card needs to tell none from one from several
    // and nothing beyond that, so it reads at most two rows and takes the
    // count off the result meta — which counts every matching row whatever
    // the page held, and so names the number the refusal reports even when
    // that number is large. An entry expecting many runs against all of them
    // and asks for no page at all.
    ...(find.expect === 'one' ? { page: { size: 2 } } : {}),
  };
  let marker = markerIn(find.query);
  if (marker) {
    // A marker is how a *declared* query stands in for a value only known when
    // someone invokes the operation, and lowering resolves it against the
    // invocation. This filter is not a declaration — the caller wrote it and
    // holds every value in it — so nothing resolves one here.
    //
    // Refused rather than passed through, because the search grammar accepts
    // it: `{ "$ref": "actor" }` is a well-formed operand, so it would be
    // compared against a stored value as a literal object, match nothing, and
    // answer `[]` under `many` or blame the data under `one`. An author coming
    // from declared `query` syntax, or from a client that offers `actor()`,
    // would have no way to tell that from a filter that genuinely matched
    // nothing.
    throw refuse(
      `entry ${entry.position} describes the card it runs against with a ` +
        `query containing ${marker}, which stands for a value a declared ` +
        `operation supplies when it is invoked; a "boxel:target" is written ` +
        `by the caller, so it carries the value itself`,
      entry.position,
    );
  }
  let query;
  try {
    query = parseSearchEntryQueryFromPayload(wire);
  } catch (err: any) {
    throw refuse(
      `entry ${entry.position} describes the card it runs against with a ` +
        `query the realm does not accept — ${err?.message ?? String(err)}`,
      entry.position,
    );
  }
  let doc = await core.indexQueryEngine.searchEntries(query);
  return {
    urls: doc.data.map((match) => match.id),
    total: doc.meta.page.total,
  };
}

// The names a declared query's markers are written under, and the members one
// carries besides `$ref`. Read off the resolver those markers go through, so
// what is refused here is exactly what would have been resolved there.
const MARKER_NAMES = ['params', 'actor', 'card', 'instance', 'realmConfig'];
const MARKER_MEMBERS = ['$ref', 'key', 'value'];

// The first marker anywhere in a filter, named the way an author writes it, or
// undefined when the filter carries none.
//
// Structural, wherever it sits — a filter operand, a member of an `in` list, a
// branch of an `any` — because that is how the resolver that *does* resolve
// markers recognizes one, and a check that looked in fewer places than the
// thing it guards would pass exactly the payloads worth refusing.
//
// Narrow on purpose, though: a filter operand is a literal JSON value, and a
// card field may legitimately store an object. So an object is read as a
// marker only when it is one — a `$ref` naming a marker this runtime resolves,
// and no member beyond the ones such a marker carries. `{ "$ref": "#/defs/x" }`
// is somebody's JSON Schema fragment and filters for it as data; a field
// storing `{ "$ref": "actor" }` and nothing else is indistinguishable from the
// marker and is the one shape this makes unfilterable from a query target,
// which `href` and the search endpoint both still reach.
function markerIn(node: unknown): string | undefined {
  if (Array.isArray(node)) {
    for (let member of node) {
      let found = markerIn(member);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  if (typeof node !== 'object' || node === null) {
    return undefined;
  }
  let record = node as Record<string, unknown>;
  let ref = record.$ref;
  if (
    typeof ref === 'string' &&
    MARKER_NAMES.includes(ref) &&
    Object.keys(record).every((member) => MARKER_MEMBERS.includes(member))
  ) {
    return typeof record.key === 'string'
      ? `${ref}("${record.key}")`
      : `${ref}()`;
  }
  for (let value of Object.values(record)) {
    let found = markerIn(value);
    if (found) {
      return found;
    }
  }
  return undefined;
}

// The one member of the sparse fieldset, which selects nothing.
//
// An entry's id rides on the entry itself rather than on its `item`, so
// resolution reads the whole of what it needs without any item field at all.
// The fieldset is not optional, though — a query that names none gets the
// default, which is the rendering set — so this names the id and the item
// resource it produces comes back empty. What it buys is the projection: no
// HTML, and no link assembly, which is where a search that only wanted
// identities would otherwise spend its time.
const IDENTITY_FIELDSET = 'item.id';

// Follow one link from a matched card.
//
// The field is read off the matched card's own definition rather than guessed
// from what the stored JSON happens to carry, because the two disagree in
// exactly the case that matters: a link nobody has set is stored the same way
// a field that does not exist is — as nothing — and telling a caller its
// `"classroom"` matched no card when the field is really called `"class"` is
// the refusal that costs the most to work out from the outside.
async function hop(
  entry: EnvelopeEntry,
  find: QueryTarget,
  match: string,
  context: Resolution,
): Promise<string[]> {
  let field = find.field!;
  let { core, scope, paths, opts } = context;
  let url = new URL(match);
  let row = await scope.peekInstance(url);
  // Both of these are races against the search that matched the card moments
  // ago — this path's filter excludes error rows, so neither is a state the
  // query could have selected — and neither is the caller's request being
  // wrong. So they carry the codes this subsystem already has for them rather
  // than `invalid-params`, which would tell a client to fix a payload when
  // retrying is the remedy.
  if (!row) {
    throw new OperationFailure({
      id: match,
      status: 404,
      code: 'target-not-found',
      title: 'Target not found',
      detail:
        `entry ${entry.position} follows "${field}" from ${match}, which ` +
        `this realm no longer has an index row for`,
      meta: { entry: entry.position },
    });
  }
  if (row.type !== 'instance') {
    // The row's own message travels in the detail: the caller needs to know
    // why the card it matched cannot be read, not only that it cannot. The
    // row's status is not mirrored the way a read mirrors it — this is not
    // serving the card, it is reporting that a target cannot be followed to.
    throw new OperationFailure({
      id: match,
      status: 422,
      code: 'target-errored',
      title: 'Target errored',
      detail:
        `entry ${entry.position} follows "${field}" from ${match}, whose ` +
        `index row is an error row: ${row.error.message}`,
      meta: { entry: entry.position },
    });
  }
  let definition = await definitionOf(core, row.instance, url);
  let fieldDef = definition && getImmediateFieldDef(definition, field);
  if (!fieldDef) {
    throw refuse(
      `entry ${entry.position} follows "${field}" from ${match}, which has ` +
        `no field by that name`,
      entry.position,
      match,
    );
  }
  if (fieldDef.type !== 'linksTo' && fieldDef.type !== 'linksToMany') {
    throw refuse(
      `entry ${entry.position} follows "${field}" from ${match}, which is a ` +
        `${fieldDef.type} field; a query target follows a link to another ` +
        `card`,
      entry.position,
      match,
    );
  }
  // Two ways a link field holds no stored target, kept apart because they are
  // different facts about the field and a caller fixes them differently — the
  // same split the write side draws in `unwritableReason`.
  //
  // They have to be asked separately for a second reason: a field declared
  // with a `query` and no `computeVia` reaches here with `isComputed` false.
  // The definition entry records `isComputed` from `computeVia` alone and
  // carries the query beside it, so a single `isComputed` test would follow a
  // query-backed link, find nothing on the row — a query-backed field's
  // members are written onto the served copy, never onto the stored one — and
  // answer as though the card simply had no link, which under `many` is an
  // empty result rather than a refusal.
  if (fieldDef.isComputed) {
    throw refuse(
      `entry ${entry.position} follows "${field}" from ${match}, which is ` +
        `computed; its value comes from its \`computeVia\` rather than from ` +
        `a link the realm stored`,
      entry.position,
      match,
    );
  }
  if (fieldDef.query !== undefined) {
    throw refuse(
      `entry ${entry.position} follows "${field}" from ${match}, which is ` +
        `resolved by a \`query\`; it holds no stored link to follow, and the ` +
        `cards it answers with are whatever that query returns when the ` +
        `field is read`,
      entry.position,
      match,
    );
  }
  let links = linksOf(row.instance, field, fieldDef.type);
  if (links.length === 0) {
    if (find.expect === 'many') {
      // A card with an empty link contributes no target, the same way a query
      // matching nothing produces none. Skipped rather than refused because
      // `many` is the caller saying it does not know how many there will be,
      // and one of the answers to that is none.
      return [];
    }
    throw refuse(
      `entry ${entry.position} follows "${field}" from ${match}, whose ` +
        `"${field}" links to no card`,
      entry.position,
      match,
    );
  }
  return links.map((link) =>
    hopTarget(entry, field, match, link, {
      paths,
      opts,
      from: url,
    }),
  );
}

// The cards a link field points at, as the stored serialization spells them.
//
// A `linksTo` is one relationship under the field's own name. A `linksToMany`
// is one per member, keyed `field.0`, `field.1`, …, and a collection an author
// emptied is the field's own name carrying a null link — the same spelling a
// `linksTo` nobody has set carries, which is why neither is read as a target.
function linksOf(
  instance: CardResource,
  field: string,
  type: 'linksTo' | 'linksToMany',
): string[] {
  let relationships = instance.relationships ?? {};
  if (type === 'linksTo') {
    let self = selfOf(relationships[field]);
    return self ? [self] : [];
  }
  let links: string[] = [];
  for (let index = 0; ; index++) {
    let relationship = relationships[`${field}.${index}`];
    if (relationship === undefined) {
      break;
    }
    let self = selfOf(relationship);
    if (self) {
      links.push(self);
    }
  }
  return links;
}

function selfOf(
  relationship: Relationship | Relationship[] | undefined,
): string | undefined {
  if (!relationship || Array.isArray(relationship)) {
    return undefined;
  }
  let self = relationship.links?.self;
  return typeof self === 'string' && self.length > 0 ? self : undefined;
}

// One link as the URL this realm addresses the card by.
//
// A stored link is written relative to the card holding it, or under a
// registered prefix, because that is what makes a realm's files portable. A
// prefix goes through the realm's identifier map; anything else is joined
// against the card the link was read from, which is where this differs from
// how an entry's own `href` resolves — an `href` is parsed absolute or taken
// as a path from the realm root, and is never joined against a card.
//
// A hop can leave this realm, which a query cannot — a card in one realm may
// link to a card in another. The batch commits under one realm's write lock,
// so a target outside it is not something the endpoint can carry out; the
// refusal names both ends, since the caller wrote neither URL and the one that
// surprised it is the link.
function hopTarget(
  entry: EnvelopeEntry,
  field: string,
  match: string,
  link: string,
  {
    paths,
    opts,
    from,
  }: { paths: RealmPaths; opts: ParseEnvelopeOptions; from: URL },
): string {
  let resolved = opts.resolveIdentifier?.(link) ?? link;
  if (resolved.startsWith('@')) {
    // A scoped reference the identifier map did not resolve, which means this
    // process has not registered its prefix. It is cross-realm by
    // construction — that is exactly why the writer stores it verbatim
    // instead of relativizing it — and it must not reach the join below: a
    // scoped reference is not a URL, so joining it against the matched card
    // produces a path *inside* this realm that nothing stores, and the
    // out-of-realm refusal would never fire for the one spelling that is
    // always out of realm.
    throw refuse(
      `entry ${entry.position} follows "${field}" from ${match} to ` +
        `"${link}", which names a realm this one has no prefix registered ` +
        `for; a batch commits to one realm`,
      entry.position,
      match,
    );
  }
  let absolute: URL;
  try {
    absolute = new URL(resolved, from);
  } catch {
    throw refuse(
      `entry ${entry.position} follows "${field}" from ${match} to ` +
        `"${link}", which is not a URL`,
      entry.position,
      match,
    );
  }
  try {
    paths.local(absolute);
  } catch {
    throw refuse(
      `entry ${entry.position} follows "${field}" from ${match} to ` +
        `${absolute.href}, which realm ${paths.url} does not contain; a ` +
        `batch commits to one realm`,
      entry.position,
      absolute.href,
    );
  }
  return absolute.href;
}

// The type entry a matched card's fields are declared on, read off the row the
// filter already matched rather than from the card's source.
async function definitionOf(
  core: OperationCore,
  instance: CardResource,
  url: URL,
): Promise<Definition | undefined> {
  let adoptsFrom = instance.meta?.adoptsFrom;
  if (!adoptsFrom) {
    return undefined;
  }
  let resolved = core.resolveCodeRef(adoptsFrom, url);
  if (!resolved) {
    return undefined;
  }
  try {
    return await core.definitionLookup.lookupDefinition(resolved);
  } catch {
    return undefined;
  }
}

// Whether this batch mints cards, as the envelope alone can tell.
//
// Two marks, both of them the envelope's own rather than the operation's: a
// local id is the caller's handle on a card this batch will mint, and an entry
// naming no target at all is one scoped to a type, which is the other shape a
// create takes. Neither needs a definition, which is the point — this is read
// before any entry's operation has been resolved, to say something in the
// zero-match refusal about the mistake that shape invites.
function batchMintsCards(nodes: readonly EnvelopeNode[]): boolean {
  return invocationsIn(nodes).some(
    (entry) =>
      entry.lid !== undefined ||
      (entry.href === undefined && entry.find === undefined),
  );
}

function refuse(
  detail: string,
  position: EntryPosition,
  id?: string,
): OperationFailure {
  return new OperationFailure({
    ...(id ? { id } : {}),
    status: 400,
    code: 'invalid-params',
    title: 'Invalid operations envelope',
    detail,
    meta: { entry: position },
  });
}
