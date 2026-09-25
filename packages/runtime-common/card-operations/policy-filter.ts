import type { ResolvedCodeRef } from '../code-ref.ts';
import { isResolvedCodeRef } from '../card-document-shape.ts';
import type { Definition, FieldDefinition } from '../definitions.ts';
import type { OperationQueryFilterTemplate } from './types.ts';

// ============================================================================
// A query grant's predicate, compiled to a search filter.
//
// A query does not run through the operation core. It runs on the search
// engine, which pages through the index in SQL. So a grant on a query cannot
// be judged one card at a time: the realm would have to fetch every candidate
// and throw away the ones the predicate refuses, which defeats paging. The
// grant's predicate is compiled to a filter over the index instead, and a
// search the policy scopes adds that filter to the caller's own.
//
// The filter is compiled when the policy is, never on a request, and it is
// stored as a wire filter template. `actor()` stands in it as the
// `{ $ref: 'actor' }` marker a declared query carries, so a search fills in
// the caller the way it fills in a declared query's markers.
//
// A predicate compiles only when it passes two tests.
//
// The first is BXL's `predicate` profile: the allowlist of what a query can
// evaluate. A policy predicate is written in the `policy` profile's spelling,
// which differs from the `predicate` profile's in two places. The caller is
// the call `actor()` there and a context value here, and membership in a list
// is a pipe into `any(...)` or `contains([...])` there and into `IN(...)`
// here. Those two are respelled, and what results is checked against the
// profile as it stands.
//
// The second is the filter itself. It says less than SQL does: it has no
// arithmetic and no string functions, and it cannot address one element of a
// list by its position. And it must never say more than the predicate does. A
// filter reads a field as the index holds it, and a predicate reads it from
// the card's stored source, so every field the predicate reads is checked
// against the rule's type: its kind, whether the stored source holds it, and
// whether its type indexes the value it stores. A filter may come out narrower
// than its predicate. As far as those checks reach, it never comes out wider.
//
// A `not` is what makes that direction matter. Where a filter and its
// predicate can disagree about a card, the filter must be the one refusing it,
// and a `not` turns every refusal into an admission. Two comparisons can
// disagree in that direction, so neither is compiled inside a `not`:
//
// - Membership. BXL's `contains` matches substrings, and the filter matches
//   whole values, so a filter can refuse a card that `contains` admits. And
//   the index answers `not` element by element: a card is admitted by
//   `not member` as soon as any one element differs.
// - A card's id. The predicate reads every link as the URL it resolves to,
//   and the index holds a link it could not follow as the stored source wrote
//   it, so the index can find two ids unequal that the predicate finds equal.
//   The same difference is why an id is compared only with an absolute URL,
//   in a `not` or out of one: a constant spelled the way the stored source
//   wrote a link would match the index, and never the URL the predicate
//   reads.
//
// What the checks do not reach:
//
// - Other types. A filter is compiled against the rule's type and the types
//   its path names for contained values. `item.on` also admits a card whose
//   type descends from the rule's, and a contained value can be of a subtype
//   of its field's type. Either can declare a field the predicate reads
//   differently, computed where the rule's type stores it, and the index
//   then holds what that type makes of it. The paths a filter reads are the
//   keys of its `eq` and `range` members, so they can be checked against any
//   other type's definition.
// - A number field whose stored value is not a number. The index holds what
//   the field makes of the stored value, so the string "150" is indexed as
//   150, while BXL compares the string. Only a writer of the card can store
//   such a value, and a writer can already move a card into or out of a grant
//   by writing the fields its predicate reads.
// ============================================================================

export type PolicyFilterOutcome =
  | { filter: OperationQueryFilterTemplate }
  | { problem: string };

// What compiling a filter reads beyond the rule's own type.
export interface PolicyFilterEnvironment {
  // The definition of a type a predicate's path crosses into, or undefined
  // when there is none.
  lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition | undefined>;
  // BXL's profile check, as `@cardstack/bxl` exports it.
  validateBxlAst(
    node: unknown,
    options: { profile: 'predicate' },
  ): { code: string; severity: 'error' | 'warning'; message: string }[];
}

