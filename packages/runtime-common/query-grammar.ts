// The query grammar as one table: every member a query can carry, scope by
// scope (top level, page, a filter node, a sort entry, a facet, a binding,
// …), with the spelling that has it, the validator that checks it, the
// refusal codes that validator raises, and the text the AI assistant's
// search tools describe it with.
//
// Owns: which members exist and in what order they are listed. The order is
// load-bearing: an unknown member is refused with the nearest known one
// (ties go to the earlier) or with the whole list, so a list's order is
// part of a refusal's message.
// Must not: hold a validator's logic (query.ts), the lowering (query-syntax.ts)
// or a JSON schema's types (helpers/ai.ts). Those read the table:
//   - query.ts: the known-member lists and nearest-name hints of the top
//     level, page, filter nodes, facets, windows, comparison sets, collapse,
//     bindings, linkedFrom, near targets and range bounds; the filter
//     operators' validator map is keyed by this table's operators.
//   - query-syntax.ts: the members that make a query the newer spelling
//     (`usesNewSyntax`), and the one a mixed-spelling refusal names.
//   - helpers/ai.ts: every description in the search tools' query schema.
// Guarantees: docs/search.md ("The shape of a query", "Refusals",
// "Compatibility: older and newer spellings"); the codes are listed in
// invalid-query-error.ts. query-grammar-test.ts pins the derived lists.
//
// Spellings: 'older' is main's grammar, still valid in the newer spelling;
// 'newer' is a Query V2 member, and writing one makes a query the newer
// spelling (unless `marker: false`); 'engine' is the engine's own form,
// never suggested to an author; 'retired' is suggested only so a slip is
// named, then refused. `form` says where a member is read when it is not
// the engine form itself: 'lowered' (rewritten by the lowering before the
// validator sees it), 'wire' (a request member beside the query) or
// 'entry' (the search-entry wire grammar, search-entry.ts).

export type Spelling = 'older' | 'newer' | 'engine' | 'retired';

export interface GrammarMember {
  readonly name: string;
  readonly spelling: Spelling;
  // filter nodes only: an operator, or a member that sits beside one
  readonly role?: 'operator' | 'modifier';
  readonly form?: 'lowered' | 'wire' | 'entry';
  // false: never offered as the nearest name (default: offered unless
  // 'engine')
  readonly hint?: boolean;
  // false: a newer member that does not by itself make a query the newer
  // spelling (default: every 'newer' member does)
  readonly marker?: boolean;
  // the function that checks it (query.ts unless named elsewhere)
  readonly validator?: string;
  // the codes that validator raises
  readonly refusals?: readonly string[];
  // the AI tool schema's description (helpers/ai.ts)
  readonly description?: string;
}

export interface GrammarScope {
  readonly about: string;
  // the AI tool schema's description of the whole scope
  readonly description?: string;
  // when the newer members are named in another order than the table's
  // (a mixed-spelling refusal names the first one present)
  readonly newerOrder?: readonly string[];
  readonly members: readonly GrammarMember[];
}

