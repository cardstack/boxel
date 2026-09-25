import { codeRefForDef, isResolvedCodeRef, type CodeRef } from '../code-ref.ts';
import { getImmediateFieldDef } from '../definitions.ts';
import type { Definition, FieldDefinition } from '../definitions.ts';
import {
  bxlFieldPath,
  bxlLiteral,
  bxlObjectKey,
  checkExpressionProgram,
  checkMutationProgram,
  paramKeysRead,
  callsActor,
  usesVolatileCall,
} from './bxl-emit.ts';
import { isBxl, isMarker, lowerQueryTemplate } from './query.ts';
import { isDefinitionFreeBaseOperation } from './types.ts';
import type {
  LowerOperationDeclarationsResult,
  OperationDefinition,
  OperationLoweringIssue,
  OperationLoweringIssueCode,
  OperationParamDefinition,
  OperationProgram,
  OperationTemplate,
} from './types.ts';
import type { BaseDef } from '@cardstack/base/card-api';
import type {
  BaseOperationName,
  OperationDeclaration,
} from '@cardstack/base/operations';

// ============================================================================
// Lowering `@operation` declarations to the data the realm executes.
//
// A declaration is authored against JavaScript: `params: { body: StringField }`
// names a class, `append: { to: 'comments', value: … }` names a convenience
// form, `of: ClassroomActivity` names another class. None of that survives the
// trip to a trusted process that must not load the card's module. Lowering
// translates it once, when the module's definition-cache entry is built:
//
//   append: { to: 'comments', value: { body: params('body'), author: params('author') } }
//     → append(.comments;{body:params("body"),author:card(params("author"))});
//
// Two things make that translation more than a syntax rewrite.
//
// **The target's shape decides how a value is written.** `author` in the
// example lands in a `linksTo` field, so the param lowers to a card identity —
// `card(params("author"))` — while the same marker in a scalar field lowers to
// `params("author")`. That is read off the declaring type's `fieldDefs` and,
// for a nested value, off the definitions its fields point at, which is the
// one thing here that does I/O: `lookupDefinition`.
//
// **A declaration can be wrong in ways only the type's shape reveals** — a
// field that does not exist, a write into a computed field or through a link,
// an assertion over values a program cannot see. Those are recorded as issues
// and never thrown: definition build happens long after the edit that
// introduced the problem, so a throw would fail a whole module's definitions
// at a confusing moment. An operation with issues is still stored, flagged
// `invalid`, so invoking it reports what is wrong with the declaration rather
// than "unknown operation".
//
// Nothing here touches a `VirtualNetwork` or a loader: `identifyCard` and
// `lookupDefinition` arrive as functions, and no card code runs.
// ============================================================================

export interface LoweringContext {
  // The type the operations are declared on, as its definition-cache entry.
  // Field paths in the clauses are rooted here, and `type` is what decides
  // which behaviors the type may build on at all.
  definition: Pick<Definition, 'type' | 'fields' | 'fieldDefs'>;
  // Resolves a code ref to its definition, for chasing a path into a
  // contained value or a linked card's type.
  lookupDefinition: (codeRef: CodeRef) => Promise<Definition | undefined>;
  // The code ref for a def class the declaration names. Passed in rather than
  // imported so lowering stays independent of any loader.
  identifyCard: (def: typeof BaseDef) => CodeRef | undefined;
}

// The shape a value is being lowered into. What a slot is decides how a typed
// reference is spelled: a card identity in a link slot, the raw builtin
// anywhere else.
type ValueSlot =
  // A single card identity.
  | { kind: 'link' }
  // A list of card identities.
  | { kind: 'links' }
  // A card identity being compared rather than written: the identity string
  // itself, not the `card(…)` projection a link slot writes.
  | { kind: 'identity' }
  // A single value the field's serializer understands.
  | { kind: 'scalar' }
  // A contained value, whose keys are the fields of `definition`.
  | { kind: 'object'; definition?: Definition }
  // A list of contained values.
  | { kind: 'objects'; definition?: Definition }
  // Nothing known about the slot, so the value is lowered as plain data. This
  // is where an unresolvable field or an already-reported problem lands, so
  // one bad path does not cascade into a second round of issues.
  | { kind: 'opaque' };

// One resolved segment of a dotted field path.
interface PathSegment {
  name: string;
  fieldDef: FieldDefinition;
}

interface ResolvedPath {
  segments: PathSegment[];
  // Why the path stopped short, when it did. `at` is the dotted prefix that
  // did resolve (empty when the very first segment failed), so a message can
  // name the type the missing segment was looked for on. `missing` means no
  // such field; `unreachable` means the segment before it has no type to
  // follow — a primitive, or a ref nothing resolves.
  unresolved?: {
    at: string;
    segment: string;
    reason: 'missing' | 'unreachable' | 'crosses-collection';
  };
}

const LINK_KINDS = ['linksTo', 'linksToMany'];
const PLURAL_KINDS = ['containsMany', 'linksToMany'];

// Which behaviors each def family may build an operation on, mirroring the
// authoring API's own division of them. A card reaches its JSON:API document,
// a file reaches its bytes, and a field is not addressable at all, so field
// data is reached through the operations of the card that contains it.
//
// `readSource` is carried by a card and a file and appears in neither list:
// the realm answers it without reading a definition, so nothing may be built
// on it — the refusal for that is its own, below.
//
// `field-def` is two families rather than one. The recorded kind is derived
// from the class, and every addressable def that is neither a card nor a file
// lands there alongside the fields: a def extending `BaseDef` directly is
// recorded `field-def` too, and that one carries the two reads. Reading only
// the entry, lowering cannot tell them apart, so it admits what either may
// declare — which is `read`, and nothing a field could put to use. Refusing a
// field its `read` is the authoring decorator's, which has the class in hand;
// refusing to dispatch one is dispatch's, which carries no operations at all
// for a field. Narrowing it here would instead flag a declaration the
// decorator accepted, leaving a def that can declare a `read` and never
// invoke it.
//
// Keyed by base operation rather than by kind, the way the authoring API's own
// table is. Keyed the other way this would be a `Record` of three keys whose
// values are free-form arrays, and a tenth base operation would compile clean
// here while silently defaulting to "carried by nothing" — declarable, then
// flagged on every entry that declares it, with nothing red to say so. This
// way the compiler asks where it belongs.
const DECLARABLE_BY: Record<BaseOperationName, readonly Definition['type'][]> =
  {
    read: ['card-def', 'file-def', 'field-def'],
    // Refused on its own path, above: the realm answers it without reading a
    // definition, so nothing may build on it. Present so the table stays
    // exhaustive.
    readSource: [],
    create: ['card-def'],
    update: ['card-def', 'file-def'],
    delete: ['card-def'],
    query: ['card-def'],
    transform: ['card-def'],
    appendContainsMany: ['card-def'],
    appendLine: ['file-def'],
  };

function declarableBases(
  kind: Definition['type'],
): readonly BaseOperationName[] {
  return (Object.keys(DECLARABLE_BY) as BaseOperationName[]).filter((base) =>
    DECLARABLE_BY[base].includes(kind),
  );
}