// Compile the predicate of a grant on a query, whose rule governs
// `targetType`, into the filter the grant admits. `predicate` is the body of
// the grant's `where` as BXL parsed it, with the grant's `snapshot`
// annotation, or undefined for a grant with no condition, which admits every
// card of the rule's type.
//
// The filter is anchored on the rule's type. It admits only cards of that type
// or of a type descending from it, and its field paths are resolved against
// that type.
export async function compilePolicyFilter(
  targetType: ResolvedCodeRef,
  definition: Definition,
  predicate: { body: unknown; snapshot: boolean } | undefined,
  env: PolicyFilterEnvironment,
): Promise<PolicyFilterOutcome> {
  if (predicate === undefined) {
    return { filter: { 'item.on': targetType } };
  }
  let refusals = env
    .validateBxlAst(inPredicateSpelling(predicate.body), {
      profile: 'predicate',
    })
    .filter((issue) => issue.severity === 'error');
  if (refusals.length > 0) {
    return {
      problem: `the \`predicate\` profile refuses it: ${refusals
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join('; ')}`,
    };
  }
  let compiler = new FilterCompiler(definition, predicate.snapshot, env);
  try {
    let filter = await compiler.predicate(predicate.body, 'positive');
    return { filter: { 'item.on': targetType, ...filter } };
  } catch (e: unknown) {
    if (e instanceof Unfilterable) {
      return { problem: e.message };
    }
    throw e;
  }
}

// Where the caller stands in a filter: the marker a declared query uses for
// `actor()`, which a search replaces with the caller's user id.
type ActorMarker = { $ref: 'actor' };

function actorMarker(): ActorMarker {
  return { $ref: 'actor' };
}

// How `actor()` is spelled in the `predicate` profile: the requesting user's
// id, as a context value the profile compiles to a bound parameter.
function callerInPredicateSpelling() {
  return {
    type: 'contextPath',
    root: '@User',
    parts: [{ type: 'field', key: 'ID' }],
  };
}

// A reason a predicate has no filter. Thrown within one compilation and caught
// where it began, so a refusal found deep inside a predicate ends the whole
// compilation with that one reason.
class Unfilterable extends Error {}

function refuse(reason: string): never {
  throw new Unfilterable(reason);
}

type Polarity = 'positive' | 'negative';

function flip(polarity: Polarity): Polarity {
  return polarity === 'positive' ? 'negative' : 'positive';
}

type Filter = OperationQueryFilterTemplate;

// A constant a predicate compares a field with: a value written in the
// predicate, or the caller.
type Constant =
  | { kind: 'string'; value: string | ActorMarker }
  | { kind: 'number'; value: number }
  | { kind: 'null'; value: null };

// What a field holds, as far as a comparison with it is concerned. `identity`
// is a card's id, its own or the id of a card it links to.
type FieldKind = 'string' | 'number' | 'identity';

const RANGE_OPERATORS: Record<string, 'gt' | 'gte' | 'lt' | 'lte'> = {
  '>': 'gt',
  '>=': 'gte',
  '<': 'lt',
  '<=': 'lte',
};

// The same comparison with its two sides swapped, so a constant written on
// the left compiles as though written on the right.
const MIRRORED: Record<string, string> = {
  '==': '==',
  '!=': '!=',
  '>': '<',
  '>=': '<=',
  '<': '>',
  '<=': '>=',
};

class FilterCompiler {
  #definition: Definition;
  #snapshot: boolean;
  #env: PolicyFilterEnvironment;

  constructor(
    definition: Definition,
    snapshot: boolean,
    env: PolicyFilterEnvironment,
  ) {
    this.#definition = definition;
    this.#snapshot = snapshot;
    this.#env = env;
  }

