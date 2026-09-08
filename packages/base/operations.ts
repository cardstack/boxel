import {
  BaseDef,
  CardDef,
  FieldDef,
  FileDef,
  type BaseDefConstructor,
  type BaseInstanceType,
  type CardDefConstructor,
  type FieldDefConstructor,
  type LinkableDefConstructor,
} from './card-api';

// ============================================================================
// The `@operation` authoring surface for card definitions.
//
// An operation is a named, reusable action on a card — "add a comment",
// "invite a guardian", "create an activity for this classroom" — declared by
// the card author as plain data rather than as JavaScript. A declaration names
// the built-in behavior it builds on (`base`), the payload it accepts
// (`params`), and what it does to the target. Values that are only known at
// invocation time are written as typed references: `params('body')` for a
// member of the request payload, `actor()` for the invoking actor,
// `instance()` for the target's stored source document, `card(…)` for a link
// identity, and the `bxl` tag for a raw program.
//
//   class ExternalReport extends CardDef {
//     @operation static addComment = {
//       base: 'transform',
//       params: { body: StringField },
//       append: {
//         to: 'comments',
//         value: { body: params('body'), author: actor() },
//       },
//     } satisfies OperationDeclaration;
//   }
//
// Everything here is data: a declaration is captured when a module's
// definition-cache entry is built, lowered there to canonical base-operation
// data plus BXL, and executed by the realm from that lowered form. No author
// JavaScript runs on an operation's path, which is why this module declares
// and validates shapes without running any of them, and why it reaches
// neither the loader nor the network — it has to load inside a card module,
// where only the card loader exists.
//
// The `satisfies OperationDeclaration` above is worth keeping in author code:
// it type-checks the declaration in place and preserves the literal types
// (`base: 'transform'` rather than `base: string`) that `OperationsOf` and
// `ParamsOf` read.
//
// A subclass overrides an inherited operation by redeclaring its name.
// TypeScript requires a subclass's static to stay assignable to the one it
// shadows, so an operation meant to be overridden with a differently-shaped
// declaration is annotated `: OperationDeclaration` where it is first
// declared; the override then keeps its own literal types. That annotation
// costs the annotated name its payload type — `ParamsOf` reads the literal
// schema — so it is worth writing only where a subclass really will reshape
// the operation, and the override's own declaration is where the payload type
// then comes from.
// ============================================================================

// The behaviors every declaration builds on. Which of them a def carries is
// implied by the def type rather than written in author code — a `CardDef`
// has all six, a `FileDef` only `read`, a `FieldDef` none — so
// `getOperations` synthesizes them. A declaration *named* after a base op is
// an author's override of it and takes its place, which is how a card
// specializes its own `read` projection or `update` validation.
export const BASE_OPERATIONS = [
  'read',
  'create',
  'update',
  'delete',
  'query',
  'transform',
] as const;

export type BaseOperationName = (typeof BASE_OPERATIONS)[number];

// ============================================================================
// Typed references
//
// Each constructor below returns a plain marker object that survives
// `JSON.stringify` and carries the reference's kind in a `$`-prefixed key.
// The same words name BXL builtins that read the injected operation context,
// so what a declaration writes is what the lowered program evaluates — there
// is no interpolation syntax and no sigil.
// ============================================================================

export interface ParamsReference<Key extends string = string> {
  readonly $ref: 'params';
  readonly key: Key;
}

export interface ActorReference {
  readonly $ref: 'actor';
  readonly key?: string;
}

export interface InstanceReference {
  readonly $ref: 'instance';
  readonly key?: string;
}

export interface CardReference {
  readonly $ref: 'card';
  readonly value: string | ParamsReference | ActorReference | InstanceReference;
}

export type OperationReference =
  | ParamsReference
  | ActorReference
  | InstanceReference
  | CardReference;

export interface BxlProgram {
  readonly $bxl: string;
}

// A member of the request payload, checked against the declaration's own
// `params` schema.
export function params<Key extends string>(key: Key): ParamsReference<Key> {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error(
      `params() takes the name of a param declared in the operation's \`params\` schema`,
    );
  }
  return { $ref: 'params', key };
}

// The invoking actor — the whole actor, or one of its members: `actor('id')`.
export function actor(key?: string): ActorReference {
  assertOptionalReferenceKey('actor', key);
  return key === undefined ? { $ref: 'actor' } : { $ref: 'actor', key };
}

// The invocation target's stored source document — never a live card
// instance. Unavailable to an operation invoked with no target in scope.
export function instance(key?: string): InstanceReference {
  assertOptionalReferenceKey('instance', key);
  return key === undefined ? { $ref: 'instance' } : { $ref: 'instance', key };
}

