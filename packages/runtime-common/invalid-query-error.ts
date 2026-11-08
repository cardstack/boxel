// The error every check in the query grammar raises when a query does not
// conform to it. It lives in its own module so `json-validation.ts` can raise
// it without importing `query.ts`, which imports `json-validation.ts`.
//
// Callers key their response off the class, not the message: the search
// endpoints turn it into a 400 and let anything else surface as a 500, so a
// grammar violation reported as a plain `Error` reads to a caller as a server
// fault rather than a bad request.
//
// `code` names the mistake for a caller that reacts to it (an editor, a
// test), and every refusal carries one; it rides in the 400 body as
// `errors[0].code`. The codes:
//   invalid-value          a member has the wrong kind of value, or is out
//                          of range
//   missing-member         something the query needs is absent
//   unknown-key            a member the grammar does not have
//   conflicting-members    two members that cannot go together
//   limit-exceeded         more of something than a query may have
//   invalid-nesting        something placed where it cannot go
//   invalid-type           a type reference that names no card type
//   needs-type, sort-needs-type  a path that needs a type anchor
//   needs-declaration      a field or type lacks a declaration a feature
//                          needs
//   needs-postgres         a feature this index (SQLite) cannot run
//   matches-required       a text-relevance sort with no `matches` filter
//   engine-only            a member only the engine sets
//   invalid-formula, invalid-json, invalid-page, unknown-field,
//   unknown-binding, binding-kind, policy-linked-from
//   not-selectable         a select path the search doc does not carry
//   select-excludes-fields select beside fields (a table or entries, not both)
export class InvalidQueryError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'InvalidQueryError';
    this.code = code;
  }
}
