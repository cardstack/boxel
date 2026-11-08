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
  refused('ROUND(rating, x)', /digits are a whole number/, 'computed digits');
  refused('', /cannot be empty/, 'nothing');
  refused('IF(rating)', /IF takes 2 to 3 arguments/, 'arity');
});

check(() => {
  ok(BXL_SCORE_FUNCTIONS.includes('LN'));
  ok(!(BXL_SCORE_FUNCTIONS as readonly string[]).includes('XIRR'));
});

console.log(`BXL score profile SQL compiler: ${checks} checks passed`);
