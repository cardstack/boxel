// Search intent: what a field is and how people look for it, declared by the
// card author (see docs/search-intent.md). The index derives its mechanics
// from these declarations: which full-text weight a field's words carry, which
// fields a `_relevance` sort blends in, and which fields stay out of the search
// doc. An author never names a weight, an index or a storage choice here, so
// the framework can change those without touching a card.
//
// This module is the vocabulary and the rules that need no card class. The
// walk over a card's fields lives in card-api (`searchTextOf`), and the query
// engine reads the declarations through the type's `Definition`.

export const SEARCH_ROLES = [
  'title',
  'name',
  'alias',
  'summary',
  'keywords',
  'label',
  'body',
  'note',
  'identifier',
  'code',
] as const;
export type SearchRole = (typeof SEARCH_ROLES)[number];

export const SEARCH_RANK_SIGNALS = [
  'popularity',
  'recency',
  'quality',
  'priority',
] as const;
export type SearchRankSignal = (typeof SEARCH_RANK_SIGNALS)[number];

export type SearchFacetShape = true | 'values' | 'range' | 'date';
export type SearchChunks = 'item' | 'paragraph' | 'heading';

// A field's `search` option. Every member is optional; a field with none
// takes its type's default.
export interface FieldSearchIntent {
  role?: SearchRole;
  facet?: SearchFacetShape;
  rank?: SearchRankSignal;
  typos?: boolean;
  patterns?: boolean;
  chunks?: SearchChunks;
  // On a link: the linked card's fields that describe this card.
  include?: string[];
  appendOnly?: boolean;
  language?: string;
}

// `false` keeps the field out of the search doc.
export type FieldSearchOption = FieldSearchIntent | false;

// A card's `static searchDefaults`: defaults for the whole type. (Not
// `static search`, which a card may declare as an `@operation`.)
export interface CardSearchIntent {
  // The field whose role is `title`, when it isn't `cardInfo.name`.
  title?: string;
  // The main field for each ranking signal.
  rank?: Partial<Record<SearchRankSignal, string>>;
  language?: string;
}

// The full-text weight tier a role's words carry. Postgres has four weights,
// A (highest) to D; a role maps to one, and `identifier` to none, because an
// id is matched exactly, never ranked as prose. A text field with no role is
// plain text, ranked between the high and the low roles.
const ROLE_TIERS: Record<SearchRole, SearchTextTier | undefined> = {
  title: 'A',
  name: 'A',
  alias: 'A',
  summary: 'B',
  keywords: 'B',
  label: 'B',
  body: 'D',
  note: 'D',
  code: 'D',
  identifier: undefined,
};
export const PLAIN_TEXT_TIER: SearchTextTier = 'C';

export type SearchTextTier = 'A' | 'B' | 'C' | 'D';

// A card's searchable text, grouped by weight tier. Stamped into the search
// doc under `SEARCH_TEXT_KEY` by the render, turned into the row's weighted
// full-text vector by the index writer, and never stored in the promoted doc.
// Two more groups ride along: `typos`, the words of fields declared
// `typos: true`, which the writer adds to the realm's word list so a
// misspelt term can be corrected; and `patterns`, the values of fields
// searched by glob or regex (declared `patterns: true`, or an `identifier`
// or `code` role), one per line, which the writer keeps trigram-indexed.
export type SearchTextGroup = SearchTextTier | 'typos' | 'patterns';
export type SearchText = Partial<Record<SearchTextGroup, string>>;

export const SEARCH_TEXT_KEY = '_searchText';

// The most characters a tier holds. A title tier is short by nature; the
// prose tiers are capped so one huge field can't push the vector past
// Postgres's 1 MB tsvector limit.
export const SEARCH_TEXT_TIER_MAX: Record<SearchTextGroup, number> = {
  A: 10_000,
  B: 40_000,
  C: 200_000,
  D: 200_000,
  typos: 100_000,
  patterns: 20_000,
};

// Whether a field's values are searched by glob or regex.
export function searchesByPattern(
  intent: FieldSearchIntent | undefined,
): boolean {
  return (
    Boolean(intent?.patterns) ||
    intent?.role === 'identifier' ||
    intent?.role === 'code'
  );
}

