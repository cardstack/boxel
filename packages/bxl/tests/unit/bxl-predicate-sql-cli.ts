import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';
import {
  BxlPredicateSqlError,
  compileBxlPredicateToSql,
  parseBxlAst,
  type BxlPredicateSqlPathUsage,
  type ReadableSchema,
} from '../../src/index.js';

const schema: ReadableSchema = {
  fields: [
    { key: 'amount', label: 'Amount' },
    { key: 'createdAt', label: 'Created At' },
    { key: 'department', label: 'Department' },
    { key: 'ownerId', label: 'Owner ID' },
    { key: 'status', label: 'Status' },
    { key: 'tags', label: 'Tags' },
  ],
};

function pathToSql(
  path: { root: 'current' | 'Record'; parts: string[] },
  usage: BxlPredicateSqlPathUsage,
) {
  return `${path.root}:${path.parts.join('.')}:${usage}`;
}

function compile(expression: string) {
  return compileBxlPredicateToSql(expression, {
    schema,
    context: {
      User: {
        ID: 'user_123',
        Clearances: ['finance', 'exec'],
        Departments: ['Finance', 'Legal'],
      },
      Env: {
        Cutoff: '2026-01-01T00:00:00.000Z',
      },
    },
    pathToSql,
    matchesToSql: (query) => `(MATCHES ${query.sql})`,
    ageToSql: (value) => `(NOW() - ${value.sql})`,
  });
}

deepStrictEqual(
  compile('Status = "Active"'),
  {
    sql: '((current:status:value) = ($1))',
    params: ['Active'],
    source: 'Status = "Active"',
    canonicalSource: '.status == "Active"',
  },
  'equality lowers to a parameterized comparison',
);

deepStrictEqual(
  compile('Owner ID = @User.ID'),
  {
    sql: '((current:ownerId:value) = ($1))',
    params: ['user_123'],
    source: 'Owner ID = @User.ID',
    canonicalSource: '.ownerId == @User.ID',
  },
  'context paths lower to bound parameters',
);

deepStrictEqual(
  compile('Status IN ["Active", "Pending"]'),
  {
    sql: '((current:status:value) IN ($1, $2))',
    params: ['Active', 'Pending'],
    source: 'Status IN ["Active", "Pending"]',
    canonicalSource: '(.status | IN(["Active", "Pending"]))',
  },
  'IN lowers literal arrays to SQL IN lists',
);

deepStrictEqual(
  compile('Department IN @User.Departments'),
  {
    sql: '((current:department:value) IN ($1, $2))',
    params: ['Finance', 'Legal'],
    source: 'Department IN @User.Departments',
    canonicalSource: '(.department | IN(@User.Departments))',
  },
  'IN lowers context arrays to SQL IN lists',
);

deepStrictEqual(
  compile('Tags | overlaps(@User.Clearances)'),
  {
    sql: '((current:tags:array) && (ARRAY[$1, $2]))',
    params: ['finance', 'exec'],
    source: 'Tags | overlaps(@User.Clearances)',
    canonicalSource: '.tags | overlaps(@User.Clearances)',
  },
  'overlaps stays function-shaped and lowers to an array intersection predicate',
);

deepStrictEqual(
  compile('present(Department)'),
  {
    sql: "((current:department:text) IS NOT NULL AND CAST((current:department:text) AS text) <> '')",
    params: [],
    source: 'present(Department)',
    canonicalSource: 'present(.department)',
  },
  'present lowers to a null and empty-string check',
);

deepStrictEqual(
  compile('(Amount // 0) >= 1000 and matches("jwt OR token")'),
  {
    sql: '(((COALESCE((current:amount:value), ($1))) >= ($2)) AND (MATCHES $3))',
    params: [0, 1000, 'jwt OR token'],
    source: '(Amount // 0) >= 1000 and matches("jwt OR token")',
    canonicalSource: '(.amount//0) >= 1000 and matches("jwt OR token")',
  },
  'null coalescing and corpus matches are pushdown predicates',
);

deepStrictEqual(
  compile('Amount + 5 >= 1000'),
  {
    sql: '((((current:amount:value) + ($1))) >= ($2))',
    params: [5, 1000],
    source: 'Amount + 5 >= 1000',
    canonicalSource: '.amount + 5 >= 1000',
  },
  'portable SQL arithmetic lowers inside predicate value expressions',
);

