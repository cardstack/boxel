import type { CodeRef } from '../code-ref.ts';
import type {
  SearchEntryWireFilter,
  SearchEntryWireQuery,
} from '../search-entry.ts';
import type { BaseOperationName } from '@cardstack/base/operations';

// ============================================================================
// The lowered form of a card's `@operation` declarations.
//
// A declaration as an author writes it references JavaScript — `StringField`
// the class, `ClassroomActivity` the class, `params('body')` the marker — and
// spells its work in convenience clauses. Lowering translates that into the
// plain JSON below: classes become code refs, the clauses become one
// canonical BXL program, and the query becomes an entry-wire query template.
//
// The realm executes an operation from this form alone. It is stored in the
// `operations` member of a type's definition-cache entry, which is reachable
// from a card's `adoptsFrom` without loading the card's module — the whole
// point of the shape, since card modules are author-written and the realm is
// a trusted context.
// ============================================================================

// What the caller must send, keyed by param name. `field` is a scalar the
// named field class serializes; `link` is a card identity — the URL of a
// saved card, or the `lid` of one being created in the same atomic batch.
export type OperationParamDefinition =
  | { kind: 'field'; codeRef: CodeRef }
  | { kind: 'link'; codeRef: CodeRef };

// BXL as lowering emits it: already canonical, so a consumer parses it with
// `syntax: 'solidified'` and no readable-syntax schema. Author programs are
// canonicalized on the way in, so one program shape reaches the realm
// whichever spelling produced it.
export interface OperationProgram {
  source: string;
  syntax: 'solidified';
}

// A JSON tree that still carries typed-reference markers where an invocation
// supplies the value — `{ $ref: 'params', key: 'body' }` and friends, exactly
// as the declaration wrote them. Substituting them is the invocation's job:
// only then are the payload and the actor known.
export type OperationTemplate =
  | string
  | number
  | boolean
  | null
  | OperationTemplate[]
  | { [key: string]: OperationTemplate };

// A `SearchEntryWireQuery` with the value slots an invocation fills still
// holding their markers. Defined against the realm's own wire types rather
// than restated, so a change to the search grammar reaches a declared query
// too; the only relaxation is where a marker can legally stand — a full-text
// term, and the values inside the field-keyed operators, which the wire
// grammar already types as `unknown`.
export interface OperationQueryTemplate extends Omit<
  SearchEntryWireQuery,
  'filter'
> {
  filter?: OperationQueryFilterTemplate;
}

export type OperationQueryFilterTemplate = Omit<
  SearchEntryWireFilter,
  'any' | 'every' | 'not' | 'matches'
> & {
  any?: OperationQueryFilterTemplate[];
  every?: OperationQueryFilterTemplate[];
  not?: OperationQueryFilterTemplate;
  matches?: string | OperationTemplate;
};

export interface OperationDefinition {
  // The built-in behavior that carries this operation out. The name the
  // operation is invoked under is the key it is stored under, and the two are
  // read separately: a `delete` built on `transform` is a soft delete.
  base: BaseOperationName;
  params?: Record<string, OperationParamDefinition>;
  // The transformation stage — the clauses and any raw program, lowered to a
  // single BXL mutation program.
  program?: OperationProgram;
  // The raw program's payload-shaping stage, and its result projection.
  input?: OperationProgram;
  output?: OperationProgram;
  // The type a `create` mints.
  of?: CodeRef;
  // The attributes a named `create` stages, as a marker-carrying template
  // rather than a program: the coordinator resolves it by substitution, and a
  // link-typed param's value becomes a relationship.
  fill?: Record<string, OperationTemplate>;
  // A saved search, as an entry-wire query whose value slots may still hold
  // markers.
  query?: OperationQueryTemplate;
  // The author's override of the client's optimistic eligibility.
  optimistic?: boolean;
  // Whether every program this operation runs yields the same result for the
  // same input. A volatile call (`NOW`, `TODAY`, `RAND`, `RANDBETWEEN`,
  // `ISAFTER`, `ISBEFORE`) is what makes one false; `params()`, `actor()` and
  // `instance()` do not, since they are fixed for a given request. The
  // client's optimistic ledger only applies a program locally when this
  // holds — a non-deterministic one would land a different value locally than
  // the server computes, and reconciliation would report a phantom conflict.
  deterministic: boolean;
  // Set when lowering found problems. The operation is stored either way, so
  // invoking it reports what is wrong with it rather than "unknown
  // operation".
  invalid?: true;
  issues?: OperationLoweringIssue[];
}

export type OperationLoweringIssueCode =
  // A clause names a field the type does not have.
  | 'unknown-field'
  // A clause appends to, or asserts uniqueness over, a field that holds one
  // value rather than a collection.
  | 'not-a-collection'
  // `params('x')` for a key the `params` schema does not declare.
  | 'undeclared-param'
  // A write into a computed field. Its value comes from its `computeVia`, so
  // a write would be overwritten by the next read.
  | 'computed-write'
  // A write into a field nothing may write: one whose value is resolved by a
  // `query`, or the card's own `id`.
  | 'read-only-write'
  // A `set` that would replace a whole link collection. A relationship
  // collection is changed one edge at a time, so this is `append`'s job.
  | 'link-collection-replace'
  // A dotted path that crosses a collection. Which item it means is not
  // something a declaration can say, so the path addresses nothing.
  | 'path-crosses-collection'
  // A write whose path crosses a `linksTo` / `linksToMany`. An operation
  // binds only to the target card's own stored values; the linked card is a
  // separate document with its own operations.
  | 'write-through-link'
  // A read that crosses a link not marked `searchable`. Those values are not
  // available to an operation, so the read yields nothing.
  | 'unsearchable-read'
  // An `assert` over a computed or linked path that did not declare
  // `{ snapshot: true }`. The program reads the target's stored document,
  // which holds neither a computed value nor a linked card's fields, so the
  // assertion needs the author to ask for the values to be gathered first.
  | 'unsnapshotted-assert'
  // A class reference that no module exports under a name, so there is no
  // code ref to store.
  | 'unresolved-type'
  // A raw BXL program that does not parse.
  | 'invalid-program'
  // A declared query the realm's own query grammar refuses.
  | 'invalid-query';

// A problem found while lowering one operation. Recorded, never thrown:
// definition build is decoupled in time from the edit that introduced the
// problem, so a throw would fail the whole module's definitions over one bad
// declaration and surface at a confusing moment.
export interface OperationLoweringIssue {
  code: OperationLoweringIssueCode;
  // The operation the problem is in.
  operation: string;
  // Where in the declaration, as a dotted path — `append.to`, `set.status`,
  // `query.filter`.
  path: string;
  message: string;
}

export interface LowerOperationDeclarationsResult {
  operations: Record<string, OperationDefinition>;
  // Every issue across every operation, in the order they were found. The
  // same issues are on the operations that carry them; this is the flat view
  // a module's diagnostics are built from.
  issues: OperationLoweringIssue[];
}