  // A boolean expression, as the filter that admits exactly the cards it
  // holds for, or fewer.
  async predicate(node: unknown, polarity: Polarity): Promise<Filter> {
    let binary = asBinary(node);
    if (binary?.operator === 'and' || binary?.operator === 'or') {
      let operator = binary.operator;
      let branches: Filter[] = [];
      for (let branch of flatten(binary, operator)) {
        branches.push(await this.predicate(branch, polarity));
      }
      return operator === 'and' ? { every: branches } : { any: branches };
    }
    if (binary?.operator === '|' && isCall(binary.right, 'not', 0)) {
      return { not: await this.predicate(binary.left, flip(polarity)) };
    }
    let membership = asMembership(node);
    if (membership) {
      return await this.membership(membership, polarity);
    }
    if (binary && hasOwn(MIRRORED, binary.operator)) {
      return await this.comparison(binary, polarity);
    }
    return refuse(notAPredicate(node));
  }

  async comparison(
    { operator: written, left, right }: BinaryNode,
    polarity: Polarity,
  ): Promise<Filter> {
    let operator = written;
    let path = asFieldPath(left);
    let constant = readConstant(right);
    if (!path || !constant) {
      path = asFieldPath(right);
      constant = readConstant(left);
      operator = MIRRORED[written];
    }
    if (!path || !constant) {
      return refuse(
        `\`${written}\` must compare a field with a constant, and ${operandProblem(left, right)}`,
      );
    }
    let field = await this.field(path);
    if (operator === '==' || operator === '!=') {
      let eqPolarity = operator === '!=' ? flip(polarity) : polarity;
      if (field.kind === 'identity' && eqPolarity === 'negative') {
        return refuse(
          `\`${field.path}\` is a card's id, and an id is compiled only where it admits a card, not inside a \`not\` or a \`!=\`: the index and the stored source can spell one id two ways`,
        );
      }
      if (field.kind === 'identity' && constant.kind !== 'null') {
        assertURL(field.path, constant);
      }
      assertComparable(field, constant);
      let eq: Filter = { eq: { [`item.${field.path}`]: constant.value } };
      return operator === '!=' ? { not: eq } : eq;
    }
    if (field.kind !== 'number' || constant.kind !== 'number') {
      return refuse(
        `\`${written}\` is compiled only between a number field and a number, and \`${field.path}\` ${field.kind === 'number' ? `is compared with ${describeConstant(constant)}` : `is not a number field`}`,
      );
    }
    return {
      range: {
        [`item.${field.path}`]: { [RANGE_OPERATORS[operator]]: constant.value },
      },
    };
  }

  async membership(
    { collection, member, through }: Membership,
    polarity: Polarity,
  ): Promise<Filter> {
    let path = asFieldPath(collection);
    if (!path) {
      return refuse(
        `membership must test a field of the card: ${describeNode(collection)} is not one`,
      );
    }
    if (polarity === 'negative') {
      return refuse(
        `membership in ${describeNode(collection)} is compiled only where it admits a card, not inside a \`not\`: the index answers \`not\` element by element, so it would admit a card as soon as any one element differs`,
      );
    }
    let list = await this.list(path, through);
    let constant = readConstant(member);
    if (constant?.kind !== 'string') {
      return refuse(
        `membership in \`${list.path}\` must test for a string or \`actor()\`, not ${constant ? describeConstant(constant) : describeNode(member)}`,
      );
    }
    if (through === 'id') {
      assertURL(list.path, constant);
    }
    // A list field matches `eq` when any one element does, which is what
    // makes this membership.
    return { eq: { [`item.${list.path}`]: constant.value } };
  }

  // A field a comparison reads: a primitive value of the card or of a value it
  // contains, or the id of the card itself or of a card it links to.
  async field(parts: PathPart[]): Promise<{ path: string; kind: FieldKind }> {
    let names = fieldNames(parts);
    let definition = this.#definition;
    for (let [index, name] of names.entries()) {
      let dotted = names.slice(0, index + 1).join('.');
      let last = index === names.length - 1;
      let field = this.#immediateField(definition, name, dotted);
      if (field.type === 'linksTo') {
        if (index === names.length - 2 && names[index + 1] === 'id') {
          return { path: `${dotted}.id`, kind: 'identity' };
        }
        return refuse(
          `\`${dotted}\` is a link, and a filter compares only the id of the card it links to: \`.${dotted}.id\``,
        );
      }
      if (field.type === 'containsMany' || field.type === 'linksToMany') {
        return refuse(
          `\`${dotted}\` is a list, and \`==\` compares a whole list; test one member with \`.${dotted} | any(${field.type === 'linksToMany' ? '.id' : '.'} == value)\``,
        );
      }
      if (field.isPrimitive) {
        if (!last) {
          return refuse(
            `\`${dotted}\` holds a single value, which has no field \`${names[index + 1]}\``,
          );
        }
        if (index === 0 && name === 'id') {
          return { path: dotted, kind: 'identity' };
        }
        return { path: dotted, kind: fieldHolds(field, dotted) };
      }
      if (last) {
        return refuse(
          `\`${dotted}\` is a compound value, and a filter compares one of its fields`,
        );
      }
      definition = await this.#compoundDefinition(field, dotted);
    }
    return refuse('a comparison must read a field of the card');
  }

