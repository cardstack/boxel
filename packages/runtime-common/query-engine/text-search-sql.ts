// Pure SQL for text search: the tsquery a `matches` term compiles to
// (words, phrases, prefixes, excluded words), type-ahead's tsquery and stop
// words, typo clauses, passages, and the word-statistics score.
// Owns: those builders and the text-search constants.
// Must not: read the index (text-search.ts runs the statements that read
// statistics and typo candidates).
// Guarantees: docs/search.md ("Text search (`matches`)", "Relevance").

import { type Expression, param } from '../expression.ts';
import {
  type MatchTerm,
  splitTypeAheadQuery as splitTypeAheadQueryAsWritten,
  typeAheadWords as typeAheadWordsAsWritten,
} from '../query.ts';
import { TIER_WEIGHTS, rankVector } from './index-sql.ts';
import { TYPE_AHEAD_KEY } from '../search-doc-keys.ts';

// The small-count rules for realm-wide word statistics shown to a caller a
// realm policy scopes (`anonymizeStatistics`): the realm must hold at least
// STATS_MIN_ROWS rows, and a count below STATS_MIN_COUNT reads as that
// floor (k-anonymity's suppression of small cells).
export const STATS_MIN_ROWS = 200;

export const STATS_MIN_COUNT = 5;

// How stale a realm's word statistics may be before a search rebuilds them.
export const WORD_STATISTICS_MAX_AGE_SECONDS = 600;

export function wordStatisticsScore(
  matches: MatchTerm[],
  staged: boolean,
): Expression {
  let idf = new Map<string, number>();
  for (let m of matches) {
    m.wordStatistics!.lexemes.forEach((l, i) =>
      idf.set(l, Math.max(idf.get(l) ?? 0, m.wordStatistics!.idfs[i])),
    );
  }
  if (idf.size === 0) return ['0'];
  let vector = `COALESCE(${rankVector('i', staged)}, ''::tsvector)`;
  let sum: Expression = ['(SELECT s / (s + 1) FROM (SELECT'];
  [...idf].forEach(([lexeme, weight], i) => {
    sum.push(
      i > 0 ? '+' : '',
      `${weight.toFixed(6)} * ts_rank('${TIER_WEIGHTS}'::float4[], ${vector}, quote_literal(`,
      param(lexeme),
      `)::tsquery, 1)`,
    );
  });
  sum.push(') AS z(s))');
  return sum;
}

// The Postgres tsquery one `matches` term compiles to. Without `prefix` it is
// `websearch_to_tsquery('boxel_english', …)` over the whole string. With it, the
// finished words keep that form, ANDed with an OR over the unfinished last
// word:
//   - the word as a prefix of any lexeme (`kleppm:*`, under `boxel_simple`
//     so it is not stemmed first, but its accents fold as the document's
//     did);
//   - the word's own english stem, exact (`jobs` → `job`);
//   - the word less its last one or two letters, exact, while at least three
//     remain.
// The document's tsvector is stemmed, so a prefix alone misses a word whose
// stem is shorter than what has been typed: "learni" is a prefix of
// "learning", but the indexed lexeme is "learn". The shortened forms catch it,
// at the cost of the odd extra match on a short word ("lear"). The partial
// word is letters and digits only, so it carries no tsquery syntax. A partial
// word right after a websearch `-` is negated, as a finished one would be.
// Every text vector and query uses one of two configurations, both folding
// accents with `unaccent`: `boxel_english` where words are stemmed (the
// field, rank, passage and rendered-markdown vectors) and `boxel_simple`
// where they are not (type-ahead, and a prefix still being typed).
//
// The type-ahead tsvector, exactly as the `one-text-search-config` migration
// indexes it (the planner uses the index only for an identical expression).
export const TYPE_AHEAD_TSVECTOR = (alias: string) =>
  `to_tsvector('boxel_simple', coalesce(${alias}.search_doc ->> '${TYPE_AHEAD_KEY}', ''))`;

// Every word of a type-ahead query as a prefix (`word:*`), ANDed. The words
// are letters and digits only, so they carry no tsquery syntax. Undefined when
// the query has no words.
// Words too common to narrow a type-ahead: dropped when other words remain,
// and a query made only of them matches nothing (13k of 36k cards in one realm hold
// "the"; counting and ranking them took ~220 ms for a list of eight).
export const TYPE_AHEAD_STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'are',
  'was',
  'not',
  'but',
  'you',
  'all',
  'can',
  'has',
  'have',
  'its',
  'our',
  'out',
  'into',
]);