deepStrictEqual(
  compile('Amount BETWEEN 1000 AND 5000'),
  {
    sql: '((current:amount:value) BETWEEN ($1) AND ($2))',
    params: [1000, 5000],
    source: 'Amount BETWEEN 1000 AND 5000',
    canonicalSource: 'between(.amount; 1000; 5000)',
  },
  'BETWEEN maps to a jq helper and SQL BETWEEN',
);

deepStrictEqual(
  compile('Amount NOT BETWEEN 1000 AND 5000'),
  {
    sql: '(NOT (((current:amount:value) BETWEEN ($1) AND ($2))))',
    params: [1000, 5000],
    source: 'Amount NOT BETWEEN 1000 AND 5000',
    canonicalSource: '(between(.amount; 1000; 5000) | not)',
  },
  'NOT BETWEEN maps to jq not and SQL NOT',
);

deepStrictEqual(
  compile('Status NOT IN ["Closed", "Archived"]'),
  {
    sql: '(NOT (((current:status:value) IN ($1, $2))))',
    params: ['Closed', 'Archived'],
    source: 'Status NOT IN ["Closed", "Archived"]',
    canonicalSource: '((.status | IN(["Closed", "Archived"])) | not)',
  },
  'NOT IN maps to jq not and SQL NOT IN semantics',
);

deepStrictEqual(
  compile('Status LIKE "Act%"'),
  {
    sql: '((current:status:text) LIKE ($1))',
    params: ['Act%'],
    source: 'Status LIKE "Act%"',
    canonicalSource: 'like(.status; "Act%")',
  },
  'LIKE maps to a jq helper and SQL LIKE',
);

deepStrictEqual(
  compile('Status LIKE "%ive"'),
  {
    sql: '((current:status:text) LIKE ($1))',
    params: ['%ive'],
    source: 'Status LIKE "%ive"',
    canonicalSource: 'like(.status; "%ive")',
  },
  'LIKE supports leading percent wildcard patterns',
);

deepStrictEqual(
  compile('Status LIKE "%ct%"'),
  {
    sql: '((current:status:text) LIKE ($1))',
    params: ['%ct%'],
    source: 'Status LIKE "%ct%"',
    canonicalSource: 'like(.status; "%ct%")',
  },
  'LIKE supports contains-style percent wildcard patterns',
);

deepStrictEqual(
  compile('Status IS NOT NULL'),
  {
    sql: '((current:status:value) IS NOT NULL)',
    params: [],
    source: 'Status IS NOT NULL',
    canonicalSource: '.status != null',
  },
  'IS NOT NULL maps to jq null comparison and SQL IS NOT NULL',
);

deepStrictEqual(
  compile('age("Created At") < "30 days"'),
  {
    sql: '(((NOW() - current:createdAt:timestamp)) < ($1))',
    params: ['30 days'],
    source: 'age("Created At") < "30 days"',
    canonicalSource: 'age(.createdAt) < "30 days"',
  },
  'age lowers through the temporal SQL hook',
);

const inlineArrayProfile = parseBxlAst('Status IN ["Active", "Pending"]', {
  schema,
  profile: 'predicate',
});
strictEqual(
  inlineArrayProfile.profileIssues.length,
  0,
  'predicate profile allows inline arrays for IN',
);

const stateProfile = parseBxlAst('$new.Status = "Approved"', {
  readableSyntax: false,
  profile: 'predicate',
});
ok(
  stateProfile.profileIssues.some(
    (issue) => issue.code === 'predicate-state-context-banned',
  ),
  'predicate profile rejects mutation state contexts',
);

const freeVariableProfile = parseBxlAst('$limit == 10', {
  readableSyntax: false,
  profile: 'predicate',
});
ok(
  freeVariableProfile.profileIssues.some(
    (issue) => issue.code === 'predicate-variable-banned',
  ),
  'predicate profile rejects free jq variables',
);

throws(
  () => compileBxlPredicateToSql('words(Department) > 5', { schema }),
  /predicate-call-banned/,
  'profile violations are reported before SQL compilation',
);

throws(
  () => compileBxlPredicateToSql('Department IN @User.Departments', { schema }),
  /Missing context value for @User/,
  'context-backed predicates require context binding',
);

throws(
  () => compileBxlPredicateToSql('Department | contains("Fin")', { schema }),
  /predicate-call-banned/,
  'string contains cannot sneak through predicate SQL compilation',
);

throws(
  () => {
    throw new BxlPredicateSqlError('example');
  },
  /example/,
  'SQL compiler exports a typed error',
);

console.log('BXL predicate profile SQL compiler: all checks passed');
