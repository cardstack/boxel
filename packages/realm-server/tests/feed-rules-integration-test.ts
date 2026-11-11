import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  InvalidQueryError,
  assertQuery,
  internalKeyFor,
  param,
  query,
  VirtualNetwork,
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { lowerQuery } from '@cardstack/runtime-common/query-syntax';
import {
  parseSearchEntryQueryFromPayload,
  searchEntryWireQueryFromQuery,
} from '@cardstack/runtime-common/search-entry';

import { setupDB } from './helpers/index.ts';

// The rules a social feed applies before it shows a viewer anything, one test
// per rule, over one small fixture seeded straight into boxel_index.
//
// Every rule is written twice: once as a query, and once as a few lines of
// plain JavaScript over the same fixture rows. The two must agree, and where
// the rule's outcome on this fixture is known by hand, the JavaScript reading
// is first checked against that. The engine's output is never the source of
// an expectation.
//
// A rule is asked in every form it has: as a query saved in a realm writes it
// (an `on` anchor on every operator), in the newer spelling (a top-level
// `type`), and each of those over the search wire. A ranking by an expression
// has no saved spelling, so those are asked in the newer one only.
//
// What the viewer follows, blocks, mutes, subscribes to, has seen and was
// served are cards here, read by `let` bindings. In a running app the seen
// and served records would be lines of an append-only log; they are cards in
// this file so a binding can read them (log queries have their own suites).
// The per-viewer predictions a ranking model would produce are stored on the
// post for the one viewer who is ranked, since a card query cannot join a
// per-viewer score card to a post.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const realm = 'http://feed-rules-test/';
const refs = {
  string: ref('@cardstack/base/string', 'default'),
  number: ref('@cardstack/base/number', 'default'),
  boolean: ref('@cardstack/base/boolean', 'default'),
  datetime: ref('@cardstack/base/datetime', 'default'),
};

type Kind = 'string' | 'number' | 'boolean' | 'strings' | 'datetime';
type Value = string | number | boolean | string[] | null;
type Doc = Record<string, Value>;

interface App {
  ref: ResolvedCodeRef;
  fields: Record<string, Kind>;
  rows: Record<string, Doc>;
}

function definitionOf(app: App): Definition {
  // every card has an id, which its search doc carries too
  let names = ['id', ...Object.keys(app.fields)];
  return {
    type: 'card-def',
    codeRef: app.ref,
    displayName: app.ref.name,
    fields: Object.fromEntries(names.map((n, i) => [n, `f${i}`])),
    fieldDefs: Object.fromEntries(
      names.map((n, i) => {
        let kind = n === 'id' ? 'string' : app.fields[n];
        return [
          `f${i}`,
          {
            type: kind === 'strings' ? 'containsMany' : 'contains',
            isPrimitive: true,
            isComputed: false,
            fieldOrCard:
              kind === 'number'
                ? refs.number
                : kind === 'boolean'
                  ? refs.boolean
                  : kind === 'datetime'
                    ? refs.datetime
                    : refs.string,
            ...(kind === 'number' || kind === 'boolean' || kind === 'datetime'
              ? { serializerName: kind }
              : {}),
          },
        ];
      }),
    ),
  } as Definition;
}

// --- the fixture ------------------------------------------------------------

const MINUTE = 60;
const HOUR = 3_600;
// Query time, in seconds. Relative bounds (`now-48h`) are read when a query
// runs, a moment later; the nearest fixture time to any bound is minutes away.
const T = Math.floor(Date.now() / 1000);
// How a datetime field spells a time in the search doc: zoneless, which a
// query reads as UTC.
const asDatetime = (seconds: number) =>
  new Date(seconds * 1000).toISOString().slice(0, 16);

const urlOf = (app: App, name: string) => `${realm}${app.ref.name}/${name}`;
const nameOf = (url: string) => url.slice(url.lastIndexOf('/') + 1);

// Authors: A (the viewer follows A, and A follows back), B (followed), C and
// D (not followed), E (blocked by the viewer), F (muted by the viewer), G
// (blocks the viewer), H (not followed, flagged adult), S (followed, but
// suspended). V is the viewer. W is a second viewer, who follows C.
const SUSPENDED = ['S'];
const ADULT = ['H'];

interface PostSpec {
  author: string;
  ageHours: number;
  replyTo?: string;
  repostOf?: string;
  quotes?: string;
  text?: string;
  subscriberOnly?: boolean;
  labels?: string[];
  withheldIn?: string[];
  pFav?: number;
  pReply?: number;
  pReport?: number;
}

// prettier-ignore
const POSTS: Record<string, PostSpec> = {
  a1: { author: 'A', ageHours: 1, text: 'morning run', pFav: 0.10, pReply: 0.02 },
  a2: { author: 'A', ageHours: 2, subscriberOnly: true },
  a3: { author: 'A', ageHours: 3, text: 'crypto is back' },
  a4: { author: 'A', ageHours: 50 },
  a5: { author: 'A', ageHours: 4, replyTo: 'c1', pFav: 0.40 },
  b1: { author: 'B', ageHours: 1, pFav: 0.20 },
  b2: { author: 'B', ageHours: 5, repostOf: 'c1' },
  b3: { author: 'B', ageHours: 6, subscriberOnly: true },
  b4: { author: 'B', ageHours: 2, replyTo: 'c1', pFav: 0.50 },
  c1: { author: 'C', ageHours: 6, pFav: 0.30, pReport: 0.001 },
  c2: { author: 'C', ageHours: 2, replyTo: 'a1' },
  c3: { author: 'C', ageHours: 3, repostOf: 'b1' },
  c4: { author: 'C', ageHours: 4, labels: ['doNotAmplify'] },
  d1: { author: 'D', ageHours: 1, withheldIn: ['DE'] },
  d2: { author: 'D', ageHours: 2, quotes: 'e1' },
  e1: { author: 'E', ageHours: 1 },
  f1: { author: 'F', ageHours: 1 },
  g1: { author: 'G', ageHours: 1 },
  h1: { author: 'H', ageHours: 1 },
  s1: { author: 'S', ageHours: 1 },
  v1: { author: 'V', ageHours: 1 },
};

const Post: App = {
  ref: ref(`${realm}post`, 'Post'),
  fields: {
    author: 'string',
    // seconds, for arithmetic and literal bounds
    postedAt: 'number',
    // the same moment as a datetime, for relative bounds
    postedOn: 'datetime',
    kind: 'string',
    // ids of the post replied to, reposted and quoted
    inReplyTo: 'string',
    repostOf: 'string',
    quotes: 'string',
    // the authors of the quoted and reposted posts: what a searchable link
    // to those posts would carry into this post's search doc
    quotedAuthor: 'string',
    repostedAuthor: 'string',
    // a repost's original, or the post itself
    originalId: 'string',
    // the first post of the thread a reply belongs to, or the post itself
    conversationRoot: 'string',
    text: 'string',
    subscriberOnly: 'boolean',
    labels: 'strings',
    withheldIn: 'strings',
    // the author's account, as a searchable link to it would carry
    authorState: 'string',
    authorAdult: 'boolean',
    // what a model predicts the one ranked viewer does with the post
    pFav: 'number',
    pReply: 'number',
    pReport: 'number',
  },
  rows: {},
};
const postUrl = (name: string) => urlOf(Post, name);
const rootOf = (name: string): string =>
  POSTS[name].replyTo ? rootOf(POSTS[name].replyTo!) : name;
