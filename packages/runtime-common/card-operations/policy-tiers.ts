import type { ResolvedCodeRef } from '../code-ref.ts';
import { isResolvedCodeRef } from '../card-document-shape.ts';
import type { Definition, FieldDefinition } from '../definitions.ts';

// ============================================================================
// Which tier a policy predicate reads.
//
// A predicate reads one of three tiers of a card, and a stale read here is an
// authorization decision rather than a value on a screen:
//
// - Tier 0, the card's stored source: its own scalars, contained values and
//   relationship links. As fresh as the last write.
// - Tier 1, the card's computed values, which only the index holds, in the
//   card's `pristine_doc`.
// - Tier 2, the fields of the cards it links to, which only the index holds,
//   denormalized into the card's `search_doc` for a link marked `searchable`.
//
// The gate reads Tier 0 unless a predicate says otherwise. A predicate that
// reads Tier 1 or 2 has to be annotated `snapshot: true`, and is then judged
// against the snapshot: the stored source with the index's values laid under
// it. The index lags the stored source, so such a grant is a window measured in
// index latency. Take someone off a roster that a computed value reads, and the
// grant keeps admitting them until the card is indexed again. An annotation is
// how an author accepts that window. Without one, the predicate would read the
// stored source, find nothing where the computed value would be, and decide
// on that, which no author means.
//
// This module answers, from the predicate and the rule's type alone, which
// tier the predicate reads. It does so when the policy compiles, so a problem
// reaches the policy's author, not a caller.
//
// What the snapshot holds (see `snapshotInput` in `gate.ts`), and so what an
// annotated predicate can read:
//
// - A computed value on the card itself, or inside a single contained value.
//   Nothing is laid inside a list the card stores: a position in a list is
//   an identity only while nothing moves, and the index's copy cannot say
//   which of the card's items it meant.
// - The fields of the card a single link on the card itself points to, when
//   the link is marked `searchable`, and only while the stored link names the
//   card the index expanded.
//
// A read of anything else outside the stored source is one no snapshot holds:
// the fields behind a list of links, behind a link not marked `searchable`,
// behind a link inside a contained value or a linked card, a computed value
// inside a list, or a relationship a query fills. The annotation cannot supply
// those, so such a predicate is recorded whether or not it is annotated.
//
// The walk is conservative in one direction only. Where it cannot tell which
// field a value comes from, it counts the value as possibly any value beneath
// the one it came from. So it can find a Tier 1 read in a predicate that makes
// none, which leaves the grant inactive until its author annotates it or
// rewrites it. It never finds Tier 0 where the predicate reads more.
// ============================================================================

export interface PredicateTierRead {
  // The field the predicate reads, as a dotted path from the card.
  path: string;
  // Why that read is not Tier 0, or why no snapshot holds it.
  reason: string;
}

export interface PredicateTiers {
  // The first read of a Tier 1 or Tier 2 value the snapshot holds. Absent for
  // a predicate that reads the stored source alone.
  snapshot?: PredicateTierRead;
  // The first read of a value outside the stored source that no snapshot
  // holds.
  unheld?: PredicateTierRead;
}

export interface PredicateTierEnvironment {
  // The definition of a type a predicate's path crosses into, or undefined
  // when there is none.
  lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition | undefined>;
}

// Which tiers a predicate, as BXL's `policy` profile parsed it, reads of a
// card whose type is `definition`.
export async function classifyPredicateTiers(
  body: unknown,
  definition: Definition,
  env: PredicateTierEnvironment,
): Promise<PredicateTiers> {
  let walk = new TierWalk(definition, env);
  await walk.evaluate(body, [walk.card], new Map());
  return walk.tiers;
}

// ----------------------------------------------------------------------------
// Where a value comes from.
// ----------------------------------------------------------------------------

type Place = CardPlace | OpaquePlace | BuiltPlace | ForeignPlace;

// A value that is not the card's: a literal, the caller, a realm setting, or
// anything computed from those alone.
interface ForeignPlace {
  kind: 'foreign';
}

const FOREIGN: ForeignPlace = { kind: 'foreign' };

// A value the walk cannot place, which may be any value beneath `under`. Using
// one in any way reads everything beneath `under`.
interface OpaquePlace {
  kind: 'opaque';
  under: Place[];
}

// An array or object the predicate built. `fields` holds what each key it
// wrote names, where the key is written as a constant. `computedKeys` marks an
// object with a key the predicate computed, whose fields could be any of its
// values.
interface BuiltPlace {
  kind: 'built';
  inner: Place[];
  fields: Map<string, Place[]>;
  computedKeys?: true;
}

