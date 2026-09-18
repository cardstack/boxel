// Per-request query-shape telemetry for the federated search.
//
// One JSON-object log line per `_federated-search` request on the
// `boxel:search-shape` channel — the same emit convention as
// `boxel:client-perf` and `boxel:screenshot-perf`: the whole line is one JSON
// object carrying an explicit `channel` field so Loki's `| json` parse reads
// it, and every member is a flat top-level scalar so LogQL can filter and
// aggregate on it directly (nested objects and arrays flatten into
// per-key/per-index labels instead).
//
// Why it exists: a federated search is a `QUERY` whose query travels in the
// request body. Access logs carry method, URL, status and timing and never
// bodies, so without this line a load event is legible only as a request rate
// — how many searches ran, from how many users, and how long each took, with
// nothing about what any of them asked for. That is the question both a
// diagnosis ("which card type's render is issuing these") and a replay
// ("issue the same queries against the same index paths") start from.
//
// What it carries is the *shape*, never the content. A filter's structure —
// its operators, the field paths they address, and the card types they anchor
// on — is schema; the values bound to those operators are card field values,
// so they are user data and none of them are logged. `eq` and `contains`
// render their field paths and drop what those fields were compared against,
// `in` renders its field paths and neither its members nor how many there
// were, `range` renders its bound operators and not its bounds, and a
// full-text `matches` renders as the bare operator. A `cardUrls` subset is
// reported as a count for the same reason: those URLs identify individual
// cards. Nothing is read from the response beyond how many entries it carries.
//
// Always on, for every request, unsampled. The rate this path sustains makes
// that a real log spend, but a sampler drops exactly the outlier a diagnosis
// is looking for, and a flag that is off when an incident starts is worth
// nothing during it. Should the spend ever outweigh that, it is a named
// channel like any other — `LOG_LEVELS=boxel:search-shape=none` silences it —
// so the lever is there without the default being the quiet one.
//
// What keeps that trade honest is `MAX_MEMBER_CHARS`. The rendered members are
// caller-controlled text — a filter reports the field paths the request named,
// and nothing upstream bounds how long or how many those are — so an uncapped
// line is a caller's to size at will, once per request. Each rendered member
// is capped; `truncated` says when one was. The cap is not only about spend: a
// long enough line is what a log shipper drops, which would make the
// pathological query the one that goes unrecorded.
//
// Grouping: `shapeHash` is a stable hash over the shape members alone (filter,
// sort, htmlQuery, page size, fieldset, scope, link mode, and whether a
// `cardUrls` subset applies). It is derived from the shape text and nothing
// else — no process state, no clock — so the same query hashes the same on
// every realm-server and across restarts. The text it hashes is the pre-cap
// text, so a capped line still groups with its own shape.
//
// Counting distinct hashes answers "how many shapes is this load made of", but
// no member of this line groups one render. `correlationId` is minted per
// search, so every line carrying one carries its own — and a live request whose
// client-telemetry instrument is dormant carries none at all. `jobId` is the
// indexing job the search ran under (queue job + reservation), held across the
// whole file sweep, so it groups an entire index pass rather than one visit.
// Live browser traffic reaches a tab session only by joining `correlationId` to
// the `server-request` event on `boxel:client-perf`.
//
// The hash folds what the handler's cache key folds, for the same reason: a
// member that changes the response body is a member two requests differ by.
// Whatever a response's size and cost turn on belongs in both.
//
// Correlation: `correlationId` joins a line to the realm-server's
// `realm:requests` lines and to the `realm:search-timing` stage breakdown for
// the same request (that one is emitted only when the client minted a
// correlation id; this one is emitted regardless). `jobId` joins an in-render
// search to the indexing job that caused it, and `consumingRealm` names the
// realm whose render issued it.

import { logger } from './log.ts';
import type { CodeRef } from './code-ref.ts';
import type { LinkShapeLevel, LinkShapeRowClass } from './link-shape-policy.ts';
import type { Filter, Query, RangeOperator, Sort } from './query.ts';
import type { HtmlQuery } from './resource-types.ts';
import type {
  SearchEntryFieldset,
  SearchEntryQuery,
  SearchEntryScope,
} from './search-entry.ts';

export const SEARCH_SHAPE_CHANNEL = 'boxel:search-shape';