export function searchTierOf(
  intent: FieldSearchIntent | undefined,
): SearchTextTier | undefined {
  if (!intent?.role) {
    return PLAIN_TEXT_TIER;
  }
  return ROLE_TIERS[intent.role];
}

// The roles a `matches … in: 'title'` term reads: the A tier.
export const TITLE_TIER: SearchTextTier = 'A';

// Collects text per tier, skipping a value it already holds in that tier (a
// card's title and its `cardInfo.name` are usually the same string) and
// stopping each tier at its cap.
export class SearchTextBuilder {
  #parts = new Map<SearchTextGroup, string[]>();
  #seen = new Map<SearchTextGroup, Set<string>>();
  #lengths = new Map<SearchTextGroup, number>();

  add(tier: SearchTextGroup, text: string) {
    let value = text.trim();
    if (!value) {
      return;
    }
    let seen = this.#seen.get(tier) ?? new Set<string>();
    if (seen.has(value)) {
      return;
    }
    let length = this.#lengths.get(tier) ?? 0;
    let room = SEARCH_TEXT_TIER_MAX[tier] - length;
    if (room <= 0) {
      return;
    }
    if (value.length > room) {
      value = value.slice(0, room);
    }
    seen.add(value);
    this.#seen.set(tier, seen);
    this.#lengths.set(tier, length + value.length + 1);
    let parts = this.#parts.get(tier) ?? [];
    parts.push(value);
    this.#parts.set(tier, parts);
  }

  build(): SearchText | undefined {
    let text: SearchText = {};
    for (let [tier, parts] of this.#parts) {
      text[tier] = parts.join('\n');
    }
    return Object.keys(text).length > 0 ? text : undefined;
  }
}

// Whether a string is data rather than words: an inline data URL or an
// encoded vector. Neither belongs in a full-text vector.
export function isNonTextString(value: string): boolean {
  return value.startsWith('data:') || value.startsWith('vec:');
}

// Serializers whose values are never prose, whatever their role says.
export const NON_TEXT_SERIALIZERS: ReadonlySet<string> = new Set([
  'number',
  'big-integer',
  'boolean',
  'date',
  'datetime',
  'vector',
  'ethereum-address',
  'code-ref',
  'json',
]);

// A card type's ranking signals: for each, the fields that carry it, the
// card's `static search.rank` choice first.
export function rankFieldsOf(definition: {
  search?: CardSearchIntent;
  fields: { [fieldName: string]: string };
  fieldDefs: { [defId: string]: { search?: FieldSearchOption } };
}): Partial<Record<SearchRankSignal, string[]>> {
  let signals: Partial<Record<SearchRankSignal, string[]>> = {};
  for (let signal of SEARCH_RANK_SIGNALS) {
    let main = definition.search?.rank?.[signal];
    if (main) {
      signals[signal] = [main];
    }
  }
  for (let [fieldName, defId] of Object.entries(definition.fields)) {
    let search = definition.fieldDefs[defId]?.search;
    if (search && search.rank) {
      let list = (signals[search.rank] ??= []);
      if (!list.includes(fieldName)) {
        list.push(fieldName);
      }
    }
  }
  return signals;
}