export const QUERY_GRAMMAR = {
  query: {
    about: 'The members of a query, top level.',
    description:
      'A card search query (docs/search.md): which cards match (filter), their order (sort), and which slice comes back (page), optionally collapsed to the best few per group, or reading values computed first (let); re-ranking is a sort entry ({ expression, top, compare }). Every member is optional; {} matches every card. Omit a member you do not use: an empty object, list or CodeRef is a condition, not "nothing". A type is written "<module>#<Name>" ("@cardstack/catalog/product#Product") or as the CodeRef { module, name }, the same type either way. The module is a card id or module URL, a registered prefix such as "@cardstack/catalog/product", or "$REALM/<path>" for a module in the realm being searched (refused in a search across several realms); never a bare name or a relative path.',
    members: [
      {
        name: 'filter',
        spelling: 'older',
        validator: 'assertFilter',
        refusals: [
          'conflicting-members',
          'invalid-value',
          'missing-member',
          'unknown-key',
        ],
        description:
          "Which cards match. A filter object holds at most one operator — 'eq', 'in', 'contains', 'range', 'matches', 'near', 'pattern', 'regex', 'linkedFrom', 'any', 'every' or 'not' — optionally beside 'on' (the card type its field paths belong to) and/or 'type' (keep only cards of that type and its subtypes). A filter with only 'type' is valid. Two operators in one object are refused (conflicting-members); nest one filter per operator under 'every' (all hold) or 'any' (one holds). Field paths are dotted ('author.name'). A card with no value at a path matches neither a comparison nor its 'not', as in SQL: to include those cards write any: [{ eq: { path: null } }, { not: … }]. On a list field a comparison holds when some element matches, so 'not' keeps cards with an empty list. Example: { on: <CodeRef>, every: [{ matches: 'brass lamp' }, { range: { price: { lte: 50 } } }] }.",
      },
      {
        name: 'sort',
        spelling: 'older',
        validator: 'assertSortExpression',
        refusals: [
          'invalid-nesting',
          'invalid-value',
          'missing-member',
          'needs-type',
          'sort-needs-type',
          'unknown-key',
        ],
        description:
          'Sort keys, in order: the first orders, each later one only breaks the ties of those before. Rows still tied, and every row of an unsorted query, come back by card URL.',
      },
      {
        name: 'page',
        spelling: 'older',
        validator: 'assertPage',
        refusals: ['invalid-page', 'unknown-key'],
      },
      {
        name: 'facets',
        spelling: 'newer',
        validator: 'assertFacets',
        refusals: ['invalid-value', 'limit-exceeded', 'unknown-key'],
        description:
          "Up to 8 counts of what every match holds in one field, in meta.facets[by] as { value, count } (most first), counted over all matches, not the page. A field counts only when its type declares it a facet (search: { facet: true }); any other 'by' is refused with needs-declaration, naming the declaration to add. Every card and file also facets by _type (its type, labeled), _realm, createdAt and lastModified; a card by _cardType. A number counts in range buckets unless the facet says stats: true (each value, with min/max/sum/avg in meta.facetStats) or names ranges ([{ from?, to?, key? }]); a date by month unless it names an interval. own: 'ignore' counts without the facet's own selection; measure: { avg: <number field> } adds a per-value aggregate. Use page: { size: 0 } for counts alone. Example: facets: [{ by: 'brand.name', size: 10 }, { by: 'priceMin', stats: true }].",
      },
      {
        name: 'collapse',
        spelling: 'newer',
        validator: 'assertCollapse',
        refusals: ['invalid-value', 'unknown-key'],
        description:
          "Keep the best 'keep' cards (1 to 10, default 1) of each group of cards sharing a value at 'by', by the query's own sort. A card with no value is a group of its own. Each kept card carries meta._collapseSize.",
      },
      {
        name: 'let',
        spelling: 'newer',
        validator: 'assertLetBindings',
        refusals: [
          'invalid-nesting',
          'invalid-value',
          'limit-exceeded',
          'missing-member',
          'unknown-key',
        ],
        description:
          "1 to 4 named values computed before the query, each name written with its $: { $brands: { from: { filter, sort?, page?: { size } }, select: 'brand.name' } } is the list of values at that path across the rows 'from' finds (at most 10,000), read whole as the string '$brands', the value of an 'in'. { $sofa: { from, one: true } } is the first card 'from' finds, read as the string '$sofa.priceMin' wherever a value goes, and as $sofa.priceMin in an expression. A string is a reference only when its $name is declared here; '$this' and '$literal' are reserved. A binding's query cannot read another binding.",
      },
      { name: 'explain', spelling: 'newer' },
      { name: 'rerank', spelling: 'engine' },
      {
        name: 'timeZone',
        spelling: 'newer',
        validator: 'assertTimeZone',
        refusals: ['invalid-value'],
        description:
          "An IANA time zone, such as 'America/New_York', whose calendar decides where 'today', 'this week' and a day, week, month or year bucket start: relative dates (now/d, now-1w/w), facet intervals and TODAY(). Stored values keep their meaning. Absent: the caller's zone, else the realm's default zone, else UTC. Name it for a question about a person's or a place's day.",
      },
      { name: 'asData', spelling: 'older' },
      {
        name: 'fields',
        spelling: 'older',
        validator: 'assertFields',
        refusals: ['invalid-value'],
      },
      {
        name: 'type',
        spelling: 'newer',
        form: 'lowered',
        validator: 'assertCardType',
        refusals: ['invalid-type'],
        description:
          "The card type of every match (subtypes included), whose fields the filter's, sort's and facets' paths name unless a nested node gives its own 'on'. Name the query's type here, not as an 'on' on the top filter node: a top-node 'on' is the older spelling and is refused (mixed-spelling) beside any newer member (facets, collapse, let, timeZone, page.total, near, typos, prefix, pattern, regex, linkedFrom, within, scope, fields, exists, missing, an expression sort). Example: { type: '@cardstack/catalog/product#Product', filter: { eq: { brand: 'Acme' } }, facets: [{ by: 'brand' }] }.",
      },
      { name: 'select', spelling: 'newer', form: 'entry' },
      {
        name: 'realm',
        spelling: 'older',
        form: 'wire',
        validator: 'assertRealm',
        refusals: ['invalid-value'],
      },
      {
        name: 'realms',
        spelling: 'older',
        form: 'wire',
        validator: 'assertRealms',
        refusals: ['invalid-value'],
      },
      { name: 'queryString', spelling: 'older', form: 'wire' },
    ],
  },
  page: {
    about: 'The members of `page`.',
    newerOrder: ['total', 'exactTotal'],
    members: [
      {
        name: 'size',
        spelling: 'older',
        validator: 'assertPage',
        refusals: ['invalid-page', 'unknown-key'],
        description:
          'Rows per page; 0 returns only the total. The search-entries tool sets it from its own limit.',
      },
      {
        name: 'number',
        spelling: 'older',
        validator: 'assertPage',
        refusals: ['invalid-page', 'unknown-key'],
        description: '0-based page number.',
      },
      { name: 'generation', spelling: 'older' },
      { name: 'exactTotal', spelling: 'newer' },
      {
        name: 'total',
        spelling: 'newer',
        validator: 'assertPage',
        refusals: ['invalid-page', 'unknown-key'],
        description:
          "How the total is counted: 'capped' counts up to 1,000 and reports a lower bound past it (the default in the newer spelling); 'exact' counts every match (the default in the older spelling, and for size 0); 'none' counts nothing.",
      },
    ],
  },
  filter: {
    about:
      'The members of a filter node: one operator, and what may sit beside it.',
    members: [
      {
        name: 'eq',
        spelling: 'older',
        role: 'operator',
        validator: 'assertEqFilter',
        refusals: ['invalid-value', 'missing-member'],
        description:
          "Field paths to exact values, all of which must hold: { status: 'open', 'author.firstName': 'Ada' }. null finds the cards with no value at that path. A value may be the string '$name.path' to read a one-card 'let' binding '$name' (only a declared name is a reference; any other string, '$100' included, is text, and { \"$literal\": '…' } writes text that would otherwise read a binding).",
      },
      {
        name: 'in',
        spelling: 'older',
        role: 'operator',
        validator: 'assertInFilter',
        refusals: ['invalid-value', 'limit-exceeded', 'missing-member'],
        description:
          "One field path to a list of accepted values: { status: [\"open\", \"closed\"] }. The list may instead be the string '$name' to read a list binding '$name' from 'let'; a list binding goes nowhere else.",
      },
      {
        name: 'range',
        spelling: 'older',
        role: 'operator',
        validator: 'assertRangeFilter',
        refusals: ['invalid-value', 'missing-member', 'unknown-key'],
        description:
          "Field paths to bounds, any of gt, gte, lt, lte: { price: { gte: 10, lt: 50 } }. A bound is a number or a string, never null. A date bound may be relative: 'now', 'now-30d', 'now-1M/d' (units s, m, h, d, w, M, y; '/unit' rounds down on the query's time zone calendar: its timeZone, else the caller's, else the realm's default, else UTC).",
      },
      {
        name: 'contains',
        spelling: 'older',
        role: 'operator',
        validator: 'assertContainsFilter',
        refusals: ['invalid-value', 'missing-member'],
        description:
          'Field paths to substrings, matched ignoring case: { cardTitle: "lamp" }.',
      },
      {
        name: 'matches',
        spelling: 'older',
        role: 'operator',
        validator: 'assertMatchesFilter',
        refusals: [
          'conflicting-members',
          'engine-only',
          'invalid-value',
          'limit-exceeded',
          'missing-member',
        ],
        description:
          "Full-text search over each card's words, in web search syntax: bare words are ANDed, \"quotes\" for a phrase, OR between alternatives, -word to exclude. Words are stemmed in English. Options beside it: 'prefix', 'typos', 'scope', 'fields', 'within'. Sort by '_matchRelevance' to put the best matches first.",
      },
      {
        name: 'near',
        spelling: 'newer',
        role: 'operator',
        validator: 'assertNearFilter',
        refusals: ['conflicting-members', 'invalid-value', 'unknown-key'],
        description:
          "Vector similarity on one VectorField, keyed by its path (with 'on' naming the card type): { embedding: { to: [ …numbers… ], minSimilarity?: number } }. 'to' has as many numbers as the field has dimensions, or is the string '$name.path' reading a one-card binding's vector; minSimilarity is a cosine threshold from -1 to 1. Without minSimilarity it keeps every card with a vector there. For the k most similar, sort by the field with 'near' and set page.size to k.",
      },
      {
        name: 'pattern',
        spelling: 'newer',
        role: 'operator',
        validator: 'assertStringKeyedFilter',
        refusals: ['invalid-value', 'missing-member'],
        description:
          "Field paths to globs over the whole value, ignoring case, path-aware ('*' any run within one '/' segment, '?' one character other than '/', '**' any run across segments): { sku: 'AMG1*' }, { url: '**/components/*.gts' }. Only on fields declared for patterns (search: { patterns: true }, or an identifier or code role); every file type's 'url' and 'name' are.",
      },
      {
        name: 'regex',
        spelling: 'newer',
        role: 'operator',
        validator: 'assertStringKeyedFilter',
        refusals: ['invalid-value', 'missing-member'],
        description:
          "Field paths to POSIX regular expressions, case-sensitive, on the same fields as 'pattern'.",
      },
      {
        name: 'linkedFrom',
        spelling: 'newer',
        role: 'operator',
        validator: 'assertLinkedFromFilter',
        refusals: ['invalid-value', 'unknown-key'],
        description:
          "The cards another card links to: { card: <the id of a card in the searched realm: its URL, its @scope/… id or '$REALM/<path>'>, field: 'items' }, where field is a linksTo or linksToMany of that card.",
      },
      {
        name: 'every',
        spelling: 'older',
        role: 'operator',
        validator: 'assertEveryFilter',
        refusals: ['invalid-value', 'missing-member'],
        description: 'Holds when every nested filter holds.',
      },
      {
        name: 'any',
        spelling: 'older',
        role: 'operator',
        validator: 'assertAnyFilter',
        refusals: ['invalid-value', 'missing-member'],
        description: 'Holds when at least one nested filter holds.',
      },
      {
        name: 'not',
        spelling: 'older',
        role: 'operator',
        validator: 'assertNotFilter',
        refusals: ['invalid-value', 'missing-member'],
        description:
          'Holds when the nested filter does not, for cards that have a value there (see the missing-value rule above).',
      },
      { name: 'exists', spelling: 'newer', role: 'operator', form: 'lowered' },
      { name: 'missing', spelling: 'newer', role: 'operator', form: 'lowered' },
      {
        name: 'on',
        spelling: 'older',
        role: 'modifier',
        validator: 'assertCardType',
        refusals: ['invalid-type'],
        description:
          "The card type whose fields this filter's paths name. Nested filters do not inherit it; give each one its own 'on'. Name the whole query's type with the top-level 'type' instead of an 'on' on the top filter node: beside a newer member (facets, near, typos, an expression sort, …) a top-node 'on' is refused (mixed-spelling).",
      },
      {
        name: 'type',
        spelling: 'older',
        role: 'modifier',
        validator: 'assertCardType',
        refusals: ['invalid-type'],
        description:
          'Keep only cards of this type, subtypes included. Alone, the filter is every card of the type.',
      },
      {
        name: 'fields',
        spelling: 'newer',
        role: 'modifier',
        validator: 'assertMatchesFilter',
        refusals: [
          'conflicting-members',
          'engine-only',
          'invalid-value',
          'limit-exceeded',
          'missing-member',
        ],
        description:
          "With 'matches': search only these 1 to 8 field paths' values. Takes no 'prefix', 'scope' or 'within'.",
      },
      {
        name: 'within',
        spelling: 'newer',
        role: 'modifier',
        validator: 'assertMatchesFilter',
        refusals: [
          'conflicting-members',
          'engine-only',
          'invalid-value',
          'limit-exceeded',
          'missing-member',
        ],
        description:
          "With 'matches': the top-level PassageField list to search passage by passage, such as 'segments'.",
      },
      {
        name: 'prefix',
        spelling: 'newer',
        role: 'modifier',
        validator: 'assertMatchesFilter',
        refusals: [
          'conflicting-members',
          'engine-only',
          'invalid-value',
          'limit-exceeded',
          'missing-member',
        ],
        description:
          "With 'matches': type-ahead. The last word is unfinished and matches as a prefix. With scope 'title' too, it suggests by a card's names: every word is a prefix of a word of its title or alternative names, in any order, never stemmed (a word under 3 letters matches whole unless a longer word narrows it), ranked exact title first under a '_matchRelevance' sort.",
      },
      {
        name: 'typos',
        spelling: 'newer',
        role: 'modifier',
        validator: 'assertMatchesFilter',
        refusals: [
          'conflicting-members',
          'engine-only',
          'invalid-value',
          'limit-exceeded',
          'missing-member',
        ],
        description:
          "With 'matches': each word also matches its closest spellings in the realm's word list.",
      },
      {
        name: 'scope',
        spelling: 'newer',
        role: 'modifier',
        validator: 'assertMatchesFilter',
        refusals: [
          'conflicting-members',
          'engine-only',
          'invalid-value',
          'limit-exceeded',
          'missing-member',
        ],
        description:
          "With 'matches': search only the title, name and alias fields. With 'prefix': type-ahead over titles and alternative names.",
      },
      { name: 'typoQuery', spelling: 'engine', role: 'modifier' },
      { name: 'typoPartial', spelling: 'engine', role: 'modifier' },
      { name: 'wordStatistics', spelling: 'engine', role: 'modifier' },
    ],
  },
  sortEntry: {
    about:
      "The members of a sort entry, as an author writes them (the engine's own keys after lowering are checked per kind in query.ts).",
    members: [
      {
        name: 'by',
        spelling: 'older',
        description:
          "A field path (with 'on' naming its card type), a general key that needs no 'on' ('lastModified', 'createdAt', 'cardURL'), or a ranking key: '_matchRelevance' (full-text relevance, best first; needs a positive 'matches' term), '_blend' (fuses the signals in 'of'), '_relevance' (the type's declared search signals, weighted by 'weights'), '_expr' (a spreadsheet expression in 'expr').",
      },
      {
        name: 'on',
        spelling: 'older',
        description:
          "The card type 'by' is a field of. Required for a field path and for a 'near' sort; not needed for a general or ranking key.",
      },
      {
        name: 'direction',
        spelling: 'older',
        description:
          "Fields default to 'asc'; ranking keys and 'near' default to 'desc' (best first).",
      },
      {
        name: 'missing',
        spelling: 'newer',
        marker: false,
        description:
          "On a field sort: where cards with no value go (default 'last').",
      },
      { name: 'weight', spelling: 'older' },
      {
        name: 'near',
        spelling: 'newer',
        marker: false,
        description:
          "Rank by cosine similarity between the VectorField named by 'by' (with 'on') and this vector, most similar first. Results carry meta._nearSimilarity; cards without a vector sort last.",
      },
      {
        name: 'blend',
        spelling: 'newer',
        validator: 'assertBlendSort',
        refusals: [
          'conflicting-members',
          'invalid-nesting',
          'invalid-value',
          'limit-exceeded',
          'missing-member',
          'unknown-key',
        ],
      },
      {
        name: 'expression',
        spelling: 'newer',
        validator: 'assertSortExpression',
        refusals: [
          'invalid-nesting',
          'invalid-value',
          'missing-member',
          'needs-type',
          'sort-needs-type',
          'unknown-key',
        ],
        description:
          "In place of 'by': a sort entry { expression, direction?, top?, compare? } ranks by a spreadsheet expression in SQL (at most 200 syntax parts, about 100 terms): numbers, fields, arithmetic, comparisons and IF, IFERROR, AND, OR, NOT, ROUND, ABS, SQRT, POWER, EXP, LN, LOG10, MIN, MAX, AVERAGE, SUM, COUNT, MEDIAN, STANDARDIZE, PERCENTRANK_INC, COUNTIF (a number, text equal ignoring case, or a field), DAYS, NOW, TODAY, NA. Text functions are refused (expression-unsupported). With 'top' or 'compare' it must be the FIRST sort entry: it re-orders only the first 'top' rows of the order the entries after it give, and the rest follow in that order.",
      },
      { name: 'boost', spelling: 'newer' },
      {
        name: 'relevance',
        spelling: 'newer',
        validator: 'assertRelevanceSort',
        refusals: ['invalid-value', 'unknown-key'],
      },
      { name: 'placement', spelling: 'retired' },
      {
        name: 'of',
        spelling: 'engine',
        hint: false,
        validator: 'assertBlendSort',
        refusals: [
          'conflicting-members',
          'invalid-nesting',
          'invalid-value',
          'limit-exceeded',
          'missing-member',
          'unknown-key',
        ],
        description:
          "With by '_blend': 1 to 8 signals fused by reciprocal rank (each card scores the sum of weight / (k + rank) over the signals it has a value for); results carry meta._blendScore. A blend cannot hold another blend or a '_relevance'. Example: [{ by: '_matchRelevance' }, { by: 'embedding', on: <CodeRef>, near: [ … ], weight: 2 }, { by: 'createdAt' }, { by: '_when', when: { on: <CodeRef>, eq: { material: 'Brass' } }, weight: 1.5 }].",
      },
      {
        name: 'k',
        spelling: 'engine',
        hint: false,
        validator: 'assertBlendSort',
        refusals: [
          'conflicting-members',
          'invalid-nesting',
          'invalid-value',
          'limit-exceeded',
          'missing-member',
          'unknown-key',
        ],
        description:
          "With by '_blend': the positive rank-fusion constant (default 60). Smaller values favor each signal's top ranks.",
      },
      {
        name: 'weights',
        spelling: 'engine',
        hint: false,
        validator: 'assertRelevanceSort',
        refusals: ['invalid-value', 'unknown-key'],
        description:
          "With by '_relevance': weights by signal name (text, popularity, quality, recency, priority, meaning). Defaults: text and meaning 1, the rest 0.5; 0 drops a signal, a negative weight inverts it.",
      },
      {
        name: 'expr',
        spelling: 'engine',
        hint: false,
        description:
          "With by '_expr': a spreadsheet expression over the card's fields, such as 'rating / LN(priceMin + 1)'. Highest first unless direction is 'asc'.",
      },
      {
        name: 'top',
        spelling: 'newer',
        hint: false,
        marker: false,
        description:
          "With 'expression' as the first sort entry: how many of the first rows it re-orders (1 to 500; 100 when 'compare' is given without it).",
      },
      {
        name: 'compare',
        spelling: 'newer',
        hint: false,
        marker: false,
        description:
          "With 'expression' as the first sort entry: the comparison set its expression reads as stats.<field>.<count|sum|avg|min|max|median|p10|p25|p75|p90|stdev> and peers.<field> (a list, for COUNT, MIN, MAX, MEDIAN, PERCENTRANK_INC, COUNTIF): { by: <path> } (the rows sharing the row's value there), { filter } (default: the query's matches; give it its own 'on'), or { near: <vector field>, k?, minSimilarity? } (each row's look-alikes). Example: sort: [{ expression: 'PERCENTRANK_INC(peers.rating, rating)', top: 200, compare: { by: 'productType' } }, { by: 'rating', on: <CodeRef>, direction: 'desc' }].",
      },
    ],
  },
  blend: {
    about: 'The members of a `{ blend }` sort entry, as an author writes them.',
    members: [
      { name: 'blend', spelling: 'newer' },
      { name: 'method', spelling: 'newer' },
      { name: 'k', spelling: 'newer' },
      { name: 'direction', spelling: 'newer' },
    ],
  },
  window: {
    about:
      "The members of a sort window (the engine's `rerank`, from a sort entry with `top`).",
    members: [
      { name: 'expression', spelling: 'newer' },
      { name: 'top', spelling: 'newer' },
      { name: 'direction', spelling: 'newer' },
      { name: 'compare', spelling: 'newer' },
    ],
  },
  compare: {
    about: "The members of a window's comparison set.",
    members: [
      { name: 'filter', spelling: 'newer' },
      { name: 'by', spelling: 'newer' },
      { name: 'near', spelling: 'newer' },
      { name: 'k', spelling: 'newer' },
      { name: 'minSimilarity', spelling: 'newer' },
    ],
  },
  facet: {
    about: 'The members of a facet.',
    members: [
      { name: 'by', spelling: 'newer' },
      { name: 'size', spelling: 'newer' },
      { name: 'own', spelling: 'newer' },
      { name: 'stats', spelling: 'newer' },
      { name: 'ranges', spelling: 'newer' },
      { name: 'interval', spelling: 'newer' },
      { name: 'prefix', spelling: 'newer' },
      { name: 'missing', spelling: 'newer' },
      { name: 'order', spelling: 'newer' },
      { name: 'measure', spelling: 'newer' },
    ],
  },
  facetRange: {
    about: "The members of one of a facet's ranges.",
    members: [
      { name: 'from', spelling: 'newer' },
      { name: 'to', spelling: 'newer' },
      { name: 'key', spelling: 'newer' },
    ],
  },
  collapse: {
    about: 'The members of `collapse`.',
    members: [
      { name: 'by', spelling: 'newer' },
      {
        name: 'on',
        spelling: 'newer',
        description: 'The card type whose field "by" is.',
      },
      { name: 'keep', spelling: 'newer' },
    ],
  },
  binding: {
    about: 'The members of a `let` binding.',
    members: [
      { name: 'from', spelling: 'newer' },
      { name: 'select', spelling: 'newer' },
      { name: 'one', spelling: 'newer' },
    ],
  },
  bindingQuery: {
    about: "The members of a card binding's query (`let.$name.from`).",
    members: [
      { name: 'type', spelling: 'newer', form: 'lowered' },
      { name: 'filter', spelling: 'newer' },
      { name: 'sort', spelling: 'newer' },
      { name: 'page', spelling: 'newer' },
      { name: 'timeZone', spelling: 'newer' },
    ],
  },
  logBinding: {
    about:
      "The members of a log binding's source (`let.$name.from` with `log` or `logs`).",
    members: [
      { name: 'log', spelling: 'newer' },
      { name: 'logs', spelling: 'newer' },
      { name: 'filter', spelling: 'newer' },
      { name: 'select', spelling: 'newer' },
    ],
  },
  linkedFrom: {
    about: 'The members of `linkedFrom`.',
    members: [
      { name: 'card', spelling: 'newer' },
      { name: 'field', spelling: 'newer' },
    ],
  },
  nearTarget: {
    about: "The members of a `near` filter's target.",
    members: [
      { name: 'to', spelling: 'newer' },
      { name: 'minSimilarity', spelling: 'newer' },
    ],
  },
  rangeBound: {
    about: 'The bounds of a `range`.',
    members: [
      { name: 'gt', spelling: 'older' },
      { name: 'gte', spelling: 'older' },
      { name: 'lt', spelling: 'older' },
      { name: 'lte', spelling: 'older' },
    ],
  },
} as const satisfies Record<string, GrammarScope>;