// Which cache, if any, produced the response — the difference between a search
// that cost an index read and one that cost nothing, which the request rate
// alone cannot show.
export type SearchShapeCacheOutcome =
  // No cache in play: the handler computed the response itself.
  | 'none'
  // Live-search cache: this request did the computing and the result was
  // retained for the TTL window.
  | 'miss'
  // Live-search cache: awaited an identical computation already in flight.
  | 'join'
  // Live-search cache: served from the TTL window.
  | 'hit'
  // Job-scoped (indexer) cache: this request did the computing and the result
  // was written to the job's slot.
  | 'job-miss'
  // Job-scoped cache: served from the job's slot.
  | 'job-hit'
  // Job-scoped cache revalidated the caller's ETag — a 304 with no body.
  | 'not-modified';

// How much of a result's link graph the response carries — the largest
// per-result cost there is, and one the query itself does not show. A
// prerender skips the `loadLinks` relationship-assembly pass outright; a live
// search configured against side-loading runs the pass and drops the closure;
// the default assembles the whole closure. The same query in two of these
// modes is two different response bodies, which is why the handler's cache key
// separates them and why the shape hash does too.
export type SearchShapeLinkMode = 'prerender' | 'links-only' | 'full';

// The members derivable from the request alone. Everything here is a function
// of the query, so two identical requests produce identical descriptors.
export interface SearchShapeDescriptor {
  // The canonical value-elided filter tree, or null for a filter-less query —
  // one that matches every entry in the searched realms.
  filter: string | null;
  // Sort expressions in precedence order, each `[<anchor>:]<field>:<direction>`.
  sort: string | null;
  // The rendering selection, reported only where the fieldset puts the html
  // branch in play. A fieldset without `html` makes the htmlQuery inert — the
  // response is identical whatever it says — which is the same condition under
  // which the handler folds it into the cache key.
  htmlQuery: string | null;
  // The page the request asked for. `pageSize` is post-clamp: the ceiling the
  // server applies to a live item-leg search has already been imposed, so this
  // is the page the query actually ran with.
  //
  // Both are coerced to numbers here rather than passed through. The grammar
  // admits a numeric string for `page.size` and validates `page.number` not at
  // all, and the server-side clamp that would coerce the size runs only on the
  // item leg — so without this a caller decides what type lands in the line,
  // and a string or an object breaks the flat-scalar contract the channel
  // rests on. A value that is not a finite number is reported as absent.
  pageSize: number | null;
  pageNumber: number | null;
  // Whether the request pinned an index generation — the consistency token
  // that holds a paginated walk against one view of the index.
  pageGeneration: boolean;
  // The sparse fieldset: whether the html branch is selected, which form of
  // the `item` serialization is, and (for a sparse selection) the field paths
  // it names.
  html: boolean;
  item: 'none' | 'full' | 'sparse';
  itemFields: string | null;
  // The default resolution policy, which a request selects by naming no
  // fieldset at all: the `item` branch is emitted per result only where no
  // rendering matched. An explicit fieldset pins its branches instead. The two
  // spell the same `html` / `item` selection while producing different rows,
  // so this separates them.
  itemAsFallback: boolean;
  // The mode the response was built in. With the load-driven policy in play
  // this is the *served* mode, which is not always the one asked for.
  linkMode: SearchShapeLinkMode;
  // The mode the caller asked for. One field cannot distinguish "the caller
  // asked for links-only" and got it from "the caller asked for the closure
  // and was downgraded", and without both, a slow page cannot be attributed
  // after the fact — the load that caused the decision is long gone by the
  // time anyone asks. `downgraded` is derivable from the pair and carried
  // anyway, so the common filter is a field match rather than a comparison.
  requestedLinkMode: SearchShapeLinkMode;
  linkModeDowngraded: boolean;
  // The policy's inputs on the request it decided: the sustained in-flight
  // reading consulted, the level in force for the realm, and the row class the
  // request was classified as. Recording the inputs rather than only the
  // outcome is what separates a policy that did the right thing on bad inputs
  // from one that misjudged good inputs. Null during a prerender, which never
  // reaches the policy.
  linkShapeLoad: number | null;
  linkShapeLevel: LinkShapeLevel | null;
  linkShapeRowClass: LinkShapeRowClass | null;
  scope: SearchEntryScope;
  // How many card URLs the request narrowed results to. The URLs themselves
  // identify individual cards, so they are not logged.
  cardUrlCount: number;
  shapeHash: string;
  // Whether any rendered member hit `MAX_MEMBER_CHARS` and was cut. The hash is
  // taken before the cap, so a cut line still groups correctly; this is what
  // stops a reader reading the cut text as the whole of it.
  truncated: boolean;
  // The realms the request named, in payload order, every one of them
  // authorized for the caller — an unauthorized realm fails the whole request
  // rather than being dropped from this list. It is not the list the fan-out
  // ultimately searched: a realm that cannot be mounted is dropped there, which
  // is what `incomplete` reports against this same list.
  realms: string;
  realmCount: number;
  correlationId: string | null;
  jobId: string | null;
  consumingRealm: string | null;
  jobPriority: number | null;
}