// A value of the card: the card itself, one of its fields, or a value beneath
// one.
interface CardPlace {
  kind: 'card';
  // Dotted, from the card. Empty for the card itself.
  path: string;
  // What a field of this value resolves against: the card's definition, a
  // contained value's, or a linked card's. Absent for a primitive value, and
  // for a compound value whose type has no definition.
  definition?: Definition;
  // The value is a compound or a link, so reading it whole reads what is
  // beneath it.
  compound: boolean;
  // The value is a list the card holds, rather than one item of it.
  list: boolean;
  // The tier the value comes from.
  tier: 0 | 1 | 2;
  // Why the value is not Tier 0.
  tierReason?: string;
  // Why no snapshot holds the value. Absent where one does, which it does for
  // every Tier 0 value.
  unheld?: string;
  // Beneath a list the card stores, where nothing is laid.
  inList: boolean;
  // Reached through `instance()`, which holds the card's stored attributes
  // and nothing else: no computed value, no relationship.
  attributesOnly: boolean;
  // The card itself, as opposed to a value beneath it.
  root: boolean;
  // For a link: whether the snapshot holds the fields of the card it links
  // to, or why not.
  link?: { membersUnheld?: string };
}

// ----------------------------------------------------------------------------
// The builtins.
//
// A call's filter arguments are expressions over some input, and what that
// input is decides which field a path in one reads. For most builtins it is
// the call's own input. For some it is each item of that input, or the output
// of another argument. For a few it is something the walk cannot place: a
// value beneath the input (`walk`, `recurse`, `paths`), the entries of an
// object (`with_entries`), or the builtin's own previous output (`until`).
//
// Every jq-defined builtin with a filter argument is named here, in one of the
// tables, so none is taken for the default by omission: the default reads a
// filter argument over the call's own input, which is right for a native
// builtin and for a value argument, and wrong for the rest.
// ----------------------------------------------------------------------------

type ArgInput =
  // The call's own input.
  | 'input'
  // Each item of the call's input.
  | 'items'
  // A value the walk cannot place.
  | 'anywhere'
  // The outputs of the first argument.
  | 'first-arg';

type Result =
  // The call's input, or some of it.
  | 'input'
  // Items of the call's input.
  | 'items'
  // The outputs of the last argument.
  | 'last-arg'
  // A list of the outputs of the only argument.
  | 'list-of-arg'
  // A value computed from nothing of the card: a boolean or a count.
  | 'scalar';

interface Builtin {
  args: ArgInput[];
  result: Result;
  // How the call reads its input beyond its arguments. `truthiness` asks only
  // whether the input is null or false, `items` compares the input's items
  // whole, and `size` counts it. Absent where it reads nothing of it.
  reads?: 'truthiness' | 'items' | 'size';
  // Arguments whose outputs are compared whole, or tested for truth.
  compares?: number[];
  tests?: number[];
}

const BUILTINS: ReadonlyMap<string, Builtin> = new Map<string, Builtin>([
  ['map/1', { args: ['items'], result: 'list-of-arg' }],
  ['select/1', { args: ['input'], result: 'input', tests: [0] }],
  ['any/1', { args: ['items'], result: 'scalar', tests: [0] }],
  ['all/1', { args: ['items'], result: 'scalar', tests: [0] }],
  ['any/2', { args: ['input', 'first-arg'], result: 'scalar', tests: [1] }],
  ['all/2', { args: ['input', 'first-arg'], result: 'scalar', tests: [1] }],
  ['any/0', { args: [], result: 'scalar', reads: 'items' }],
  ['all/0', { args: [], result: 'scalar', reads: 'items' }],
  ['sort_by/1', { args: ['items'], result: 'items', compares: [0] }],
  ['group_by/1', { args: ['items'], result: 'items', compares: [0] }],
  ['unique_by/1', { args: ['items'], result: 'items', compares: [0] }],
  ['min_by/1', { args: ['items'], result: 'items', compares: [0] }],
  ['max_by/1', { args: ['items'], result: 'items', compares: [0] }],
  ['sort/0', { args: [], result: 'items', reads: 'items' }],
  ['unique/0', { args: [], result: 'items', reads: 'items' }],
  ['min/0', { args: [], result: 'items', reads: 'items' }],
  ['max/0', { args: [], result: 'items', reads: 'items' }],
  ['first/0', { args: [], result: 'items' }],
  ['last/0', { args: [], result: 'items' }],
  ['nth/1', { args: ['input'], result: 'items', compares: [0] }],
  ['first/1', { args: ['input'], result: 'last-arg' }],
  ['last/1', { args: ['input'], result: 'last-arg' }],
  ['limit/2', { args: ['input', 'input'], result: 'last-arg', compares: [0] }],
  ['skip/2', { args: ['input', 'input'], result: 'last-arg', compares: [0] }],
  ['nth/2', { args: ['input', 'input'], result: 'last-arg', compares: [0] }],
  ['isempty/1', { args: ['input'], result: 'scalar' }],
  ['length/0', { args: [], result: 'scalar', reads: 'size' }],
  ['utf8bytelength/0', { args: [], result: 'scalar', reads: 'size' }],
  ['not/0', { args: [], result: 'scalar', reads: 'truthiness' }],
  ['type/0', { args: [], result: 'scalar', reads: 'truthiness' }],
  ['IN/1', { args: ['input'], result: 'scalar', compares: [0] }],
  ['IN/2', { args: ['input', 'input'], result: 'scalar', compares: [0, 1] }],
  ['error/1', { args: ['input'], result: 'scalar', compares: [0] }],
  ['empty/0', { args: [], result: 'scalar' }],
  ['range/1', { args: ['input'], result: 'scalar', compares: [0] }],
  ['range/2', { args: ['input', 'input'], result: 'scalar', compares: [0, 1] }],
  [
    'range/3',
    {
      args: ['input', 'input', 'input'],
      result: 'scalar',
      compares: [0, 1, 2],
    },
  ],
]);