// A link identity: the URL of a saved card, or the reference that resolves to
// one — `card(params('activity'))`, `card(actor('id'))`.
export function card(reference: CardReference['value']): CardReference {
  if (typeof reference === 'string') {
    if (reference.length === 0) {
      throw new Error(`card() takes a card URL or a typed reference to one`);
    }
    return { $ref: 'card', value: reference };
  }
  if (!isReferenceMarker(reference)) {
    throw new Error(`card() takes a card URL or a typed reference to one`);
  }
  return { $ref: 'card', value: reference };
}

// A raw BXL program, for the transformations the declarative clauses don't
// express. The tag takes no substitutions: `params()`, `actor()` and
// `instance()` are BXL builtins that read the operation context, so a program
// reads the payload and the actor directly instead of having values spliced
// into its text.
export function bxl(
  program: TemplateStringsArray,
  ...substitutions: unknown[]
): BxlProgram {
  if (!Array.isArray(program) || !Array.isArray(program?.raw)) {
    throw new Error(
      `bxl is a template tag: write bxl\`…\` rather than calling it`,
    );
  }
  if (substitutions.length > 0) {
    throw new Error(
      `the bxl tag does not interpolate values; read the payload, the actor and the target inside the program with the params(), actor() and instance() builtins`,
    );
  }
  return { $bxl: program.raw.join('') };
}

// ============================================================================
// Declaration types
// ============================================================================

// A param that carries a card identity: the URL of a saved card, or the `lid`
// of a card being created in the same atomic batch.
export interface LinkToParam<
  Def extends LinkableDefConstructor = LinkableDefConstructor,
> {
  readonly $linkTo: Def | (() => Def);
}

export type LinkParamValue = string | { lid: string };

export function linkTo<Def extends LinkableDefConstructor>(
  def: Def | (() => Def),
): LinkToParam<Def> {
  if (typeof def !== 'function') {
    throw new Error(
      `linkTo() takes a card class (or a thunk returning one, for a class declared later in the module)`,
    );
  }
  // A thunk defers its class past this point; one named directly can be held
  // to a kind that has a URL to link to.
  if (
    isDefConstructor(def) &&
    !isSubclassOf(def, CardDef) &&
    !isSubclassOf(def, FileDef)
  ) {
    throw new Error(
      `linkTo() takes a card or file class — a link points at something with a URL`,
    );
  }
  return { $linkTo: def };
}

// A field class for a scalar param, or `linkTo(…)` for a card identity. The
// schema is the single source for the payload's TypeScript type, for checking
// `params(…)` references, and for the endpoint's payload validation.
export type ParamType = FieldDefConstructor | LinkToParam;
export type ParamsSchema = Record<string, ParamType>;

export type OperationValue =
  | string
  | number
  | boolean
  | null
  | OperationReference
  | BxlProgram
  | readonly OperationValue[]
  | { readonly [key: string]: OperationValue };

// Appends a value to a collection field. Cardinality (contained value vs.
// link) comes from the field-type map, so a declaration names the field and
// the value and nothing else.
export interface AppendClause {
  readonly to: string;
  readonly value: OperationValue;
}

// A precondition on the target's stored data. It guards data state, not
// identity — an assertion is never an authorization check.
export interface AssertClause {
  readonly unique: string;
  readonly by: OperationValue;
  readonly message?: string;
}

export type SetClause = { readonly [fieldName: string]: OperationValue };
export type FillClause = { readonly [fieldName: string]: OperationValue };

// Projects or reshapes the result. May reference the actor, which makes the
// operation's response per-actor.
export type OperationOutput =
  | BxlProgram
  | { readonly [key: string]: OperationValue };

// A saved search, declared next to the card's other operations and lowered to
// an ordinary realm query. `filter.on` takes the card class itself and the
// code ref is derived when the declaration is lowered; a query that filters on
// the very class it is declared on takes the thunk form, since the class
// binding is not yet initialized while its own statics are being built.
export interface QueryDeclaration {
  readonly filter?: OperationQueryValue;
  readonly sort?: OperationQueryValue;
  readonly page?: { readonly size?: number; readonly cursor?: string };
  readonly realms?: readonly string[];
}

export type OperationQueryValue =
  | string
  | number
  | boolean
  | null
  | BaseDefConstructor
  | (() => BaseDefConstructor)
  | OperationReference
  | readonly OperationQueryValue[]
  | { readonly [key: string]: OperationQueryValue };

interface OperationCommon {
  readonly params?: ParamsSchema;
  // The author's override of the automatically-detected eligibility for the
  // client's optimistic path.
  readonly optimistic?: boolean;
  // The raw escape hatch: author-supplied BXL in place of the declarative
  // clauses, for anything they don't express.
  readonly input?: BxlProgram;
  readonly transformations?: BxlProgram;
  readonly output?: OperationOutput;
}