// Checks a field's `search` option where it is declared, so a typo fails the
// module rather than silently indexing the field by its default.
export function assertFieldSearchOption(
  value: unknown,
  where: string,
): asserts value is FieldSearchOption | undefined {
  if (value === undefined || value === false) {
    return;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      `${where}: \`search\` must be an object of search options, or false`,
    );
  }
  let intent = value as Record<string, unknown>;
  for (let key of Object.keys(intent)) {
    if (!FIELD_SEARCH_KEYS.has(key)) {
      throw new Error(
        `${where}: unknown search option "${key}" (expected one of ${[...FIELD_SEARCH_KEYS].join(', ')})`,
      );
    }
  }
  if (
    intent.role !== undefined &&
    !(SEARCH_ROLES as readonly unknown[]).includes(intent.role)
  ) {
    throw new Error(
      `${where}: search role must be one of ${SEARCH_ROLES.join(', ')}`,
    );
  }
  if (
    intent.rank !== undefined &&
    !(SEARCH_RANK_SIGNALS as readonly unknown[]).includes(intent.rank)
  ) {
    throw new Error(
      `${where}: search rank must be one of ${SEARCH_RANK_SIGNALS.join(', ')}`,
    );
  }
  if (
    intent.facet !== undefined &&
    ![true, 'values', 'range', 'date'].includes(intent.facet as never)
  ) {
    throw new Error(
      `${where}: search facet must be true, 'values', 'range' or 'date'`,
    );
  }
  if (
    intent.chunks !== undefined &&
    !['item', 'paragraph', 'heading'].includes(intent.chunks as never)
  ) {
    throw new Error(
      `${where}: search chunks must be 'item', 'paragraph' or 'heading'`,
    );
  }
  if (
    intent.include !== undefined &&
    (!Array.isArray(intent.include) ||
      intent.include.some((name) => typeof name !== 'string'))
  ) {
    throw new Error(`${where}: search include must be a list of field names`);
  }
  for (let flag of ['typos', 'patterns', 'appendOnly'] as const) {
    if (intent[flag] !== undefined && typeof intent[flag] !== 'boolean') {
      throw new Error(`${where}: search ${flag} must be a boolean`);
    }
  }
  if (intent.language !== undefined && typeof intent.language !== 'string') {
    throw new Error(`${where}: search language must be a string`);
  }
}

const FIELD_SEARCH_KEYS = new Set([
  'role',
  'facet',
  'rank',
  'typos',
  'patterns',
  'chunks',
  'include',
  'appendOnly',
  'language',
]);

// A card class's `static searchDefaults`, merged up its ancestry: the nearest
// class's choice for each member wins. A field type's `searchDefaults` is a
// field intent, not a card's, and is never read here.
export function cardSearchIntentOf(
  cardClass: { searchDefaults?: CardSearchIntent } | undefined,
): CardSearchIntent | undefined {
  let chain: CardSearchIntent[] = [];
  let current: any = cardClass;
  while (current && current !== Function.prototype) {
    let own = Object.prototype.hasOwnProperty.call(current, 'searchDefaults')
      ? current.searchDefaults
      : undefined;
    if (own && typeof own === 'object' && !('role' in own)) {
      chain.push(own as CardSearchIntent);
    }
    current = Object.getPrototypeOf(current);
  }
  if (chain.length === 0) {
    return undefined;
  }
  let merged: CardSearchIntent = {};
  for (let intent of chain.reverse()) {
    if (intent.title !== undefined) {
      merged.title = intent.title;
    }
    if (intent.language !== undefined) {
      merged.language = intent.language;
    }
    if (intent.rank) {
      merged.rank = { ...merged.rank, ...intent.rank };
    }
  }
  return merged;
}

// How many edits a typo-tolerant word may be from the word it is corrected
// to: none under four letters, one up to seven, two from eight. Trigram
// similarity nominates the candidates; this budget decides, so a long word
// can't be "corrected" to a different long word that merely shares most of
// its trigrams ("concurency" is not "cryptocurrency").
export function typoBudget(word: string): number {
  let length = [...word].length;
  return length < 4 ? 0 : length < 8 ? 1 : 2;
}

// The optimal-string-alignment distance between two words: insertions,
// deletions, substitutions and swaps of adjacent letters each cost one.
export function editDistance(a: string, b: string): number {
  let s = [...a];
  let t = [...b];
  let d: number[][] = Array.from({ length: s.length + 1 }, (_, i) =>
    Array.from({ length: t.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      let cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[s.length][t.length];
}

// The corrections a typo-tolerant word takes from its candidates: those
// within the word's typo budget, closest first (ties in the candidates'
// order), at most `limit`.
export function typoCorrections(
  word: string,
  candidates: string[],
  limit = 3,
): string[] {
  let budget = typoBudget(word);
  if (budget === 0) {
    return [];
  }
  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      distance: editDistance(word, candidate),
    }))
    .filter(
      ({ candidate, distance }) => candidate !== word && distance <= budget,
    )
    .sort((x, y) => x.distance - y.distance || x.index - y.index)
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}