// jq-defined builtins whose filter arguments run somewhere the walk cannot
// place. Each reads its input whole, and its result is opaque.
export const FILTER_ARGUMENTS_RUN_ANYWHERE: ReadonlySet<string> = new Set([
  'add/1',
  'del/1',
  '_assign/2',
  '_modify/2',
  'map_values/1',
  'recurse/1',
  'recurse/2',
  'with_entries/1',
  'paths/1',
  'while/2',
  'until/2',
  'repeat/1',
  'combinations/1',
  'walk/1',
  'pick/1',
  'truncate_stream/1',
  'fromstream/1',
  'debug/1',
  'INDEX/1',
  'JOIN/2',
  'JOIN/3',
  'JOIN/4',
  'sub/2',
  'sub/3',
  'gsub/2',
  'gsub/3',
  'splits/2',
  'split/2',
  'match/2',
  'test/2',
  'capture/2',
  '_nwise/2',
  'in/1',
  'inside/1',
]);

// jq-defined builtins whose filter arguments all run over the call's own
// input, which is the default. Named so that every jq-defined builtin with a
// filter argument is in a table here: the Excel conditionals, which evaluate
// their branches lazily over the formula's input, and the helpers built the
// same way.
export const FILTER_ARGUMENTS_RUN_ON_INPUT: ReadonlySet<string> = new Set([
  'IF/2',
  'IF/3',
  'IFS/4',
  'IFS/6',
  'IFS/8',
  'IFS/10',
  'IFS/12',
  'IFS/14',
  'IFS/16',
  'IFERROR/2',
  'IFNA/2',
  'ISERROR/1',
  'ISNA/1',
  'ISERR/1',
  'ERROR_TYPE/1',
  'INDEX/2',
  'INDEX/3',
  'present/1',
  'when/2',
  'implies/2',
  'words/1',
  'nonempty/1',
  'overlaps/1',
]);

// Every jq-defined builtin with a filter argument that one of the tables
// above names. The drift test holds this against BXL's registry.
export function classifiedFilterBuiltins(): Set<string> {
  return new Set([
    ...BUILTINS.keys(),
    ...FILTER_ARGUMENTS_RUN_ANYWHERE,
    ...FILTER_ARGUMENTS_RUN_ON_INPUT,
  ]);
}

// An Excel formula computes from its arguments and never reads its input, so
// a formula called on the card reads only what its arguments name.
const FORMULA_NAME = /^[A-Z][A-Z0-9_.]*$/;

// ----------------------------------------------------------------------------
// The walk.
// ----------------------------------------------------------------------------

type Variables = Map<string, Place[]>;

class TierWalk {
  readonly tiers: PredicateTiers = {};
  readonly card: CardPlace;
  #env: PredicateTierEnvironment;
  #definitions = new Map<string, Promise<Definition | undefined>>();

  constructor(definition: Definition, env: PredicateTierEnvironment) {
    this.#env = env;
    this.card = {
      kind: 'card',
      path: '',
      definition,
      compound: true,
      list: false,
      tier: 0,
      inList: false,
      attributesOnly: false,
      root: true,
    };
  }