export interface TransformOperationDeclaration extends OperationCommon {
  readonly base: 'transform';
  readonly append?: AppendClause;
  readonly assert?: AssertClause;
  readonly set?: SetClause;
}

export interface CreateOperationDeclaration extends OperationCommon {
  readonly base: 'create';
  // The type to create. Required unless the declaration supplies a raw
  // program instead.
  readonly of?: CardDefConstructor | (() => CardDefConstructor);
  readonly fill?: FillClause;
}

export interface UpdateOperationDeclaration extends OperationCommon {
  readonly base: 'update';
}

export interface DeleteOperationDeclaration extends OperationCommon {
  readonly base: 'delete';
}

export interface ReadOperationDeclaration extends OperationCommon {
  readonly base: 'read';
}

export interface QueryOperationDeclaration extends OperationCommon {
  readonly base: 'query';
  // Required unless the declaration supplies a raw program instead.
  readonly query?: QueryDeclaration;
}

export type OperationDeclaration =
  | TransformOperationDeclaration
  | CreateOperationDeclaration
  | UpdateOperationDeclaration
  | DeleteOperationDeclaration
  | ReadOperationDeclaration
  | QueryOperationDeclaration;

// The operations declared on a def, read off the class type. Keyed by
// operation name, so an invocation surface can be typed from the class alone.
//
// A declaration qualifies by its `base` still naming a base operation, which
// is what `satisfies OperationDeclaration` (or an explicit annotation)
// preserves. Written without either, `base` widens to `string` and the
// declaration is indistinguishable from any other static that happens to
// carry a `base` — so it is left out rather than sweeping unrelated statics
// in alongside it.
export type OperationsOf<Def> = {
  [Name in keyof Def as Def[Name] extends { base: BaseOperationName }
    ? Name
    : never]: Def[Name];
};

// The payload an operation accepts, derived from its declared `params`
// schema: each entry becomes the value type of the field class that declares
// it, and a `linkTo(…)` param becomes a card identity.
//
// This reads the literal schema, so it needs a declaration whose `params`
// survived inference — `satisfies OperationDeclaration`, or nothing at all.
// Annotating a declaration `: OperationDeclaration` widens `params` to the
// schema type and erases the keys, leaving `Record<string, never>` here:
// annotate only the operation a subclass has to reshape (see the header), and
// read the payload type off the subclass's own declaration.
export type ParamsOf<Declaration> = Declaration extends {
  params: infer Schema;
}
  ? { [Key in keyof Schema]: ParamValueOf<Schema[Key]> }
  : Record<string, never>;

type ParamValueOf<Param> =
  Param extends LinkToParam<LinkableDefConstructor>
    ? LinkParamValue
    : Param extends BaseDefConstructor
      ? BaseInstanceType<Param & BaseDefConstructor>
      : unknown;

// ============================================================================
// The decorator
// ============================================================================

const operationDeclarations = Symbol.for('cardstack-operation-declarations');

// Keys every declaration may carry, whichever base it builds on. `input`,
// `transformations` and `output` are the raw program's stages.
const COMMON_DECLARATION_KEYS = [
  'base',
  'params',
  'optimistic',
  'input',
  'transformations',
  'output',
] as const;

// The declarative clauses each base accepts. A declaration uses these or a
// raw `transformations` program — the two are alternative spellings of the
// same lowered program, not layers.
const CLAUSE_KEYS: Record<BaseOperationName, readonly string[]> = {
  transform: ['append', 'assert', 'set'],
  create: ['of', 'fill'],
  update: [],
  delete: [],
  read: [],
  query: ['query'],
};

// Clauses without which an authored declaration names no work at all: a
// create with no type to create, a query with no query.
//
// The rule is about what an author writes, not about every entry a reader
// returns. A base operation reached with no declaration takes both of these
// from the invocation instead — a plain `create` is called with the class and
// carries the type in the request, a plain `query` is called with the query —
// so the entries `getOperations` synthesizes for them are bare by design and
// do not satisfy this. Anything that needs the guarantee this rule provides
// is reading authored declarations, which is what `getDeclaredOperations`
// returns.
const REQUIRED_CLAUSE: Partial<Record<BaseOperationName, string>> = {
  create: 'of',
  query: 'query',
};

// Clauses that name a type rather than describe work. A raw program replaces
// the work, so it does not replace these — a `create` driven by a program
// still has to say what it creates.
const TYPE_NAMING_KEYS: readonly string[] = ['of'];