// How a finding names the kind it refused. `field-def` is the recorded kind for
// a bare `BaseDef` subclass as well as for a field, so it is described by what
// the entry actually says rather than asserted to be a field.
const DEF_KIND_LABELS: Record<Definition['type'], string> = {
  'card-def': 'card definition',
  'file-def': 'file definition',
  'field-def': 'definition recorded as a field',
};

// The bases that run no BXL program, so a `transformations` program stored for
// one would never be reached. Mirrors the authoring API's refusal of the same
// declaration. A file's `update` joins the two appends because it replaces the
// content wholesale, which is why the kind is read here too; the same base on
// a card is the declarative merge and does run one.
function runsNoProgram(base: BaseOperationName, kind: Definition['type']) {
  return (
    base === 'appendLine' ||
    base === 'appendContainsMany' ||
    (base === 'update' && kind === 'file-def')
  );
}

// Lower every declared operation on one type.
//
// `raw` is the authored view — `getDeclaredOperations`, not `getOperations`.
// A base operation reached with no declaration has nothing to lower, and the
// clause a base requires is only guaranteed present on an entry that went
// through the decorator.
export async function lowerOperationDeclarations(
  raw: Record<string, OperationDeclaration>,
  context: LoweringContext,
): Promise<LowerOperationDeclarationsResult> {
  let operations: Record<string, OperationDefinition> = {};
  let issues: OperationLoweringIssue[] = [];
  for (let name of Object.keys(raw)) {
    let sink = new IssueSink(name);
    if (isDefinitionFreeBaseOperation(name)) {
      // The realm answers these names without reading a definition, so a
      // stored operation under one would be dispatched straight past rather
      // than run. The authoring decorator refuses the name; refusing it here
      // too is what keeps it out of a type's entry, which outlives the code
      // that built it — a definition-cache row carries no code version and is
      // not re-derived until something invalidates it.
      let operation: OperationDefinition = {
        base: 'read',
        deterministic: true,
        invalid: true,
        issues: [
          {
            code: 'reserved-name',
            operation: name,
            path: name,
            message: `"${name}" is a reserved operation name — the realm serves it from the bytes stored at the target's URL and reads no definition to do so`,
          },
        ],
      };
      operations[name] = operation;
      issues.push(...operation.issues!);
      continue;
    }
    let refusal = baseRefusal(raw[name]?.base, context.definition.type);
    if (refusal) {
      // A behavior the def type does not carry leaves every clause pointing at
      // something that is not there, so there is nothing to lower against.
      // Stored all the same, flagged, so invoking it says what is wrong with
      // the declaration rather than that it does not exist.
      let operation: OperationDefinition = {
        base: raw[name].base,
        deterministic: true,
        invalid: true,
        issues: [
          {
            code: refusal.code,
            operation: name,
            path: 'base',
            message: refusal.message,
          },
        ],
      };
      operations[name] = operation;
      issues.push(...operation.issues!);
      continue;
    }
    let operation = await lowerOperation(raw[name], sink, context);
    if (sink.issues.length > 0) {
      operation.invalid = true;
      operation.issues = sink.issues;
      issues.push(...sink.issues);
    }
    operations[name] = operation;
  }
  return { operations, issues };
}

// Collects one operation's issues. Every check reports through this rather
// than throwing, so a single bad clause costs its own operation its validity
// and nothing else.
class IssueSink {
  readonly issues: OperationLoweringIssue[] = [];
  private operation: string;

  constructor(operation: string) {
    this.operation = operation;
  }

  add(code: OperationLoweringIssueCode, path: string, message: string) {
    this.issues.push({ code, operation: this.operation, path, message });
  }
}

// Why a def type cannot build an operation on this behavior, or undefined when
// it can.
//
// The authoring decorator refuses both of these at class-definition time, so
// nothing an author writes reaches here. It is checked again because a
// definition-cache entry outlives the code that built it and because this pass
// is exported over plain data: a stored entry naming a behavior its type does
// not carry would be dispatched to an executor the target has no surface for.
function baseRefusal(
  base: BaseOperationName | undefined,
  kind: Definition['type'],
): { code: OperationLoweringIssueCode; message: string } | undefined {
  if (base === undefined) {
    return undefined;
  }
  if (isDefinitionFreeBaseOperation(base)) {
    return {
      code: 'reserved-name',
      message: `a "${base}" serves the bytes stored at the target's URL, which the realm answers without reading a definition — so there is nothing for an operation to build on`,
    };
  }
  if (DECLARABLE_BY[base]?.includes(kind)) {
    return undefined;
  }
  let declarable = declarableBases(kind);
  return {
    code: 'base-not-carried',
    message: `a ${DEF_KIND_LABELS[kind]} carries ${quoteList(declarable)}, so it cannot build an operation on "${base}"`,
  };
}

function quoteList(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(', ');
}

async function lowerOperation(
  declaration: OperationDeclaration,
  sink: IssueSink,
  context: LoweringContext,
): Promise<OperationDefinition> {
  let base: BaseOperationName = declaration.base;
  let operation: OperationDefinition = { base, deterministic: true };
  let params = lowerParams(declaration.params, sink, context);
  if (params) {
    operation.params = params;
  }
  let paramNames = new Set(Object.keys(declaration.params ?? {}));

  if (declaration.optimistic !== undefined) {
    operation.optimistic = declaration.optimistic;
  }

  let { statements, snapshot } = await lowerClauses(
    declaration,
    paramNames,
    sink,
    context,
  );
  let rawProgram = (declaration as { transformations?: { $bxl: string } })
    .transformations;
  if (rawProgram && runsNoProgram(base, context.definition.type)) {
    sink.add(
      'unrunnable-program',
      'transformations',
      base === 'update'
        ? `an "update" on a file replaces its content wholesale rather than transforming a document, so this program would never be reached`
        : `an "${base}" operation appends to the stored file rather than running a program over a document, so this program would never be reached`,
    );
  } else if (rawProgram) {
    // An author's program is written in the readable spelling; canonicalizing
    // it here means the realm sees one program shape whichever spelling
    // produced it.
    let program = lowerProgram(
      rawProgram.$bxl,
      'readable',
      'transformations',
      paramNames,
      sink,
    );
    if (program) {
      operation.program = program;
    }
  } else if (statements.length > 0) {
    // The clauses' own values were checked as they were lowered, so the
    // assembled program needs no second pass over the same references.
    let program = lowerProgram(
      statements.join('\n'),
      'solidified',
      'program',
      undefined,
      sink,
    );
    if (program) {
      operation.program = program;
      if (snapshot) {
        operation.snapshot = true;
      }
    }
  }

  if (declaration.input) {
    let input = lowerExpression(
      declaration.input.$bxl,
      'input',
      paramNames,
      sink,
    );
    if (input) {
      operation.input = input;
    }
  }
  let output = await lowerOutput(declaration.output, paramNames, sink, context);
  if (output) {
    operation.output = output;
  }

  if (base === 'create') {
    await lowerCreate(
      declaration as { of?: unknown; fill?: Record<string, unknown> },
      paramNames,
      sink,
      context,
      operation,
    );
  }
  if (base === 'query') {
    let query = lowerQueryTemplate(
      (declaration as { query?: Record<string, unknown> }).query,
      sink,
      { codeRef: (value) => identify(value, context) },
    );
    if (query) {
      operation.query = query;
    }
  }
  if (base === 'appendContainsMany') {
    let items = await lowerAppendContainsMany(
      declaration as AppendContainsManyClauses,
      paramNames,
      sink,
      context,
    );
    if (items) {
      operation.items = items;
    }
  }

  operation.deterministic = [
    operation.program,
    operation.input,
    operation.output,
  ].every((program) => !program || !usesVolatileCall(program.source));

  if (readsActor(operation)) {
    operation.readsActor = true;
  }

  return operation;
}