  // What `node` produces, from each value in `input`.
  async evaluate(
    node: unknown,
    input: Place[],
    variables: Variables,
  ): Promise<Place[]> {
    if (!isNode(node)) {
      return [];
    }
    switch (node.type) {
      case 'literal':
        if (node.valueType === 'interpolated-string') {
          for (let part of asArray(node.parts)) {
            if (typeof part !== 'string') {
              await this.readWhole(await this.evaluate(part, input, variables));
            }
          }
        }
        return [FOREIGN];
      case 'path':
        return await this.path(asArray(node.parts), input, variables);
      case 'contextPath':
      case 'format':
        if (node.type === 'format') {
          await this.readWhole(input);
        }
        return [FOREIGN];
      case 'variable':
        return variables.get(String(node.name)) ?? [FOREIGN];
      case 'recursiveDescent':
        return [opaque(input)];
      case 'call':
        return await this.call(node, input, variables);
      case 'binary':
        return await this.binary(node, input, variables);
      case 'unary': {
        let operand = await this.evaluate(node.expr, input, variables);
        return [opaque(operand)];
      }
      case 'if': {
        let results: Place[] = [];
        let branches = [
          { cond: node.cond, then: node.then },
          ...asArray(node.elifs).map((branch) => branch as AstNode),
        ];
        for (let branch of branches) {
          await this.test(await this.evaluate(branch.cond, input, variables));
          results.push(...(await this.evaluate(branch.then, input, variables)));
        }
        results.push(
          ...(node.else === undefined
            ? input
            : await this.evaluate(node.else, input, variables)),
        );
        return results;
      }
      case 'try': {
        let results = await this.evaluate(node.body, input, variables);
        if (node.catch !== undefined) {
          results.push(
            ...(await this.evaluate(node.catch, [FOREIGN], variables)),
          );
        }
        return results;
      }
      case 'array':
        return [
          {
            kind: 'built',
            inner:
              node.expr === undefined
                ? []
                : await this.evaluate(node.expr, input, variables),
            fields: new Map(),
          },
        ];
      case 'object':
        return [await this.object(asArray(node.entries), input, variables)];
      case 'index': {
        let base = await this.evaluate(node.expr, input, variables);
        return await this.index(base, node.index, input, variables);
      }
      case 'slice': {
        let base = await this.evaluate(node.expr, input, variables);
        for (let bound of [node.from, node.to]) {
          if (bound !== undefined) {
            await this.readWhole(await this.evaluate(bound, input, variables));
          }
        }
        return base;
      }
      case 'iterator':
        return this.items(await this.evaluate(node.expr, input, variables));
      case 'binding': {
        let bound = await this.evaluate(node.expr, input, variables);
        let names = asArray(node.names).map(String);
        let next = new Map(variables);
        for (let name of names) {
          // A destructuring pattern binds parts of the value, which the walk
          // does not follow.
          next.set(name, names.length === 1 ? bound : [opaque(bound)]);
        }
        return await this.evaluate(node.next, input, next);
      }
      case 'label':
        return await this.evaluate(node.next, input, variables);
      case 'break':
        return [];
      default:
        // `def`, `reduce` and `foreach` are refused by the `policy` profile.
        // Anything else reached here is read as possibly anything beneath its
        // input.
        return await this.anywhere(childNodesOf(node), input, variables);
    }
  }

  async path(
    parts: unknown[],
    input: Place[],
    variables: Variables,
  ): Promise<Place[]> {
    let current = input;
    for (let part of parts) {
      if (!isNode(part)) {
        continue;
      }
      switch (part.type) {
        case 'field':
          current = await this.fields(current, String(part.key));
          break;
        case 'index':
          current = this.items(current);
          break;
        case 'dynamic-index':
          current = await this.index(current, part.expr, input, variables);
          break;
        case 'iterator':
          current = this.items(current);
          break;
        case 'slice':
          for (let bound of [part.from, part.to]) {
            if (bound !== undefined) {
              await this.readWhole(
                await this.evaluate(bound, input, variables),
              );
            }
          }
          break;
        default:
          current = [opaque(current)];
      }
    }
    return current;
  }

  // `base[index]`, where `index` is the expression in the brackets or a key
  // written as a string. A constant key reads that field, a number an item,
  // and anything else any item or field.
  async index(
    base: Place[],
    index: unknown,
    input: Place[],
    variables: Variables,
  ): Promise<Place[]> {
    if (typeof index === 'string') {
      return await this.fields(base, index);
    }
    if (isNode(index) && index.type === 'literal') {
      if (index.valueType === 'string' && typeof index.value === 'string') {
        return await this.fields(base, index.value);
      }
      if (index.valueType === 'number') {
        return this.items(base);
      }
    }
    await this.readWhole(await this.evaluate(index, input, variables));
    return base.map((place) =>
      place.kind === 'card' && (place.list || !place.compound)
        ? itemOf(place)
        : opaque([place]),
    );
  }