// Records a static declaration on the class it is declared on. Our decorators
// are implemented by Babel, not TypeScript, so the signature differs from the
// one TypeScript expects; a static-property decorator receives the
// constructor.
export const operation = function (
  target: unknown,
  key: string | symbol,
  descriptor: { initializer?: (() => unknown) | null } | undefined,
) {
  if (typeof key === 'symbol') {
    throw new Error(
      `the @operation decorator only supports string operation names, not symbols`,
    );
  }
  let owner = assertOperationTarget(target, key);
  assertNameAvailable(owner, key);
  if (typeof descriptor?.initializer !== 'function') {
    throw new Error(
      `${declarationLabel(owner, key)}: an operation must be assigned a declaration object`,
    );
  }
  let declaration = descriptor.initializer.call(owner);
  assertValidDeclaration(owner, key, declaration);
  recordDeclaration(owner, key, declaration as OperationDeclaration);
  // A descriptor carrying `value` (and no `initializer`) is what installs the
  // property on the constructor at class-definition time. Leaving the
  // initializer in place defers it to instance construction, where a static
  // never runs.
  return {
    configurable: true,
    enumerable: true,
    writable: true,
    value: declaration,
  };
} as unknown as PropertyDecorator;

// Every operation a def carries: the base operations its def type implies,
// plus everything its authors declared, with a declaration taking the place
// of the base operation it names. This is the read path a caller wants —
// dispatch, lowering and an invocation surface all need the whole set, and
// which part of it came from author code is not something they branch on.
//
// `create` and `query` are type-scoped rather than instance-scoped: they come
// back for a card def either way, but they target the type, not one instance.
//
// A synthesized entry is the bare `{ base }`: the base operations are the
// executors, so there is nothing for an author to have said about one, and
// what a plain `create` or `query` needs travels with the invocation rather
// than the declaration. Read `declaration.base` to dispatch and this record
// is uniform; reach for a clause and only authored declarations can be
// relied on to carry one, so lower from `getDeclaredOperations`.
export function getOperations(
  classOrInstance: BaseDef | typeof BaseDef,
): Record<string, OperationDeclaration> {
  let owner = defConstructorFor(classOrInstance, 'getOperations');
  let operations = emptyOperationRecord();
  for (let base of impliedOperations(owner)) {
    // A base operation with nothing declared on it is the declaration
    // `{ base }`; the cast is only because a union does not narrow from a
    // computed discriminant.
    operations[base] = { base } as OperationDeclaration;
  }
  return Object.assign(operations, declaredOperations(owner));
}

// Only what `@operation` declarations put on the def, merged by name up the
// prototype chain so a subclass adds new names and overrides inherited ones
// wholesale, per name. Read through this rather than a class's static
// directly — a plain property read sees only the nearest declaration and
// drops everything an ancestor declared. Use it over `getOperations` when the
// distinction matters: what an author wrote, as opposed to what the def type
// provides on its own.
//
// Every entry here went through the decorator's validation, so a clause the
// declaration's base requires is present. That makes this the reader to
// lower from: lowering turns authored sugar into base-operation data plus
// BXL, and a base operation reached with no declaration has nothing to
// lower.
export function getDeclaredOperations(
  classOrInstance: BaseDef | typeof BaseDef,
): Record<string, OperationDeclaration> {
  return declaredOperations(
    defConstructorFor(classOrInstance, 'getDeclaredOperations'),
  );
}

// Which base operations a def type carries. Overriding one is a matter of
// declaring an operation by its name; nothing here is written in author code.
function impliedOperations(
  owner: typeof BaseDef,
): readonly BaseOperationName[] {
  if (isSubclassOf(owner, FieldDef)) {
    // A field's instances have no URL, so nothing is invocable on one; field
    // data is reached through the operations of the card that contains it.
    return [];
  }
  if (isSubclassOf(owner, CardDef)) {
    return BASE_OPERATIONS;
  }
  if (isSubclassOf(owner, FileDef)) {
    // A file's metadata is content-derived and read-only: there is no
    // JSON:API mutation surface for anything else to reach.
    return READ_ONLY;
  }
  // The one operation every addressable def shares.
  return READ_ONLY;
}

const READ_ONLY = ['read'] as const;

function declaredOperations(
  owner: typeof BaseDef,
): Record<string, OperationDeclaration> {
  // Collect declaration levels base-most first so a subclass's entry lands
  // after (and thus overrides) its ancestor's.
  let levels: Record<string, OperationDeclaration>[] = [];
  let current: unknown = owner;
  while (typeof current === 'function') {
    let declarations = ownDeclarations(current);
    if (declarations) {
      levels.unshift(declarations);
    }
    current = Object.getPrototypeOf(current);
  }
  return Object.assign(emptyOperationRecord(), ...levels);
}

// A record with no prototype. Operations are addressed by name — the realm
// dispatches one from a name that arrived over the wire — so a name-keyed map
// must not answer to `toString`, `constructor` or `__proto__` with something
// that is not an operation.
function emptyOperationRecord(): Record<string, OperationDeclaration> {
  return Object.create(null) as Record<string, OperationDeclaration>;
}

