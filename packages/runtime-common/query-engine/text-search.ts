// Text search: `matches` (words, phrases, prefixes, fields and title scope),
// type-ahead, typo correction and its small-count floor, the candidate cap on a
// broad term, relevance scores, and rendered-page passages.
// Owns: the statements that read typo candidates and their floor, and
// the relevance expression a `_matchRelevance` sort reads.
// Must not: page or count (paging.ts), or blend signals (sort-order.ts).
// Guarantees: docs/search.md ("Text search (`matches`)", "Relevance",
// "Edge cases and what is guaranteed").

import { CARD_TITLE_KEY, TYPE_AHEAD_KEY } from '../search-doc-keys.ts';
import {
  type CardExpression,
  type Expression,
  type Querier,
  addExplicitParens,
  every,
  param,
  separatedByCommas,
} from '../expression.ts';
import { type CodeRef, baseCardRef } from '../index.ts';
import {
  DEFAULT_FILTER_CONTEXT,
  type FilterContext,
  MATCH_RELEVANCE_SORT_KEY,
  type QueryOptions,
  type ReadContext,
} from './types.ts';
import {
  type Filter,
  type MatchTerm,
  type MatchesFilter,
  type PassageMatch,
  type Query,
  type TypeAheadFilter,
  matchesHoldsNoWord,
} from '../query-v2/query.ts';
import { FilterCompiler } from './filter-compiler.ts';
import {
  MIN_PREFIX_LETTERS,
  MIN_TYPO_PARTIAL_LETTERS,
  PASSAGES_PER_CARD,
  STATS_MIN_COUNT,
  STATS_MIN_ROWS,
  TYPE_AHEAD_STOP_WORDS,
  TYPE_AHEAD_TSVECTOR,
  TYPO_NOMINATION_SIMILARITY,
  matchTsQuery,
  renderedTsQuery,
  splitTypeAheadQuery,
  typeAheadTsQuery,
  typeAheadWords,
  typoTermClauses,
} from './text-search-sql.ts';
import {
  PAGE_ONLY_RELEVANCE,
  markdownVector,
  prerenderedTableFromOpts,
  rankVector,
  realmBound,
  searchTextVector,
  tableFromOpts,
} from './index-sql.ts';
import { arrayElement } from '../sql-literal.ts';
import { escapeLikePattern, filterAnchor } from './filter-sql.ts';
import { realmIs, typoRealmIs } from '../realm-union.ts';
import { matchCandidateCap } from '../search-bounds.ts';
import { storeKept } from './store-narrow.ts';
import { typoCorrections } from '../search-intent.ts';

export abstract class TextSearch extends FilterCompiler {
  // Widens each `typos` term's words to the closest words of the realm's
  // word list (fields declared `typos: true`), as tsquery text the term then
  // matches with (`typoQuery`). A word of three letters or fewer, or one the
  // list already holds, stays as typed. Postgres only.
  // Bounds each broad `matches` term (docs/search.md, "Bounds every query
  // runs under"). Every positive full-text term of a paged search is probed:
  // how many of the realm's cards hold its words in their fields, counting
  // no further than the cap. A term within the cap runs as written, so its
  // rows and total are exact. One past it is marked `candidateCap` and then
  // takes the cap's worth of its field matches, its best by rank vector and
  // then url (see `matchesCondition`); every card whose rendered page holds
  // it is still a candidate, so the term never drops a card it finds on a
  // page, and a candidate set is the same on every run. The search reports
  // its total as a lower bound (`capped`). A term under a `not` is never
  // capped, since bounding what it excludes would admit what it should not.
  // An exact total (`page.total: 'exact'`, or `page.exactTotal`) turns the
  // cap off; the time budget still bounds the search.
  protected async capBroadMatches(
    filter: Filter | undefined,
    realmURL: URL,
    page: Query['page'],
    opts: QueryOptions,
    _entryType: 'instance' | 'file' | 'all' = 'instance',
  ): Promise<{ filter: Filter | undefined; capped: boolean }> {
    if (
      !filter ||
      !page ||
      page.exactTotal ||
      page.total === 'exact' ||
      !this.dialect.candidateCaps ||
      opts.pendingStagingId !== undefined
    ) {
      return { filter, capped: false };
    }
    let cap = matchCandidateCap();
    let capped = false;
    let context: FilterContext = {
      inAny: false,
      prerenderedTable: prerenderedTableFromOpts(opts),
      now: opts.queryNow,
      indexTable: tableFromOpts(opts),
      realmURL,
    };
    // For a caller a policy scopes, a term is broad only by the cards its
    // grants open: whether a search was cut must never tell the caller what
    // cards they cannot read hold (ADR 006).
    let granted: CardExpression | undefined = opts.grantFilter
      ? this.filterCondition(opts.grantFilter, baseCardRef, 'positive', context)
      : undefined;
    let broadUnderGrants = async (node: MatchesFilter): Promise<boolean> => {
      let side = (select: CardExpression) => [
        `(SELECT COUNT(*) FROM (SELECT 1 FROM ${context.indexTable} AS i WHERE`,
        ...realmIs('i.realm_url', realmURL),
        'AND (i.is_deleted = FALSE OR i.is_deleted IS NULL) AND (i.url, i.realm_url, i.type) IN (',
        ...select,
        ') AND',
        ...granted!,
        `LIMIT ${cap + 1}) AS g)`,
      ];
      let [row] = (await this.queryCards(
        [
          'SELECT',
          ...side([
            `SELECT tsi.url, tsi.realm_url, tsi.type FROM ${context.indexTable} AS tsi WHERE ${searchTextVector('tsi', false)} @@`,
            ...matchTsQuery(node),
            ...realmBound('tsi', context),
          ]),
          'AS field_count',
        ],
        undefined,
        opts,
      )) as { field_count: number | string }[];
      return Number(row.field_count) > cap;
    };
    let broad = async (node: MatchesFilter): Promise<boolean> => {
      if (granted) return await broadUnderGrants(node);
      let [row] = (await this.query(
        [
          `SELECT (SELECT COUNT(*) FROM (SELECT 1 FROM ${context.indexTable} AS tsi WHERE ${searchTextVector('tsi', false)} @@`,
          ...matchTsQuery(node),
          ...realmBound('tsi', context),
          `LIMIT ${cap + 1}) AS b) AS field_count`,
        ] as Expression,
        opts,
      )) as { field_count: number | string }[];
      return Number(row.field_count) > cap;
    };
    // `on` is the type the node's rows must be: its own anchor, or one an
    // `every` it sits in names.
    let walk = async (node: any, on?: CodeRef): Promise<any> => {
      if (!node || typeof node !== 'object') {
        return node;
      }
      let here = (node.on ?? node.type ?? on) as CodeRef | undefined;
      if (Array.isArray(node.every)) {
        let anchor = filterAnchor(node) ?? here;
        return {
          ...node,
          every: await Promise.all(node.every.map((n: any) => walk(n, anchor))),
        };
      }
      if (Array.isArray(node.any)) {
        return {
          ...node,
          any: await Promise.all(node.any.map((n: any) => walk(n, here))),
        };
      }
      if (
        typeof node.matches === 'string' &&
        !matchesHoldsNoWord(node.matches) &&
        !node.within &&
        !node.fields?.length &&
        node.scope !== 'title' &&
        (await broad(node))
      ) {
        capped = true;
        return { ...node, candidateCap: cap };
      }
      return node;
    };
    let out = await walk(filter);
    return { filter: capped ? out : filter, capped };
  }