  async object(
    entries: unknown[],
    input: Place[],
    variables: Variables,
  ): Promise<Place> {
    let built: BuiltPlace = { kind: 'built', inner: [], fields: new Map() };
    for (let entry of entries) {
      let { key, value } = entry as { key?: unknown; value?: unknown };
      let values: Place[];
      if (value === undefined) {
        // `{name}` is `{name: .name}`, and `{$name}` is `{name: $name}`.
        let name = String(key);
        values = name.startsWith('$')
          ? (variables.get(name) ?? [FOREIGN])
          : await this.fields(input, name);
        key = name.replace(/^\$/, '');
      } else {
        values = await this.evaluate(value, input, variables);
      }
      if (typeof key === 'string') {
        built.fields.set(key, [...(built.fields.get(key) ?? []), ...values]);
      } else {
        await this.readWhole(await this.evaluate(key, input, variables));
        built.computedKeys = true;
      }
      built.inner.push(...values);
    }
    return built;
  }

  async binary(
    node: AstNode,
    input: Place[],
    variables: Variables,
  ): Promise<Place[]> {
    let operator = String(node.operator);
    if (operator === '|') {
      let left = await this.evaluate(node.left, input, variables);
      return await this.evaluate(node.right, left, variables);
    }
    if (ASSIGNMENTS.has(operator)) {
      // `.a |= f` runs `f` over what `.a` holds; every other assignment runs
      // its right side over the input. The result is the input, changed.
      let target = await this.evaluate(node.left, input, variables);
      let value = await this.evaluate(
        node.right,
        operator === '|=' ? target : input,
        variables,
      );
      return [opaque([...input, ...target, ...value])];
    }
    let left = await this.evaluate(node.left, input, variables);
    let right = await this.evaluate(node.right, input, variables);
    switch (operator) {
      case ',':
        return [...left, ...right];
      case 'and':
      case 'or':
        await this.test(left);
        await this.test(right);
        return [FOREIGN];
      case '//':
        await this.test(left);
        return [...left, ...right];
      case '==':
      case '!=':
        // Compared with `null`, a value is asked only whether it is there,
        // which the snapshot answers as the stored source does.
        if (isNullLiteral(node.left) || isNullLiteral(node.right)) {
          await this.test(left);
          await this.test(right);
          return [FOREIGN];
        }
        await this.readWhole(left);
        await this.readWhole(right);
        return [FOREIGN];
      case '<':
      case '<=':
      case '>':
      case '>=':
        await this.readWhole(left);
        await this.readWhole(right);
        return [FOREIGN];
      default:
        return [opaque([...left, ...right])];
    }
  }

  async call(
    node: AstNode,
    input: Place[],
    variables: Variables,
  ): Promise<Place[]> {
    let name = String(node.name);
    let args = asArray(node.args);
    let key = `${name}/${args.length}`;
    switch (key) {
      case 'actor/0':
      case 'realmConfig/0':
      case 'params/0':
        return [FOREIGN];
      case 'realmConfig/1':
      case 'params/1':
        await this.readWhole(await this.evaluate(args[0], input, variables));
        return [FOREIGN];
      case 'instance/0':
        return [this.instance()];
      case 'instance/1':
        return await this.index([this.instance()], args[0], input, variables);
      case 'has/1':
        return await this.has(args[0], input, variables);
    }
    let builtin = BUILTINS.get(key);
    if (builtin) {
      return await this.modeled(builtin, args, input, variables);
    }
    if (FILTER_ARGUMENTS_RUN_ANYWHERE.has(key)) {
      await this.readWhole(input);
      return await this.anywhere(args, input, variables);
    }
    let outputs: Place[] = [];
    for (let arg of args) {
      outputs.push(...(await this.evaluate(arg, input, variables)));
    }
    if (FORMULA_NAME.test(name)) {
      return [opaque(outputs)];
    }
    await this.readWhole(input);
    return [opaque([...input, ...outputs])];
  }

