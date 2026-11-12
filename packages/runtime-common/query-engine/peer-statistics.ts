import type { BxlScoreSqlOptions } from '@cardstack/bxl/compiler';
import type { ComparedRows } from './sort-sql.ts';
import { sqlTextLiteral } from '../sql-literal.ts';

// Floating-point reductions use the same peer order as the peer arrays.
const aggregates = {
  count: (value: string) => `count(${value})`,
  sum: (value: string) => `COALESCE(sum(${value} ORDER BY c.ord), 0)`,
  avg: (value: string) => `avg(${value} ORDER BY c.ord)`,
  min: (value: string) => `min(${value})`,
  max: (value: string) => `max(${value})`,
  median: percentile(0.5),
  p10: percentile(0.1),
  p25: percentile(0.25),
  p75: percentile(0.75),
  p90: percentile(0.9),
  stdev: (value: string) => `stddev_samp(${value} ORDER BY c.ord)`,
};

function peerNumber(key: string): string {
  return `CASE jsonb_typeof(c.vals -> ${key}) WHEN 'number' THEN (c.vals ->> ${key})::double precision END`;
}

function percentile(fraction: number) {
  return (value: string) =>
    `percentile_cont(${fraction}) WITHIN GROUP (ORDER BY ${value})`;
}

function objectSql(pairs: string[]): string {
  return `jsonb_build_object(${pairs.join(', ')})`;
}

// Paths are the JSON reads emitted by the scorer. A percentile lookup that
// uses the shared distribution bypasses the peer array read.
export function peerStatistics(
  fields: readonly string[],
  paths: readonly string[][],
): { sql: string; empty: string } | undefined {
  let peers: string[] = [];
  let stats: string[] = [];
  let emptyPeers: Record<string, never[]> = Object.create(null);
  let emptyStats: Record<string, Record<string, number | null>> = Object.create(
    null,
  );
  for (let field of fields) {
    let key = sqlTextLiteral(field);
    let value = `c.vals -> ${key}`;
    if (
      paths.some(
        ([scope, name]) =>
          scope === 'peers' && (name === undefined || name === field),
      )
    ) {
      peers.push(
        `${key}, COALESCE(jsonb_agg(${value} ORDER BY c.ord) FILTER (WHERE jsonb_typeof(${value}) IN ('number', 'string')), '[]'::jsonb)`,
      );
      emptyPeers[field] = [];
    }
    let numeric = peerNumber(key);
    let needed = Object.entries(aggregates).filter(([name]) =>
      paths.some(
        ([scope, ref, member]) =>
          scope === 'stats' &&
          (ref === undefined ||
            (ref === field && (member === undefined || member === name))),
      ),
    );
    if (needed.length) {
      stats.push(
        `${key}, ${objectSql(needed.map(([name, aggregate]) => `${sqlTextLiteral(name)}, ${aggregate(numeric)}`))}`,
      );
      emptyStats[field] = Object.fromEntries(
        needed.map(([name]) => [
          name,
          name === 'count' || name === 'sum' ? 0 : null,
        ]),
      );
    }
  }
  // Preserve a read of the root object even when it has no fields.
  let roots: string[] = [];
  let empty: Record<string, unknown> = {};
  if (
    peers.length ||
    paths.some(([scope, field]) => scope === 'peers' && field === undefined)
  ) {
    roots.push(`'peers', ${objectSql(peers)}`);
    empty.peers = emptyPeers;
  }
  if (
    stats.length ||
    paths.some(([scope, field]) => scope === 'stats' && field === undefined)
  ) {
    roots.push(`'stats', ${objectSql(stats)}`);
    empty.stats = emptyStats;
  }
  return roots.length
    ? { sql: objectSql(roots), empty: JSON.stringify(empty) }
    : undefined;
}

type Reduction = 'count' | 'sum' | 'min' | 'max' | 'median';
const noScore = "'NaN'::double precision";

export class PeerReductions {
  #compared: ComparedRows | undefined;
  #safe = new Map<string, boolean>();
  #columns = new Map<string, { alias: string; sql: string }>();

  constructor(compared: ComparedRows | undefined) {
    this.#compared = compared;
  }

  compile: NonNullable<BxlScoreSqlOptions['peerReductionToSql']> = (
    name,
    [, field],
  ) => {
    if (!this.#compared?.fields.includes(field)) return;
    if (
      (name === 'SUM' || name === 'AVERAGE' || name === 'MEDIAN') &&
      !this.#safeToReduce(field)
    ) {
      return;
    }
    let read = (reduction: Reduction) => this.#read(field, reduction);
    switch (name) {
      case 'COUNT':
        return `COALESCE(${read('count')}, 0)::double precision`;
      case 'SUM':
        return `COALESCE(${read('sum')}, 0::double precision)`;
      case 'MIN':
        return `COALESCE(${read('min')}, 0::double precision)`;
      case 'MAX':
        return `COALESCE(${read('max')}, 0::double precision)`;
      case 'MEDIAN':
        return `COALESCE(${read('median')}, ${noScore})`;
      case 'AVERAGE':
        return `COALESCE((0::double precision + COALESCE(${read('sum')}, 0)) / NULLIF(${read('count')}, 0), ${noScore})`;
    }
  };

  #safeToReduce(field: string): boolean {
    let safe = this.#safe.get(field);
    if (safe === undefined) {
      let rows = this.#compared!.rows;
      // Keep potentially overflowing operations inside their original CASE
      // branch. With this bound any partial sum and median interpolation fit.
      let limit = Number.MAX_VALUE / (2 * Math.max(rows.length, 1));
      safe = rows.every(({ vals }) => {
        let value = vals[field];
        return typeof value !== 'number' || Math.abs(value) <= limit;
      });
      this.#safe.set(field, safe);
    }
    return safe;
  }

  #read(field: string, reduction: Reduction): string {
    let key = JSON.stringify([field, reduction]);
    let column = this.#columns.get(key);
    if (!column) {
      column = {
        alias: `reduction_${this.#columns.size}`,
        sql: aggregates[reduction](peerNumber(sqlTextLiteral(field))),
      };
      this.#columns.set(key, column);
    }
    return `g.${column.alias}`;
  }

  get columns(): string[] {
    return [...this.#columns.values()].map(
      ({ sql, alias }) => `${sql} AS ${alias}`,
    );
  }
}