function defConstructorFor(
  classOrInstance: BaseDef | typeof BaseDef,
  reader: string,
): typeof BaseDef {
  let owner =
    typeof classOrInstance === 'function'
      ? classOrInstance
      : classOrInstance?.constructor;
  if (typeof owner !== 'function' || !isDefConstructor(owner)) {
    throw new Error(
      `${reader}() takes a class that extends BaseDef, or an instance of one`,
    );
  }
  return owner;
}

function ownDeclarations(
  owner: unknown,
): Record<string, OperationDeclaration> | undefined {
  if (!hasOwn(owner as object, operationDeclarations)) {
    return undefined;
  }
  return (owner as Record<symbol, Record<string, OperationDeclaration>>)[
    operationDeclarations
  ];
}

function recordDeclaration(
  owner: typeof BaseDef,
  key: string,
  declaration: OperationDeclaration,
) {
  let declarations = ownDeclarations(owner);
  if (!declarations) {
    // A name-keyed store with no prototype: nothing an operation could be
    // called is also an inherited member here, so a name can only ever add a
    // key rather than reach something the store inherits.
    declarations = Object.create(null) as Record<string, OperationDeclaration>;
    Object.defineProperty(owner, operationDeclarations, {
      value: declarations,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }
  declarations[key] = declaration;
}

function hasOwn(target: object, key: string | symbol): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function isDefConstructor(target: unknown): target is typeof BaseDef {
  return (
    typeof target === 'function' &&
    (target === BaseDef || target.prototype instanceof BaseDef)
  );
}

function isSubclassOf(target: typeof BaseDef, def: typeof BaseDef): boolean {
  return target === def || target.prototype instanceof def;
}

function assertOperationTarget(target: unknown, key: string): typeof BaseDef {
  if (!isDefConstructor(target)) {
    throw new Error(
      `the @operation decorator can only be used on static properties of classes that extend BaseDef`,
    );
  }
  if (isSubclassOf(target, FieldDef)) {
    throw new Error(
      `${declarationLabel(target, key)}: a field has no URL of its own, so it cannot carry operations — declare this on the card that contains the field`,
    );
  }
  return target;
}

// A name that already resolves on the class would shadow, or be shadowed by,
// whatever provides it — a system static like `displayName`, or something a
// class inherits from `Function.prototype`. An inherited operation of the
// same name is the one exception: that is how a subclass overrides it. The
// exemption is an own-property test, because an `in` test against the merged
// record answers true for every `Object.prototype` member (`toString`,
// `constructor`, `__proto__`) and would wave through exactly the names that
// must not become operations.
function assertNameAvailable(owner: typeof BaseDef, key: string) {
  if (!(key in owner)) {
    return;
  }
  if (hasOwn(declaredOperations(owner), key)) {
    return;
  }
  throw new Error(
    `${declarationLabel(owner, key)}: "${key}" already resolves on this class, so it cannot name an operation`,
  );
}

function assertValidDeclaration(
  owner: typeof BaseDef,
  key: string,
  value: unknown,
) {
  let label = declarationLabel(owner, key);
  if (!isPlainObject(value)) {
    throw new Error(`${label}: an operation must be a declaration object`);
  }
  let declaration = value as Record<string, unknown>;
  let base = declaration.base;
  if (!isBaseOperationName(base)) {
    throw new Error(
      `${label}: \`base\` must name the built-in behavior this operation builds on — one of ${quoteList(BASE_OPERATIONS)}`,
    );
  }
  // An author may only specialize a base operation the def type actually
  // carries. Read from the same list `getOperations` synthesizes: only a card
  // has a mutation surface, and a file's metadata is content-derived and
  // read-only.
  let implied = impliedOperations(owner);
  if (!implied.includes(base)) {
    throw new Error(
      `${label}: this def type carries only ${quoteList(
        implied,
      )}, so it cannot declare a "${base}" operation`,
    );
  }
  let clauseKeys = CLAUSE_KEYS[base];
  let legalKeys = new Set<string>([...COMMON_DECLARATION_KEYS, ...clauseKeys]);
  for (let declaredKey of Object.keys(declaration)) {
    if (!legalKeys.has(declaredKey)) {
      throw new Error(
        `${label}: "${declaredKey}" is not a valid key for a "${base}" operation; valid keys are ${quoteList(
          [...legalKeys].sort(),
        )}`,
      );
    }
  }
  let paramNames = assertValidParamsSchema(label, declaration.params);
  if (
    declaration.optimistic !== undefined &&
    typeof declaration.optimistic !== 'boolean'
  ) {
    throw new Error(`${label}: \`optimistic\` must be a boolean`);
  }
  if (declaration.input !== undefined) {
    assertBxlProgram(label, 'input', declaration.input);
  }
  let usedClauses = clauseKeys.filter(
    (clause) =>
      declaration[clause] !== undefined && !TYPE_NAMING_KEYS.includes(clause),
  );
  if (declaration.transformations !== undefined) {
    assertBxlProgram(label, 'transformations', declaration.transformations);
    if (usedClauses.length > 0) {
      throw new Error(
        `${label}: a declaration expresses its work either with clauses (${quoteList(
          usedClauses,
        )}) or with a raw \`transformations\` program, not both`,
      );
    }
  } else {
    let required = REQUIRED_CLAUSE[base];
    if (required !== undefined && declaration[required] === undefined) {
      throw new Error(
        `${label}: a "${base}" operation needs \`${required}\`, or a raw \`transformations\` program`,
      );
    }
  }
  assertValidClauses(label, base, declaration);
  if (declaration.output !== undefined && !isPlainObject(declaration.output)) {
    throw new Error(
      `${label}: \`output\` must be a projection object or a bxl program`,
    );
  }
  assertReferencesResolve(label, declaration, paramNames);
}

function assertValidClauses(
  label: string,
  base: BaseOperationName,
  declaration: Record<string, unknown>,
) {
  if (declaration.append !== undefined) {
    let append = declaration.append;
    if (!isPlainObject(append)) {
      throw new Error(
        `${label}: \`append\` must be an object naming the field to append \`to\` and the \`value\` to append`,
      );
    }
    assertOnlyKeys(label, 'append', append, ['to', 'value']);
    if (typeof append.to !== 'string' || append.to.length === 0) {
      throw new Error(
        `${label}: \`append.to\` must name the collection field to append to`,
      );
    }
    if (append.value === undefined) {
      throw new Error(`${label}: \`append\` must carry a \`value\` to append`);
    }
  }
  if (declaration.assert !== undefined) {
    let assertion = declaration.assert;
    if (!isPlainObject(assertion)) {
      throw new Error(
        `${label}: \`assert\` must be an object naming the collection that must stay \`unique\` and the value to key it \`by\``,
      );
    }
    assertOnlyKeys(label, 'assert', assertion, ['unique', 'by', 'message']);
    if (typeof assertion.unique !== 'string' || assertion.unique.length === 0) {
      throw new Error(
        `${label}: \`assert.unique\` must name the collection field that must not already hold the value`,
      );
    }
    if (assertion.by === undefined) {
      throw new Error(
        `${label}: \`assert\` must carry a \`by\` value to key the uniqueness check on`,
      );
    }
    if (
      assertion.message !== undefined &&
      typeof assertion.message !== 'string'
    ) {
      throw new Error(`${label}: \`assert.message\` must be a string`);
    }
  }
  for (let clause of ['set', 'fill'] as const) {
    let value = declaration[clause];
    if (value === undefined) {
      continue;
    }
    if (!isPlainObject(value) || Object.keys(value).length === 0) {
      throw new Error(
        `${label}: \`${clause}\` must be an object mapping field names to values`,
      );
    }
  }
  if (declaration.of !== undefined) {
    if (typeof declaration.of !== 'function') {
      throw new Error(
        `${label}: \`of\` must be the card class to create, or a thunk returning it`,
      );
    }
    // A thunk cannot be resolved this early, but a def class named directly
    // can be held to the kind a create can mint.
    if (
      isDefConstructor(declaration.of) &&
      !isSubclassOf(declaration.of, CardDef)
    ) {
      throw new Error(
        `${label}: \`of\` must be a card class — only a card can be created`,
      );
    }
  }
  if (base === 'query' && declaration.query !== undefined) {
    let query = declaration.query;
    if (!isPlainObject(query) || Object.keys(query).length === 0) {
      throw new Error(
        `${label}: \`query\` must be an object with at least one of \`filter\`, \`sort\`, \`page\` and \`realms\``,
      );
    }
    assertOnlyKeys(label, 'query', query, ['filter', 'sort', 'page', 'realms']);
    if (query.page !== undefined) {
      if (!isPlainObject(query.page)) {
        throw new Error(
          `${label}: \`query.page\` must be an object with \`size\` and \`cursor\``,
        );
      }
      assertOnlyKeys(label, 'query.page', query.page, ['size', 'cursor']);
      let size = query.page.size;
      if (
        size !== undefined &&
        (typeof size !== 'number' || !Number.isInteger(size) || size < 1)
      ) {
        throw new Error(
          `${label}: \`query.page.size\` must be a positive integer`,
        );
      }
      if (
        query.page.cursor !== undefined &&
        (typeof query.page.cursor !== 'string' ||
          query.page.cursor.length === 0)
      ) {
        throw new Error(`${label}: \`query.page.cursor\` must be a string`);
      }
    }
    if (query.realms !== undefined) {
      let realms = query.realms;
      if (
        !Array.isArray(realms) ||
        realms.length === 0 ||
        realms.some((realm) => typeof realm !== 'string' || realm.length === 0)
      ) {
        throw new Error(
          `${label}: \`query.realms\` must be a non-empty array of realm URLs`,
        );
      }
    }
  }
}

function assertValidParamsSchema(label: string, schema: unknown): Set<string> {
  if (schema === undefined) {
    return new Set();
  }
  if (!isPlainObject(schema)) {
    throw new Error(
      `${label}: \`params\` must be an object mapping param names to a field class or linkTo(…)`,
    );
  }
  let names = new Set<string>();
  for (let [name, type] of Object.entries(schema)) {
    if (isPlainObject(type)) {
      if (typeof (type as { $linkTo?: unknown }).$linkTo !== 'function') {
        throw new Error(
          `${label}: param "${name}" must be a field class or linkTo(…)`,
        );
      }
      assertOnlyKeys(label, `params.${name}`, type, ['$linkTo']);
    } else if (!isFieldDefConstructor(type)) {
      // A scalar param is typed by the field class that serializes it, so
      // any other function — a card class, a thunk, an unrelated callable —
      // would type the payload as something the endpoint cannot validate.
      throw new Error(
        `${label}: param "${name}" must be a field class or linkTo(…)${
          isDefConstructor(type)
            ? ', and a card or file identity is a linkTo(…) param'
            : ''
        }`,
      );
    }
    names.add(name);
  }
  return names;
}

function isFieldDefConstructor(value: unknown): boolean {
  return (
    typeof value === 'function' &&
    isSubclassOf(value as typeof BaseDef, FieldDef)
  );
}

// Walks the declaration, validating each typed reference in place and holding
// every other value to what a declaration can carry.
//
// A reference to the payload only means something when the schema declares
// that param, so an undeclared key is an authoring error caught here rather
// than a runtime hole. References inside a raw program's text are BXL's to
// resolve.
//
// The rest is the plain-data invariant, enforced rather than assumed: a
// declaration reaches the realm as JSON in a definition-cache entry, and
// anything that does not survive that trip — `undefined`, a function, a
// symbol, a bigint, a non-finite number, a class instance whose fields JSON
// flattens away, a cycle JSON refuses outright — would leave the operation
// running against something other than what the author wrote, silently.
//
// A def class is legal in exactly the two slots that name a type: the `of` a
// `create` targets, and the `on` a query filters against (at any depth, since
// filters nest). Naming those slots individually is what keeps a thunk from
// being mistaken for a value everywhere else in a query — a function under
// `eq` would lower to nothing and match every card instead of one.
function assertReferencesResolve(
  label: string,
  declaration: Record<string, unknown>,
  paramNames: Set<string>,
) {
  // The current DFS path, not a memo: a node is unwound on the way back out,
  // so a cycle is caught while the same object legitimately appearing twice
  // is validated in each place it appears.
  let ancestors = new Set<object>();
  let walk = (node: unknown, path: string, slot: SlotKind) => {
    if (node === null) {
      return;
    }
    if (typeof node === 'function') {
      if (slot.definitionAllowed) {
        return;
      }
      throw new Error(
        `${label}: \`${path}\` is a function; a declaration is data — name a run-time value with params(), actor(), instance() or card(), or a program with the bxl tag`,
      );
    }
    if (typeof node !== 'object') {
      if (typeof node === 'symbol' || typeof node === 'bigint') {
        throw new Error(
          `${label}: \`${path}\` is ${describeValue(node)}, which a declaration cannot carry`,
        );
      }
      if (node === undefined) {
        throw new Error(
          `${label}: \`${path}\` is undefined; omit an optional key rather than declaring it as undefined`,
        );
      }
      if (typeof node === 'number' && !Number.isFinite(node)) {
        throw new Error(
          `${label}: \`${path}\` is ${node}, which serializes as null`,
        );
      }
      return;
    }
    if (ancestors.has(node)) {
      throw new Error(
        `${label}: \`${path}\` refers back to a value that contains it; a declaration is a tree`,
      );
    }
    if (isBxlMarker(node)) {
      assertBxlProgram(label, path, node);
      return;
    }
    if ('$ref' in node) {
      assertValidReference(label, path, node, paramNames);
      return;
    }
    if (!Array.isArray(node) && !isPlainObject(node)) {
      throw new Error(
        `${label}: \`${path}\` is ${describeValue(
          node,
        )}; a declaration carries plain objects, arrays and primitives`,
      );
    }
    ancestors.add(node);
    if (Array.isArray(node)) {
      node.forEach((entry, index) =>
        walk(entry, `${path}[${index}]`, {
          definitionAllowed: false,
          inQuery: slot.inQuery,
        }),
      );
    } else {
      for (let [key, value] of Object.entries(node)) {
        // The params schema holds field classes and linkTo markers rather
        // than references, and is validated on its own terms.
        if (path === '' && key === 'params') {
          continue;
        }
        let inQuery = slot.inQuery || (path === '' && key === 'query');
        walk(value, path === '' ? key : `${path}.${key}`, {
          definitionAllowed:
            (path === '' && key === 'of') || (inQuery && key === 'on'),
          inQuery,
        });
      }
    }
    ancestors.delete(node);
  };
  walk(declaration, '', { definitionAllowed: false, inQuery: false });
}

// Where in a declaration the walk currently is, in the only two terms it
// changes behavior on.
interface SlotKind {
  // This slot names a type, so a def class (or a thunk returning one) belongs.
  definitionAllowed: boolean;
  // Somewhere inside a `query`, where a nested `on` names a type.
  inQuery: boolean;
}

function describeValue(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'symbol') {
    return 'a symbol';
  }
  if (typeof value === 'bigint') {
    return 'a bigint';
  }
  if (typeof value === 'function') {
    return 'a function';
  }
  let name = (value as { constructor?: { name?: string } })?.constructor?.name;
  return name ? `a ${name} instance` : 'a non-plain object';
}

function assertValidReference(
  label: string,
  path: string,
  node: object,
  paramNames: Set<string>,
) {
  let reference = node as Record<string, unknown>;
  switch (reference.$ref) {
    case 'params': {
      assertOnlyKeys(label, path, reference, ['$ref', 'key']);
      let key = reference.key;
      if (typeof key !== 'string' || key.length === 0) {
        throw new Error(
          `${label}: the params reference at \`${path}\` must name a param`,
        );
      }
      if (!paramNames.has(key)) {
        throw new Error(
          `${label}: \`${path}\` references the param "${key}", which the \`params\` schema does not declare`,
        );
      }
      return;
    }
    case 'actor':
    case 'instance': {
      assertOnlyKeys(label, path, reference, ['$ref', 'key']);
      if (
        reference.key !== undefined &&
        (typeof reference.key !== 'string' || reference.key.length === 0)
      ) {
        throw new Error(
          `${label}: the ${reference.$ref} reference at \`${path}\` must name a member, or none at all`,
        );
      }
      return;
    }
    case 'card': {
      assertOnlyKeys(label, path, reference, ['$ref', 'value']);
      let value = reference.value;
      if (typeof value === 'string') {
        if (value.length === 0) {
          throw new Error(
            `${label}: the card reference at \`${path}\` must carry a card URL or a reference to one`,
          );
        }
        return;
      }
      if (!isPlainObject(value) || !('$ref' in value)) {
        throw new Error(
          `${label}: the card reference at \`${path}\` must carry a card URL or a reference to one`,
        );
      }
      assertValidReference(label, `${path}.value`, value, paramNames);
      return;
    }
    default:
      throw new Error(
        `${label}: \`${path}\` is not a typed reference; build one with params(), actor(), instance() or card()`,
      );
  }
}

function assertBxlProgram(label: string, path: string, value: unknown) {
  if (
    !isBxlMarker(value) ||
    typeof (value as BxlProgram).$bxl !== 'string' ||
    (value as BxlProgram).$bxl.length === 0
  ) {
    throw new Error(
      `${label}: \`${path}\` must be a program written with the bxl tag`,
    );
  }
  assertOnlyKeys(label, path, value as object, ['$bxl']);
}

function assertOnlyKeys(
  label: string,
  path: string,
  node: object,
  allowed: readonly string[],
) {
  for (let key of Object.keys(node)) {
    if (!allowed.includes(key)) {
      throw new Error(
        `${label}: "${key}" is not a valid key for \`${path}\`; valid keys are ${quoteList(
          allowed,
        )}`,
      );
    }
  }
}

function assertOptionalReferenceKey(kind: string, key: unknown) {
  if (key === undefined) {
    return;
  }
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error(
      `${kind}() takes the name of a member to read, or no argument at all`,
    );
  }
}

function isReferenceMarker(value: unknown): boolean {
  return isPlainObject(value) && '$ref' in (value as object);
}

function isBxlMarker(value: unknown): boolean {
  return isPlainObject(value) && '$bxl' in (value as object);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  // Plain means plain: a `Date` serializes to a string and a `Map` to `{}`,
  // so a class instance cannot stand in for a declaration, a clause or a
  // marker without losing what it holds.
  let proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isBaseOperationName(value: unknown): value is BaseOperationName {
  return (
    typeof value === 'string' &&
    (BASE_OPERATIONS as readonly string[]).includes(value)
  );
}

function declarationLabel(owner: typeof BaseDef, key: string): string {
  return `@operation "${key}" on ${owner.name || owner.displayName || 'card'}`;
}

function quoteList(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(', ');
}