  async modeled(
    builtin: Builtin,
    args: unknown[],
    input: Place[],
    variables: Variables,
  ): Promise<Place[]> {
    let items = this.items(input);
    let outputs: Place[][] = [];
    for (let [index, arg] of args.entries()) {
      let over =
        builtin.args[index] === 'items'
          ? items
          : builtin.args[index] === 'first-arg'
            ? (outputs[0] ?? [])
            : builtin.args[index] === 'anywhere'
              ? [opaque(input)]
              : input;
      outputs.push(await this.evaluate(arg, over, variables));
    }
    for (let index of builtin.compares ?? []) {
      await this.readWhole(outputs[index] ?? []);
    }
    for (let index of builtin.tests ?? []) {
      await this.test(outputs[index] ?? []);
    }
    switch (builtin.reads) {
      case 'truthiness':
        await this.test(input);
        break;
      case 'items':
        await this.readWhole(items);
        break;
      case 'size':
        await this.readSize(input);
        break;
    }
    switch (builtin.result) {
      case 'input':
        return input;
      case 'items':
        return items;
      case 'last-arg':
        return outputs[outputs.length - 1] ?? [];
      case 'list-of-arg':
        return [{ kind: 'built', inner: outputs[0] ?? [], fields: new Map() }];
      case 'scalar':
        return [FOREIGN];
    }
  }

  // `has(key)` asks whether a value holds a key. For a constant key on the
  // card, that is a read of the field it names: whether a computed field is
  // there is a question only the snapshot answers.
  async has(
    key: unknown,
    input: Place[],
    variables: Variables,
  ): Promise<Place[]> {
    if (
      isNode(key) &&
      key.type === 'literal' &&
      key.valueType === 'string' &&
      typeof key.value === 'string'
    ) {
      await this.fields(input, key.value);
      await this.test(input);
      return [FOREIGN];
    }
    await this.readWhole(await this.evaluate(key, input, variables));
    await this.readWhole(input);
    return [FOREIGN];
  }

  // A construct the walk does not follow: every expression under it is read
  // over its input and over anything beneath it, and so is its result.
  async anywhere(
    nodes: unknown[],
    input: Place[],
    variables: Variables,
  ): Promise<Place[]> {
    let beneath = [opaque(input)];
    let outputs: Place[] = [];
    for (let node of nodes) {
      outputs.push(...(await this.evaluate(node, input, variables)));
      outputs.push(...(await this.evaluate(node, beneath, variables)));
    }
    return [opaque([...input, ...outputs])];
  }

  // `instance()`: the card's id and its stored attributes.
  instance(): CardPlace {
    return { ...this.card, attributesOnly: true };
  }

  // ------------------------------------------------------------------------
  // Reading a field, an item, or a whole value.
  // ------------------------------------------------------------------------

  async fields(places: Place[], name: string): Promise<Place[]> {
    let results: Place[] = [];
    for (let place of places) {
      results.push(...(await this.field(place, name)));
    }
    return results;
  }

  async field(place: Place, name: string): Promise<Place[]> {
    switch (place.kind) {
      case 'foreign':
        return [FOREIGN];
      case 'opaque':
        await this.readWhole(place.under);
        return [place];
      case 'built':
        return place.computedKeys
          ? place.inner
          : (place.fields.get(name) ?? [FOREIGN]);
    }
    let path = place.path ? `${place.path}.${name}` : name;
    if (place.link) {
      // A link holds the id of the card it points to. Every other field is
      // that card's, which only the index holds.
      if (name === 'id') {
        return [{ ...leaf(place, path), link: undefined }];
      }
      let definition = place.definition;
      let field = definition ? immediateField(definition, name) : undefined;
      if (definition && !field) {
        return [FOREIGN];
      }
      let linked: CardPlace = {
        ...place,
        link: undefined,
        tier: 2,
        tierReason: `\`.${path}\` is a field of the card \`.${place.path}\` links to`,
        unheld: place.unheld ?? place.link.membersUnheld,
      };
      return [await this.child(linked, path, field)];
    }
    if (!place.definition) {
      if (!place.compound) {
        return [FOREIGN];
      }
      return [
        this.record({
          ...leaf(place, path),
          compound: true,
          unheld:
            place.unheld ??
            `the type of \`.${place.path}\` has no definition, so what \`.${path}\` reads cannot be told`,
        }),
      ];
    }
    let field = immediateField(place.definition, name);
    if (!field) {
      return [FOREIGN];
    }
    return [await this.child(place, path, field)];
  }

