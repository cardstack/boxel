import { deepStrictEqual, ok, throws } from 'node:assert';
import {
  BXL_SCORE_FUNCTIONS,
  BxlScoreSqlError,
  compileBxlScoreToSql,
  type BxlScoreSqlUsage,
} from '../../src/index.ts';

// The score profile: a spreadsheet formula over a record's fields, lowered
// to a SQL number a database can rank every row by.

const fieldToSql = (parts: string[], usage: BxlScoreSqlUsage) =>
  `${usage}:${parts.join('.')}`;
const sql = (source: string) =>
  compileBxlScoreToSql(source, { fieldToSql }).sql;
let checks = 0;
const check = (fn: () => void) => {
  fn();
  checks++;
};

check(() => {
  let r = compileBxlScoreToSql('rating / LN(priceMin + 1)', { fieldToSql });
  deepStrictEqual(r.fields, ['rating', 'priceMin']);
  ok(r.sql.includes('number:rating'), 'bare names are fields');
  ok(
    r.sql.startsWith('NULLIF('),
    'an error (NaN) has no score, as a blank (NULL) has none',
  );
  ok(
    r.sql.includes(", 0)), 'NaN'::double precision)"),
    'a division by zero is an error, not a blank',
  );
  ok(
    r.sql.includes('ln(NULLIF(GREATEST('),
    'the log of a non-positive number is an error',
  );
});

check(() => {
  ok(
    sql('.rating * 2').includes(
      '(COALESCE(number:rating, 0) * (2::double precision))',
    ),
    'jq paths are fields too, and a blank is 0 in arithmetic',
  );
  ok(sql('brand.name').includes('number:brand.name'), 'dotted fields');
  ok(sql('rating^2').includes('power('), '^ is POWER');
});

check(() => {
  ok(
    sql('IF(discountPercent >= 20, rating * 1.2, rating)').includes(
      'compare:discountPercent',
    ),
    'a field compared reads text as above every number',
  );
  let iferror = sql('IFERROR(reviewCount / views30d, 0)');
  ok(
    iferror.includes('NULLIF(COALESCE(NULLIF(COALESCE('),
    'IFERROR catches an error, and only an error: a blank passes through',
  );
  ok(
    sql('IFERROR(rating, 0)').includes('passthrough:rating'),
    "IFERROR keeps a field's text as a value",
  );
  ok(
    sql('MAX(rating, 3)').includes('GREATEST(aggregate:rating'),
    'MAX reads only the numbers of a field it reads directly',
  );
  ok(sql('ROUND(rating, 1)').includes('round(CAST('), 'ROUND keeps its digits');
  ok(sql('NOT(rating)').includes('WHEN 0 THEN 1 ELSE 0'), 'NOT runs in SQL');
});

check(() => {
  let s = sql('unitsSold30d / MAX(DAYS(NOW(), publishedAt), 7)');
  ok(s.includes('timestamp:publishedAt'), 'a field inside DAYS is a date');
  ok(s.includes('EXTRACT(EPOCH FROM (now() - '), 'DAYS counts days');
});

check(() => {
  let refused = (source: string, pattern: RegExp, why: string) =>
    throws(
      () => compileBxlScoreToSql(source, { fieldToSql }),
      (e: unknown) => e instanceof BxlScoreSqlError && pattern.test(e.message),
      why,
    );
  refused(
    'LEN(title)',
    /LEN is not part of the score profile/,
    'text functions',
  );
  refused('"x" + 1', /text values are not part/, 'strings');
  refused('NOW()', /use it inside DAYS/, 'a bare date');
  refused('.items[0]', /list positions/, 'list positions');
  refused('rating | . + 1', /not part of the score profile/, 'pipes');
  refused(
    'rating & "a"',
    /^The operator & \(text joining\) is not part of the score profile/,
    '& is named as itself, not as the pipe it is rewritten to',
  );
  refused('ROUND(rating, x)', /digits are a whole number/, 'computed digits');
  refused('', /cannot be empty/, 'nothing');
  refused('IF(rating)', /IF takes 2 to 3 arguments/, 'arity');
});

check(() => {
  let r = compileBxlScoreToSql('PERCENTRANK_INC(peers.rating, rating)', {
    fieldToSql,
    percentRankToSql(parts, value) {
      deepStrictEqual(parts, ['peers', 'rating']);
      deepStrictEqual(value, 'COALESCE(number:rating, 0)');
      return 'shared_rank';
    },
  });
  ok(r.sql.includes('shared_rank'));
  ok(!r.sql.includes('unnest'));
  deepStrictEqual([...r.fields].sort(), ['peers.rating', 'rating']);
  ok(sql('PERCENTRANK_INC(peers.rating, rating)').includes('unnest'));
});

check(() => {
  let calls: string[] = [];
  let options: Parameters<typeof compileBxlScoreToSql>[1] = {
    fieldToSql,
    peerReductionToSql(name, parts) {
      calls.push(name);
      deepStrictEqual(parts, ['peers', 'price']);
      return `shared_${name.toLowerCase()}`;
    },
  };
  let r = compileBxlScoreToSql(
    'COUNT(peers.price) + SUM(peers.price) + MEDIAN(peers.price) + MIN(peers.price) + MAX(peers.price) + AVERAGE(peers.price)',
    options,
  );
  deepStrictEqual(calls, ['COUNT', 'SUM', 'MEDIAN', 'MIN', 'MAX', 'AVERAGE']);
  deepStrictEqual(r.fields, ['peers.price']);
  ok(!r.sql.includes('unnest'));
  for (let source of [
    'COUNTIF(peers.price, ">" & price)',
    'SUM(peers.price, price)',
    'SUM(prices)',
  ]) {
    deepStrictEqual(compileBxlScoreToSql(source, options).sql, sql(source));
  }
  deepStrictEqual(calls, ['COUNT', 'SUM', 'MEDIAN', 'MIN', 'MAX', 'AVERAGE']);
});

check(() => {
  let kinds: string[] = [];
  let options: Parameters<typeof compileBxlScoreToSql>[1] = {
    fieldToSql,
    countIfToSql(parts, criterion) {
      deepStrictEqual(parts, ['peers', 'price']);
      kinds.push(criterion.kind);
      if (criterion.kind === 'number') deepStrictEqual(criterion.op, '>');
      if (criterion.kind === 'text') deepStrictEqual(criterion.negate, true);
      return 'shared_count';
    },
  };
  for (let source of [
    'COUNTIF(peers.price, ">" & price)',
    'COUNTIF(peers.price, "<>rug")',
    'COUNTIF(peers.price, price)',
  ]) {
    let r = compileBxlScoreToSql(source, options);
    ok(r.sql.includes('shared_count'));
    ok(r.fields.includes('peers.price'));
    ok(!r.sql.includes('unnest') && !r.sql.includes('jsonb_array_elements'));
  }
  deepStrictEqual(kinds, ['number', 'text', 'field']);
  let source = 'COUNTIF(prices, ">" & price)';
  deepStrictEqual(compileBxlScoreToSql(source, options).sql, sql(source));
});

check(() => {
  ok(BXL_SCORE_FUNCTIONS.includes('LN'));
  ok(!(BXL_SCORE_FUNCTIONS as readonly string[]).includes('XIRR'));
});

console.log(`BXL score profile SQL compiler: ${checks} checks passed`);