  // A list a membership test reads: a list of strings the card contains, or a
  // list of links, whose members are the ids of the cards they link to.
  async list(
    parts: PathPart[],
    through: 'value' | 'id',
  ): Promise<{ path: string }> {
    let names = fieldNames(parts);
    let definition = this.#definition;
    for (let [index, name] of names.entries()) {
      let dotted = names.slice(0, index + 1).join('.');
      let last = index === names.length - 1;
      let field = this.#immediateField(definition, name, dotted);
      if (last) {
        if (field.type === 'linksToMany') {
          if (through !== 'id') {
            return refuse(
              `\`${dotted}\` is a list of links, and a filter tests one by the id of the card it links to: \`.${dotted} | any(.id == value)\``,
            );
          }
          return { path: `${dotted}.id` };
        }
        if (field.type === 'containsMany' && field.isPrimitive) {
          if (through !== 'value') {
            return refuse(
              `\`${dotted}\` is a list of values, and a filter tests one as it is: \`.${dotted} | any(. == value)\``,
            );
          }
          if (fieldHolds(field, dotted) !== 'string') {
            return refuse(
              `\`${dotted}\` is a list of numbers, and a filter tests membership only in a list of strings or of links`,
            );
          }
          return { path: dotted };
        }
        return refuse(
          `\`${dotted}\` is not a list of strings or of links, which is all a filter tests membership in`,
        );
      }
      if (field.type !== 'contains' || field.isPrimitive) {
        return refuse(
          `\`${dotted}\` is not a compound value, so the path cannot continue past it`,
        );
      }
      definition = await this.#compoundDefinition(field, dotted);
    }
    return refuse('membership must test a field of the card');
  }

  #immediateField(
    definition: Definition,
    name: string,
    dotted: string,
  ): FieldDefinition {
    let id = hasOwn(definition.fields, name)
      ? definition.fields[name]
      : undefined;
    let field =
      id !== undefined && hasOwn(definition.fieldDefs, id)
        ? definition.fieldDefs[id]
        : undefined;
    if (!field) {
      return refuse(
        `\`${dotted}\` is not a field of ${definition.displayName ?? nameOf(definition)}`,
      );
    }
    // The predicate reads the card's stored source, and the filter reads the
    // index. A computed value is only in the index, and a query-backed
    // relationship is only in the index, so the two would read different
    // things. A predicate annotated `snapshot: true` says it reads what the
    // index holds, which is what a filter reads, so its computed values are
    // compared.
    if (field.isComputed && !this.#snapshot) {
      return refuse(
        `\`${dotted}\` is computed, so the card's stored source, which the predicate reads, does not hold it; a \`where\` annotated \`snapshot: true\` reads computed values`,
      );
    }
    if (field.query) {
      return refuse(
        `\`${dotted}\` is filled by a query, so the card's stored source, which the predicate reads, does not hold it`,
      );
    }
    return field;
  }

  async #compoundDefinition(
    field: FieldDefinition,
    dotted: string,
  ): Promise<Definition> {
    let definition = isResolvedCodeRef(field.fieldOrCard)
      ? await this.#env.lookupDefinition(field.fieldOrCard)
      : undefined;
    if (!definition) {
      return refuse(`no definition was found for the type of \`${dotted}\``);
    }
    return definition;
  }
}