  // The field at `path` of the compound value at `parent`.
  async child(
    parent: CardPlace,
    path: string,
    field: FieldDefinition | undefined,
  ): Promise<Place> {
    let place: CardPlace = {
      ...parent,
      path,
      root: false,
      link: undefined,
      list: false,
      definition: undefined,
      compound: false,
    };
    if (!field) {
      // A field of a linked card whose type has no definition.
      return this.record({ ...place, compound: true });
    }
    if (parent.attributesOnly) {
      if (field.isComputed) {
        return this.record({
          ...place,
          tier: 1,
          tierReason: `\`.${path}\` is computed`,
          unheld: `\`instance()\` holds the card's stored attributes, which never carry a computed value such as \`.${path}\`; read it as \`.${path}\``,
        });
      }
      if (field.type === 'linksTo' || field.type === 'linksToMany') {
        // `instance()` holds no relationship, so this reads nothing in any
        // tier.
        return FOREIGN;
      }
    }
    if (field.query) {
      return this.record({
        ...place,
        compound: true,
        tier: Math.max(parent.tier, 1) as 1 | 2,
        tierReason: parent.tierReason ?? `\`.${path}\` is filled by a query`,
        unheld: `\`.${path}\` is filled by a query, which no snapshot the gate reads holds`,
      });
    }
    if (field.isComputed && parent.tier === 0) {
      place.tier = 1;
      place.tierReason = `\`.${path}\` is computed`;
      if (parent.inList) {
        place.unheld = `\`.${path}\` is computed inside a list, and the index's copy of a list cannot say which of the card's items it describes`;
      }
    }
    let plural = field.type === 'containsMany' || field.type === 'linksToMany';
    place.list = plural;
    if (field.type === 'linksTo' || field.type === 'linksToMany') {
      place.compound = true;
      place.definition = await this.lookup(field.fieldOrCard);
      place.link = {
        membersUnheld:
          place.tier === 2
            ? `\`.${path}\` is a link of a linked card, and the index carries only its id`
            : place.tier === 1
              ? `\`.${path}\` is a computed link, and the index does not carry the fields of the card it points to`
              : !parent.root
                ? `\`.${path}\` is a link inside a contained value, and the index does not carry the fields of the card it points to`
                : field.type === 'linksToMany'
                  ? `\`.${path}\` is a list of links, and the index's copy of a list cannot say which of the card's links it describes`
                  : field.searchable == null
                    ? `\`.${path}\` is not marked \`searchable\`, so the index does not carry the fields of the card it points to`
                    : undefined,
      };
    } else if (!field.isPrimitive) {
      place.compound = true;
      place.definition = await this.lookup(field.fieldOrCard);
      place.inList ||= field.type === 'containsMany';
    }
    return place.tier > 0 ? this.record(place) : place;
  }

  // The items of each value: an item of a list, or, for a value that is not a
  // list, any of its fields.
  items(places: Place[]): Place[] {
    return places.map((place) => {
      switch (place.kind) {
        case 'foreign':
          return place;
        case 'opaque':
          return place;
        case 'built':
          return opaque(place.inner);
        case 'card':
          return place.list || !place.compound
            ? itemOf(place)
            : opaque([place]);
      }
    });
  }

  // Whether each value is null or false. A value of the card answers that the
  // same way whether or not the snapshot is laid under it: the snapshot fills
  // no value the stored source leaves empty but a computed one, and the
  // fields of a linked card only where the stored link is there.
  async test(places: Place[]): Promise<void> {
    for (let place of places) {
      // An array or object the predicate built is never null or false.
      if (place.kind === 'opaque') {
        await this.readWhole(place.under);
      }
    }
  }

  // How many keys or items each value holds. A list counts the items the card
  // stores, which the snapshot never adds to, and a string counts characters.
  async readSize(places: Place[]): Promise<void> {
    for (let place of places) {
      if (place.kind === 'card' && (place.list || !place.compound)) {
        continue;
      }
      await this.readWhole([place]);
    }
  }

  // Each value, read whole: everything beneath it.
  //
  // Only what the snapshot would change is recorded. Beneath a list, beneath
  // a Tier 1 or Tier 2 value, and through `instance()`, the stored source and
  // the snapshot hold the same thing, or the read that reached the value was
  // recorded already. So the walk descends into the card and its single
  // contained values, recording each computed value and each link whose
  // linked card the snapshot fills in.
  async readWhole(places: Place[], seen = new Set<Place>()): Promise<void> {
    for (let place of places) {
      if (seen.has(place)) {
        continue;
      }
      seen.add(place);
      switch (place.kind) {
        case 'foreign':
          continue;
        case 'opaque':
          await this.readWhole(place.under, seen);
          continue;
        case 'built':
          await this.readWhole(place.inner, seen);
          continue;
      }
      if (
        !place.compound ||
        place.tier > 0 ||
        place.inList ||
        place.attributesOnly
      ) {
        continue;
      }
      if (place.link) {
        if (!place.list && !place.link.membersUnheld) {
          this.record({
            ...place,
            path: `${place.path}.*`,
            tier: 2,
            tierReason: `\`.${place.path}\` is read whole, and the index fills in the card it links to`,
          });
        }
        continue;
      }
      await this.readCompound(place, place.definition, new Set());
    }
  }

