export interface BxlSqlPredicateMapping {
  syntax: string;
  jq: string;
  sql: string;
  notes?: string;
}

export interface BxlSqlPredicateModule {
  name: 'sql-predicate';
  grammar: string;
  mappings: BxlSqlPredicateMapping[];
}

export const SQL_PREDICATE_MODULE: BxlSqlPredicateModule = {
  name: 'sql-predicate',
  grammar: String.raw`
SqlPredicate      = SqlOr ;
SqlOr             = SqlAnd, { "OR", SqlAnd } ;
SqlAnd            = SqlNot, { "AND", SqlNot } ;
SqlNot            = [ "NOT" ], SqlComparison ;
SqlComparison     = SqlValue
                  | SqlValue, CompareOp, SqlValue
                  | SqlValue, [ "NOT" ], "IN", ArrayOrContext
                  | SqlValue, [ "NOT" ], "BETWEEN", SqlValue, "AND", SqlValue
                  | SqlValue, [ "NOT" ], "LIKE", SqlLikePattern
                  | SqlValue, "IS", [ "NOT" ], ("NULL" | "TRUE" | "FALSE") ;
SqlValue          = SqlTerm, { ("+" | "-"), SqlTerm } ;
SqlTerm           = SqlFactor, { ("*" | "/" | "%"), SqlFactor } ;
SqlFactor         = FieldPath | ContextPath | Literal | ArrayLiteral | "(", SqlValue, ")" ;
CompareOp         = "=" | "==" | "!=" | "<>" | "<" | "<=" | ">" | ">=" ;
ArrayOrContext    = ArrayLiteral | ContextPath ;
SqlLikePattern    = String ;  (* SQL LIKE wildcards live in the string:
                                  "fish%" starts with fish,
                                  "%fish" ends with fish,
                                  "%fish%" contains fish,
                                  "_" matches one character. *)
`,
  mappings: [
    { syntax: 'a = b', jq: 'a == b', sql: 'a = b' },
    { syntax: 'a <> b', jq: 'a != b', sql: 'a <> b' },
    { syntax: 'a != b', jq: 'a != b', sql: 'a <> b' },
    { syntax: 'a < b / <= / > / >=', jq: 'same operator', sql: 'same operator' },
    { syntax: 'a + b / - / * / / / %', jq: 'same operator', sql: 'same operator' },
    { syntax: 'a IS NULL', jq: 'a == null', sql: 'a IS NULL' },
    { syntax: 'a IS NOT NULL', jq: 'a != null', sql: 'a IS NOT NULL' },
    { syntax: 'a IS TRUE', jq: 'a == true', sql: 'a IS TRUE' },
    { syntax: 'a IS FALSE', jq: 'a == false', sql: 'a IS FALSE' },
    { syntax: 'a IN [x, y]', jq: 'a | IN([x, y])', sql: 'a IN (?, ?)' },
    { syntax: 'a NOT IN [x, y]', jq: '(a | IN([x, y])) | not', sql: 'a NOT IN (?, ?)' },
    { syntax: 'a BETWEEN lo AND hi', jq: 'between(a; lo; hi)', sql: 'a BETWEEN lo AND hi' },
    { syntax: 'a NOT BETWEEN lo AND hi', jq: 'between(a; lo; hi) | not', sql: 'a NOT BETWEEN lo AND hi' },
    { syntax: 'a LIKE "fish%"', jq: 'like(a; "fish%")', sql: 'a LIKE ?', notes: '% and _ are SQL LIKE wildcards inside the pattern string.' },
    { syntax: 'a NOT LIKE "%fish%"', jq: 'like(a; "%fish%") | not', sql: 'a NOT LIKE ?', notes: 'No wildcard means exact string match.' },
  ],
};