// Whether anything this operation runs or fills reads the invoking actor.
//
// Asked here, where the whole lowered operation is in hand, rather than at
// invocation: the answer cannot change between one request and the next, and
// every member that can carry an actor is in front of us — the three programs,
// and the two marker-carrying templates. A caller asking the same question
// from a request would have to remember this list, and would be reading
// program text on a path that must not reach the BXL package at all.
function readsActor(operation: OperationDefinition): boolean {
  for (let program of [operation.program, operation.input, operation.output]) {
    if (program && callsActor(program.source)) {
      return true;
    }
  }
  return [operation.fill, operation.items].some(
    (template) => template !== undefined && templateReadsActor(template),
  );
}

function templateReadsActor(template: OperationTemplate): boolean {
  if (Array.isArray(template)) {
    return template.some(templateReadsActor);
  }
  if (template === null || typeof template !== 'object') {
    return false;
  }
  if ((template as Record<string, unknown>).$ref === 'actor') {
    return true;
  }
  return Object.values(template).some(templateReadsActor);
}

// ---------------------------------------------------------------------------
// The payload schema
// ---------------------------------------------------------------------------

// `{ body: StringField }` becomes `{ body: { kind: 'field', codeRef } }`, and
// `linkTo(Activity)` becomes a `link` entry. The distinction is what tells the
// invocation endpoint whether a value is a scalar to deserialize or an
// identity to resolve into a relationship.
function lowerParams(
  schema: Record<string, unknown> | undefined,
  sink: IssueSink,
  context: LoweringContext,
): Record<string, OperationParamDefinition> | undefined {
  if (!schema || Object.keys(schema).length === 0) {
    return undefined;
  }
  let params: Record<string, OperationParamDefinition> = {};
  for (let [name, type] of Object.entries(schema)) {
    let linked = (type as { $linkTo?: unknown })?.$linkTo;
    let kind: OperationParamDefinition['kind'] =
      linked === undefined ? 'field' : 'link';
    let codeRef = identify(linked ?? type, context);
    if (!codeRef) {
      sink.add(
        'unresolved-type',
        `params.${name}`,
        `param "${name}" names a class that no module exports, so there is no code ref to store for it`,
      );
      continue;
    }
    params[name] = { kind, codeRef };
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

function identify(
  value: unknown,
  context: LoweringContext,
): CodeRef | undefined {
  return codeRefForDef(value, context.identifyCard);
}

// ---------------------------------------------------------------------------
// Clauses → mutation statements
// ---------------------------------------------------------------------------

// The convenience clauses, in the order the program runs them: preconditions
// first, then the writes. `assert` guards the state a write is about to
// change, so an assertion that runs after the write it guards guards nothing.
async function lowerClauses(
  declaration: OperationDeclaration,
  paramNames: Set<string>,
  sink: IssueSink,
  context: LoweringContext,
): Promise<{ statements: string[]; snapshot: boolean }> {
  let statements: string[] = [];
  let snapshot = false;
  let assertion = (declaration as { assert?: Record<string, unknown> }).assert;
  if (assertion) {
    let lowered = await lowerAssert(assertion, paramNames, sink, context);
    if (lowered.statement) {
      statements.push(lowered.statement);
    }
    snapshot = lowered.snapshot;
  }
  let set = (declaration as { set?: Record<string, unknown> }).set;
  if (set) {
    for (let [path, value] of Object.entries(set)) {
      let statement = await lowerSet(path, value, paramNames, sink, context);
      if (statement) {
        statements.push(statement);
      }
    }
  }
  let append = (declaration as { append?: Record<string, unknown> }).append;
  if (append) {
    let statement = await lowerAppend(append, paramNames, sink, context);
    if (statement) {
      statements.push(statement);
    }
  }
  return { statements, snapshot };
}

// `set: { status: 'closed' }` → `.status="closed";`
//
// The write binds to the target's own stored value, so the path may reach
// into a contained value but not across a link and not into a computed field.
async function lowerSet(
  path: string,
  value: unknown,
  paramNames: Set<string>,
  sink: IssueSink,
  context: LoweringContext,
): Promise<string | undefined> {
  let resolved = await resolvePath(path, context);
  let field = checkWritablePath(resolved, path, `set.${path}`, sink);
  if (!field) {
    return undefined;
  }
  if (field.type === 'linksToMany') {
    // A relationship collection is changed one edge at a time; an assignment
    // would replace the whole set, which the executor refuses outright.
    sink.add(
      'link-collection-replace',
      `set.${path}`,
      `"${path}" is a link collection, which changes one edge at a time — append to it rather than assigning the whole set`,
    );
    return undefined;
  }
  let slot = await slotForField(field, 'whole', context);
  let source = await lowerValue(
    value,
    slot,
    `set.${path}`,
    paramNames,
    sink,
    context,
  );
  return `${bxlFieldPath(path)}=${source};`;
}

// `append: { to: 'comments', value: {…} }` → `append(.comments;{…});`
//
// The value lands in an *item* of the collection, so it is lowered against
// the item's shape: a card identity for a link collection, the item type's
// fields for a contained one.
async function lowerAppend(
  append: Record<string, unknown>,
  paramNames: Set<string>,
  sink: IssueSink,
  context: LoweringContext,
): Promise<string | undefined> {
  let path = String(append.to);
  let resolved = await resolvePath(path, context);
  let field = checkWritablePath(resolved, path, 'append.to', sink);
  if (!field) {
    return undefined;
  }
  if (!PLURAL_KINDS.includes(field.type)) {
    sink.add(
      'not-a-collection',
      'append.to',
      `"${path}" is a ${field.type} field, which holds one value — there is nothing to append to`,
    );
    return undefined;
  }
  let slot = await slotForField(field, 'item', context);
  let source = await lowerValue(
    append.value,
    slot,
    'append.value',
    paramNames,
    sink,
    context,
  );
  return `append(${bxlFieldPath(path)};${source});`;
}

// `assert: { unique: 'acl', by: params('id') }`
//   → `assert(all(.acl[];.id!=params("id"));"…");`
//
// The check reads every item of the collection and compares the member that
// identifies it: a link collection is keyed by the linked card's `id`, a
// contained one by the item value itself.
async function lowerAssert(
  assertion: Record<string, unknown>,
  paramNames: Set<string>,
  sink: IssueSink,
  context: LoweringContext,
): Promise<{ statement?: string; snapshot: boolean }> {
  let path = String(assertion.unique);
  let resolved = await resolvePath(path, context);
  if (resolved.unresolved) {
    sink.add(
      unresolvedCode(resolved),
      'assert.unique',
      unresolvedMessage(resolved, path),
    );
    return { snapshot: false };
  }
  let field = resolved.segments[resolved.segments.length - 1].fieldDef;
  if (!PLURAL_KINDS.includes(field.type)) {
    sink.add(
      'not-a-collection',
      'assert.unique',
      `"${path}" is a ${field.type} field, which holds one value — a uniqueness check needs a collection`,
    );
    return { snapshot: false };
  }
  checkReadablePath(resolved, path, 'assert.unique', sink);
  let gathered = resolved.segments.some(
    ({ fieldDef }) => fieldDef.isComputed || LINK_KINDS.includes(fieldDef.type),
  );
  if (gathered && assertion.snapshot !== true) {
    sink.add(
      'unsnapshotted-assert',
      'assert.unique',
      `"${path}" names computed or linked values, which a program does not find in the target's stored document — declare \`snapshot: true\` to have them gathered first`,
    );
  }
  // A link collection's items are identities, so the member that decides
  // uniqueness is the linked card's `id`; a contained item is compared whole.
  //
  // `by` is therefore compared against a member, not against the item: on a
  // link collection it is the identity string that `.id` holds, so it lowers
  // in an identity slot rather than being wrapped in `card(…)` the way the
  // same value would be on its way *into* the link.
  let linked = LINK_KINDS.includes(field.type);
  let keyed = linked ? '.id' : '.';
  let slot: ValueSlot = linked
    ? { kind: 'identity' }
    : await slotForField(field, 'item', context);
  let by = await lowerValue(
    assertion.by,
    slot,
    'assert.by',
    paramNames,
    sink,
    context,
  );
  let message =
    typeof assertion.message === 'string'
      ? bxlLiteral(assertion.message)
      : bxlLiteral(`${path} already holds this value`);
  return {
    statement: `assert(all(${bxlFieldPath(path)}[];${keyed}!=${by});${message});`,
    // The flag travels with the program rather than staying a lowering-time
    // gate: the check it suppresses is exactly the one saying the stored
    // document does not hold these values, so the realm has to be told to
    // gather them or the assertion reads an absent field and holds.
    snapshot: gathered && assertion.snapshot === true,
  };
}

// ---------------------------------------------------------------------------
// Path checks
// ---------------------------------------------------------------------------

// Resolve a dotted path one segment at a time, chasing each non-final
// segment's type through `lookupDefinition`. Reuses `getImmediateFieldDef`
// per segment rather than `getFieldDef`, because the checks below need the
// whole chain — which segment is computed, which one crosses a link — not
// only where the path lands.
async function resolvePath(
  path: string,
  context: LoweringContext,
): Promise<ResolvedPath> {
  let segments: PathSegment[] = [];
  let current: Pick<Definition, 'fields' | 'fieldDefs'> | undefined =
    context.definition;
  let names = path.split('.');
  for (let [index, name] of names.entries()) {
    let at = names.slice(0, index).join('.');
    if (!current) {
      return {
        segments,
        unresolved: { at, segment: name, reason: 'unreachable' },
      };
    }
    let fieldDef = getImmediateFieldDef(current, name);
    if (!fieldDef) {
      return { segments, unresolved: { at, segment: name, reason: 'missing' } };
    }
    segments.push({ name, fieldDef });
    if (index === names.length - 1) {
      return { segments };
    }
    if (fieldDef.isPrimitive || !isResolvedCodeRef(fieldDef.fieldOrCard)) {
      return {
        segments,
        unresolved: {
          at: names.slice(0, index + 1).join('.'),
          segment: names[index + 1],
          reason: 'unreachable',
        },
      };
    }
    // A collection has to say *which* item before a path can continue into
    // one, and a declaration has no way to. Following the item type here
    // would emit a location that reads the collection itself as an object.
    if (PLURAL_KINDS.includes(fieldDef.type)) {
      return {
        segments,
        unresolved: {
          at: names.slice(0, index + 1).join('.'),
          segment: names[index + 1],
          reason: 'crosses-collection',
        },
      };
    }
    current = await context.lookupDefinition(fieldDef.fieldOrCard);
  }
  return { segments };
}

// Why a field accepts no write, or undefined when it does. Mirrors the
// writability the executor derives from the same `FieldDefinition`, so a
// declaration is refused here rather than at every invocation: a computed
// field is recomputed over any write, a query-backed field's value comes
// from its query, and `id` is the card's identity rather than its data.
function unwritableReason(
  name: string,
  fieldDef: FieldDefinition,
): { code: 'computed-write' | 'read-only-write'; why: string } | undefined {
  if (fieldDef.isComputed) {
    return {
      code: 'computed-write',
      why: `"${name}" is a computed field, so a write to it would be replaced by the next read of its \`computeVia\``,
    };
  }
  if (fieldDef.query !== undefined) {
    return {
      code: 'read-only-write',
      why: `"${name}" is resolved by a \`query\`, so it holds no stored value to write`,
    };
  }
  if (name === 'id') {
    return {
      code: 'read-only-write',
      why: `"id" is the card's identity rather than its data, and no operation assigns it`,
    };
  }
  return undefined;
}

// The field a write lands on, or undefined when the path cannot carry one.
//
// A write binds to the target card's own stored values. That rules out any
// field nothing may write (see `unwritableReason`), and it rules out reaching
// *through* a link: the linked card is a separate document with its own
// operations, so writing into it from here would edit a card the invocation
// never named. A link as the last segment is fine — that writes the link
// itself.
function checkWritablePath(
  resolved: ResolvedPath,
  path: string,
  clausePath: string,
  sink: IssueSink,
): FieldDefinition | undefined {
  if (resolved.unresolved) {
    sink.add(
      unresolvedCode(resolved),
      clausePath,
      unresolvedMessage(resolved, path),
    );
    return undefined;
  }
  let ok = true;
  for (let [index, { name, fieldDef }] of resolved.segments.entries()) {
    let unwritable = unwritableReason(name, fieldDef);
    if (unwritable) {
      sink.add(
        unwritable.code,
        clausePath,
        // Name the whole path only when it says more than the segment does.
        name === path
          ? unwritable.why
          : `${unwritable.why}, so the write to "${path}" lands on nothing`,
      );
      ok = false;
    }
    if (
      index < resolved.segments.length - 1 &&
      LINK_KINDS.includes(fieldDef.type)
    ) {
      sink.add(
        'write-through-link',
        clausePath,
        `"${path}" writes through the link "${name}" into a linked card, which an operation on this card cannot edit`,
      );
      ok = false;
    }
  }
  return ok
    ? resolved.segments[resolved.segments.length - 1].fieldDef
    : undefined;
}

// A path that names a field the type does not have is an unknown field; one
// that stops at a collection names a real field it simply cannot address.
function unresolvedCode(
  resolved: ResolvedPath,
): 'unknown-field' | 'path-crosses-collection' {
  return resolved.unresolved?.reason === 'crosses-collection'
    ? 'path-crosses-collection'
    : 'unknown-field';
}

function unresolvedMessage(resolved: ResolvedPath, path: string): string {
  let { at, segment, reason } = resolved.unresolved!;
  if (reason === 'crosses-collection') {
    return `"${path}" continues past the collection "${at}" into "${segment}", and a declaration cannot say which item it means`;
  }
  if (reason === 'unreachable') {
    return `"${path}" cannot be followed past "${at}", whose type does not resolve`;
  }
  return at === ''
    ? `"${segment}" is not a field of this type`
    : `"${path}" names "${segment}", which is not a field of the type at "${at}"`;
}

// A read reaches a linked card's fields only through a link the author marked
// `searchable`, which is what makes those values available to an operation.
function checkReadablePath(
  resolved: ResolvedPath,
  path: string,
  clausePath: string,
  sink: IssueSink,
) {
  for (let [index, { name, fieldDef }] of resolved.segments.entries()) {
    if (index === resolved.segments.length - 1) {
      continue;
    }
    if (LINK_KINDS.includes(fieldDef.type) && fieldDef.searchable == null) {
      sink.add(
        'unsearchable-read',
        clausePath,
        `"${path}" reads through the link "${name}", which is not marked \`searchable\` — the linked card's values are not available to an operation`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Values → BXL expressions
// ---------------------------------------------------------------------------

// What a field can hold, either as a whole or one item at a time. `whole` is
// the slot a `set` writes; `item` is what an `append` adds and what an
// `assert` compares.
async function slotForField(
  fieldDef: FieldDefinition,
  granularity: 'whole' | 'item',
  context: LoweringContext,
): Promise<ValueSlot> {
  let plural = PLURAL_KINDS.includes(fieldDef.type) && granularity === 'whole';
  if (LINK_KINDS.includes(fieldDef.type)) {
    return plural ? { kind: 'links' } : { kind: 'link' };
  }
  if (fieldDef.isPrimitive) {
    return { kind: 'scalar' };
  }
  let definition = isResolvedCodeRef(fieldDef.fieldOrCard)
    ? await context.lookupDefinition(fieldDef.fieldOrCard)
    : undefined;
  return plural
    ? { kind: 'objects', definition }
    : { kind: 'object', definition };
}

// A declaration value as a BXL expression.
//
// A typed reference lowers to the builtin of the same name, except in a link
// slot: a link holds an identity, so the reference is wrapped in `card(…)`
// and a whole-value `instance()` is narrowed to the `id` that identifies it —
// which is why `report: instance()` on a `linksTo` field becomes
// `card(instance("id"))`.
//
// The walk is async because it resolves the type of every contained value it
// descends into, so a key is checked at whatever depth an author wrote it.
//
// One emitted shape has no executable spelling yet. `card(…)` is a marker the
// mutation planner recognizes structurally, and only as an entire value
// expression, so a relationship *nested inside* a contained value —
// `append(.comments;{body:"b",author:card(params("author"))});` — parses, plans,
// and then fails with `'card/1' is not defined`. That is every contained
// write carrying a link, not one example. It is emitted unchanged all the
// same: this is the lowered form the design calls for, and bending it here
// would bake a workaround into stored data that later has to be unbaked;
// resolving the marker inside a value tree belongs to the executor.
//
// No finding is recorded for it, deliberately. A finding sets `invalid`,
// which would refuse the shape rather than flag it, and there is no
// warning severity to say "this is right but not yet runnable". The same
// reasoning leaves `deterministic` alone: it says whether a program yields
// the same result for the same input, which stays true of a program that
// cannot yet run, and nothing is optimistically applied from a program the
// planner rejects.
async function lowerValue(
  value: unknown,
  slot: ValueSlot,
  path: string,
  paramNames: Set<string>,
  sink: IssueSink,
  context: LoweringContext,
): Promise<string> {
  // A link collection holds a *list* of identities, so anything that is not a
  // list cannot be one — a bare marker included, since that names a single
  // card. Recorded and then lowered against the slot anyway: dropping to
  // `opaque` here would strip a marker of its `card(…)` wrapper, and the
  // unwrapped spelling is the one the executor accepts and writes, so the
  // stored program for a refused operation would go from one the planner
  // rejects to one that quietly writes the wrong thing.
  //
  // An actor is the exception, and gets one finding rather than two: telling
  // an author to write a list of callers answers a question they should not
  // be asking, so the finding below says the one thing that is wrong.
  if (
    slot.kind === 'links' &&
    !Array.isArray(value) &&
    !(isMarker(value) && value.$ref === 'actor')
  ) {
    sink.add('link-requires-identity', path, notAList(path));
  }
  if (isMarker(value)) {
    return await lowerReference(value, slot, path, paramNames, sink, context);
  }
  if (isBxl(value)) {
    let program = checkExpressionProgram(value.$bxl);
    if (program.error) {
      sink.add(
        'invalid-program',
        path,
        `the bxl program at \`${path}\` does not parse: ${program.error}`,
      );
      return 'null';
    }
    for (let key of paramKeysRead(program.source!)) {
      checkParamKey(key, paramNames, path, sink);
    }
    // Parenthesized so a piped or comma-bearing program cannot rebind the
    // expression it is spliced into.
    return `(${program.source})`;
  }
  if (Array.isArray(value)) {
    // Reported once and then carried through as plain data: descending with
    // the identity slot still in hand would report every item as well.
    if (wantsIdentity(slot)) {
      sink.add('link-requires-identity', path, notAnIdentity(path, 'a list'));
      slot = { kind: 'opaque' };
    }
    let itemSlot = itemSlotOf(slot);
    let items: string[] = [];
    for (let [index, entry] of value.entries()) {
      items.push(
        await lowerValue(
          entry,
          itemSlot,
          `${path}[${index}]`,
          paramNames,
          sink,
          context,
        ),
      );
    }
    return `[${items.join(',')}]`;
  }
  if (isPlainObject(value)) {
    if (wantsIdentity(slot)) {
      sink.add(
        'link-requires-identity',
        path,
        notAnIdentity(path, 'an object'),
      );
      slot = { kind: 'opaque' };
    }
    return await lowerObject(value, slot, path, paramNames, sink, context);
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    if (wantsIdentity(slot)) {
      if (typeof value !== 'string') {
        sink.add(
          'link-requires-identity',
          path,
          value === null
            ? cannotClearLink(path)
            : notAnIdentity(path, JSON.stringify(value)),
        );
        return bxlLiteral(value);
      }
      // A bare URL is the identity spelled without the `card(…)` marker: a
      // write wants the projection around it, a comparison wants the
      // identity itself.
      return slot.kind === 'identity'
        ? bxlLiteral(value)
        : `card(${bxlLiteral(value)})`;
    }
    return bxlLiteral(value);
  }
  return 'null';
}

// An object value's keys are the fields of the type the slot names, so each
// one is checked and each member is lowered against its own field's shape. A
// slot that names no type (a raw program's neighbor, an `output` projection,
// a path already reported as broken) carries its members through as data —
// one bad path does not cascade into a second round of findings.
async function lowerObject(
  value: Record<string, unknown>,
  slot: ValueSlot,
  path: string,
  paramNames: Set<string>,
  sink: IssueSink,
  context: LoweringContext,
): Promise<string> {
  let definition =
    slot.kind === 'object' || slot.kind === 'objects'
      ? slot.definition
      : undefined;
  let entries: string[] = [];
  for (let [key, member] of Object.entries(value)) {
    let memberPath = `${path}.${key}`;
    let memberSlot: ValueSlot = { kind: 'opaque' };
    if (definition) {
      let fieldDef = getImmediateFieldDef(definition, key);
      let unwritable = fieldDef && unwritableReason(key, fieldDef);
      if (!fieldDef) {
        sink.add(
          'unknown-field',
          memberPath,
          `"${key}" is not a field of ${describeDefinition(definition)}`,
        );
      } else if (unwritable) {
        sink.add(
          unwritable.code,
          memberPath,
          `${unwritable.why}, and ${describeDefinition(
            definition,
          )} is what this value is written into`,
        );
      } else {
        memberSlot = await slotForField(fieldDef, 'whole', context);
        if (
          member === null &&
          (memberSlot.kind === 'link' || memberSlot.kind === 'links')
        ) {
          // A contained value written whole simply has no link, or no links,
          // at this key. That is not the "clear this link" a `set` on a link
          // path would be — there is no existing edge to remove — and the
          // executor writes it without complaint, so refusing it would refuse
          // work that does happen.
          memberSlot = { kind: 'opaque' };
        }
      }
    }
    entries.push(
      `${bxlObjectKey(key)}:${await lowerValue(
        member,
        memberSlot,
        memberPath,
        paramNames,
        sink,
        context,
      )}`,
    );
  }
  return `{${entries.join(',')}}`;
}

// A link holds a card identity — the URL of a saved card, or a marker that
// resolves to one. Anything else in that position lowers to a program that
// parses and then fails on every invocation, since the executor requires an
// identity for a relationship write. The same holds where an identity is
// compared rather than written: a value that is not an identity can never
// equal one, so the comparison would quietly hold for every item.
function wantsIdentity(slot: ValueSlot): boolean {
  return slot.kind === 'link' || slot.kind === 'identity';
}

function notAnIdentity(path: string, described: string): string {
  return `${described} cannot stand for a card identity at \`${path}\` — write a card URL, a param declared with \`linkTo(…)\`, or \`instance()\` there`;
}

// The caller is authenticated as a user id and no card represents a user, so
// an `actor()` where a card identity belongs names a link that cannot
// resolve. The person acting is expressible, just not from the actor.
function actorIsNotACard(path: string): string {
  return `\`${path}\` asks for a card identity, and \`actor()\` is the caller's user id rather than a card — declare the person as a \`params\` member typed \`linkTo(…)\` and write that there`;
}

function instanceOutOfScope(path: string): string {
  return `\`${path}\` reads the card's own stored values, and an append never assembles the card's document — declare what the item needs as a \`params\` member, or make it a \`transform\`, which does read the card`;
}

function notAList(path: string): string {
  return `\`${path}\` addresses a link collection, which holds a list of card identities — write a list, or append to the collection one edge at a time`;
}

// `null` in a link position reads as "clear this link", which is a different
// operation from writing one: the executor removes an edge with `del`, and
// that refuses a link which is already empty. So there is no spelling a
// clause can lower to that clears idempotently, and approximating one would
// give an operation that works until the second time it runs.
function cannotClearLink(path: string): string {
  return `\`${path}\` addresses a link, and \`null\` there reads as clearing it — which a clause cannot express: a relationship write requires an identity, and removing the edge outright fails when the link is already empty`;
}

function itemSlotOf(slot: ValueSlot): ValueSlot {
  switch (slot.kind) {
    case 'links':
      return { kind: 'link' };
    case 'objects':
      return { kind: 'object', definition: slot.definition };
    default:
      return slot;
  }
}

async function lowerReference(
  marker: Record<string, unknown>,
  slot: ValueSlot,
  path: string,
  paramNames: Set<string>,
  sink: IssueSink,
  context: LoweringContext,
): Promise<string> {
  let asLink = slot.kind === 'link' || slot.kind === 'links';
  // A link slot and an identity slot both ask *which card*, so a whole-value
  // reference narrows to its `id` in either. They differ only in spelling:
  // a link is written as the `card(…)` projection, an identity is the bare
  // string that `.id` holds.
  let identifies = asLink || slot.kind === 'identity';
  switch (marker.$ref) {
    case 'params': {
      let key = String(marker.key);
      checkParamKey(key, paramNames, path, sink);
      let read = `params(${bxlLiteral(key)})`;
      return asLink ? `card(${read})` : read;
    }
    case 'actor': {
      // `actor()` is the caller's user id, which is a value a text field
      // stores and a filter compares — not a card. Where a card identity
      // belongs there is nothing to narrow it to, so this is an authoring
      // problem rather than a spelling one, and the message says what to
      // declare instead.
      if (identifies) {
        sink.add('actor-not-a-card', path, actorIsNotACard(path));
      }
      return 'actor()';
    }
    case 'instance': {
      // The identity of a whole instance is its `id`.
      let key = marker.key ?? (identifies ? 'id' : undefined);
      let read =
        key === undefined
          ? 'instance()'
          : `instance(${bxlLiteral(String(key))})`;
      return asLink ? `card(${read})` : read;
    }
    case 'realmConfig': {
      // The key names a setting of the realm the operation runs in, which
      // lowering has no view of: a type is lowered once and its cards live in
      // whatever realms hold them. So the key travels unchecked, and a realm
      // that carries no such setting says so when the program runs.
      let key = marker.key;
      if (identifies && key === undefined) {
        // Without a key this reads the whole configuration map, which is not
        // one card's identity and never will be. Reported and then lowered
        // against the slot anyway, for the reason a marker always is: the
        // unwrapped spelling is the one the executor writes, so a refused
        // operation would otherwise store a program that quietly writes
        // something else.
        sink.add(
          'link-requires-identity',
          path,
          notAnIdentity(path, `the realm's whole configuration`),
        );
      }
      let read =
        key === undefined
          ? 'realmConfig()'
          : `realmConfig(${bxlLiteral(String(key))})`;
      return asLink ? `card(${read})` : read;
    }
    case 'card': {
      // Whatever `card(…)` wraps is an identity by definition, so the value
      // inside it lowers in an identity slot however the marker itself is
      // being used. That is what narrows a keyless `instance()` to the `id`
      // the constructor needs: `card(…)` takes exactly one identity string,
      // so a whole stored document is refused at plan time. Lowering the
      // inside against the outer slot instead would leave the explicit
      // spelling broken while the bare `instance()` it is more precise than
      // works.
      let inner = await lowerValue(
        marker.value,
        { kind: 'identity' },
        `${path}.value`,
        paramNames,
        sink,
        context,
      );
      // A comparison wants that identity on its own; everywhere else the
      // marker is saying "this is a link", and the projection around it is
      // what the executor writes.
      return slot.kind === 'identity' ? inner : `card(${inner})`;
    }
    default:
      return 'null';
  }
}

// Where a clause value reads a param, the declaration API has already
// resolved the reference and refused the declaration at class-definition
// time, so this only fires for a caller that assembled declarations without
// going through the decorator. It stays because the pass is exported and its
// input is plain data. Raw program text is the case this genuinely catches:
// the declaration API leaves the references inside a `bxl` program to BXL,
// so nothing before lowering has read those keys.
function checkParamKey(
  key: string,
  paramNames: Set<string>,
  path: string,
  sink: IssueSink,
) {
  if (!paramNames.has(key)) {
    sink.add(
      'undeclared-param',
      path,
      `\`${path}\` reads the param "${key}", which the \`params\` schema does not declare`,
    );
  }
}

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

// `paramNames` is the schema to check the program's `params()` reads against,
// or undefined when those reads were already checked at their source — which
// is the case for a program assembled from clauses.
function lowerProgram(
  source: string,
  syntax: 'readable' | 'solidified',
  path: string,
  paramNames: Set<string> | undefined,
  sink: IssueSink,
): OperationProgram | undefined {
  let checked = checkMutationProgram(source, syntax);
  if (checked.error) {
    sink.add(
      'invalid-program',
      path,
      `the program at \`${path}\` does not parse: ${checked.error}`,
    );
    return undefined;
  }
  if (paramNames) {
    for (let key of paramKeysRead(checked.source!)) {
      checkParamKey(key, paramNames, path, sink);
    }
  }
  return { source: checked.source!, syntax: 'solidified' };
}

function lowerExpression(
  source: string,
  path: string,
  paramNames: Set<string>,
  sink: IssueSink,
): OperationProgram | undefined {
  let checked = checkExpressionProgram(source);
  if (checked.error) {
    sink.add(
      'invalid-program',
      path,
      `the program at \`${path}\` does not parse: ${checked.error}`,
    );
    return undefined;
  }
  for (let key of paramKeysRead(checked.source!)) {
    checkParamKey(key, paramNames, path, sink);
  }
  return { source: checked.source!, syntax: 'solidified' };
}

// `output` is either a raw program or a projection object. A projection is
// the same thing said declaratively, so it lowers to the object-construction
// program it describes and the realm has one form to evaluate.
async function lowerOutput(
  output: unknown,
  paramNames: Set<string>,
  sink: IssueSink,
  context: LoweringContext,
): Promise<OperationProgram | undefined> {
  if (output === undefined) {
    return undefined;
  }
  if (isBxl(output)) {
    return lowerExpression(output.$bxl, 'output', paramNames, sink);
  }
  if (!isPlainObject(output)) {
    return undefined;
  }
  // A projection's keys name the response's own members rather than the
  // card's fields, so the slot carries no type to check them against.
  let source = await lowerObject(
    output,
    { kind: 'opaque' },
    'output',
    paramNames,
    sink,
    context,
  );
  return lowerExpression(source, 'output', paramNames, sink);
}

// ---------------------------------------------------------------------------
// `create`
// ---------------------------------------------------------------------------

// A `create` names the type it mints and, optionally, the attributes to stage
// on it. `fill` stays a marker-carrying JSON template rather than becoming a
// program: staging a new card is a substitution into a document, and a
// link-typed param's value becomes a relationship rather than an attribute.
async function lowerCreate(
  declaration: { of?: unknown; fill?: Record<string, unknown> },
  paramNames: Set<string>,
  sink: IssueSink,
  context: LoweringContext,
  operation: OperationDefinition,
) {
  let codeRef = identify(declaration.of, context);
  if (declaration.of !== undefined && !codeRef) {
    sink.add(
      'unresolved-type',
      'of',
      `\`of\` names a class that no module exports, so there is no code ref to store for what this creates`,
    );
  }
  if (codeRef) {
    operation.of = codeRef;
  }
  if (!declaration.fill) {
    return;
  }
  // `fill`'s field names belong to the type being created, not to the type
  // the operation is declared on.
  let target = codeRef ? await context.lookupDefinition(codeRef) : undefined;
  let fill: Record<string, OperationTemplate> = {};
  for (let [key, value] of Object.entries(declaration.fill)) {
    let fieldDef = target ? getImmediateFieldDef(target, key) : undefined;
    if (target) {
      let unwritable = fieldDef && unwritableReason(key, fieldDef);
      if (!fieldDef) {
        sink.add(
          'unknown-field',
          `fill.${key}`,
          `"${key}" is not a field of ${describeDefinition(target)}`,
        );
      } else if (unwritable) {
        sink.add(
          unwritable.code,
          `fill.${key}`,
          `${unwritable.why}, and ${describeDefinition(
            target,
          )} is the type this creates`,
        );
      }
    }
    fill[key] = templateOf(value, {
      path: `fill.${key}`,
      paramNames,
      sink,
      identifies: fieldDef ? LINK_KINDS.includes(fieldDef.type) : false,
    });
  }
  operation.fill = fill;
}

// A value carried to invocation time as data: markers stay exactly as the
// declaration wrote them, and everything else is the plain JSON it already
// is. A raw program has no place in a template — nothing substitutes into a
// document evaluates BXL — so one is reported rather than silently dropped.
interface TemplateSlot {
  path: string;
  paramNames: Set<string>;
  sink: IssueSink;
  // Whether the slot this fills is a link field, which is the one thing a
  // template's shape does not say for itself: a marker is carried through as
  // data, so what it stands for is decided by the field it lands in.
  identifies?: boolean;
  // Whether the card's stored document is in scope where this template is
  // resolved. A `create` reads the card it was invoked from; an append reads
  // nothing, so an `instance(…)` under one never resolves.
  reads?: boolean;
}

function templateOf(value: unknown, slot: TemplateSlot): OperationTemplate {
  let { path, paramNames, sink, identifies = false, reads = true } = slot;
  if (isMarker(value)) {
    if (value.$ref === 'params') {
      checkParamKey(String(value.key), paramNames, path, sink);
    }
    if (value.$ref === 'actor' && identifies) {
      sink.add('actor-not-a-card', path, actorIsNotACard(path));
    }
    if (value.$ref === 'instance' && !reads) {
      sink.add('instance-out-of-scope', path, instanceOutOfScope(path));
    }
    if (value.$ref === 'card' && isMarker(value.value)) {
      // Inside `card(…)` every value is a card identity, whatever field the
      // wrapper itself fills.
      templateOf(value.value, {
        ...slot,
        path: `${path}.value`,
        identifies: true,
      });
    }
    return value as OperationTemplate;
  }
  if (isBxl(value)) {
    sink.add(
      'invalid-program',
      path,
      `\`${path}\` is a template the realm fills by substitution, so it carries values and typed references rather than a bxl program`,
    );
    return null;
  }
  if (Array.isArray(value)) {
    // A link collection's members are each a card identity, so the slot's
    // reading carries into every entry — a list is how a `linksToMany` is
    // filled, not a place where the question changes.
    return value.map((entry, index) =>
      templateOf(entry, { ...slot, path: `${path}[${index}]`, identifies }),
    );
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, member]) => [
        key,
        templateOf(member, {
          ...slot,
          path: `${path}.${key}`,
          identifies: false,
        }),
      ]),
    );
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// `appendContainsMany`
// ---------------------------------------------------------------------------

interface AppendContainsManyClauses {
  field?: unknown;
  item?: unknown;
  fields?: Record<string, unknown>;
}

// `field: 'events', item: {…}` → `items: { events: {…} }`, and `fields: {…}`
// the same one entry at a time.
//
// The item stays a marker-carrying template rather than becoming a program,
// for the reason `fill` does: an append substitutes values into a stored
// document, and nothing on this path evaluates BXL.
//
// A field name is held to naming an immediate `containsMany` this card stores
// itself — the same thing the executor holds it to, since that is the only
// field a splice can reach. A dotted path is not among them: an append writes
// into one array, and which item of an outer collection a path continued
// through is not something a field name says.
async function lowerAppendContainsMany(
  declaration: AppendContainsManyClauses,
  paramNames: Set<string>,
  sink: IssueSink,
  context: LoweringContext,
): Promise<Record<string, OperationTemplate> | undefined> {
  // The two spellings, flattened to the one shape the lowered form carries.
  // Each entry keeps the clause path it was written at, so a finding names
  // where the author wrote it rather than where lowering put it.
  let declared: { field: string; item: unknown; path: string }[] = [];
  let plural = declaration.fields !== undefined;
  let singular =
    declaration.field !== undefined || declaration.item !== undefined;
  if (plural && singular) {
    // One field named twice would have two items and no rule for which wins.
    // The decorator refuses this, so it only arrives on a stored entry — where
    // silently preferring one spelling would append something the author did
    // not write.
    sink.add(
      'incomplete-append',
      'fields',
      `this append names one field with its \`item\` and several under \`fields\`, and there is no rule for which of them to write`,
    );
    return undefined;
  }
  if (plural && isPlainObject(declaration.fields)) {
    for (let [field, item] of Object.entries(declaration.fields)) {
      declared.push({ field, item, path: `fields.${field}` });
    }
  } else if (!plural && typeof declaration.field === 'string') {
    declared.push({
      field: declaration.field,
      item: declaration.item,
      path: 'item',
    });
  }
  if (declared.length === 0) {
    // An append with no field to append to describes no work at all, and the
    // executor would refuse every invocation of it. Recorded here so the
    // stored operation says so rather than reading as valid.
    sink.add(
      'incomplete-append',
      'field',
      `this append names no \`containsMany\` field to append to`,
    );
    return undefined;
  }
  let items: Record<string, OperationTemplate> = {};
  for (let { field, item, path } of declared) {
    let fieldPath = path === 'item' ? 'field' : path;
    let fieldDef = getImmediateFieldDef(context.definition, field);
    if (!fieldDef) {
      sink.add(
        'unknown-field',
        fieldPath,
        `"${field}" is not a field of this type`,
      );
      continue;
    }
    let unwritable = unwritableReason(field, fieldDef);
    if (unwritable) {
      sink.add(unwritable.code, fieldPath, unwritable.why);
      continue;
    }
    if (fieldDef.type !== 'containsMany') {
      sink.add(
        'not-a-collection',
        fieldPath,
        `"${field}" is a ${fieldDef.type} field; an append adds items to a \`containsMany\`, which is the only collection a card holds in its own file`,
      );
      continue;
    }
    if (item === undefined) {
      // Nothing to append. Left unreported this stores as a template of
      // `null`, which the executor would splice into the card's array as a
      // literal null rather than refusing.
      sink.add(
        'incomplete-append',
        path,
        `this append names "${field}" but no item to append to it`,
      );
      continue;
    }
    items[field] = lowerItem(
      item,
      await itemDefinitionOf(fieldDef, context),
      path,
      paramNames,
      sink,
    );
  }
  return Object.keys(items).length > 0 ? items : undefined;
}

// The type of one item of a collection, or undefined where its items have no
// fields of their own — a `containsMany` of primitives, or an item type
// nothing resolves.
async function itemDefinitionOf(
  fieldDef: FieldDefinition,
  context: LoweringContext,
): Promise<Definition | undefined> {
  if (fieldDef.isPrimitive || !isResolvedCodeRef(fieldDef.fieldOrCard)) {
    return undefined;
  }
  return await context.lookupDefinition(fieldDef.fieldOrCard);
}

// One appended item as a template, with its members checked against the item
// type's own fields — which is where an author finds out a member is
// misspelled, rather than the realm finding out when the spliced card next
// indexes.
//
// A marker in the item's place stands for whatever the invocation supplies, so
// there are no members to check; the same holds for a collection of
// primitives, whose items have no fields at all.
function lowerItem(
  item: unknown,
  itemDefinition: Definition | undefined,
  path: string,
  paramNames: Set<string>,
  sink: IssueSink,
): OperationTemplate {
  if (!itemDefinition || isMarker(item) || !isPlainObject(item)) {
    return templateOf(item, { path, paramNames, sink, reads: false });
  }
  // Each member is lowered against its own field, the way a `fill`'s members
  // are: the item's shape does not say which of them hold a card identity, so
  // the item type is what decides, one member at a time.
  let members: Record<string, OperationTemplate> = {};
  for (let [key, member] of Object.entries(item)) {
    let memberPath = `${path}.${key}`;
    let fieldDef = getImmediateFieldDef(itemDefinition, key);
    let unwritable = fieldDef && unwritableReason(key, fieldDef);
    if (!fieldDef) {
      sink.add(
        'unknown-field',
        memberPath,
        `"${key}" is not a field of ${describeDefinition(itemDefinition)}`,
      );
    } else if (unwritable) {
      sink.add(
        unwritable.code,
        memberPath,
        `${unwritable.why}, and ${describeDefinition(
          itemDefinition,
        )} is what an appended item holds`,
      );
    }
    members[key] = templateOf(member, {
      path: memberPath,
      paramNames,
      sink,
      identifies: fieldDef ? LINK_KINDS.includes(fieldDef.type) : false,
      // An append never assembles the card's document, so its own values are
      // not in scope for the item being built from it.
      reads: false,
    });
  }
  return members;
}

// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeDefinition(
  definition: Pick<Definition, 'displayName' | 'codeRef'>,
): string {
  return definition.displayName ?? JSON.stringify(definition.codeRef);
}