// What the request cost, stamped once the response is settled.
export interface SearchShapeObservation {
  // Entries in the response page, and the total matching the query across the
  // searched realms. Null where the handler never built a document: a cache
  // hit, join or 304 answers from a body another request computed, and a
  // request that fails before the search runs builds nothing at all. `total`
  // is additionally null on an incomplete merge, where it counts only the
  // realms that answered and so is a floor rather than a match count.
  results: number | null;
  total: number | null;
  // Whether a realm the query fanned out to failed to answer, leaving the
  // result set short of what the query asked about. Null alongside the counts
  // when no document was built.
  incomplete: boolean | null;
  cache: SearchShapeCacheOutcome;
  status: number;
  totalMs: number;
}

export type SearchShapeEvent = SearchShapeDescriptor & SearchShapeObservation;

// Test seam, mirroring `emitSearchTiming` / `emitScreenshotPerf`: when set,
// events go to the sink instead of the logger so a test can assert on records
// without scraping stdout.
let searchShapeSink: ((event: SearchShapeEvent) => void) | undefined;

export function setSearchShapeSink(
  sink: ((event: SearchShapeEvent) => void) | undefined,
): void {
  searchShapeSink = sink;
}

// Created lazily: a module-scope `logger()` here can race the circular import
// that installs the log-definitions factory (the same hazard
// `emitSearchTiming` documents).
let searchShapeLog: ReturnType<typeof logger> | undefined;

export function emitSearchShape(event: SearchShapeEvent): void {
  if (searchShapeSink) {
    searchShapeSink(event);
    return;
  }
  (searchShapeLog ??= logger(SEARCH_SHAPE_CHANNEL)).info(
    JSON.stringify({ channel: SEARCH_SHAPE_CHANNEL, ...event }),
  );
}

export function describeSearchShape(args: {
  query: SearchEntryQuery;
  realms: string[];
  linkMode: SearchShapeLinkMode;
  requestedLinkMode?: SearchShapeLinkMode;
  linkShapeLoad?: number | null;
  linkShapeLevel?: LinkShapeLevel | null;
  linkShapeRowClass?: LinkShapeRowClass | null;
  correlationId: string | null;
  jobId: string | null;
  consumingRealm: string | null;
  jobPriority: number | null;
}): SearchShapeDescriptor {
  let { query, realms, linkMode } = args;
  // A caller that stated nothing asked for the shape it would have got, which
  // is the served one — so an omitted requested mode reports no override
  // rather than a null a reader would have to interpret.
  let requestedLinkMode = args.requestedLinkMode ?? linkMode;
  let itemQuery: Query = query.itemQuery;
  let filter = describeFilterShape(itemQuery.filter);
  let sort = describeSortShape(itemQuery.sort);
  let { html, item, itemFields, itemAsFallback } = describeFieldset(
    query.fieldset,
  );
  // Inert without the html branch — see `htmlQuery` on the descriptor.
  let htmlQuery = html ? describeHtmlQuery(query.htmlQuery) : null;
  let pageSize = finiteNumber(itemQuery.page?.size);
  let scope = query.scope ?? 'all';
  let cardUrlCount = query.cardUrls?.length ?? 0;
  let realmList = realms.join(',');
  // The members that decide which index paths a query exercises and how much
  // work each result costs. `pageNumber`, the pinned generation, the realm
  // list and the correlation/job identity are deliberately out: they vary
  // across requests that are the same query, and folding them in would leave
  // every request its own shape.
  //
  // The *served* link mode folds in; the requested one and the policy inputs
  // beside it do not. A member belongs in the hash when it changes the
  // response body, and only the served mode does — two requests that asked for
  // different shapes and were served the same one are the same shape, and
  // hashing the preference would split one shape's traffic in two under
  // exactly the conditions the hash is used to aggregate.
  //
  // Hashed before the members are capped, so two requests of one shape agree
  // whether or not either line was cut.
  let shapeHash = hashShape(
    [
      `filter=${filter ?? '-'}`,
      `sort=${sort ?? '-'}`,
      `htmlQuery=${htmlQuery ?? '-'}`,
      `pageSize=${pageSize ?? '-'}`,
      `fieldset=${html ? 'html' : '-'}/${item}${
        itemFields ? `(${itemFields})` : ''
      }${itemAsFallback ? '+fallback' : ''}`,
      `linkMode=${linkMode}`,
      `scope=${scope}`,
      `cardUrls=${cardUrlCount > 0 ? 'y' : 'n'}`,
    ].join(' '),
  );
  let truncated = [filter, sort, htmlQuery, itemFields, realmList].some(
    (member) => member !== null && member.length > MAX_MEMBER_CHARS,
  );
  return {
    filter: capMember(filter),
    sort: capMember(sort),
    htmlQuery: capMember(htmlQuery),
    pageSize,
    pageNumber: finiteNumber(itemQuery.page?.number),
    pageGeneration: itemQuery.page?.generation !== undefined,
    html,
    item,
    itemFields: capMember(itemFields),
    itemAsFallback,
    linkMode,
    requestedLinkMode,
    linkModeDowngraded: requestedLinkMode !== linkMode,
    linkShapeLoad: args.linkShapeLoad ?? null,
    linkShapeLevel: args.linkShapeLevel ?? null,
    linkShapeRowClass: args.linkShapeRowClass ?? null,
    scope,
    cardUrlCount,
    shapeHash,
    truncated,
    realms: capMember(realmList)!,
    realmCount: realms.length,
    correlationId: args.correlationId,
    jobId: args.jobId,
    consumingRealm: args.consumingRealm,
    jobPriority: args.jobPriority,
  };
}