  // Everything beneath a card or a single contained value that the snapshot
  // lays under the stored source.
  async readCompound(
    place: CardPlace,
    definition: Definition | undefined,
    // The types of the values this one is contained in, which a type that
    // contains itself would otherwise walk forever.
    within: Set<Definition>,
  ): Promise<void> {
    if (!definition) {
      this.record({
        ...place,
        unheld: `the type of \`.${place.path}\` has no definition, so what reading it whole reads cannot be told`,
      });
      return;
    }
    if (within.has(definition)) {
      return;
    }
    let nested = new Set(within).add(definition);
    for (let name of Object.keys(definition.fields)) {
      let field = immediateField(definition, name);
      if (!field || field.query) {
        // A relationship a query fills is in neither the stored source nor
        // the snapshot, so reading it whole reads the same in both.
        continue;
      }
      let path = place.path ? `${place.path}.${name}` : name;
      if (field.isComputed) {
        this.record({
          ...leaf(place, path),
          tier: 1,
          tierReason: `${dotted(place.path)} is read whole, and \`.${path}\` beneath it is computed`,
        });
      } else if (
        field.type === 'linksTo' &&
        place.root &&
        field.searchable != null
      ) {
        this.record({
          ...leaf(place, `${path}.*`),
          tier: 2,
          tierReason: `${dotted(place.path)} is read whole, and the index fills in the card \`.${path}\` links to`,
        });
      } else if (field.type === 'contains' && !field.isPrimitive) {
        await this.readCompound(
          { ...leaf(place, path), compound: true },
          await this.lookup(field.fieldOrCard),
          nested,
        );
      }
    }
  }

  // Note what a read of a value outside the stored source says.
  record(place: CardPlace): CardPlace {
    let read = (reason: string) => ({ path: place.path, reason });
    if (place.unheld) {
      this.tiers.unheld ??= read(place.unheld);
    } else if (place.tier > 0 && place.tierReason) {
      this.tiers.snapshot ??= read(place.tierReason);
    }
    return place;
  }

  lookup(codeRef: unknown): Promise<Definition | undefined> {
    if (!isResolvedCodeRef(codeRef as object)) {
      return Promise.resolve(undefined);
    }
    let resolved = codeRef as ResolvedCodeRef;
    let key = `${resolved.module}#${resolved.name}`;
    let found = this.#definitions.get(key);
    if (!found) {
      found = this.#env.lookupDefinition(resolved).catch(() => undefined);
      this.#definitions.set(key, found);
    }
    return found;
  }
}

const ASSIGNMENTS = new Set(['=', '|=', '+=', '-=', '*=', '/=', '%=', '//=']);

// A path as a predicate spells it, in backticks: `.address`, or `.` for the
// card itself.
function dotted(path: string): string {
  return path ? `\`.${path}\`` : '`.`';
}

function opaque(under: Place[]): OpaquePlace {
  return { kind: 'opaque', under };
}

// An item of the list at `place`, or the value itself where it is not a list.
function itemOf(place: CardPlace): CardPlace {
  return place.list ? { ...place, list: false } : place;
}

// A primitive value beneath `place`, at the same tier.
function leaf(place: CardPlace, path: string): CardPlace {
  return {
    ...place,
    path,
    root: false,
    definition: undefined,
    compound: false,
    list: false,
  };
}

function immediateField(
  definition: Definition,
  name: string,
): FieldDefinition | undefined {
  let id = Object.prototype.hasOwnProperty.call(definition.fields, name)
    ? definition.fields[name]
    : undefined;
  return id !== undefined &&
    Object.prototype.hasOwnProperty.call(definition.fieldDefs, id)
    ? definition.fieldDefs[id]
    : undefined;
}

// ----------------------------------------------------------------------------
// Reading BXL's AST, which reaches this module typed as nothing in
// particular.
// ----------------------------------------------------------------------------

type AstNode = { type: string } & Record<string, unknown>;

function isNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function isNullLiteral(node: unknown): boolean {
  return isNode(node) && node.type === 'literal' && node.valueType === 'null';
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// Every expression directly under a node, whatever its type.
function childNodesOf(node: AstNode): unknown[] {
  let children: unknown[] = [];
  for (let [key, value] of Object.entries(node)) {
    if (key === 'type') {
      continue;
    }
    for (let candidate of Array.isArray(value) ? value : [value]) {
      if (isNode(candidate)) {
        children.push(candidate);
      } else if (typeof candidate === 'object' && candidate !== null) {
        children.push(...Object.values(candidate).filter(isNode));
      }
    }
  }
  return children;
}