for (let [name, spec] of Object.entries(POSTS)) {
  let postedAt = T - spec.ageHours * HOUR;
  Post.rows[name] = {
    author: spec.author,
    postedAt,
    postedOn: asDatetime(postedAt),
    kind: spec.replyTo
      ? 'reply'
      : spec.repostOf
        ? 'repost'
        : spec.quotes
          ? 'quote'
          : 'original',
    inReplyTo: spec.replyTo ? postUrl(spec.replyTo) : null,
    repostOf: spec.repostOf ? postUrl(spec.repostOf) : null,
    quotes: spec.quotes ? postUrl(spec.quotes) : null,
    quotedAuthor: spec.quotes ? POSTS[spec.quotes].author : null,
    repostedAuthor: spec.repostOf ? POSTS[spec.repostOf].author : null,
    originalId: postUrl(spec.repostOf ?? name),
    conversationRoot: postUrl(rootOf(name)),
    text: spec.text ?? null,
    subscriberOnly: spec.subscriberOnly ?? false,
    labels: spec.labels ?? [],
    withheldIn: spec.withheldIn ?? [],
    authorState: SUSPENDED.includes(spec.author) ? 'suspended' : 'active',
    authorAdult: ADULT.includes(spec.author),
    // a prediction the model did not make is absent, and counts as 0
    pFav: spec.pFav ?? null,
    pReply: spec.pReply ?? null,
    pReport: spec.pReport ?? null,
  };
}

// One card per relationship: who (`source`) does what (`kind`) to whom
// (`target`). The inverse ("who blocks me") is a query on `target`.
const Edge: App = {
  ref: ref(`${realm}edge`, 'Edge'),
  fields: { source: 'string', target: 'string', kind: 'string' },
  // prettier-ignore
  rows: {
    vFollowsA:    { source: 'V', target: 'A', kind: 'follow' },
    vFollowsB:    { source: 'V', target: 'B', kind: 'follow' },
    vFollowsS:    { source: 'V', target: 'S', kind: 'follow' },
    aFollowsV:    { source: 'A', target: 'V', kind: 'follow' },
    vBlocksE:     { source: 'V', target: 'E', kind: 'block' },
    vMutesF:      { source: 'V', target: 'F', kind: 'mute' },
    gBlocksV:     { source: 'G', target: 'V', kind: 'block' },
    vSubscribesA: { source: 'V', target: 'A', kind: 'subscribe' },
    // the second viewer's graph, which no query for V may read
    wFollowsC:    { source: 'W', target: 'C', kind: 'follow' },
    wBlocksA:     { source: 'W', target: 'A', kind: 'block' },
    wMutesB:      { source: 'W', target: 'B', kind: 'mute' },
    dBlocksW:     { source: 'D', target: 'W', kind: 'block' },
  },
};

// One card per post a viewer saw (it scrolled into view) or was served (it
// was sent, seen or not). `at` is seconds, `when` the same moment as a
// datetime.
const event = (
  viewer: string,
  kind: 'seen' | 'served',
  post: string,
  secondsAgo: number,
): Doc => ({
  viewer,
  kind,
  post: postUrl(post),
  at: T - secondsAgo,
  when: asDatetime(T - secondsAgo),
});
const Event: App = {
  ref: ref(`${realm}event`, 'Event'),
  fields: {
    viewer: 'string',
    kind: 'string',
    post: 'string',
    at: 'number',
    when: 'datetime',
  },
  rows: {
    vSawC1: event('V', 'seen', 'c1', 24 * HOUR),
    vServedB1: event('V', 'served', 'b1', 5 * MINUTE),
    vServedA1: event('V', 'served', 'a1', 20 * MINUTE),
    // the second viewer's history
    wSawA1: event('W', 'seen', 'a1', HOUR),
    wServedH1: event('W', 'served', 'h1', 2 * MINUTE),
  },
};

const Viewer: App = {
  ref: ref(`${realm}viewer`, 'Viewer'),
  fields: { handle: 'string', country: 'string' },
  rows: {
    V: { handle: 'V', country: 'DE' },
    W: { handle: 'W', country: 'FR' },
  },
};

// Five posts with a final score each, for the rule that attenuates an
// author's second and later posts.
const Scored: App = {
  ref: ref(`${realm}scored`, 'Scored'),
  fields: { author: 'string', score: 'number' },
  rows: {
    x1: { author: 'A', score: 1.0 },
    x2: { author: 'A', score: 0.9 },
    x3: { author: 'A', score: 0.8 },
    y1: { author: 'B', score: 0.6 },
    z1: { author: 'C', score: 0.5 },
  },
};

// Many small cards, for a filter that names hundreds of ids.
const TICKS = 650;
const tickName = (n: number) => `t${String(n).padStart(3, '0')}`;
const Tick: App = {
  ref: ref(`${realm}tick`, 'Tick'),
  fields: { n: 'number' },
  rows: Object.fromEntries(
    Array.from({ length: TICKS }, (_, n) => [tickName(n), { n }]),
  ),
};

const APPS = [Post, Edge, Event, Viewer, Scored, Tick];

// --- the rules, in plain JavaScript -----------------------------------------

const str = (v: Value) => v as string | null;
const list = (v: Value) => v as string[];
const num = (v: Value) => (v == null ? 0 : (v as number));

const edges = (
  kinds: string[],
  from: 'source' | 'target',
  who: string,
): string[] =>
  Object.values(Edge.rows)
    .filter((e) => kinds.includes(e.kind as string) && e[from] === who)
    .map((e) => (from === 'source' ? e.target : e.source) as string);

interface Graph {
  following: string[];
  blocked: string[];
  blockedOrMuted: string[];
  blockers: string[];
  subscribed: string[];
  seen: string[];
  servedLately: string[];
  country: string;
}
const graphOf = (viewer: string): Graph => ({
  following: edges(['follow'], 'source', viewer),
  blocked: edges(['block'], 'source', viewer),
  blockedOrMuted: edges(['block', 'mute'], 'source', viewer),
  blockers: edges(['block'], 'target', viewer),
  subscribed: edges(['subscribe'], 'source', viewer),
  seen: Object.values(Event.rows)
    .filter((e) => e.viewer === viewer && e.kind === 'seen')
    .map((e) => e.post as string),
  servedLately: Object.values(Event.rows)
    .filter(
      (e) =>
        e.viewer === viewer &&
        e.kind === 'served' &&
        (e.at as number) >= T - 10 * MINUTE,
    )
    .map((e) => e.post as string),
  country: Viewer.rows[viewer].country as string,
});