// The primitive field types a filter compares, and what each holds. Each one
// indexes the value it stores unchanged. A field's definition names its type
// and not the code behind it, and another type can index something else:
// `JsonField` indexes nothing, so every card would satisfy `== null` on one,
// a boolean field indexes an unset value as `false`, and any subclass of the
// types here can change what it indexes. So a field of any other type is not
// compared.
const COMPARED_FIELD_TYPES: {
  module: string;
  name: string;
  holds: 'string' | 'number';
}[] = [
  { module: '@cardstack/base/card-api', name: 'StringField', holds: 'string' },
  {
    module: '@cardstack/base/card-api',
    name: 'TextAreaField',
    holds: 'string',
  },
  {
    module: '@cardstack/base/card-api',
    name: 'MarkdownField',
    holds: 'string',
  },
  {
    module: '@cardstack/base/card-api',
    name: 'ReadOnlyField',
    holds: 'string',
  },
  { module: '@cardstack/base/card-api', name: 'NumberField', holds: 'number' },
  { module: '@cardstack/base/number', name: 'default', holds: 'number' },
];

// What a primitive field holds, for a comparison.
function fieldHolds(
  field: FieldDefinition,
  dotted: string,
): 'string' | 'number' {
  let type = isResolvedCodeRef(field.fieldOrCard)
    ? { module: field.fieldOrCard.module, name: field.fieldOrCard.name }
    : undefined;
  let compared = COMPARED_FIELD_TYPES.find(
    ({ module, name }) => type?.module === module && type?.name === name,
  );
  if (!compared) {
    return refuse(
      `\`${dotted}\` is a ${type ? (type.name === 'default' ? type.module : type.name) : 'custom'} field, and a filter compares only the base string and number fields, which the index holds as their stored source does`,
    );
  }
  return compared.holds;
}

// An id is compared only with an absolute URL, the form the predicate reads
// every id in.
function assertURL(path: string, constant: Constant): void {
  let url =
    typeof constant.value === 'string' ? parseURL(constant.value) : undefined;
  if (url?.protocol !== 'http:' && url?.protocol !== 'https:') {
    refuse(
      `\`${path}\` is a card's id, and an id is compared only with an absolute URL, which is how the predicate reads one; ${describeConstant(constant)} is not one`,
    );
  }
}