// The tsquery for a type-ahead: every word must start some word of the card's
// short names. A word shorter than MIN_PREFIX_LETTERS is a prefix of a large
// share of the index (one letter matched 11k-24k of 36k cards in one realm at
// 200-450 ms), so it matches as a whole word unless a longer word is there to
// narrow the match first ("steve jo" keeps "jo" a prefix). Returns undefined
// when nothing is left to match.
export function typeAheadTsQuery(text: string): Expression | undefined {
  let words = typeAheadWords(text);
  let meaningful = words.filter((w) => !TYPE_AHEAD_STOP_WORDS.has(w));
  if (meaningful.length === 0) {
    return undefined;
  }
  let narrowed = meaningful.some((w) => [...w].length >= MIN_PREFIX_LETTERS);
  return [
    `to_tsquery('boxel_simple',`,
    param(
      meaningful
        .map((word) =>
          narrowed || [...word].length >= MIN_PREFIX_LETTERS
            ? `${word}:*`
            : word,
        )
        .join(' & '),
    ),
    `)`,
  ];
}

export const MIN_PREFIX_LETTERS = 3;

// A term's words, read in Unicode's composed form first: an accent written
// as a combining mark ("cre\u0300me") is part of its letter, so the word folds
// as "crème" does, the same as a `matches` term reads it.
export function typeAheadWords(text: string): string[] {
  return typeAheadWordsAsWritten(text.normalize('NFC'));
}

export function splitTypeAheadQuery(text: string) {
  return splitTypeAheadQueryAsWritten(text.normalize('NFC'));
}

// How many matching passages a search reports per card and field.
export const PASSAGES_PER_CARD = 5;

// The query a `matches` term runs against a card's rendered markdown. With
// `prefix`, the word still being typed matches the rendered page only as a
// whole word (and its typo corrections): a page carries its template's own
// words (headings such as "Connected concepts", labels), so a short prefix
// would match every card of a type, and a prefix scan over every rendered
// page in the realm is slow. The prefix itself matches the card's own field
// words (`search_tsv`), which `matchTsQuery` builds.
export function renderedTsQuery(term: MatchTerm): Expression {
  if (!term.prefix) {
    return matchTsQuery(term);
  }
  let { words, partial } = splitTypeAheadQuery(term.matches);
  // A negated partial ("dog -painterl") excludes by prefix, which only
  // narrows, so the page reads it as a prefix too.
  if (partial === undefined || /(^|\s)-$/.test(words)) {
    return matchTsQuery(term);
  }
  if (term.typoQuery === undefined) {
    return [`websearch_to_tsquery('boxel_english',`, param(term.matches), `)`];
  }
  let partialAlternatives = [partial, ...(term.typoPartial ?? '').split(' | ')]
    .map((w) => w.trim())
    .filter(Boolean)
    .join(' | ');
  let tsquery = [term.typoQuery, `(${partialAlternatives})`]
    .filter(Boolean)
    .join(' & ');
  return [`to_tsquery('boxel_english',`, param(tsquery), `)`];
}

// A `matches` term's words as websearch syntax reads them, for a typo
// query: plain words are required (ANDed), `or` between two clauses takes
// either, `-` before a word or a quoted phrase excludes it, and a quoted
// phrase keeps its words in order (`<->`). `positive` are the words that
// take corrections; `tsquery` builds the term with each positive word
// widened to its alternatives, every excluded word as written.
export function typoTermClauses(text: string): {
  positive: string[];
  // the excluded words and phrases, any of them (`a | (b <-> c)`), or ''
  excluded: string;
  tsquery: (alternativesOf: (word: string) => string[]) => string;
} {
  type Item = { words: string[]; negated: boolean; phrase: boolean };
  let clauses: Item[][] = [];
  let orNext = false;
  // a dash set off by a space excludes the word after it, as websearch
  // syntax reads it
  let negateNext = false;
  for (let m of text.matchAll(/(-?)"([^"]*)"?|(\S+)/g)) {
    let item: Item | undefined;
    if (m[2] !== undefined) {
      let words = typeAheadWords(m[2]);
      if (words.length) {
        item = { words, negated: m[1] === '-' || negateNext, phrase: true };
      }
      negateNext = false;
    } else {
      let token = m[3];
      if (token === '-') {
        negateNext = true;
        continue;
      }
      if (token.toLowerCase() === 'or' && clauses.length > 0) {
        orNext = true;
        continue;
      }
      let negated = (token.startsWith('-') && token.length > 1) || negateNext;
      negateNext = false;
      let words = typeAheadWords(
        token.startsWith('-') ? token.slice(1) : token,
      );
      if (words.length) {
        item = { words, negated, phrase: words.length > 1 };
      }
    }
    if (!item) continue;
    if (orNext) {
      clauses[clauses.length - 1].push(item);
      orNext = false;
    } else {
      clauses.push([item]);
    }
  }
  let positive = [
    ...new Set(
      clauses.flatMap((c) =>
        c.filter((i) => !i.negated).flatMap((i) => i.words),
      ),
    ),
  ];
  let excluded = clauses
    .flatMap((c) => c.filter((i) => i.negated))
    .map((i) =>
      i.words.length > 1 ? `(${i.words.join(' <-> ')})` : i.words[0],
    )
    .join(' | ');
  return {
    positive,
    excluded,
    tsquery(alternativesOf) {
      let render = (item: Item) => {
        let words = item.words.map((w) =>
          item.negated
            ? w
            : `(${[...new Set(alternativesOf(w))].join(' | ') || w})`,
        );
        let joined = words.length > 1 ? `(${words.join(' <-> ')})` : words[0];
        return item.negated ? `!${joined}` : joined;
      };
      return clauses
        .map((c) =>
          c.length > 1 ? `(${c.map(render).join(' | ')})` : render(c[0]),
        )
        .join(' & ');
    },
  };
}