type Rule = (doc: Doc, id: string) => boolean;
const within48h: Rule = (d) => num(d.postedAt) >= T - 48 * HOUR;
const notBy =
  (viewer: string): Rule =>
  (d) =>
    d.author !== viewer;
const authorNotHidden =
  (g: Graph): Rule =>
  (d) =>
    !g.blockedOrMuted.includes(str(d.author)!) &&
    !g.blockers.includes(str(d.author)!);
// A block reaches through a quote and a repost; a mute does not.
const notThroughABlock =
  (g: Graph): Rule =>
  (d) =>
    !(d.quotedAuthor != null && g.blocked.includes(str(d.quotedAuthor)!)) &&
    !(d.repostedAuthor != null && g.blocked.includes(str(d.repostedAuthor)!));
const networkRule =
  (g: Graph): Rule =>
  (d) =>
    g.following.includes(str(d.author)!) ||
    (d.inReplyTo == null && d.repostOf == null);
const subscription =
  (g: Graph): Rule =>
  (d) =>
    d.subscriberOnly === false || g.subscribed.includes(str(d.author)!);
// Its own id, the post it reposts and the post it replies to; not a quote.
const noneOf =
  (ids: string[]): Rule =>
  (d, id) =>
    !ids.includes(id) &&
    !(d.repostOf != null && ids.includes(str(d.repostOf)!)) &&
    !(d.inReplyTo != null && ids.includes(str(d.inReplyTo)!));
const withoutWord =
  (word: string): Rule =>
  (d) =>
    !(str(d.text) ?? '').toLowerCase().split(/\W+/).includes(word);
const amplifiable =
  (g: Graph): Rule =>
  (d) =>
    d.authorState === 'active' &&
    (g.following.includes(str(d.author)!) ||
      !list(d.labels).includes('doNotAmplify'));
const notWithheldIn =
  (country: string): Rule =>
  (d) =>
    !list(d.withheldIn).includes(country);
const adultOnlyFromFollowed =
  (g: Graph): Rule =>
  (d) =>
    g.following.includes(str(d.author)!) || d.authorAdult === false;

// The weighted sum of the predictions, with a negative weight.
const WEIGHTS = { pFav: 0.708, pReply: 5, pReport: -234 };
const NEGATIVE = 234;
const ALL = 0.708 + 5 + 234;
const OFFSET = 0.001;
const rawScore = (d: Doc) =>
  WEIGHTS.pFav * num(d.pFav) +
  WEIGHTS.pReply * num(d.pReply) +
  WEIGHTS.pReport * num(d.pReport);
// A non-negative sum moves up by the offset; a negative one is squeezed into
// the gap under it, keeping its order.
const finalScore = (d: Doc) => {
  let raw = rawScore(d);
  return raw < 0 ? ((raw + NEGATIVE) / ALL) * OFFSET : raw + OFFSET;
};
const RAW = '(0.708 * pFav + 5 * pReply - 234 * pReport)';
const FINAL = `IF(${RAW} < 0, (${RAW} + 234) / 239.708 * 0.001, ${RAW} + 0.001)`;

// The posts every rule keeps, by name. `order` sorts them (ties by name, as
// the queries break ties by URL); without one they come back sorted by name.
function posts(
  rules: Rule[],
  order?: (a: Doc, b: Doc) => number,
  rows: Record<string, Doc> = Post.rows,
): string[] {
  let kept = Object.entries(rows)
    .filter(([name, doc]) => rules.every((rule) => rule(doc, postUrl(name))))
    .map(([name, doc]) => ({ name, doc }));
  kept.sort(
    (a, b) => (order ? order(a.doc, b.doc) : 0) || (a.name < b.name ? -1 : 1),
  );
  return kept.map((k) => k.name);
}
const newestFirst = (a: Doc, b: Doc) => num(b.postedAt) - num(a.postedAt);
const without = (...names: string[]) =>
  Object.keys(Post.rows)
    .filter((n) => !names.includes(n))
    .sort();

// --- the rules, as queries --------------------------------------------------

// The two ways a query is spelled: anchored on every operator, as a query
// saved in a realm is, or with one type at the top.
interface Speller {
  // one filter node of a type
  on(app: App, node: Record<string, any>): Record<string, any>;
  // a whole query about a type
  about(app: App, parts: Record<string, any>): Record<string, any>;
  // a `let` binding: the values at `select` across the cards `filter` finds
  listOf(
    app: App,
    filter: Record<string, any>,
    select: string,
  ): Record<string, any>;
  // a `let` binding of the first card `filter` finds
  oneOf(app: App, filter: Record<string, any>): Record<string, any>;
  by(app: App, field: string, direction: 'asc' | 'desc'): Record<string, any>;
  collapse(app: App, field: string, keep?: number): Record<string, any>;
}
const saved: Speller = {
  on: (app, node) => ({ on: app.ref, ...node }),
  about: (app, parts) => ({ filter: { type: app.ref }, ...parts }),
  listOf: (_app, filter, select) => ({ from: { filter }, select }),
  oneOf: (_app, filter) => ({ from: { filter }, one: true }),
  by: (app, field, direction) => ({ on: app.ref, by: field, direction }),
  collapse: (app, field, keep) => ({
    by: field,
    on: app.ref,
    ...(keep ? { keep } : {}),
  }),
};
const typed: Speller = {
  on: (_app, node) => node,
  about: (app, parts) => ({ type: app.ref, ...parts }),
  listOf: (app, filter, select) => ({
    from: { type: app.ref, filter },
    select,
  }),
  oneOf: (app, filter) => ({ from: { type: app.ref, filter }, one: true }),
  by: (_app, field, direction) => ({ by: field, direction }),
  collapse: (_app, field, keep) => ({ by: field, ...(keep ? { keep } : {}) }),
};
const byUrl = { by: 'cardURL' };
const $ = (name: string) => `$${name}`;
type Ids = string[] | string;

// Bindings: a viewer's lists, each read from the cards that record them.
const edgeList = (
  s: Speller,
  kinds: string[],
  from: 'source' | 'target',
  who: string,
) =>
  s.listOf(
    Edge,
    s.on(Edge, {
      every: [
        s.on(Edge, { eq: { [from]: who } }),
        s.on(Edge, { in: { kind: kinds } }),
      ],
    }),
    from === 'source' ? 'target' : 'source',
  );