  protected async resolveTypos(
    filter: Filter | undefined,
    realmURL: URL,
    anonymize = false,
  ): Promise<Filter | undefined> {
    if (!filter || !this.dialect.typoCorrection) {
      return filter;
    }
    let node = filter as any;
    if ('matches' in node) {
      if (!node.typos || node.matches.trim() === '') {
        return filter;
      }
      // With `prefix`, the last word is still being typed: it matches as a
      // prefix exactly as without `typos` (see `matchTsQuery`), and takes
      // corrections only once it is long enough to stand for a whole word.
      // A short partial would otherwise be "corrected" to a host of short
      // words and match nearly everything.
      let { words: finishedText, partial } = node.prefix
        ? splitTypeAheadQuery(node.matches)
        : { words: node.matches, partial: undefined };
      // Only the words the term asks for take corrections: an excluded word
      // excludes as written.
      let finished = typoTermClauses(finishedText).positive;
      let partialWords =
        partial && [...partial].length >= MIN_TYPO_PARTIAL_LETTERS
          ? [partial]
          : [];
      if (finished.length === 0 && partialWords.length === 0) {
        return filter;
      }
      let corrections = await this.#typoCorrectionsFor(
        [...finished, ...partialWords],
        realmURL,
        anonymize,
      );
      let alternativesOf = (word: string) =>
        [...new Set([word, ...(corrections.get(word) ?? [])])]
          .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
          .filter(Boolean);
      // The term's own syntax holds: `-word` excludes, `or` takes either
      // side, and a quoted phrase keeps its words in order.
      let typoQuery = typoTermClauses(finishedText).tsquery(alternativesOf);
      let typoPartial =
        partialWords.length > 0
          ? (corrections.get(partialWords[0]) ?? [])
              .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
              .filter(Boolean)
              .join(' | ')
          : '';
      return {
        ...node,
        typoQuery,
        ...(typoPartial ? { typoPartial } : {}),
      } as Filter;
    }
    if ('typeahead' in node) {
      if (!node.typos) {
        return filter;
      }
      let words = typeAheadWords(node.typeahead).filter(
        (w) => !TYPE_AHEAD_STOP_WORDS.has(w),
      );
      if (words.length === 0) {
        return filter;
      }
      // Every type-ahead word matches as a prefix, so any of them may still
      // be being typed: only words long enough to stand for a whole word take
      // corrections.
      let corrections = await this.#typoCorrectionsFor(
        words.filter((w) => [...w].length >= MIN_TYPO_PARTIAL_LETTERS),
        realmURL,
        anonymize,
      );
      // As `typeAheadTsQuery`: a word of three letters or more matches as a
      // prefix (so does a shorter one once another word narrows). Each word
      // also matches its corrections whole, so a fully typed misspelling
      // ("conurency") finds the word it meant.
      let narrowed = words.some((w) => [...w].length >= MIN_PREFIX_LETTERS);
      let typoQuery = words
        .map((word) => {
          let clean = word.replace(/[^\p{L}\p{N}]/gu, '');
          let alternatives = [
            narrowed || [...clean].length >= MIN_PREFIX_LETTERS
              ? `${clean}:*`
              : clean,
            ...(corrections.get(word) ?? [])
              .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
              .filter(Boolean),
          ];
          return `(${[...new Set(alternatives)].join(' | ')})`;
        })
        .join(' & ');
      return { ...node, typoQuery } as Filter;
    }
    if ('every' in node || 'any' in node) {
      let key = 'every' in node ? 'every' : 'any';
      return {
        ...node,
        [key]: await Promise.all(
          (node[key] as Filter[]).map((child) =>
            this.resolveTypos(child, realmURL, anonymize),
          ),
        ),
      } as Filter;
    }
    if ('not' in node) {
      return {
        ...node,
        not: await this.resolveTypos(node.not, realmURL, anonymize),
      } as Filter;
    }
    return filter;
  }

  // Each word's corrections from the realm's word list: candidates by
  // trigram similarity (the list's GIN index), for words the list doesn't
  // already hold, kept when within the word's edit budget
  // (`typoCorrections`).
  async #typoCorrectionsFor(
    words: string[],
    realmURL: URL,
    anonymize = false,
  ): Promise<Map<string, string[]>> {
    // Candidates are nominated by trigram similarity through the word list's
    // index, at a threshold low enough that a swap of two letters in a short
    // word ("clsoed", 0.27 to "closed") is nominated; the edit budget then
    // decides (`typoCorrections`, which counts a swap as one edit).
    let offered: Set<string> | undefined;
    let rows = (await this.dbAdapter.withTransaction(async (q) => {
      await q([
        `SELECT set_config('pg_trgm.similarity_threshold', '${TYPO_NOMINATION_SIMILARITY}', true)`,
      ]);
      let nominated = (await q([
        `SELECT q.w AS word, c.word AS correction FROM unnest(ARRAY(SELECT jsonb_array_elements_text(`,
        param(JSON.stringify(words)),
        `::jsonb))) AS q(w) CROSS JOIN LATERAL (SELECT DISTINCT bw.word, similarity(bw.word, q.w) AS sim FROM boxel_index_words AS bw WHERE`,
        ...typoRealmIs('bw.realm_url', realmURL),
        `AND char_length(q.w) > 3 AND bw.word % q.w AND bw.word <> q.w AND NOT EXISTS (SELECT 1 FROM boxel_index_words AS known WHERE`,
        ...typoRealmIs('known.realm_url', realmURL),
        `AND known.word = q.w)`,
        `ORDER BY sim DESC, bw.word LIMIT 10) AS c`,
      ])) as { word: string; correction: string }[];
      // A union's word list is its realms' lists together, and its floor
      // counts their rows together, as one realm holding every card would.
      if (anonymize) {
        offered = await this.#aboveTypoFloor(
          q,
          [...new Set(nominated.map((r) => r.correction))],
          realmURL,
        );
      }
      return nominated;
    })) as { word: string; correction: string }[];
    let candidates = new Map<string, string[]>();
    for (let { word, correction } of rows) {
      if (offered && !offered.has(correction)) continue;
      candidates.set(word, [...(candidates.get(word) ?? []), correction]);
    }
    return new Map(
      [...candidates].map(([word, list]) => [
        word,
        typoCorrections(word, list),
      ]),
    );
  }

  // The small-count floor on the corrections a caller the policy scopes is
  // offered: none in a realm (or union of the realms the caller reads
  // outright) of fewer than STATS_MIN_ROWS ranked rows, and only corrections
  // at least STATS_MIN_COUNT rows hold, so a suggestion never points at a
  // word only a few cards (perhaps cards the caller cannot read) contain.
  // Counted at query time through the full-text index, for the candidates
  // only, each count stopping at its floor. Returns the corrections that
  // pass. A handful of index probes: JIT is off for them (compiling would
  // cost more than the probes), and the per-word count reads the full-text
  // index alone and checks the realm on each row it finds, so it never
  // builds the realm's whole bitmap for every candidate.
  async #aboveTypoFloor(
    q: Querier,
    corrections: string[],
    realmURL: URL,
  ): Promise<Set<string>> {
    if (corrections.length === 0) {
      return new Set();
    }
    await q([`SELECT set_config('jit', 'off', true)`]);
    let rows = (await q([
      'SELECT c.w AS word FROM jsonb_array_elements_text(',
      param(JSON.stringify(corrections)),
      `::jsonb) AS c(w) WHERE (SELECT COUNT(*) FROM (SELECT 1 FROM boxel_index AS i WHERE`,
      ...typoRealmIs('i.realm_url', realmURL),
      // in the realm index's order, which reads only the realm's own rows
      `AND i.rank_tsv IS NOT NULL AND i.is_deleted IS NOT TRUE ORDER BY i.url COLLATE "POSIX" LIMIT ${STATS_MIN_ROWS}) AS r) >= ${STATS_MIN_ROWS}`,
      `AND (SELECT COUNT(*) FROM (SELECT 1 FROM boxel_index AS i WHERE`,
      `i.search_tsv @@ plainto_tsquery('boxel_english', c.w) AND`,
      // not the realm's index: see above
      ...typoRealmIs(`(i.realm_url || '')`, realmURL),
      `AND i.is_deleted IS NOT TRUE LIMIT ${STATS_MIN_COUNT}) AS h) >= ${STATS_MIN_COUNT}`,
    ])) as { word: string }[];
    return new Set(rows.map((r) => r.word));
  }

  // The relevance value for a `matches` query, aggregated per (url, type) group.
  //
  // Postgres scores the row's markdown tsvector against the OR-union of the
  // positive match terms with `ts_rank_cd` — cover-density (proximity/position
  // aware), normalized to a bounded 0–1 range via flag 32 so it reads as a clean
  // gauge. The tsvector is recomputed here (the markdown GIN index is a lossy
  // expression index and can't hand a rankable vector back), through the SAME
  // `markdown_search_text` wrapper as the match predicate and its index, so the
  // ranked text is exactly the filtered text.
  //
  // SQLite has no full-text ranking, so it falls back to boolean 1/0 (did the
  // LIKE predicate match at all) — enough for a deterministic sort in host
  // in-browser tests; meaningful ranking is Postgres-only.
  //
  // `MAX(...)` lets the value survive `GROUP BY i.url, i.type` (and any
  // table-valued fan-out, where every fanned row shares the same markdown).
  protected matchRelevanceExpression(
    matches: MatchTerm[],
    staged: boolean,
  ): CardExpression {
    return [
      ...this.matchRelevanceScore(matches, staged),
      `AS "${MATCH_RELEVANCE_SORT_KEY}"`,
    ];
  }

  // The aggregated relevance value alone (no alias), shared by the
  // `_matchRelevance` column and a `_blend` signal.
  protected matchRelevanceScore(
    allMatches: MatchTerm[],
    staged: boolean,
  ): CardExpression {
    // Terms scoped to a passage list score the card's best passage;
    // type-ahead terms score by title tier (see `#typeAheadRelevance`); the
    // others score the card's rank vector. A card's relevance is the best.
    let passageTerms = allMatches.filter((m) => m.within);
    let typeAheadTerms = allMatches.filter((m) => m.typeahead);
    let matches = allMatches.filter((m) => !m.within && !m.typeahead);
    let parts: CardExpression[] = [];
    if (passageTerms.length > 0) {
      parts.push(['MAX(', ...this.#passageRelevance(passageTerms), ')']);
    }
    if (typeAheadTerms.length > 0) {
      parts.push([
        'MAX(',
        ...this.#typeAheadRelevance(typeAheadTerms, staged),
        ')',
      ]);
    }
    if (matches.length === 0 || parts.length > 0) {
      if (matches.length > 0) {
        parts.push(this.matchRelevanceScore(matches, staged));
      }
      if (parts.length === 0) {
        return ['0'];
      }
      if (parts.length === 1) {
        return parts[0];
      }
      let out: CardExpression = ['GREATEST('];
      parts.forEach((part, i) => {
        if (i > 0) {
          out.push(',');
        }
        out.push(...part);
      });
      out.push(')');
      return out;
    }
    let pgTsQuery: Expression = [];
    matches.forEach((m, i) => {
      if (i > 0) {
        pgTsQuery.push('||');
      }
      pgTsQuery.push(...matchTsQuery(m));
    });
    return [
      'MAX(',
      ...this.dialect.matchRelevance(
        // A card ranks by its small, inline rank vector (titles, names and
        // aliases; summaries, keywords, labels and type names; the start of
        // plain and body text), so ranking any number of matches reads no
        // out-of-line value, however large the cards are. A card without
        // one yet (indexed before it existed) ranks lowest. Matching reads
        // the full vectors; ranking never reads the rendered page.
        matches.some((m) => m.optional)
          ? // The words are optional (under an `any`), so a row whose
            // fields score nothing may not have matched them at all: it
            // scores a floor only where its rendered page holds them, and
            // that page is read only for such rows.
            [
              `COALESCE(NULLIF(ts_rank_cd(COALESCE(${rankVector('i', staged)}, ''::tsvector), `,
              ...pgTsQuery,
              `, 32), 0), CASE WHEN COALESCE(${markdownVector('ph', staged)}, ''::tsvector) @@ (`,
              ...pgTsQuery,
              `) THEN ${PAGE_ONLY_RELEVANCE} ELSE 0 END)`,
            ]
          : // Every row matched the words, so one whose fields score
            // nothing matched them on its rendered page: it ranks below
            // every field match, without reading the page.
            [
              `GREATEST(ts_rank_cd(COALESCE(${rankVector('i', staged)}, ''::tsvector), `,
              ...pgTsQuery,
              `, 32), ${PAGE_ONLY_RELEVANCE})`,
            ],
        matches.map((m) => ({ text: 'ph.markdown', needle: m.matches })),
      ),
      `)`,
    ];
  }

  // A type-ahead term's relevance for one row: a tier from the row's inline
  // title (4 when the title is what was typed; 3 when it starts with the
  // typed words as whole words, its last word perhaps in the plural, so
  // "lamp" finds "Lamps, Bases & Shades" here; 2 when it only starts with the
  // typed text, as "Lamport on writing" does; 1 when every typed word
  // prefixes a title word; 0 when the row matched through its alternative
  // names or type words), plus its rank vector's score for the typed words as
  // a fraction below 1. The tiers outrank any text score, so title hits lead
  // and content can't push them down.
  #typeAheadRelevance(terms: MatchTerm[], staged: boolean): CardExpression {
    let title = staged
      ? `lower(i.search_doc ->> '${CARD_TITLE_KEY}')`
      : 'i.search_title';
    let scores: CardExpression[] = [];
    for (let term of terms) {
      let typed = typeAheadWords(term.matches).join(' ');
      if (!typed) {
        continue;
      }
      let tsquery: Expression | undefined = term.typoQuery
        ? [`to_tsquery('boxel_simple',`, param(term.typoQuery), `)`]
        : typeAheadTsQuery(term.matches);
      // The typed words as whole words at the title's start: the last one as
      // typed or as its singular, then optionally a plural ending, then the
      // end of the word. The words are letters and digits only.
      let singular =
        /s$/.test(typed) && [...typed].length > 3 ? typed.slice(0, -1) : typed;
      let wholeWords = `^(${typed}|${singular})(e?s)?([^[:alnum:]]|$)`;
      scores.push(
        this.dialect.typeAheadTier(
          [
            `(CASE WHEN ${title} =`,
            param(typed),
            `THEN 4 WHEN ${title} ~`,
            param(wholeWords),
            `THEN 3 WHEN ${title} LIKE`,
            param(`${escapeLikePattern(typed)}%`),
            `THEN 2`,
            ...(tsquery
              ? [
                  `WHEN to_tsvector('boxel_simple', coalesce(${title}, '')) @@`,
                  ...tsquery,
                  `THEN 1`,
                ]
              : []),
            `ELSE 0 END`,
            ...(tsquery
              ? [
                  `+ ts_rank_cd(COALESCE(${rankVector('i', staged)}, ''::tsvector),`,
                  ...tsquery,
                  `, 32)`,
                ]
              : []),
            `)`,
          ],
          typed,
        ),
      );
    }
    if (scores.length === 0) {
      return ['0'];
    }
    if (scores.length === 1) {
      return scores[0];
    }
    let out: CardExpression = ['GREATEST('];
    scores.forEach((score, i) => {
      if (i > 0) {
        out.push(',');
      }
      out.push(...score);
    });
    out.push(')');
    return out;
  }

  // A `matches … within <field>` predicate: the card has a passage in that field
  // whose text matches. Postgres asks the passages table's GIN index once
  // (an uncorrelated IN, hashed per row); SQLite looks for the words in the
  // field's search-doc JSON. The subquery reads only the realm searched: the
  // IN compares the realm too, so another realm's passages could never
  // match, but without the bound a common word read every realm's.
  #passageMatchCondition(
    filter: MatchesFilter,
    field: string,
    context: FilterContext,
  ): CardExpression {
    return this.dialect.textMatch(
      [
        `(i.url, i.realm_url, i.type) IN (SELECT pp.url, pp.realm_url, pp.type FROM boxel_index_passages AS pp WHERE pp.field_path =`,
        param(field),
        `AND pp.tsv @@`,
        ...matchTsQuery(filter),
        ...realmBound('pp', context),
        `)`,
      ],
      ['i.search_doc ->>', param(`$.${field}`)],
      filter.matches,
    );
  }

  // A card's best passage score for passage-scoped terms (per row, before
  // aggregation), 0 when none matches. SQLite has no ranking: 1 or 0.
  #passageRelevance(terms: MatchTerm[]): CardExpression {
    let pg: Expression = ['GREATEST(0'];
    terms.forEach((term) => {
      pg.push(
        `, (SELECT MAX(ts_rank_cd(pr.tsv,`,
        ...matchTsQuery(term),
        `, 32)) FROM boxel_index_passages AS pr WHERE pr.realm_url = i.realm_url AND pr.url = i.url AND pr.type = i.type AND pr.field_path =`,
        param(term.within!),
        `AND pr.tsv @@`,
        ...matchTsQuery(term),
        `)`,
      );
    });
    pg.push(')');
    return this.dialect.matchRelevance(
      pg,
      terms.map((term) => ({
        text: ['i.search_doc ->>', param(`$.${term.within!}`)],
        needle: term.matches,
      })),
    );
  }

  // The passages that matched a search's passage-scoped terms, for the cards
  // on the returned page: up to `PASSAGES_PER_CARD` per card and field, best
  // first, keyed by card URL. Postgres only.
  protected async pagePassages(
    realmURL: URL,
    terms: MatchTerm[],
    urls: string[],
    ctx?: ReadContext,
  ): Promise<Record<string, PassageMatch[]> | undefined> {
    if (!this.dialect.passages || terms.length === 0 || urls.length === 0) {
      return undefined;
    }
    let byField = new Map<string, MatchTerm[]>();
    for (let term of terms) {
      byField.set(term.within!, [...(byField.get(term.within!) ?? []), term]);
    }
    let found: Record<string, PassageMatch[]> = {};
    for (let [field, fieldTerms] of byField) {
      let tsQuery: Expression = [];
      fieldTerms.forEach((term, index) => {
        if (index > 0) {
          tsQuery.push('||');
        }
        tsQuery.push(...matchTsQuery(term));
      });
      let rows = (await this.query(
        [
          `SELECT url, ordinal, start_at, end_at, score, ts_headline('boxel_english', body, (`,
          ...tsQuery,
          `), 'StartSel="",StopSel="",MaxWords=24,MinWords=10,ShortWord=2,MaxFragments=1') AS snippet FROM (SELECT pp.url, pp.ordinal, pp.start_at, pp.end_at, pp.body, ts_rank_cd(pp.tsv, (`,
          ...tsQuery,
          `), 32) AS score, ROW_NUMBER() OVER (PARTITION BY pp.url ORDER BY ts_rank_cd(pp.tsv, (`,
          ...tsQuery,
          `), 32) DESC, pp.ordinal) AS rank FROM boxel_index_passages AS pp WHERE`,
          ...realmIs('pp.realm_url', realmURL),
          `AND pp.field_path =`,
          param(field),
          `AND pp.url IN`,
          ...addExplicitParens(
            separatedByCommas(urls.map((url) => [param(url)])),
          ),
          `AND pp.tsv @@ (`,
          ...tsQuery,
          `)) AS ranked WHERE rank <=`,
          param(PASSAGES_PER_CARD),
          `ORDER BY url, score DESC, ordinal`,
        ] as Expression,
        ctx,
      )) as {
        url: string;
        ordinal: number;
        start_at: number | null;
        end_at: number | null;
        score: number;
        snippet: string | null;
      }[];
      for (let row of rows) {
        let key = row.url.replace(/\.json$/, '');
        (found[key] ??= []).push({
          field,
          ordinal: Number(row.ordinal),
          start: row.start_at == null ? null : Number(row.start_at),
          end: row.end_at == null ? null : Number(row.end_at),
          score: Number(row.score),
          ...(row.snippet ? { snippet: row.snippet } : {}),
        });
      }
    }
    return found;
  }

  // Type-ahead: every typed word is a word prefix of the card's `_typeahead`
  // text. Postgres matches an unstemmed, accent-folding (`boxel_simple`)
  // tsvector of that text, which the `one-text-search-config` migration
  // indexes, so "creme" finds "Crème"; like a prefix
  // `matches`, it asks the index once through an uncorrelated IN, because the
  // planner can't estimate a prefix query and beside a type anchor would
  // otherwise test every typed row. SQLite requires each word as a substring.
  protected typeAheadCondition(
    filter: TypeAheadFilter,
    typeConditionRef: CodeRef | undefined,
    context: FilterContext,
  ): CardExpression {
    let words = typeAheadWords(filter.typeahead).filter(
      (w) => !TYPE_AHEAD_STOP_WORDS.has(w),
    );
    let query = filter.typoQuery
      ? [`to_tsquery('boxel_simple',`, param(filter.typoQuery), `)`]
      : typeAheadTsQuery(filter.typeahead);
    let predicate: CardExpression = !query
      ? ['FALSE']
      : this.dialect.everyWordMatch(
          [
            `(i.url, i.realm_url, i.type) IN (SELECT ti.url, ti.realm_url, ti.type FROM ${context.indexTable} AS ti WHERE ${TYPE_AHEAD_TSVECTOR('ti')} @@`,
            ...query,
            ...realmBound('ti', context),
            `)`,
          ],
          `i.search_doc ->> '${TYPE_AHEAD_KEY}'`,
          words,
        );
    return every([
      ...(typeConditionRef ? [this.typeCondition(typeConditionRef)] : []),
      predicate,
    ]);
  }

  // Full-text matches predicate. Postgres uses tsvector/tsquery on the
  // indexed markdown column; SQLite falls back to a case-insensitive
  // substring LIKE with `%`/`_`/`\` escaped in JS before binding. An
  // empty/whitespace-only query short-circuits to FALSE so SQLite doesn't
  // match every non-null row (PG's websearch_to_tsquery already yields an
  // empty tsquery that matches nothing — we match that behavior here).
  //
  // Markdown is a render output and lives on `prerendered_html.markdown`, so
  // full-text membership is eventually consistent: a row whose prerender-html
  // job hasn't landed yet has no markdown and is not full-text findable until
  // it does. The predicate is an expression match against the GIN-indexed
  // `to_tsvector('boxel_english', markdown_search_text(markdown))` —
  // `markdown_search_text` strips oversized base64 runs and caps length so
  // the tsvector stays under Postgres's byte limit, and the predicate must
  // call the same function as the migration's index expression or the
  // planner won't use the index.
  protected matchesCondition(
    filter: MatchesFilter,
    _on: CodeRef,
    typeConditionRef?: CodeRef,
    context: FilterContext = DEFAULT_FILTER_CONTEXT,
  ): CardExpression {
    let typeRef = typeConditionRef;
    // A term of nothing but stop words and single letters matches nothing,
    // without a scan (`matchesHoldsNoWord`).
    if (matchesHoldsNoWord(filter.matches)) {
      return every([
        ...(typeRef ? [this.typeCondition(typeRef)] : []),
        ['FALSE'],
      ]);
    }
    if (filter.within && filter.matches.trim() !== '') {
      return every([
        ...(typeRef ? [this.typeCondition(typeRef)] : []),
        this.#passageMatchCondition(filter, filter.within, context),
      ]);
    }
    if (filter.scope === 'title' && filter.matches.trim() !== '') {
      return every([
        ...(typeRef ? [this.typeCondition(typeRef)] : []),
        this.#titleScopedMatchCondition(filter, context),
      ]);
    }
    if (filter.fields?.length && filter.matches.trim() !== '') {
      return every([
        ...(typeRef ? [this.typeCondition(typeRef)] : []),
        this.#fieldScopedMatchCondition(filter, filter.fields),
      ]);
    }
    let predicate: CardExpression =
      filter.matches.trim() === ''
        ? ['FALSE']
        : this.dialect.textMatch(
            // Always an uncorrelated IN, which becomes a hashed SubPlan: the
            // markdown GIN index answers the term once, and each row is a
            // hash probe. Inline beside a type anchor, Postgres estimates a
            // term's matches from statistics, and for some words (a prefix,
            // or a plain word like "compiler") it guesses high and recomputes
            // the tsvector of every typed row: ~2 s over 6k talk transcripts
            // where the index answers in ~10 ms. Under an `any` the LEFT JOIN
            // to prerendered_html can't be reduced, so the inline form
            // recomputes every row there too. Keyed on the join's own primary
            // key, it selects exactly the rows the inline form would, and the
            // subquery never yields NULL, so it negates cleanly under `not`.
            //
            // `OFFSET 0` fences the subquery so Postgres keeps it a hashed
            // SubPlan. Without it the planner flattens the IN into a join
            // and picks the driving side from its estimate of the term; for
            // a term it guesses is common ("compiler") it drives from every
            // typed row and recomputes that row's tsvector as a filter on a
            // primary-key probe (6,449 talks × 0.8 ms = 1.7 s, once for the
            // page and again for the count). A phrase is the exception: the
            // index holds no word positions, so a fenced phrase rechecks
            // every row holding all its words across the table (60 s for
            // "type system"), while the unfenced plan rechecks only the
            // typed rows.
            //
            // A card matches by its rendered markdown or by its fields'
            // role-weighted vector (`search_tsv`), which holds the words of
            // fields the card doesn't render, such as a transcript's
            // segments. Each side is its own GIN-indexed lookup, so the
            // union stays an index answer.
            //
            // Each side reads only the realm searched: the IN compares the
            // realm too, so rows of other realms could never match, but
            // without the bound a common word read every realm's vectors
            // (28 s for "card" over 265k renderings, once per realm).
            //
            // A term broader than the candidate cap (`candidateCap`, see
            // `capBroadMatches`) takes the fields' best matches by rank
            // vector (what a relevance sort ranks them by), at most the cap
            // of them, and every card whose rendered page holds it. The
            // rendered side is not cut: it had no order that keeps its best
            // cards, so a LIMIT took whichever rows a scan met first, which
            // a concurrent scan of the table (synchronized scans) or a
            // different plan changed, and with them the page.
            //
            // A term the engine marked with the filter's other conjuncts the
            // value store decides (`storeKeep`, store-narrow.ts) keeps, on
            // each side, only the candidates the store does not prove the
            // filter refuses, so the rows of the rest are never read. The
            // field side keeps them after its cap, so the cap takes the same
            // field matches either way.
            filter.candidateCap
              ? [
                  `(i.url, i.realm_url, i.type) IN ((SELECT phm.url, phm.realm_url, phm.type FROM ${context.prerenderedTable} AS phm WHERE ${markdownVector('phm', context.prerenderedTable !== 'prerendered_html')} @@`,
                  ...renderedTsQuery(filter),
                  ...realmBound('phm', context),
                  ...storeKept(filter, 'phm'),
                  `) UNION (${filter.storeKeep ? 'SELECT tc.url, tc.realm_url, tc.type FROM (' : ''}SELECT tsi.url, tsi.realm_url, tsi.type FROM ${context.indexTable} AS tsi WHERE ${searchTextVector('tsi', context.indexTable !== DEFAULT_FILTER_CONTEXT.indexTable)} @@`,
                  ...matchTsQuery(filter),
                  ...realmBound('tsi', context),
                  `ORDER BY ts_rank_cd(COALESCE(${rankVector('tsi', context.indexTable !== DEFAULT_FILTER_CONTEXT.indexTable)}, ''::tsvector),`,
                  ...matchTsQuery(filter),
                  `, 32) DESC, tsi.url LIMIT ${Number(filter.candidateCap)}`,
                  ...(filter.storeKeep
                    ? [') AS tc WHERE TRUE', ...storeKept(filter, 'tc')]
                    : []),
                  '))',
                ]
              : [
                  `(i.url, i.realm_url, i.type) IN (SELECT phm.url, phm.realm_url, phm.type FROM ${context.prerenderedTable} AS phm WHERE ${markdownVector('phm', context.prerenderedTable !== 'prerendered_html')} @@`,
                  ...renderedTsQuery(filter),
                  ...realmBound('phm', context),
                  ...storeKept(filter, 'phm'),
                  `UNION SELECT tsi.url, tsi.realm_url, tsi.type FROM ${context.indexTable} AS tsi WHERE ${searchTextVector('tsi', context.indexTable !== DEFAULT_FILTER_CONTEXT.indexTable)} @@`,
                  ...matchTsQuery(filter),
                  ...realmBound('tsi', context),
                  ...storeKept(filter, 'tsi'),
                  filter.matches.includes('"') ? `)` : `OFFSET 0)`,
                ],
            'ph.markdown',
            filter.matches,
          );
    // An excluded word (`lamp -vintage`) excludes a card that holds it
    // anywhere it can match: its rendered page or its fields' words. Each
    // side alone would let a card through on the side that lacks the word.
    let { excluded } =
      this.dialect.tsqueryNegation && filter.matches.includes('-')
        ? typoTermClauses(
            filter.prefix
              ? splitTypeAheadQuery(filter.matches).words
              : filter.matches,
          )
        : { excluded: '' };
    let exclusion: CardExpression[] = excluded
      ? [
          [
            `(i.url, i.realm_url, i.type) NOT IN (SELECT phx.url, phx.realm_url, phx.type FROM ${context.prerenderedTable} AS phx WHERE ${markdownVector('phx', context.prerenderedTable !== 'prerendered_html')} @@ to_tsquery('boxel_english',`,
            param(excluded),
            ')',
            ...realmBound('phx', context),
            `UNION SELECT tsx.url, tsx.realm_url, tsx.type FROM ${context.indexTable} AS tsx WHERE ${searchTextVector('tsx', context.indexTable !== DEFAULT_FILTER_CONTEXT.indexTable)} @@ to_tsquery('boxel_english',`,
            param(excluded),
            ')',
            ...realmBound('tsx', context),
            ')',
          ],
        ]
      : [];
    return every([
      ...(typeRef ? [this.typeCondition(typeRef)] : []),
      predicate,
      ...exclusion,
    ]);
  }

  // A `matches … fields` term: the words of those search-doc values alone,
  // stemmed and case-insensitive as everywhere else. The values are read
  // whole and a list's values all count. Nothing indexes this text, so it is
  // computed for each row the rest of the filter admits. SQLite matches a case-insensitive substring.
  #fieldScopedMatchCondition(
    filter: MatchesFilter,
    fields: string[],
  ): CardExpression {
    // A slash is no part of a word ("Grey/Copper" is two), though the text
    // parser reads a run joined by slashes as one path token: it is a space
    // here, on the values and on the term alike. So are `<` and `>`: the
    // parser reads them as the edges of a markup tag, and one that never
    // closes swallows every word after it, in this value and in the fields
    // joined after it (a label `</script>` hid the note that followed).
    let pgText: Expression = [
      "to_tsvector('boxel_english', translate(concat_ws(' '",
    ];
    // Each field once, its text bounded as the indexed vectors bound theirs,
    // so a long value cannot push the vector past what Postgres can hold.
    for (let path of [...new Set(fields)]) {
      pgText.push(
        ', left(i.search_doc #>>',
        param(`{${path.split('.').map(arrayElement).join(',')}}`),
        '::text[], 200000)',
      );
    }
    pgText.push("), '/<>', '   '))");
    let term: MatchesFilter = {
      ...filter,
      matches: filter.matches.replace(/[/<>]/g, ' '),
    };
    // SQLite searches the fields' text joined by spaces.
    let sqliteText: Expression = ["''"];
    for (let path of fields) {
      sqliteText.push(
        "|| ' ' || coalesce(json_extract(i.search_doc,",
        param(`$.${path}`),
        "), '')",
      );
    }
    return this.dialect.textMatch(
      [...pgText, '@@', ...matchTsQuery(term)],
      sqliteText,
      filter.matches,
    );
  }

  // A `matches … scope: 'title'` term: the card's title, name and alias
  // words, which its role-weighted vector holds at weight A. The vector's GIN
  // index finds the rows holding the words anywhere, and `ts_filter` keeps
  // those holding them at A. SQLite has no vector; it reads the type-ahead
  // text, which holds the same names.
  #titleScopedMatchCondition(
    filter: MatchesFilter,
    context: FilterContext,
  ): CardExpression {
    let vector = searchTextVector(
      'ti',
      context.indexTable !== DEFAULT_FILTER_CONTEXT.indexTable,
    );
    return this.dialect.textMatch(
      [
        `(i.url, i.realm_url, i.type) IN (SELECT ti.url, ti.realm_url, ti.type FROM ${context.indexTable} AS ti WHERE ${vector} @@`,
        ...matchTsQuery(filter),
        `AND ts_filter(${vector}, '{a}') @@`,
        ...matchTsQuery(filter),
        `OFFSET 0)`,
      ],
      `i.search_doc ->> '${TYPE_AHEAD_KEY}'`,
      filter.matches,
    );
  }
}
