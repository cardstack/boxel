// `select`: reading a table of values (columns by path) for the cards a
// query matches, and planning those columns against the type.
// Owns: `planColumns`, `searchColumns`.
// Must not: page or rank on its own: it runs the query through the
// pipeline.
// Guarantees: docs/search.md ("A table of values (`select`)").

import type { CodeRef } from '../index.ts';
import {
  type ColumnPlan,
  type QueryOptions,
  type QueryResultsMeta,
  SCORE_COLUMNS,
} from './types.ts';
import type { Definition } from '../definitions.ts';
import type { Expression } from '../expression.ts';
import { InvalidQueryError, type Query } from '../query.ts';
import { Paging } from './paging.ts';
import {
  getField,
  isFilterRefersToNonsearchableFieldError,
  seedSearchableRoutesFromDefinition,
} from './filter-paths.ts';
import { internBindingReferences } from '../binding-reference.ts';
import { isFilterRefersToNonexistentTypeError } from '../definition-lookup.ts';
import { sqlJsonPathLiteral, sqlTextArrayLiteral } from '../sql-literal.ts';
import stringify from 'safe-stable-stringify';

export abstract class Columns extends Paging {
  // ---- select: a projection over the search doc -------------------------
  //
  // `select` names values to read straight from each matching row's search
  // doc, so nothing is loaded or rendered. Each path is checked against the
  // query's type here: a field the type lacks is `unknown-field`, and a path
  // through a link whose target the search doc does not carry (no
  // `searchable` route to that field, or a query-backed
  // link) is `not-indexed`. A path that crosses a link remembers the link, so
  // a caller a policy scopes reads the linked value only where that card's
  // own grants admit them (see `admittedLinkIds`).
  async planColumns(
    type: CodeRef,
    columns: { name: string; path: string }[],
  ): Promise<ColumnPlan[]> {
    this.dialect.requirePostgres(
      'select: this index (SQLite) cannot read columns; it needs Postgres',
    );
    let definition: Definition;
    let typeName = (type as { name?: unknown }).name;
    if (
      typeof typeName === 'string' &&
      ['__proto__', 'constructor', 'prototype'].includes(typeName)
    ) {
      throw new InvalidQueryError(
        `select: ${JSON.stringify(typeName)} names no card type`,
        'invalid-type',
      );
    }
    try {
      definition = await this.getDefinition(type);
    } catch (e) {
      // A type nothing defines has no fields to read columns from: refused
      // with a code, not a raw lookup error.
      if (isFilterRefersToNonexistentTypeError(e)) {
        throw new InvalidQueryError(
          `select: the type ${stringify(type)} is not defined, so it has no fields to select`,
          'invalid-type',
        );
      }
      throw e;
    }
    let plans: ColumnPlan[] = [];
    for (let [index, { name, path }] of columns.entries()) {
      if (SCORE_COLUMNS.has(path)) {
        plans.push({ name, index, score: path });
        continue;
      }
      let traveled = '';
      try {
        await this.walkFilterFieldPath(
          definition,
          path,
          [] as Expression,
          async (_definition, expression, pathTraveled) => {
            traveled = pathTraveled;
            return expression;
          },
          undefined,
          seedSearchableRoutesFromDefinition(definition),
        );
      } catch (e) {
        if (isFilterRefersToNonsearchableFieldError(e)) {
          throw new InvalidQueryError(
            e.reason === 'query-backed'
              ? `select: "${path}" is not in the index: ${e.relationshipPath} is a query-backed link, so its cards are found by a search, not stored, and the index holds none of their values (searchable cannot change that)`
              : `select: "${path}" is not in the index: the "${e.relationshipPath}" link does not carry it; name it in the link's \`searchable\` (\`searchable: true\` for the linked card's own fields)`,
            'not-selectable',
          );
        }
        throw e;
      }
      let segments = traveled.split('.');
      // The first link the path crosses, if it reads past one: the value
      // is the linked card's, and its id sits beside it in the search doc.
      let link: ColumnPlan['link'];
      let walked: string[] = [];
      let at = definition;
      for (let [i, segment] of segments.entries()) {
        let bare = segment.replace(/\[\]$/, '');
        let field = await getField(
          at,
          [...walked, bare].join('.'),
          this.definitionLookup,
        );
        walked.push(bare);
        if (
          (field.type === 'linksTo' || field.type === 'linksToMany') &&
          i < segments.length - 1 &&
          !(i === segments.length - 2 && segments[i + 1] === 'id')
        ) {
          link = {
            segments: segments.slice(0, i + 1),
            type: field.fieldOrCard,
          };
          break;
        }
      }
      let plural = segments.some((x) => x.endsWith('[]'));
      let leaf = !link
        ? await getField(
            definition,
            segments.map((x) => x.replace(/\[\]$/, '')).join('.'),
            this.definitionLookup,
          ).catch(() => undefined)
        : undefined;
      if (leaf?.serializerName === 'vector') {
        plans.push({
          name,
          index,
          vector: {
            fieldPath: segments.map((x) => x.replace(/\[\]$/, '')).join('.'),
            list: plural,
          },
        });
        continue;
      }
      plans.push({
        name,
        index,
        segments,
        plural,
        link,
      });
    }
    return plans;
  }