const lets = {
  following: (s: Speller, viewer: string) =>
    edgeList(s, ['follow'], 'source', viewer),
  blocked: (s: Speller, viewer: string) =>
    edgeList(s, ['block'], 'source', viewer),
  blockedOrMuted: (s: Speller, viewer: string) =>
    edgeList(s, ['block', 'mute'], 'source', viewer),
  blockers: (s: Speller, viewer: string) =>
    edgeList(s, ['block'], 'target', viewer),
  subscribed: (s: Speller, viewer: string) =>
    edgeList(s, ['subscribe'], 'source', viewer),
  seen: (s: Speller, viewer: string) =>
    s.listOf(
      Event,
      s.on(Event, {
        every: [
          s.on(Event, { eq: { viewer } }),
          s.on(Event, { eq: { kind: 'seen' } }),
        ],
      }),
      'post',
    ),
  // `since` is a bound on `at` (seconds) or, relative, on `when`
  served: (s: Speller, viewer: string, since: Record<string, any>) =>
    s.listOf(
      Event,
      s.on(Event, {
        every: [
          s.on(Event, { eq: { viewer } }),
          s.on(Event, { eq: { kind: 'served' } }),
          s.on(Event, { range: since }),
        ],
      }),
      'post',
    ),
  // everything seen, and what was served in the last ten minutes
  seenOrServedLately: (s: Speller, viewer: string) =>
    s.listOf(
      Event,
      s.on(Event, {
        every: [
          s.on(Event, { eq: { viewer } }),
          s.on(Event, {
            any: [
              s.on(Event, { eq: { kind: 'seen' } }),
              s.on(Event, {
                every: [
                  s.on(Event, { eq: { kind: 'served' } }),
                  s.on(Event, { range: { at: { gte: T - 10 * MINUTE } } }),
                ],
              }),
            ],
          }),
        ],
      }),
      'post',
    ),
};

// Filter nodes on Post. A scalar field with no value fails both an `in` and
// its `not`, so a rule about an optional field (the quoted author, the post
// replied to) says "no value, or a value outside the list".
const p = (s: Speller, node: Record<string, any>) => s.on(Post, node);
const all = (s: Speller, nodes: Record<string, any>[]) =>
  p(s, { every: nodes });
const absentOrNotIn = (s: Speller, field: string, ids: Ids) =>
  p(s, {
    any: [
      p(s, { eq: { [field]: null } }),
      p(s, { not: { in: { [field]: ids } } }),
    ],
  });
const f = {
  within48h: (s: Speller) =>
    p(s, { range: { postedAt: { gte: T - 48 * HOUR } } }),
  notBy: (s: Speller, viewer: string) =>
    p(s, { not: { eq: { author: viewer } } }),
  authorNotHidden: (s: Speller, hidden: Ids, blockers: Ids) =>
    all(s, [
      p(s, { not: { in: { author: hidden } } }),
      p(s, { not: { in: { author: blockers } } }),
    ]),
  notThroughABlock: (s: Speller, blocked: Ids) =>
    all(s, [
      absentOrNotIn(s, 'quotedAuthor', blocked),
      absentOrNotIn(s, 'repostedAuthor', blocked),
    ]),
  networkRule: (s: Speller, following: Ids) =>
    p(s, {
      any: [
        p(s, { in: { author: following } }),
        all(s, [
          p(s, { eq: { inReplyTo: null } }),
          p(s, { eq: { repostOf: null } }),
        ]),
      ],
    }),
  subscription: (s: Speller, subscribed: Ids) =>
    p(s, {
      any: [
        p(s, { eq: { subscriberOnly: false } }),
        p(s, { in: { author: subscribed } }),
      ],
    }),
  noneOf: (s: Speller, ids: Ids) =>
    all(s, [
      p(s, { not: { in: { id: ids } } }),
      absentOrNotIn(s, 'repostOf', ids),
      absentOrNotIn(s, 'inReplyTo', ids),
    ]),
  withoutWord: (s: Speller, word: string) =>
    p(s, { not: { matches: word, fields: ['text'] } }),
  amplifiable: (s: Speller, following: Ids) =>
    all(s, [
      p(s, { eq: { authorState: 'active' } }),
      p(s, {
        any: [
          p(s, { in: { author: following } }),
          p(s, { not: { eq: { labels: 'doNotAmplify' } } }),
        ],
      }),
    ]),
  notWithheldIn: (s: Speller, country: unknown) =>
    p(s, { not: { eq: { withheldIn: country } } }),
  adultOnlyFromFollowed: (s: Speller, following: Ids) =>
    p(s, {
      any: [
        p(s, { in: { author: following } }),
        p(s, { eq: { authorAdult: false } }),
      ],
    }),
};

interface Spelled {
  saved?: Record<string, any>;
  typed?: Record<string, any>;
}
const both = (build: (s: Speller) => Record<string, any>): Spelled => ({
  saved: build(saved),
  typed: build(typed),
});
const newerOnly = (build: (s: Speller) => Record<string, any>): Spelled => ({
  typed: build(typed),
});
const overTheWire = (payload: unknown) =>
  parseSearchEntryQueryFromPayload(JSON.parse(JSON.stringify(payload)))
    .itemQuery as Record<string, any>;

// Every form a query has, as the query the engine is handed.
function forms(q: Spelled): [string, Record<string, any>][] {
  let out: [string, Record<string, any>][] = [];
  if (q.saved) {
    out.push(['as saved', q.saved]);
    out.push([
      'saved, over the wire',
      overTheWire(searchEntryWireQueryFromQuery(q.saved as Query)),
    ]);
  }
  if (q.typed) {
    out.push(['newer spelling', lowerQuery(q.typed).query]);
    out.push(['newer spelling, over the wire', overTheWire(q.typed)]);
  }
  return out;
}

// --- the runner -------------------------------------------------------------

function makeDefinitionLookup(): DefinitionLookup {
  let definitions = [
    ...APPS.map(definitionOf),
    {
      type: 'card-def',
      codeRef: ref('@cardstack/base/card-api', 'CardDef'),
      displayName: 'Card',
      fields: {},
      fieldDefs: {},
    } as Definition,
  ];
  const lookup: DefinitionLookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      let found = definitions.find((d) => {
        let r = d.codeRef as ResolvedCodeRef;
        return r.module === codeRef.module && r.name === codeRef.name;
      });
      if (!found) {
        throw new Error(
          `unexpected definition lookup: ${codeRef.module}/${codeRef.name}`,
        );
      }
      return found;
    },
    async lookupDefinitionEntry(): Promise<never> {
      throw new Error('lookupDefinitionEntry is not used by these tests');
    },
    async lookupCachedDefinition() {
      return undefined;
    },
    async invalidate() {
      return [];
    },
    async clearRealmDefinitions() {},
    async clearAllDefinitions() {},
    registerRealm() {},
    async getCachedDefinitions() {
      return undefined;
    },
    async populateDefinitionCacheEntry() {
      return undefined;
    },
    async getCachedDefinitionsBatch() {
      return {};
    },
    forRealm() {
      return lookup;
    },
  };
  return lookup;
}