// The trigram similarity from which a word list entry is nominated as a
// typo correction (pg_trgm's default is 0.3, which misses a swapped pair of
// letters in a short word).
export const TYPO_NOMINATION_SIMILARITY = 0.2;

// A word still being typed takes typo corrections only from this many
// letters (`resolveTypos`); shorter, it matches as a prefix alone.
export const MIN_TYPO_PARTIAL_LETTERS = 5;

export function matchTsQuery(term: MatchTerm): Expression {
  let typoPartial: Expression = term.typoPartial
    ? [`|| to_tsquery('boxel_english',`, param(term.typoPartial), `)`]
    : [];
  if (term.typoQuery !== undefined && !term.prefix) {
    // The words widened to their corrections (`resolveTypos`).
    return [`to_tsquery('boxel_english',`, param(term.typoQuery), `)`];
  }
  let { words, partial } = term.prefix
    ? splitTypeAheadQuery(term.matches)
    : { words: term.matches, partial: undefined };
  // A one- or two-letter prefix is a prefix of a large share of the index's
  // lexemes, so on its own it reads most of the index for a result that says
  // little; such a word matches whole until a third letter is typed. After a
  // finished word ("steve jo") the finished word narrows the match first, so
  // a short prefix is cheap there and stays a prefix.
  if (
    partial === undefined ||
    ([...partial].length < MIN_PREFIX_LETTERS && words.trim() === '')
  ) {
    if (term.typoQuery) {
      return [`to_tsquery('boxel_english',`, param(term.typoQuery), `)`];
    }
    return [`websearch_to_tsquery('boxel_english',`, param(term.matches), `)`];
  }
  let negated = /(^|\s)-$/.test(words);
  if (negated) {
    words = words.slice(0, -1);
  }
  let alternatives: Expression = [
    `to_tsquery('boxel_simple',`,
    param(`${partial}:*`),
    `) || to_tsquery('boxel_english',`,
    param(partial),
    `)`,
  ];
  let letters = [...partial];
  for (let drop = 1; drop <= 2 && letters.length - drop >= 3; drop++) {
    alternatives.push(
      `|| to_tsquery('boxel_simple',`,
      param(letters.slice(0, -drop).join('')),
      `)`,
    );
  }
  let partialQuery: Expression = [
    negated ? '!!(' : '(',
    ...alternatives,
    ...typoPartial,
    ')',
  ];
  if (words.trim() === '') {
    return partialQuery;
  }
  // `cafe or cre`: the word being typed is the other side of an `or`, so
  // it widens the word before it rather than narrowing the rest.
  let either = negated
    ? undefined
    : /^(.*?)(?:^|\s)([^\s"-][^\s"]*)\s+or\s*$/i.exec(words);
  if (either && !term.typoQuery) {
    let [, rest, last] = either;
    let union: Expression = [
      `(websearch_to_tsquery('boxel_english',`,
      param(last),
      `) ||`,
      ...partialQuery,
      `)`,
    ];
    return rest.trim() === ''
      ? union
      : [
          `(websearch_to_tsquery('boxel_english',`,
          param(rest),
          `) &&`,
          ...union,
          `)`,
        ];
  }
  return [
    term.typoQuery
      ? `(to_tsquery('boxel_english',`
      : `(websearch_to_tsquery('boxel_english',`,
    param(term.typoQuery || words),
    `) &&`,
    ...partialQuery,
    `)`,
  ];
}