  // Runs `query` and reads each planned column off every row on the page.
  async searchColumns(
    realmURL: URL,
    query: Query,
    opts: QueryOptions,
    plans: ColumnPlan[],
  ): Promise<{ meta: QueryResultsMeta; rows: unknown[][] }> {
    // A string naming a declared binding ("$sofa.priceMin") as the engine's
    // reference, and { $literal } as its text (binding-reference.ts): once,
    // here, never in `_search`, whose own reads are already in that form.
    query = internBindingReferences(query);
    // the rows and the linked cards their columns are admitted by: one
    // snapshot
    if (!opts.reader && this.dbAdapter.withReadSnapshot) {
      return await this.inSnapshot(opts, (inSnapshot) =>
        this.searchColumns(realmURL, query, inSnapshot, plans),
      );
    }
    let select = [
      'SELECT i.url AS url, ANY_VALUE(i.type) AS type, ANY_VALUE(i.file_alias) AS card_id',
    ];
    let read = (segments: string[]) =>
      segments.some((x) => x.endsWith('[]'))
        ? `jsonb_path_query_array(i.search_doc, ${sqlJsonPathLiteral(segments)})`
        : `spill_unmark(i.search_doc #> ${sqlTextArrayLiteral(segments)})`;
    for (let plan of plans) {
      if (plan.vector) {
        // A vector column: the card's own vectors at the field, each with its
        // space (and, inside a list, its item id), in item order.
        select.push(
          this.vectors.vectorColumn(plan.vector, `__col${plan.index}`),
        );
        continue;
      }
      if (!plan.segments) continue;
      select.push(
        `, ANY_VALUE(${read(plan.segments)}) AS "__col${plan.index}"`,
      );
      if (plan.link) {
        select.push(
          `, ANY_VALUE(${read([...plan.link.segments, 'id'])}) AS "__link${plan.index}"`,
        );
      }
    }
    let { meta, results } = (await this._search(
      realmURL,
      query,
      opts,
      [select.join('')],
      'instance',
    )) as {
      meta: QueryResultsMeta;
      results: Record<string, unknown>[];
    };
    // Under a policy, a linked value shows only where the linked card's own
    // type's grants admit the caller, as a direct read of that card would.
    let admitted = new Map<number, Set<string> | null>();
    if (opts.grantsForType) {
      for (let plan of plans) {
        if (!plan.link) continue;
        let ids = new Set<string>();
        for (let row of results) {
          for (let id of [row[`__link${plan.index}`]].flat(2)) {
            if (typeof id === 'string') ids.add(id);
          }
        }
        admitted.set(
          plan.index,
          await this.admittedLinkIds([...ids], opts, realmURL, plan.link.type),
        );
      }
    }
    let rows = results.map((row) => {
      let out: unknown[] = [row.card_id ?? row.url];
      for (let plan of plans) {
        if (plan.score) {
          let v = row[plan.score];
          out.push(v == null ? null : Number(v));
          continue;
        }
        let value = row[`__col${plan.index}`] ?? null;
        let ok = admitted.get(plan.index);
        if (ok !== undefined) {
          let ids = row[`__link${plan.index}`];
          if (Array.isArray(ids) && Array.isArray(value)) {
            // a list through a list of links: keep the admitted ones' values
            value =
              ok === null
                ? []
                : value.filter(
                    (_v, i) =>
                      typeof ids[i] === 'string' && ok.has(ids[i] as string),
                  );
          } else if (ok === null || typeof ids !== 'string' || !ok.has(ids)) {
            value = null;
          }
        }
        out.push(value);
      }
      return out;
    });
    return { meta, rows };
  }
}