async function seed(dbAdapter: PgAdapter, vn: VirtualNetwork, app: App) {
  let typeKey = internalKeyFor(app.ref, undefined, vn);
  for (let [name, doc] of Object.entries(app.rows)) {
    let url = urlOf(app, name);
    await query(dbAdapter, [
      `INSERT INTO boxel_index (url, file_alias, realm_url, generation, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at, last_modified) VALUES (`,
      param(url),
      `,`,
      param(url),
      `,`,
      param(realm),
      `,`,
      param(1),
      `,`,
      param('instance'),
      `,`,
      param(JSON.stringify({ id: url, type: 'card', attributes: doc })),
      `::jsonb,`,
      param(JSON.stringify({ id: url, ...doc })),
      `::jsonb,`,
      `'[]'::jsonb,`,
      param(JSON.stringify([typeKey])),
      `::jsonb,`,
      param(false),
      `,`,
      param(false),
      `,`,
      param(Date.now()),
      `,`,
      param(1_000),
      `)`,
    ]);
  }
}

const close = (a: unknown, b: number) =>
  typeof a === 'number' || typeof a === 'string'
    ? Math.abs(Number(a) - b) < 1e-9
    : false;

module(basename(import.meta.filename), function () {
  module('feed rules (Postgres integration)', function (hooks) {
    let engine: IndexQueryEngine;

    setupDB(hooks, {
      before: async (dbAdapter) => {
        let vn = new VirtualNetwork();
        engine = new IndexQueryEngine(dbAdapter, makeDefinitionLookup(), vn);
        for (let app of APPS) {
          await seed(dbAdapter, vn, app);
        }
      },
    });

    async function run(q: Record<string, any>) {
      let { results, meta } = await engine.search(
        new URL(realm),
        q as Query,
        {},
        { kind: 'dataOnly' },
      );
      let rows = results as Record<string, any>[];
      return {
        names: rows.map((r) => nameOf(String(r.url))),
        rows,
        meta: meta as Record<string, any>,
      };
    }

    // The query, in every form it has, returns `expected`: in that order when
    // `ordered`, as a set otherwise.
    async function agree(
      assert: Assert,
      q: Spelled,
      expected: string[],
      opts: { ordered?: boolean; label?: string } = {},
    ) {
      for (let [form, asked] of forms(q)) {
        let { names } = await run(asked);
        assert.deepEqual(
          opts.ordered ? names : [...names].sort(),
          expected,
          `${opts.label ? `${opts.label}, ` : ''}${form}`,
        );
      }
    }

    test('R1 in-network recency: posts by followed authors from the last 48 hours, newest first', async function (assert) {
      let g = graphOf('V');
      let expected = posts(
        [within48h, (d) => g.following.includes(str(d.author)!)],
        newestFirst,
      );
      assert.deepEqual(
        expected,
        ['a1', 'b1', 's1', 'a2', 'b4', 'a3', 'a5', 'b2', 'b3'],
        'by hand: the 50-hour post and every unfollowed author are out',
      );
      await agree(
        assert,
        both((s) =>
          s.about(Post, {
            let: { $following: lets.following(s, 'V') },
            filter: all(s, [
              p(s, { in: { author: $('following') } }),
              f.within48h(s),
            ]),
            sort: [s.by(Post, 'postedAt', 'desc'), byUrl],
          }),
        ),
        expected,
        { ordered: true },
      );
      // The same window as a relative bound on the datetime field.
      await agree(
        assert,
        both((s) =>
          s.about(Post, {
            let: { $following: lets.following(s, 'V') },
            filter: all(s, [
              p(s, { in: { author: $('following') } }),
              p(s, { range: { postedOn: { gte: 'now-48h' } } }),
            ]),
            sort: [s.by(Post, 'postedAt', 'desc'), byUrl],
          }),
        ),
        expected,
        { ordered: true, label: 'a relative bound' },
      );
    });

    test("R2 the viewer's own posts are left out", async function (assert) {
      let expected = posts([within48h, notBy('V')]);
      assert.deepEqual(expected, without('v1', 'a4'), 'by hand');
      await agree(
        assert,
        both((s) =>
          s.about(Post, {
            filter: all(s, [f.within48h(s), f.notBy(s, 'V')]),
          }),
        ),
        expected,
      );
    });

    test('R3 authors the viewer blocks or mutes, and authors who block the viewer, are left out', async function (assert) {
      let expected = posts([authorNotHidden(graphOf('V'))]);
      assert.deepEqual(
        expected,
        without('e1', 'f1', 'g1'),
        'by hand: the post quoting a blocked author stays',
      );
      await agree(
        assert,
        both((s) =>
          s.about(Post, {
            let: {
              $hidden: lets.blockedOrMuted(s, 'V'),
              $blockers: lets.blockers(s, 'V'),
            },
            filter: f.authorNotHidden(s, $('hidden'), $('blockers')),
          }),
        ),
        expected,
      );
    });

    test('R4 a block reaches through a quote or a repost of the blocked author', async function (assert) {
      let g = graphOf('V');
      let expected = posts([authorNotHidden(g), notThroughABlock(g)]);
      assert.deepEqual(expected, without('e1', 'f1', 'g1', 'd2'), 'by hand');
      await agree(
        assert,
        both((s) =>
          s.about(Post, {
            let: {
              $hidden: lets.blockedOrMuted(s, 'V'),
              $blockers: lets.blockers(s, 'V'),
              $blocked: lets.blocked(s, 'V'),
            },
            filter: all(s, [
              f.authorNotHidden(s, $('hidden'), $('blockers')),
              f.notThroughABlock(s, $('blocked')),
            ]),
          }),
        ),
        expected,
      );
    });

    test('R5 replies and reposts come only from followed authors', async function (assert) {
      let expected = posts([networkRule(graphOf('V'))]);
      assert.deepEqual(
        expected,
        without('c2', 'c3'),
        'by hand: followed replies and reposts stay, and unfollowed originals',
      );
      await agree(
        assert,
        both((s) =>
          s.about(Post, {
            let: { $following: lets.following(s, 'V') },
            filter: f.networkRule(s, $('following')),
          }),
        ),
        expected,
      );
    });

    test('R6 a post and its reposts show once', async function (assert) {
      let candidates: Rule = (d) => d.originalId === postUrl('c1');
      assert.deepEqual(posts([candidates]), ['b2', 'c1'], 'the candidates');
      // Newest first, the repost (5 hours) is ahead of its original (6).
      let expected = posts([candidates], newestFirst).slice(0, 1);
      assert.deepEqual(expected, ['b2'], 'by hand');
      await agree(
        assert,
        both((s) =>
          s.about(Post, {
            filter: p(s, { eq: { originalId: postUrl('c1') } }),
            sort: [s.by(Post, 'postedAt', 'desc'), byUrl],
            collapse: s.collapse(Post, 'originalId'),
          }),
        ),
        expected,
        { ordered: true },
      );
      // With what the viewer has seen left out, neither is shown.
      let unseen = posts([candidates, noneOf(graphOf('V').seen)]);
      assert.deepEqual(unseen, [], 'by hand: the original was seen');
      await agree(
        assert,
        both((s) =>
          s.about(Post, {
            let: { $seen: lets.seen(s, 'V') },
            filter: all(s, [
              p(s, { eq: { originalId: postUrl('c1') } }),
              f.noneOf(s, $('seen')),
            ]),
            sort: [s.by(Post, 'postedAt', 'desc'), byUrl],
            collapse: s.collapse(Post, 'originalId'),
          }),
        ),
        unseen,
        { ordered: true, label: 'seen posts left out' },
      );
    });

    test('R7 a subscriber-only post shows only to a subscriber of its author', async function (assert) {
      let expected = posts([subscription(graphOf('V'))]);
      assert.deepEqual(expected, without('b3'), 'by hand: a2 stays');
      await agree(
        assert,
        both((s) =>
          s.about(Post, {
            let: { $subscribed: lets.subscribed(s, 'V') },
            filter: f.subscription(s, $('subscribed')),
          }),
        ),
        expected,
      );
    });

    test('R8 a seen post is left out, with its reposts and the replies to it', async function (assert) {
      let expected = posts([noneOf(graphOf('V').seen)]);
      assert.deepEqual(
        expected,
        without('c1', 'b2', 'a5', 'b4'),
        'by hand: a reply to another post stays',
      );
      await agree(
        assert,
        both((s) =>
          s.about(Post, {
            let: { $seen: lets.seen(s, 'V') },
            filter: f.noneOf(s, $('seen')),
          }),
        ),
        expected,
      );
    });

    test('R9 a post served in the last ten minutes is left out, with its reposts', async function (assert) {
      let expected = posts([noneOf(graphOf('V').servedLately)]);
      assert.deepEqual(
        expected,
        without('b1', 'c3'),
        'by hand: the post served twenty minutes ago is eligible again',
      );
      await agree(
        assert,
        both((s) =>
          s.about(Post, {
            let: {
              $served: lets.served(s, 'V', { at: { gte: T - 10 * MINUTE } }),
            },
            filter: f.noneOf(s, $('served')),
          }),
        ),
        expected,
      );
      await agree(
        assert,
        both((s) =>
          s.about(Post, {
            let: {
              $served: lets.served(s, 'V', { when: { gte: 'now-10m' } }),
            },
            filter: f.noneOf(s, $('served')),
          }),
        ),
        expected,
        { label: 'a relative bound' },
      );
    });

    test('R10 a post holding a muted word is left out', async function (assert) {
      let expected = posts([withoutWord('crypto')]);
      assert.deepEqual(
        expected,
        without('a3'),
        'by hand: posts with other text, and with none, stay',
      );
      await agree(
        assert,
        both((s) => s.about(Post, { filter: f.withoutWord(s, 'crypto') })),
        expected,
      );
    });

    test('R11 suspended authors are left out, and a do-not-amplify post shows only to a follower', async function (assert) {
      let expected = posts([amplifiable(graphOf('V'))]);
      assert.deepEqual(expected, without('s1', 'c4'), 'by hand');
      let query = (viewer: string) =>
        both((s) =>
          s.about(Post, {
            let: { $following: lets.following(s, viewer) },
            filter: f.amplifiable(s, $('following')),
          }),
        );
      await agree(assert, query('V'), expected);
      // A viewer who follows the labeled post's author gets it.
      let forFollower = posts([amplifiable(graphOf('W'))]);
      assert.deepEqual(forFollower, without('s1'), 'by hand, for a follower');
      await agree(assert, query('W'), forFollower, { label: 'a follower' });
    });

    test("R12 a post withheld in the viewer's country is left out there and shown elsewhere", async function (assert) {
      let inGermany = posts([notWithheldIn('DE')]);
      assert.deepEqual(inGermany, without('d1'), 'by hand, in DE');
      let inFrance = posts([notWithheldIn('FR')]);
      assert.deepEqual(inFrance, without(), 'by hand, in FR');
      for (let [country, expected] of [
        ['DE', inGermany],
        ['FR', inFrance],
      ] as const) {
        await agree(
          assert,
          both((s) => s.about(Post, { filter: f.notWithheldIn(s, country) })),
          expected,
          { label: country },
        );
      }
      // The country read from the viewer's own card, in the same query.
      for (let viewer of ['V', 'W']) {
        await agree(
          assert,
          both((s) =>
            s.about(Post, {
              let: {
                $me: s.oneOf(Viewer, s.on(Viewer, { eq: { handle: viewer } })),
              },
              filter: f.notWithheldIn(s, '$me.country'),
            }),
          ),
          posts([notWithheldIn(graphOf(viewer).country)]),
          { label: `the country of ${viewer}'s card` },
        );
      }
    });

    test('R13 ranking by a weighted sum of predictions, a negative weight included, with negative sums squeezed under the rest', async function (assert) {
      let names = ['a1', 'b1', 'c1'];
      let candidates: Rule = (_d, id) => names.map(postUrl).includes(id);
      let raw = Object.fromEntries(
        names.map((n) => [n, rawScore(Post.rows[n])]),
      );
      assert.deepEqual(
        names.map((n) => Number(raw[n].toFixed(6))),
        [0.1708, 0.1416, -0.0216],
        'by hand: the sums before the offset',
      );
      let expected = posts(
        [candidates],
        (a, b) => finalScore(b) - finalScore(a),
      );
      assert.deepEqual(expected, ['a1', 'b1', 'c1'], 'by hand');
      let q = newerOnly((s) =>
        s.about(Post, {
          filter: p(s, { in: { id: names.map(postUrl) } }),
          sort: [{ expression: FINAL }, byUrl],
        }),
      );
      await agree(assert, q, expected, { ordered: true });
      // Each row carries the value it was ranked by.
      let { rows } = await run(lowerQuery(q.typed!).query);
      for (let row of rows) {
        let name = nameOf(row.url);
        assert.ok(
          close(row._expression, finalScore(Post.rows[name])),
          `${name}: ${row._expression} is ${finalScore(Post.rows[name])}`,
        );
        assert.true(Number(row._expression) >= 0, `${name}: never negative`);
      }
      let c1 = Number(rows.find((r) => nameOf(r.url) === 'c1')?._expression);
      assert.true(c1 > 0, 'the negative sum ends above zero');
      assert.true(c1 < 0.001, 'and under every non-negative one');
    });

    test("R14 an author's second and later posts are attenuated, then the list is re-sorted", async function (assert) {
      // An author's k-th best (k from 0) is multiplied by 0.75 * 0.5^k + 0.25.
      let attenuated: Record<string, number> = {};
      for (let [name, doc] of Object.entries(Scored.rows)) {
        let k = Object.values(Scored.rows).filter(
          (o) => o.author === doc.author && num(o.score) > num(doc.score),
        ).length;
        attenuated[name] = num(doc.score) * (0.75 * Math.pow(0.5, k) + 0.25);
      }
      let expected = Object.keys(attenuated).sort(
        (a, b) => attenuated[b] - attenuated[a],
      );
      assert.deepEqual(expected, ['x1', 'y1', 'x2', 'z1', 'x3'], 'by hand');
      assert.deepEqual(
        expected.map((n) => Number(attenuated[n].toFixed(6))),
        [1, 0.6, 0.5625, 0.5, 0.35],
        'by hand: 0.9 * 0.625 is 0.5625, and 0.8 * 0.4375 is 0.35',
      );
      let q = both((s) =>
        s.about(Scored, {
          sort: [
            {
              expression:
                'score * (0.75 * POWER(0.5, COUNTIF(peers.score, ">" & score)) + 0.25)',
              compare: { by: 'author' },
            },
            s.by(Scored, 'score', 'desc'),
            byUrl,
          ],
        }),
      );
      await agree(assert, q, expected, { ordered: true });
      let { rows } = await run(q.saved!);
      for (let row of rows) {
        let name = nameOf(row.url);
        assert.ok(
          close(row._window, attenuated[name]),
          `${name}: ${row._window} is ${attenuated[name]}`,
        );
      }
    });

    test('R15 one post per conversation, the best scored', async function (assert) {
      let thread: Rule = (d) => d.conversationRoot === postUrl('c1');
      assert.deepEqual(posts([thread]), ['a5', 'b4', 'c1'], 'the candidates');
      let expected = posts([thread], (a, b) => rawScore(b) - rawScore(a)).slice(
        0,
        1,
      );
      assert.deepEqual(expected, ['b4'], 'by hand: 0.354 beats 0.2832');
      let q = newerOnly((s) =>
        s.about(Post, {
          filter: p(s, { eq: { conversationRoot: postUrl('c1') } }),
          sort: [{ expression: RAW }, byUrl],
          collapse: s.collapse(Post, 'conversationRoot'),
        }),
      );
      await agree(assert, q, expected, { ordered: true });
      let { rows } = await run(lowerQuery(q.typed!).query);
      assert.strictEqual(
        Number(rows[0]?._collapseSize),
        3,
        'the kept post says its conversation held three',
      );
    });

    // --- several rules at once ----------------------------------------------

    function combinedModel(viewer: string, adultRule: boolean) {
      let g = graphOf(viewer);
      return posts(
        [
          within48h,
          notBy(viewer),
          authorNotHidden(g),
          notThroughABlock(g),
          networkRule(g),
          subscription(g),
          noneOf([...g.seen, ...g.servedLately]),
          withoutWord('crypto'),
          amplifiable(g),
          notWithheldIn(g.country),
          ...(adultRule ? [adultOnlyFromFollowed(g)] : []),
        ],
        (a, b) => finalScore(b) - finalScore(a),
      );
    }

    function combinedFilter(
      s: Speller,
      viewer: string,
      lists: { blocked: Ids; subscribed: Ids },
      adultRule: boolean,
    ) {
      return all(s, [
        f.within48h(s),
        f.notBy(s, viewer),
        f.authorNotHidden(s, $('hidden'), $('blockers')),
        f.notThroughABlock(s, lists.blocked),
        f.networkRule(s, $('following')),
        f.subscription(s, lists.subscribed),
        f.noneOf(s, $('history')),
        f.withoutWord(s, 'crypto'),
        f.amplifiable(s, $('following')),
        f.notWithheldIn(s, graphOf(viewer).country),
        ...(adultRule ? [f.adultOnlyFromFollowed(s, $('following'))] : []),
      ]);
    }

    test('every filtering rule in one query needs six lists, and a query takes four', function (assert) {
      assert.throws(
        () =>
          assertQuery({
            let: {
              $following: lets.following(saved, 'V'),
              $hidden: lets.blockedOrMuted(saved, 'V'),
              $blockers: lets.blockers(saved, 'V'),
              $history: lets.seenOrServedLately(saved, 'V'),
              $blocked: lets.blocked(saved, 'V'),
              $subscribed: lets.subscribed(saved, 'V'),
            },
            filter: combinedFilter(
              saved,
              'V',
              { blocked: $('blocked'), subscribed: $('subscribed') },
              false,
            ),
          }),
        (err: unknown) =>
          err instanceof InvalidQueryError && err.code === 'limit-exceeded',
      );
    });

    test('every rule at once leaves three posts, ranked, and two once adult authors come only from follows', async function (assert) {
      assert.deepEqual(
        combinedModel('V', false),
        ['a1', 'a2', 'h1'],
        'by hand: a1 scores 0.1718; a2 and h1 tie at the offset, by name',
      );
      assert.deepEqual(combinedModel('V', true), ['a1', 'a2'], 'by hand');
      // Two of the six lists are read first and written into the query, which
      // binds the other four.
      let read = async (binding: Record<string, any>) =>
        (await run({ filter: binding.from.filter })).rows.map(
          (r) => r.pristine_doc.attributes[binding.select] as string,
        );
      let lists = {
        blocked: await read(lets.blocked(saved, 'V')),
        subscribed: await read(lets.subscribed(saved, 'V')),
      };
      assert.deepEqual(lists, { blocked: ['E'], subscribed: ['A'] });
      for (let adultRule of [false, true]) {
        let q = newerOnly((s) =>
          s.about(Post, {
            let: {
              $following: lets.following(s, 'V'),
              $hidden: lets.blockedOrMuted(s, 'V'),
              $blockers: lets.blockers(s, 'V'),
              $history: lets.seenOrServedLately(s, 'V'),
            },
            filter: combinedFilter(s, 'V', lists, adultRule),
            sort: [{ expression: FINAL }, byUrl],
            page: { size: 35 },
          }),
        );
        let expected = combinedModel('V', adultRule);
        await agree(assert, q, expected, {
          ordered: true,
          label: adultRule ? 'with the adult rule' : 'without it',
        });
        let { rows } = await run(lowerQuery(q.typed!).query);
        for (let row of rows) {
          let name = nameOf(row.url);
          assert.ok(
            close(row._expression, finalScore(Post.rows[name])),
            `${name}: ${row._expression} is ${finalScore(Post.rows[name])}`,
          );
        }
      }
    });

    // --- what the language is asked to do above, each on its own -------------

    test('one let list is read by several ins, under not as well', async function (assert) {
      // Posts neither written by, nor quoting, nor reposting a followed author.
      let g = graphOf('V');
      let expected = posts([
        (d) => !g.following.includes(str(d.author)!),
        (d) =>
          d.quotedAuthor == null || !g.following.includes(str(d.quotedAuthor)!),
        (d) =>
          d.repostedAuthor == null ||
          !g.following.includes(str(d.repostedAuthor)!),
      ]);
      // by hand: authors A, B and S go, and c3, which reposts B's b1
      assert.deepEqual(expected, [
        'c1',
        'c2',
        'c4',
        'd1',
        'd2',
        'e1',
        'f1',
        'g1',
        'h1',
        'v1',
      ]);
      await agree(
        assert,
        both((s) =>
          s.about(Post, {
            let: { $following: lets.following(s, 'V') },
            filter: all(s, [
              p(s, { not: { in: { author: $('following') } } }),
              absentOrNotIn(s, 'quotedAuthor', $('following')),
              absentOrNotIn(s, 'repostedAuthor', $('following')),
            ]),
          }),
        ),
        expected,
      );
    });

    test('an expression ranks by age read from a datetime field', async function (assert) {
      // Whether DAYS counts whole days or fractions of one is not something
      // the documentation settles, so only what holds either way is asked:
      // every post gets a number, and the post two days older than the rest
      // has the largest.
      let names = ['a1', 'a2', 'a3', 'a4', 'b3'];
      let { rows } = await run(
        lowerQuery(
          typed.about(Post, {
            filter: { in: { id: names.map(postUrl) } },
            sort: [{ expression: 'DAYS(NOW(), postedOn) * 24' }, byUrl],
          }),
        ).query,
      );
      assert.deepEqual(rows.map((r) => nameOf(r.url)).sort(), names);
      assert.deepEqual(
        rows.filter((r) => !Number.isFinite(Number(r._expression ?? NaN))),
        [],
        'every post has an age',
      );
      assert.strictEqual(nameOf(rows[0].url), 'a4', 'the 50-hour post leads');
    });

    test('a re-ranked row keeps the value its expression sort gave it', async function (assert) {
      // Whether a rerank expression can read that value is not documented and
      // not asked here; that each row still carries it is.
      let names = ['a1', 'b1', 'c1'];
      let { rows } = await run(
        lowerQuery(
          typed.about(Post, {
            filter: { in: { id: names.map(postUrl) } },
            sort: [
              { expression: 'pFav', top: 100 },
              { expression: RAW },
              byUrl,
            ],
          }),
        ).query,
      );
      // by hand: pFav is 0.30 for c1, 0.20 for b1, 0.10 for a1
      assert.deepEqual(
        rows.map((r) => nameOf(r.url)),
        ['c1', 'b1', 'a1'],
        'ordered by the rerank',
      );
      for (let row of rows) {
        let name = nameOf(row.url);
        assert.ok(
          close(row._expression, rawScore(Post.rows[name])),
          `${name}: ${row._expression} is ${rawScore(Post.rows[name])}`,
        );
        assert.ok(
          close(row._window, num(Post.rows[name].pFav)),
          `${name}: re-ranked by ${row._window}`,
        );
      }
    });

    test('an expression with compare counts within its peers with COUNTIF', async function (assert) {
      // How many of the author's posts score higher than this one.
      let expected = Object.fromEntries(
        Object.entries(Scored.rows).map(([name, doc]) => [
          name,
          Object.values(Scored.rows).filter(
            (o) => o.author === doc.author && num(o.score) > num(doc.score),
          ).length,
        ]),
      );
      assert.deepEqual(
        expected,
        { x1: 0, x2: 1, x3: 2, y1: 0, z1: 0 },
        'by hand',
      );
      for (let [form, asked] of forms(
        both((s) =>
          s.about(Scored, {
            sort: [
              {
                expression: 'COUNTIF(peers.score, ">" & score)',
                compare: { by: 'author' },
              },
              s.by(Scored, 'score', 'desc'),
              byUrl,
            ],
          }),
        ),
      )) {
        let { rows } = await run(asked);
        assert.deepEqual(
          Object.fromEntries(
            rows.map((r) => [
              nameOf(r.url),
              r._window == null ? null : Number(r._window),
            ]),
          ),
          expected,
          form,
        );
      }
    });

    // --- what the feeds of the sample apps ask ------------------------------

    test('excluded ids, two posts per author, paged: the pages laid end to end are the collapsed whole', async function (assert) {
      let excluded = ['c1', 'b1'].map(postUrl);
      let perAuthor: Record<string, number> = {};
      let whole = posts(
        [(_d, id) => !excluded.includes(id)],
        newestFirst,
      ).filter((name) => {
        let author = str(Post.rows[name].author)!;
        perAuthor[author] = (perAuthor[author] ?? 0) + 1;
        return perAuthor[author] <= 2;
      });
      // by hand: A, B, C and D keep two each, six authors have one post
      assert.strictEqual(whole.length, 14);
      let size = 3;
      let q = (number: number, pageSize: number) =>
        both((s) =>
          s.about(Post, {
            filter: p(s, { not: { in: { id: excluded } } }),
            sort: [s.by(Post, 'postedAt', 'desc'), byUrl],
            collapse: s.collapse(Post, 'author', 2),
            page: { size: pageSize, number },
          }),
        );
      await agree(assert, q(0, 100), whole, {
        ordered: true,
        label: 'unpaged',
      });
      let pages = Math.ceil(whole.length / size);
      let formCount = forms(q(0, size)).length;
      for (let i = 0; i < formCount; i++) {
        let laid: string[] = [];
        let form = '';
        for (let number = 0; number < pages + 1; number++) {
          let [name, asked] = forms(q(number, size))[i];
          form = name;
          let { names, meta } = await run(asked);
          assert.deepEqual(
            names,
            whole.slice(number * size, (number + 1) * size),
            `${form}: page ${number}`,
          );
          assert.strictEqual(
            meta.page.total,
            whole.length,
            `${form}: page ${number} counts the collapsed whole`,
          );
          laid.push(...names);
        }
        assert.deepEqual(laid, whole, `${form}: the pages end to end`);
      }
    });

    test('a filter naming 600 ids returns all 600 on one page', async function (assert) {
      let wanted = Array.from({ length: TICKS }, (_, n) => n).filter(
        (n) => n % 13 !== 0,
      );
      assert.strictEqual(wanted.length, 600, '650 cards, every 13th left out');
      let expected = wanted.map(tickName);
      for (let [form, asked] of forms(
        both((s) =>
          s.about(Tick, {
            filter: s.on(Tick, {
              in: { id: expected.map((name) => urlOf(Tick, name)) },
            }),
            sort: [s.by(Tick, 'n', 'asc')],
            page: { size: 600 },
          }),
        ),
      )) {
        let { names, meta } = await run(asked);
        assert.deepEqual(names, expected, `${form}: rows in order`);
        assert.strictEqual(meta.page.total, 600, `${form}: total`);
      }
    });

    test('paging without a count: following hasMore visits every row once', async function (assert) {
      let expected = posts([], newestFirst);
      assert.strictEqual(expected.length, 21);
      let size = 4;
      let q = (number: number) =>
        both((s) =>
          s.about(Post, {
            sort: [s.by(Post, 'postedAt', 'desc'), byUrl],
            page: { size, number, total: 'none' },
          }),
        );
      let formCount = forms(q(0)).length;
      for (let i = 0; i < formCount; i++) {
        let visited: string[] = [];
        let form = '';
        let hasMore = true;
        let last: Record<string, any> | undefined;
        for (let number = 0; hasMore && number < 20; number++) {
          let [name, asked] = forms(q(number))[i];
          form = name;
          let { names, meta } = await run(asked);
          visited.push(...names);
          hasMore = meta.page.hasMore === true;
          last = meta.page;
        }
        assert.deepEqual(visited, expected, `${form}: every row, once each`);
        assert.strictEqual(
          last?.total,
          expected.length,
          `${form}: the last page, having no next, is counted exactly`,
        );
      }
    });
  });
});