// The per-member ceiling. Generous against any filter a card actually
// authors — the realistic ones render in the low hundreds of characters — and
// low enough that a request cannot make one line dominate a shard of log.
export const MAX_MEMBER_CHARS = 1024;

function capMember(value: string | null): string | null {
  if (value === null || value.length <= MAX_MEMBER_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_MEMBER_CHARS)}…[+${
    value.length - MAX_MEMBER_CHARS
  }]`;
}

// A member the channel promises as a flat number, or null. The grammar lets a
// page size through as a numeric string and does not validate a page number at
// all, so neither arrives already a number.
function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return null;
  }
  let n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// The filter tree with every value elided, rendered canonically: a node's
// members are emitted in a fixed order rather than the order the request
// happened to spell them in, field paths within an operator are sorted, and
// the branches of the commutative connectives (`any`, `every`) are sorted by
// their own rendering. Two structurally identical filters therefore render
// identically however they were authored, which is what makes `shapeHash`
// count distinct shapes rather than distinct spellings.
//
// A node carrying no member at all renders `*` — it constrains nothing, and
// that is worth seeing as such rather than as an empty string.
export function describeFilterShape(filter: Filter | undefined): string | null {
  return filter ? describeFilterNode(filter) : null;
}

function describeFilterNode(filter: Filter): string {
  let node = filter as unknown as Record<string, unknown>;
  let parts: string[] = [];
  // `on` gates whichever member below it runs; `type` is the whole filter.
  if (isRecord(node.on)) {
    parts.push(`on(${describeCodeRef(node.on as CodeRef)})`);
  }
  if (isRecord(node.type)) {
    parts.push(`type(${describeCodeRef(node.type as CodeRef)})`);
  }
  if (Array.isArray(node.every)) {
    parts.push(`every(${describeBranches(node.every as unknown as Filter[])})`);
  }
  if (Array.isArray(node.any)) {
    parts.push(`any(${describeBranches(node.any as unknown as Filter[])})`);
  }
  if (isRecord(node.not)) {
    parts.push(`not(${describeFilterNode(node.not as unknown as Filter)})`);
  }
  if (isRecord(node.eq)) {
    parts.push(`eq(${sortedKeys(node.eq).join(',')})`);
  }
  if (isRecord(node.contains)) {
    parts.push(`contains(${sortedKeys(node.contains).join(',')})`);
  }
  if (isRecord(node.in)) {
    parts.push(`in(${sortedKeys(node.in).join(',')})`);
  }
  if (isRecord(node.range)) {
    parts.push(`range(${describeRange(node.range)})`);
  }
  if (typeof node.matches === 'string') {
    // The search term is the user's own text — the operator is the whole of
    // what can be said about it.
    parts.push('matches');
  }
  return parts.length > 0 ? parts.join(':') : '*';
}

function describeBranches(branches: Filter[]): string {
  return branches.map(describeFilterNode).sort().join(',');
}

// The grammar's four range bound operators. A local list rather than a runtime
// import of `RANGE_OPERATORS`: this module is reached from the request path and
// holding its runtime imports to the logger keeps it clear of the barrel cycle
// that `emitSearchShape` already works around. Typed as a total record over
// `RangeOperator`, so an operator added to the grammar is a type error here
// rather than a silently unreported bound.
const RANGE_BOUND_OPERATORS: Record<RangeOperator, true> = {
  gt: true,
  gte: true,
  lt: true,
  lte: true,
};

// `field:gt+lte` — the bounds a range constrains, never what it bounds them by.
//
// Only the four known operators are reported. A bound object's keys are not
// always validated before they reach here: the query grammar checks a node's
// operators in an else-if chain, so a `range` sharing a node with an operator
// earlier in that chain is never visited, and its keys are whatever the caller
// wrote. Reporting them would publish caller-authored text through a member
// documented as structure, so an unrecognized key is dropped and the count of
// dropped keys reported as `+N?` — visible, without carrying the text.
function describeRange(range: Record<string, unknown>): string {
  return Object.entries(range)
    .map(([field, bounds]) => {
      if (!isRecord(bounds)) {
        return `${field}:?`;
      }
      let keys = sortedKeys(bounds);
      let known = keys.filter((key) =>
        Object.prototype.hasOwnProperty.call(RANGE_BOUND_OPERATORS, key),
      );
      let unknown = keys.length - known.length;
      return `${field}:${known.join('+')}${unknown > 0 ? `+${unknown}?` : ''}`;
    })
    .sort()
    .join(',');
}

export function describeSortShape(sort: Sort | undefined): string | null {
  if (!sort || sort.length === 0) {
    return null;
  }
  // Not sorted: a sort list's order is its precedence, so reordering it makes
  // a different query.
  return sort
    .map((expression) => {
      let anchor = (expression as { on?: CodeRef }).on;
      let prefix = anchor ? `${describeCodeRef(anchor)}:` : '';
      return `${prefix}${expression.by}:${expression.direction ?? 'asc'}`;
    })
    .join(',');
}

// The rendering selection: an enum format and a card-type ref, both schema.
export function describeHtmlQuery(query: HtmlQuery): string {
  if ('eq' in query) {
    let leaf = query.eq;
    let parts: string[] = [];
    if (leaf.format !== undefined) {
      parts.push(`format=${leaf.format}`);
    }
    if (leaf.renderType !== undefined) {
      parts.push(`renderType=${describeCodeRef(leaf.renderType)}`);
    }
    return `eq(${parts.join(',')})`;
  }
  if ('every' in query) {
    return `every(${query.every.map(describeHtmlQuery).sort().join(',')})`;
  }
  if ('any' in query) {
    return `any(${query.any.map(describeHtmlQuery).sort().join(',')})`;
  }
  return `not(${describeHtmlQuery(query.not)})`;
}

function describeFieldset(fieldset: SearchEntryFieldset): {
  html: boolean;
  item: 'none' | 'full' | 'sparse';
  itemFields: string | null;
  itemAsFallback: boolean;
} {
  return {
    html: fieldset.html,
    item: fieldset.item.kind,
    itemFields:
      fieldset.item.kind === 'sparse'
        ? [...fieldset.item.fields].sort().join(',')
        : null,
    itemAsFallback: fieldset.itemAsFallback,
  };
}

// The spelling `internalKeyFor` produces, reached without a VirtualNetwork:
// this describes the ref the request carried, so resolving prefix and virtual
// spellings onto their real URLs would report something the caller did not
// send. Consequently two spellings of one module are two shapes here.
function describeCodeRef(ref: CodeRef): string {
  if (!('type' in ref)) {
    return `${ref.module}/${ref.name}`;
  }
  switch (ref.type) {
    case 'ancestorOf':
      return `${describeCodeRef(ref.card)}/ancestor`;
    case 'fieldOf':
      return `${describeCodeRef(ref.card)}/fields/${ref.field}`;
  }
}

// FNV-1a over the shape text, base36. Deterministic from the text alone, so
// every process that sees the same query reports the same hash — which is the
// whole point of grouping on it. Collisions are possible at 32 bits and
// tolerable: this labels log lines for aggregation, and the `filter` / `sort`
// members carry the shape itself for anyone who needs to be sure.
function hashShape(shape: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < shape.length; i++) {
    hash ^= shape.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort();
}