function parseURL(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function assertComparable(
  field: { path: string; kind: FieldKind },
  constant: Constant,
): void {
  if (constant.kind === 'null') {
    return;
  }
  let holds = field.kind === 'number' ? 'number' : 'string';
  if (constant.kind !== holds) {
    refuse(
      `\`${field.path}\` holds a ${holds}, and is compared with ${describeConstant(constant)}`,
    );
  }
}

// ----------------------------------------------------------------------------
// Reading BXL's AST.
//
// The AST reaches this module as BXL parsed it, typed as nothing in
// particular, so every reader checks the shape it relies on.
// ----------------------------------------------------------------------------

type AstNode = { type: string } & Record<string, unknown>;

interface BinaryNode {
  operator: string;
  left: unknown;
  right: unknown;
}

type PathPart = { type: string; key?: unknown };

interface Membership {
  // The list tested.
  collection: unknown;
  // The value looked for in it.
  member: unknown;
  // Whether a member is compared as it is, or by the `id` it carries, which
  // is how a list of links is tested.
  through: 'value' | 'id';
}

function isNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function asBinary(node: unknown): BinaryNode | undefined {
  if (
    isNode(node) &&
    node.type === 'binary' &&
    typeof node.operator === 'string'
  ) {
    return { operator: node.operator, left: node.left, right: node.right };
  }
  return undefined;
}

function callArgs(node: unknown, name: string): unknown[] | undefined {
  if (
    isNode(node) &&
    node.type === 'call' &&
    node.name === name &&
    Array.isArray(node.args)
  ) {
    return node.args;
  }
  return undefined;
}

function isCall(node: unknown, name: string, arity: number): boolean {
  return callArgs(node, name)?.length === arity;
}

// The parts of a path rooted at the card, or undefined when `node` is not
// one. `.` itself is a path with no parts.
function asPath(node: unknown): PathPart[] | undefined {
  if (
    isNode(node) &&
    node.type === 'path' &&
    node.root === 'current' &&
    Array.isArray(node.parts) &&
    node.parts.every(isNode)
  ) {
    return node.parts as PathPart[];
  }
  return undefined;
}

// A path that names a field: one with at least one part.
function asFieldPath(node: unknown): PathPart[] | undefined {
  let parts = asPath(node);
  return parts && parts.length > 0 ? parts : undefined;
}

// The field names a path reads, refusing a path that addresses anything else.
// `.teacherIds[0]` reads one element of a list by its position, and a filter
// has no way to name a position.
function fieldNames(parts: PathPart[]): string[] {
  return parts.map((part) => {
    if (part.type === 'field' && typeof part.key === 'string') {
      return part.key;
    }
    return refuse(
      part.type === 'index'
        ? 'the predicate reads one element of a list by its position, which a filter cannot address'
        : 'the predicate reads a path a filter cannot address',
    );
  });
}

function isPathTo(node: unknown, names: string[]): boolean {
  let parts = asPath(node);
  return (
    parts !== undefined &&
    parts.length === names.length &&
    parts.every((part, i) => part.type === 'field' && part.key === names[i])
  );
}

// A membership test, in either spelling BXL has for one:
//
//   .list | any(. == value)        .links | any(.id == value)
//   .list | contains([value])      .links | contains([{ id: value }])
//
// The `any` spelling is exact. The `contains` one matches substrings: BXL's
// `contains` holds for a list whose element merely contains the value. Its
// filter matches whole values, so it is narrower than the predicate.
function asMembership(node: unknown): Membership | undefined {
  let pipe = asBinary(node);
  if (pipe?.operator !== '|') {
    return undefined;
  }
  let [condition] = callArgs(pipe.right, 'any') ?? [];
  let comparison = asBinary(condition);
  if (isCall(pipe.right, 'any', 1) && comparison?.operator === '==') {
    for (let [element, member] of [
      [comparison.left, comparison.right],
      [comparison.right, comparison.left],
    ]) {
      if (isPathTo(element, [])) {
        return { collection: pipe.left, member, through: 'value' };
      }
      if (isPathTo(element, ['id'])) {
        return { collection: pipe.left, member, through: 'id' };
      }
    }
    return undefined;
  }
  let [array] = callArgs(pipe.right, 'contains') ?? [];
  if (
    isCall(pipe.right, 'contains', 1) &&
    isNode(array) &&
    array.type === 'array' &&
    isNode(array.expr) &&
    !(array.expr.type === 'binary' && array.expr.operator === ',')
  ) {
    let element = array.expr;
    let id = idEntry(element);
    if (id) {
      return { collection: pipe.left, member: id, through: 'id' };
    }
    return { collection: pipe.left, member: element, through: 'value' };
  }
  return undefined;
}

// The value of `{ id: value }`, the only object a membership test in a list of
// links looks for.
function idEntry(node: AstNode): unknown {
  if (
    node.type !== 'object' ||
    !Array.isArray(node.entries) ||
    node.entries.length !== 1
  ) {
    return undefined;
  }
  let [entry] = node.entries as { key?: unknown; value?: unknown }[];
  let key = entry?.key;
  let named =
    key === 'id' ||
    (isNode(key) &&
      key.type === 'literal' &&
      key.valueType === 'string' &&
      key.value === 'id');
  return named ? entry.value : undefined;
}

function readConstant(node: unknown): Constant | undefined {
  if (isCall(node, 'actor', 0)) {
    return { kind: 'string', value: actorMarker() };
  }
  if (!isNode(node)) {
    return undefined;
  }
  if (node.type === 'literal') {
    switch (node.valueType) {
      case 'string':
        return typeof node.value === 'string'
          ? { kind: 'string', value: node.value }
          : undefined;
      case 'number':
        return typeof node.value === 'number'
          ? { kind: 'number', value: node.value }
          : undefined;
      case 'null':
        return { kind: 'null', value: null };
      case 'boolean':
        return refuse(
          '`true` and `false` are not compared in a filter: a boolean field holds its unset value in the index as `false`, which the stored source does not',
        );
    }
    return undefined;
  }
  if (node.type === 'unary' && node.operator === '-') {
    let negated = readConstant(node.expr);
    return negated?.kind === 'number'
      ? { kind: 'number', value: -negated.value }
      : undefined;
  }
  return undefined;
}

// The predicate respelled for the `predicate` profile: `actor()` as the
// requesting user's id, and each membership test as a pipe into `IN(...)`.
// Everything else is copied as it is, so the profile sees the predicate's own
// structure.
function inPredicateSpelling(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(inPredicateSpelling);
  }
  if (typeof node !== 'object' || node === null) {
    return node;
  }
  if (isCall(node, 'actor', 0)) {
    return callerInPredicateSpelling();
  }
  let membership = asMembership(node);
  if (membership) {
    let collection = asPath(membership.collection);
    return {
      type: 'binary',
      operator: '|',
      left: inPredicateSpelling(membership.member),
      right: {
        type: 'call',
        name: 'IN',
        arity: 1,
        args: [
          collection && membership.through === 'id'
            ? {
                type: 'path',
                root: 'current',
                parts: [...collection, { type: 'field', key: 'id' }],
              }
            : inPredicateSpelling(membership.collection),
        ],
      },
    };
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      inPredicateSpelling(value),
    ]),
  );
}