export type GrammarScopeName = keyof typeof QUERY_GRAMMAR;

type Members<S extends GrammarScopeName> =
  (typeof QUERY_GRAMMAR)[S]['members'][number];

// The engine form's filter operators: what the validator map in query.ts is
// keyed by (lowered operators, `exists` and `missing`, are rewritten first).
export type FilterOperatorName = Exclude<
  Extract<Members<'filter'>, { role: 'operator' }>,
  { form: 'lowered' }
>['name'];

const scopeOf = (scope: GrammarScopeName): GrammarScope => QUERY_GRAMMAR[scope];

// The names of a scope's members, in table order, that pass `keep`.
export function grammarMembers(
  scope: GrammarScopeName,
  keep: (member: GrammarMember) => boolean = () => true,
): string[] {
  return scopeOf(scope)
    .members.filter(keep)
    .map((m) => m.name);
}

// The members to suggest for a slip, in the order to prefer them on a tie.
export function grammarHints(
  scope: GrammarScopeName,
  keep: (member: GrammarMember) => boolean = () => true,
): string[] {
  return grammarMembers(
    scope,
    (m) => (m.hint ?? m.spelling !== 'engine') && keep(m),
  );
}

// The members that make a query the newer spelling, in the order a
// mixed-spelling refusal names them.
export function newerSpellingMarkers(scope: GrammarScopeName): string[] {
  let { newerOrder } = scopeOf(scope);
  if (newerOrder) return [...newerOrder];
  return grammarMembers(
    scope,
    (m) => m.spelling === 'newer' && m.marker !== false,
  );
}

// The AI tool schema's description of a member (or of the scope).
export function grammarDescription(
  scope: GrammarScopeName,
  member?: string,
): string {
  let s = scopeOf(scope);
  let text =
    member === undefined
      ? s.description
      : s.members.find((m) => m.name === member)?.description;
  if (text === undefined) {
    throw new Error(
      `query-grammar: no description for ${scope}${member ? `.${member}` : ''}`,
    );
  }
  return text;
}

// Common selections.
export const isEngineForm = (m: GrammarMember) => m.form === undefined;
export const isWire = (m: GrammarMember) => m.form === 'wire';
export const isLowered = (m: GrammarMember) => m.form === 'lowered';
