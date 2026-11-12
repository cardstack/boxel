import type { BxlScoreSqlOptions } from '@cardstack/bxl/compiler';
import { sqlTextLiteral } from '../sql-literal.ts';

type CountIf = NonNullable<BxlScoreSqlOptions['countIfToSql']>;
type NumericOperator = Extract<
  Parameters<CountIf>[1],
  { kind: 'number' }
>['op'];

const error = "'NaN'::double precision";

// A distribution has one threshold per distinct numeric value and keeps the
// number of peers below each threshold, including duplicates. width_bucket
// locates a candidate's lower neighbor without scanning the peer list again.
export class PeerDistributions {
  #fields: readonly string[];
  #aliases = new Map<string, string>();
  #textAliases = new Map<string, string>();

  constructor(fields: readonly string[]) {
    this.#fields = fields;
  }

  #alias(aliases: Map<string, string>, prefix: string, field: string): string {
    let alias = aliases.get(field);
    if (alias === undefined) {
      alias = `${prefix}_${aliases.size}`;
      aliases.set(field, alias);
    }
    return alias;
  }

  #field(parts: string[]): string | undefined {
    let [scope, field] = parts;
    return scope === 'peers' &&
      parts.length === 2 &&
      this.#fields.includes(field)
      ? field
      : undefined;
  }

  percentRank = (parts: string[], value: string): string | undefined => {
    let field = this.#field(parts);
    if (field === undefined) return;
    let alias = this.#alias(this.#aliases, 'peer_rank', field);
    return `(SELECT CASE
      WHEN candidate.value = ${error} OR ${alias}.total IS NULL
        OR bucket = 0 OR candidate.value > ${alias}.thresholds[cardinality(${alias}.thresholds)] THEN ${error}
      WHEN ${alias}.total = 1 THEN 0
      WHEN candidate.value = ${alias}.thresholds[bucket]
        THEN ${alias}.below[bucket] / (${alias}.total - 1)::double precision
      ELSE (${alias}.below[bucket + 1] - 1
        + (candidate.value - ${alias}.thresholds[bucket])
          / (${alias}.thresholds[bucket + 1] - ${alias}.thresholds[bucket]))
        / (${alias}.total - 1)::double precision
      END
      FROM (SELECT ${value} AS value) AS candidate
      CROSS JOIN LATERAL (SELECT width_bucket(candidate.value, ${alias}.thresholds) AS bucket) AS lookup)`;
  };

  countIf: CountIf = (parts, criterion) => {
    let field = this.#field(parts);
    if (field === undefined) return;
    let number = () => this.#alias(this.#aliases, 'peer_rank', field);
    if (criterion.kind === 'number') {
      return this.#numberCount(number(), criterion.op, criterion.value);
    }
    let text = this.#alias(this.#textAliases, 'peer_text', field);
    let equal = (value: string) =>
      `COALESCE((${text}.counts ->> ${value})::bigint, 0)`;
    if (criterion.kind === 'text') {
      let matching = equal(criterion.value);
      return criterion.negate
        ? `(COALESCE(${text}.total, 0) + COALESCE(${number()}.total, 0) - ${matching})::double precision`
        : `(${matching})::double precision`;
    }
    let numeric = number();
    return `(SELECT CASE jsonb_typeof(criterion.value)
      WHEN 'number' THEN ${this.#numberCount(numeric, '=', "(criterion.value #>> '{}')::double precision")}
      WHEN 'string' THEN ${equal("lower(criterion.value #>> '{}')")}::double precision
      ELSE ${this.#numberCount(numeric, '=', '0::double precision')} END
      FROM (SELECT ${criterion.value} AS value) AS criterion)`;
  };

  #numberCount(alias: string, op: NumericOperator, value: string): string {
    let count = {
      '<': 'below',
      '<=': 'through',
      '=': 'through - below',
      '<>': 'total - (through - below)',
      '>=': 'total - below',
      '>': 'total - through',
    }[op];
    return `(SELECT CASE WHEN candidate.value = ${error} THEN ${error}
      WHEN candidate.value IS NULL OR ${alias}.total IS NULL THEN 0::double precision
      ELSE (${count})::double precision END
      FROM (SELECT ${value} AS value) AS candidate
      CROSS JOIN LATERAL (SELECT width_bucket(candidate.value, ${alias}.thresholds) AS bucket) AS lookup
      CROSS JOIN LATERAL (SELECT
        CASE WHEN bucket = 0 THEN 0 ELSE COALESCE(${alias}.below[bucket + 1], ${alias}.total) END AS through,
        ${alias}.total AS total) AS upper_bound
      CROSS JOIN LATERAL (SELECT CASE WHEN candidate.value = ${alias}.thresholds[bucket]
        THEN ${alias}.below[bucket] ELSE through END AS below) AS lower_bound)`;
  }

  get ctes(): string {
    return this.#numericCtes() + this.#textCtes();
  }

  #numericCtes(): string {
    if (this.#aliases.size === 0) return '';

    let fields = [...this.#aliases.keys()]
      .map((field) => sqlTextLiteral(field))
      .join(', ');
    return `, peer_values AS (
      SELECT c.key, field.name,
        CASE WHEN jsonb_typeof(c.vals -> field.name) = 'number'
          THEN (c.vals ->> field.name)::double precision END AS value
      FROM c CROSS JOIN unnest(ARRAY[${fields}]) AS field(name)
    ), peer_histogram AS (
      SELECT key, name, value, count(*) AS frequency
      FROM peer_values WHERE value IS NOT NULL
      GROUP BY key, name, value
    ), peer_distributions AS MATERIALIZED (
      SELECT key, name, array_agg(value ORDER BY value) AS thresholds,
        array_agg(below ORDER BY value) AS below,
        sum(frequency)::bigint AS total
      FROM (
        SELECT *, (sum(frequency) OVER (PARTITION BY key, name ORDER BY value)
          - frequency)::bigint AS below
        FROM peer_histogram
      ) AS histogram
      GROUP BY key, name
    )`;
  }

  #textCtes(): string {
    if (this.#textAliases.size === 0) return '';
    let fields = [...this.#textAliases.keys()]
      .map((field) => sqlTextLiteral(field))
      .join(', ');
    return `, peer_text_histogram AS (
      SELECT c.key, field.name, lower(c.vals ->> field.name) AS value, count(*) AS frequency
      FROM c CROSS JOIN unnest(ARRAY[${fields}]) AS field(name)
      WHERE jsonb_typeof(c.vals -> field.name) = 'string'
      GROUP BY c.key, field.name, lower(c.vals ->> field.name)
    ), peer_text_distributions AS MATERIALIZED (
      SELECT key, name, jsonb_object_agg(value, frequency) AS counts, sum(frequency)::bigint AS total
      FROM peer_text_histogram GROUP BY key, name
    )`;
  }

  get joins(): string {
    let joins = (aliases: Map<string, string>, table: string) =>
      [...aliases]
        .map(
          ([field, alias]) =>
            ` LEFT JOIN ${table} AS ${alias} ON ${alias}.key = w.key AND ${alias}.name = ${sqlTextLiteral(field)}`,
        )
        .join('');
    return (
      joins(this.#aliases, 'peer_distributions') +
      joins(this.#textAliases, 'peer_text_distributions')
    );
  }
}