function flatten(node: BinaryNode, operator: string): unknown[] {
  let branches: unknown[] = [];
  for (let side of [node.left, node.right]) {
    let binary = asBinary(side);
    if (binary?.operator === operator) {
      branches.push(...flatten(binary, operator));
    } else {
      branches.push(side);
    }
  }
  return branches;
}

// Why a comparison's two sides are not a field and a constant.
function operandProblem(left: unknown, right: unknown): string {
  for (let side of [left, right]) {
    let binary = asBinary(side);
    if (binary && ['+', '-', '*', '/', '%'].includes(binary.operator)) {
      return `\`${binary.operator}\` is arithmetic, which a filter cannot do`;
    }
    if (binary?.operator === '//') {
      return '`//` supplies a default value, which a filter cannot do';
    }
  }
  if (asFieldPath(left) && asFieldPath(right)) {
    return 'both sides are fields, and a filter compares a field only with a constant';
  }
  if (!asFieldPath(left) && !asFieldPath(right)) {
    return 'neither side is a field of the card';
  }
  return `${describeNode(asFieldPath(left) ? right : left)} is not a constant`;
}

function notAPredicate(node: unknown): string {
  if (isNode(node) && node.type === 'if') {
    return 'a filter has no conditional, and `if` is one';
  }
  if (asPath(node)) {
    return `${describeNode(node)} is a field, not a condition; compare it with a value`;
  }
  return `${describeNode(node)} is not a comparison, a membership test, or a combination of those with \`and\`, \`or\` and \`not\``;
}

function describeNode(node: unknown): string {
  if (!isNode(node)) {
    return 'the expression';
  }
  let parts = asPath(node);
  if (parts) {
    let names = parts.map((part) =>
      part.type === 'field' ? `.${String(part.key)}` : '[…]',
    );
    return names.length > 0 ? `\`${names.join('')}\`` : '`.`';
  }
  if (node.type === 'call') {
    return `\`${String(node.name)}(…)\``;
  }
  if (node.type === 'literal') {
    return `the ${String(node.valueType)} literal`;
  }
  return `the ${node.type} expression`;
}

function describeConstant(constant: Constant): string {
  switch (constant.kind) {
    case 'number':
      return `the number ${constant.value}`;
    case 'null':
      return '`null`';
    case 'string':
      return typeof constant.value === 'string'
        ? `the string ${JSON.stringify(constant.value)}`
        : '`actor()`';
  }
}

// Own properties only: a field named `constructor` is not the object's
// constructor.
function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function nameOf(definition: Definition): string {
  let { codeRef } = definition;
  return 'name' in codeRef && typeof codeRef.name === 'string'
    ? codeRef.name
    : 'the type';
}
