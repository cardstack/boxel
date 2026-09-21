import {
  assertQuery,
  buildOperations,
  codeRefForDef,
  getOperationsTransport,
  identifyCard,
  InvalidQueryError,
  localId,
  realmURL,
  type CarriedOperationInfo,
  type CarriedQueryDeclaration,
  type CodeRef,
  type InvokeOptions,
  type OperationDocument,
  type OperationHandle,
  type OperationResultTree,
  type OperationWriteResult,
  type OperationsSubject,
  type QueryTargetHandle,
  type SearchEntries,
  type SearchEntryWireQuery,
  type SearchInvokeOptions,
} from '@cardstack/runtime-common';

import {
  BaseDef,
  CardDef,
  FieldDef,
  FileDef,
  serializeCard,
  type BaseDefConstructor,
  type BaseInstanceType,
  type CardDefConstructor,
  type FieldDefConstructor,
  type FileDefConstructor,
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
// member of the request payload, `actor()` for the caller's user id,
// `instance()` for the target's stored source document, `realmConfig('key')`
// for a setting of the realm the operation runs in, `card(…)` for a link
// identity, and the `bxl` tag for a raw program.
//
//   class ExternalReport extends CardDef {
//     @operation static addComment = {
//       base: 'transform',
//       params: { body: StringField },
//       append: {
//         to: 'comments',
//         value: { body: params('body'), postedBy: actor() },
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
// implied by the def type rather than written in author code (see
// `CARRIED_BY`), so `getOperations` synthesizes them. A declaration *named*
// after a base op takes its place: it specializes that behavior when it names
// the same `base`, and rebinds the verb when it names another — a `delete`
// declared on `transform` is a soft delete, so asking such a card to delete
// itself archives it rather than removing it. The name is what a caller
// invokes and `base` is the behavior that carries it out, so the two are read
// separately and neither is inferred from the other.
export const BASE_OPERATIONS = [
  'read',
  'readSource',
  'create',
  'update',
  'delete',
  'query',
  'transform',
  'appendContainsMany',
  'appendLine',
] as const;

export type BaseOperationName = (typeof BASE_OPERATIONS)[number];

// The def families a base operation belongs to. `base` is every addressable
// def that is neither a card nor a file — `BaseDef` itself and a direct
// subclass of one — which carries the two reads and nothing else; a field is
// not addressable at all, so it appears here nowhere.
type DefFamily = 'card' | 'file' | 'base';

// Which families carry which behavior. The table is keyed by base operation
// rather than by family so it is exhaustive over `BASE_OPERATIONS`: a tenth
// base operation has to say where it belongs instead of defaulting into the
// families that already exist.
//
// The two writes on a file work on its bytes, which are the representation a
// file is for — `update` replaces the content wholesale, `appendLine` adds one
// newline-terminated line without reading what is already there. Everything
// else a card carries reaches its JSON:API document, which a file has no
// equivalent of: its `file-meta` fields are content-derived and read-only.
// `appendLine` goes the other way for the same reason — a line appended to a
// card's stored file leaves behind bytes that are no longer a card.
const CARRIED_BY: Record<BaseOperationName, readonly DefFamily[]> = {
  read: ['card', 'file', 'base'],
  readSource: ['card', 'file', 'base'],
  create: ['card'],
  update: ['card', 'file'],
  delete: ['card'],
  query: ['card'],
  transform: ['card'],
  appendContainsMany: ['card'],
  appendLine: ['file'],
};

function operationsCarriedBy(family: DefFamily): readonly BaseOperationName[] {
  return BASE_OPERATIONS.filter((base) => CARRIED_BY[base].includes(family));
}

const CARD_OPERATIONS = operationsCarriedBy('card');
const FILE_OPERATIONS = operationsCarriedBy('file');
const BASE_DEF_OPERATIONS = operationsCarriedBy('base');

// The base operations a declaration may neither build on nor be named after.
// A stored-bytes read serves what is on disk: there is no payload to reshape,
// no program stage to run, and no result to project, so a declaration built on
// it would describe work nothing carries out.
//
// Both halves of that refusal matter, because a name and a base are
// independent. The realm answers one of these by name without reading a
// definition at all, so a declaration under the name — whatever base it
// builds on — would be dispatched straight past: the built-in would run and
// the author's operation would never be reached. Refusing the name here is
// what keeps a new declaration out of that state, and refusing the base is
// what stops the behavior being reached under some other name. Lowering
// refuses the name too, so no stored definition can carry one either.
const NOT_DECLARABLE: readonly BaseOperationName[] = ['readSource'];

function isNotDeclarable(name: string): boolean {
  return NOT_DECLARABLE.includes(name as BaseOperationName);
}

// Names the invocation surface owns. `operations(x)` answers a bucket keyed by
// operation name, and `atomic` sits in that namespace beside them; inside a
// batch the builder adds the members that say what an entry runs against. A
// declaration under one of these names could never be reached — the surface's
// own member is what a caller gets — so it is refused where it is written
// rather than shadowed where it is invoked.
//
// `create` is deliberately absent: it is a base operation an author may
// specialize, so the collision with the builder's `create(Type, …)` is settled
// where the batch is built, not here.
const RESERVED_BY_INVOCATION: readonly string[] = [
  'atomic',
  'on',
  'find',
  'parallel',
  'serial',
];

function isReservedByInvocation(name: string): boolean {
  return RESERVED_BY_INVOCATION.includes(name);
}

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

// The caller's identity, which is a user id and nothing else — so the marker
// carries no key, and is not a card. It is stored in text fields and compared
// in filters; a link to the person acting is a `params` member declared with
// `linkTo(…)`.
export interface ActorReference {
  readonly $ref: 'actor';
}

export interface InstanceReference {
  readonly $ref: 'instance';
  readonly key?: string;
}

export interface RealmConfigReference<Key extends string = string> {
  readonly $ref: 'realmConfig';
  readonly key?: Key;
}

export interface CardReference {
  readonly $ref: 'card';
  // No `ActorReference`: the caller is a user id, and no card represents a
  // user, so an actor here would name a link that cannot resolve.
  readonly value:
    | string
    | ParamsReference
    | InstanceReference
    | RealmConfigReference;
}

export type OperationReference =
  | ParamsReference
  | ActorReference
  | InstanceReference
  | RealmConfigReference
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

// The caller's user id, as the realm authenticated them. The rest parameter
// takes `never` so an argument is a type error, and is checked at run time
// for a declaration assembled outside TypeScript.
export function actor(...args: never[]): ActorReference {
  if (args.length > 0) {
    throw new Error(`actor() takes no argument; it is the caller's user id`);
  }
  return { $ref: 'actor' };
}

// Why the caller cannot stand in for a card, wherever one is asked for. The
// realm authenticates a caller as a user id, and no card represents a user,
// so a link built from one names a card that does not exist.
function actorIsNotACard(what: string): string {
  return `${what} takes a card identity, and \`actor()\` is the caller's user id rather than a card — declare the person as a \`params\` member typed \`linkTo(…)\` and link that`;
}

// The invocation target's stored source document — never a live card
// instance. Unavailable to an operation invoked with no target in scope.
export function instance(key?: string): InstanceReference {
  assertOptionalReferenceKey('instance', key);
  return key === undefined ? { $ref: 'instance' } : { $ref: 'instance', key };
}

// A setting of the realm the operation runs in, or the whole map of them when
// no name is given. It is what lets one card type read a value that differs
// per realm — an approver, a threshold, a default — without the type
// hard-coding it.
//
// The name is not checked against anything here, and cannot be: a type is
// declared once and its cards live in whatever realms hold them, so which
// settings exist is only known where the operation runs.
//
// The realm keeps them on its RealmConfig card at `realm.json`, under
// `config`; a program reads one with the `realmConfig("key")` builtin, and a
// declaration reads one through this marker. A realm that configures no such
// setting refuses the invocation rather than resolving the marker to nothing.
export function realmConfig<Key extends string>(
  key?: Key,
): RealmConfigReference<Key> {
  assertOptionalReferenceKey('realmConfig', key);
  return key === undefined
    ? { $ref: 'realmConfig' }
    : { $ref: 'realmConfig', key };
}

// A link identity: the URL of a saved card, or the reference that resolves to
// one — `card(params('activity'))`, `card(instance('id'))`.
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
  if ((reference as { $ref?: unknown }).$ref === 'actor') {
    throw new Error(actorIsNotACard('card()'));
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
      `the bxl tag does not interpolate values; read the payload, the actor, the target and the realm's configuration inside the program with the params(), actor(), instance() and realmConfig() builtins`,
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
  // What decides whether an item is already there. On a collection of links
  // this is compared against the linked card's `id`, so it must be an
  // identity — a card URL, a param declared with `linkTo(…)`, or
  // `instance()`. On a collection of contained values the item is compared
  // whole, so a partial object never matches an item that has any other field
  // set: key such a check on the value the collection actually holds.
  readonly by: OperationValue;
  readonly message?: string;
  // Asks for the values the check reads to be gathered before it runs. A
  // program reads the target's stored document, which holds neither a
  // computed value nor a linked card's fields, so a `unique` path that names
  // one is only checkable against a snapshot — and gathering one costs reads
  // the author is opting into here rather than paying invisibly.
  readonly snapshot?: boolean;
}

export type SetClause = { readonly [fieldName: string]: OperationValue };
export type FillClause = { readonly [fieldName: string]: OperationValue };

// Projects or reshapes the result. May reference the actor, which makes the
// operation's response per-actor — and on a `read`, makes the card's plain
// `GET` uncacheable, since a per-caller body cannot be held in a shared cache
// or answered with a 304.
//
// **It is not an access boundary.** An `output` decides the shape of this
// operation's answer and nothing more: the realm checks its own read/write
// permission and nothing else, so a field left out here is still reachable by
// any caller permitted to read the realm — through the card's plain `read`,
// through its stored source, through a search. Leave a value out because a
// consumer does not need it, never because a caller may not have it.
//
// A projection of a `read` stays a JSON:API document: the response it is
// served in carries a `data` member and every client reads it. What the
// projection puts below `data` is the author's.
export type OperationOutput =
  | BxlProgram
  | { readonly [key: string]: OperationValue };

// A saved search, declared next to the card's other operations and lowered to
// an ordinary realm query. `filter.on` takes the card class itself and the
// code ref is derived when the declaration is lowered; a query that filters on
// the very class it is declared on takes the thunk form, since the class
// binding is not yet initialized while its own statics are being built.
// The realm's query, restricted to what a saved search declares. `realm` in
// the singular is left out because a declared query's scope is the fan-out
// list; `asData` and `fields` are left out because a query operation answers
// with entry rows, a different response shape than a data query.
export interface QueryDeclaration {
  readonly filter?: OperationQueryValue;
  readonly sort?: OperationQueryValue;
  // The full-text term, which a payload may supply.
  readonly queryString?: string | ParamsReference | ActorReference;
  // The realm pages by offset: `size` is the page length and `number` is the
  // 0-based page. There is no cursor paging to declare — the index generation
  // a request is pinned to is the server's to mint, not the author's.
  readonly page?: { readonly size: number; readonly number?: number };
  readonly realms?: readonly string[];
}

export type OperationQueryValue =
  | string
  | number
  | boolean
  | null
  | LinkableDefConstructor
  | (() => LinkableDefConstructor)
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
  //
  // `input` runs first, over the payload the caller sent, and produces the
  // payload the operation uses — so a value it supplies satisfies a declared
  // param the caller left out. It reads `.` (that payload), `params()` and
  // `actor()`, and it produces an object.
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

// Appends one newline-terminated line to a text file. There is no clause: the
// line is the payload, which the base operation reads under `line`, so a
// declaration says which param carries it and nothing more. An `input`
// program is the other way to produce one, for a payload the author would
// rather shape — several members joined into a line, say.
export interface AppendLineOperationDeclaration extends OperationCommon {
  readonly base: 'appendLine';
}

// Appends an item to a card's `containsMany` field by editing the card's
// stored JSON as text, without loading the document — the base operation for a
// collection large enough that loading it is the cost.
//
// One field is named with `field` and its item with `item`; several are named
// together under `fields`, each mapped to its own item. The item is written
// with the same typed references an `append` value is, and is carried to
// invocation as a template rather than a program: an append substitutes values
// into a document, and no BXL runs on its path.
export interface AppendContainsManyOperationDeclaration extends OperationCommon {
  readonly base: 'appendContainsMany';
  readonly field?: string;
  readonly item?: OperationValue;
  readonly fields?: { readonly [fieldName: string]: OperationValue };
}

export type OperationDeclaration =
  | TransformOperationDeclaration
  | CreateOperationDeclaration
  | UpdateOperationDeclaration
  | DeleteOperationDeclaration
  | ReadOperationDeclaration
  | QueryOperationDeclaration
  | AppendLineOperationDeclaration
  | AppendContainsManyOperationDeclaration;

// A base operation a def carries with nothing declared on it. It is not a
// declaration and the union above deliberately cannot express one: an author
// writes no clauses for a base operation, and a `NOT_DECLARABLE` name cannot
// be written at all, so a declaration type that admitted one would invite
// exactly what the decorator refuses. `getOperations` returns both
// shapes, so a consumer reading `base` to dispatch gets every operation a def
// carries — including the ones no `OperationDeclaration` could name.
export interface ImpliedOperation {
  readonly base: BaseOperationName;
}

export type CarriedOperation = OperationDeclaration | ImpliedOperation;

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
  // A stored-bytes read takes no clauses because it takes no declaration at
  // all; the entry is here because this table is exhaustive over the base
  // operations, so a new one has to say what it accepts.
  readSource: [],
  query: ['query'],
  // One field with its item, or several fields each with their own.
  appendContainsMany: ['field', 'item', 'fields'],
  // Appending a line takes no clause: the line is the payload, and the base
  // operation reads it under `line`.
  appendLine: [],
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
  if (isNotDeclarable(key)) {
    throw new Error(
      `${declarationLabel(owner, key)}: "${key}" is a reserved operation name — a "${key}" serves the bytes stored at the def's URL, which the realm answers without reading a definition, so a declaration under this name would never be reached`,
    );
  }
  if (isReservedByInvocation(key)) {
    throw new Error(
      `${declarationLabel(owner, key)}: "${key}" is a member of the invocation surface — operations(instance).${key} and a batch builder's ${key} are that, so a declaration under this name would never be reached`,
    );
  }
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
): Record<string, CarriedOperation> {
  let owner = defConstructorFor(classOrInstance, 'getOperations');
  let operations = emptyOperationRecord() as Record<string, CarriedOperation>;
  for (let base of impliedOperations(owner)) {
    operations[base] = { base };
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
// Every entry here went through the decorator's validation, so a clause that
// names a type is present where its base requires one — a `create` says what
// it creates whichever form its work takes. A clause that describes work may
// be absent when a raw program replaces it. That makes this the reader to
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
    return CARD_OPERATIONS;
  }
  if (isSubclassOf(owner, FileDef)) {
    return FILE_OPERATIONS;
  }
  // The operations every addressable def shares: a `read` serves the def's
  // indexed document, and a `readSource` serves the bytes stored at the
  // instance's URL — a representation every addressable def has whether or
  // not its document is the interesting one.
  return BASE_DEF_OPERATIONS;
}

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
    // Names what arrived, because the commonest way to reach this is a def
    // built by a different copy of the card API — a value that is a def by
    // every appearance and is not an instance of *this* module's `BaseDef`.
    throw new Error(
      `${reader}() takes a class that extends BaseDef, or an instance of one; got ${describeTarget(classOrInstance)}`,
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

// What arrived, in the terms a reader can act on: the class's own name when
// there is one, and otherwise enough of the value to tell a plain object from
// a def from nothing at all.
function describeTarget(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === 'function') {
    return `the class ${value.name || '(anonymous)'}, which does not extend BaseDef`;
  }
  if (typeof value !== 'object') {
    return typeof value;
  }
  let owner = (value as { constructor?: { name?: string } }).constructor;
  return owner
    ? `an instance of ${owner.name || '(anonymous)'}`
    : 'an object with no constructor';
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

// Why this operation runs no BXL program over the target's document, or
// undefined when it runs one. A raw `transformations` program declared on one
// of these would be stored and never reached, which is the one outcome worse
// than refusing it.
//
// The two appends edit the stored file — a line onto the end of a text file,
// an item into a card's JSON — and never build the document a program would
// run against. A file's `update` joins them, because it replaces the content
// wholesale rather than transforming a document; the same base on a card is
// the declarative merge, which does run one. This keys on the base rather than
// on the def family, so a file def's `read` keeps the `output` projection it
// lowers to a program of its own.
function noProgramReason(
  owner: typeof BaseDef,
  base: BaseOperationName,
): string | undefined {
  if (base === 'appendLine' || base === 'appendContainsMany') {
    return `an "${base}" operation appends to the stored file rather than running a program over a document`;
  }
  if (base === 'update' && isSubclassOf(owner, FileDef)) {
    return `an "update" on a file def replaces the file's content wholesale rather than transforming a document`;
  }
  return undefined;
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
  if (isNotDeclarable(base)) {
    throw new Error(
      `${label}: a "${base}" operation serves the bytes stored at the def's URL, so there is nothing for a declaration to specialize or rebind`,
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
  let hasProgram = declaration.transformations !== undefined;
  if (hasProgram) {
    assertBxlProgram(label, 'transformations', declaration.transformations);
    let noProgram = noProgramReason(owner, base);
    if (noProgram) {
      throw new Error(
        `${label}: ${noProgram}, so it carries no \`transformations\``,
      );
    }
    if (usedClauses.length > 0) {
      throw new Error(
        `${label}: a declaration expresses its work either with clauses (${quoteList(
          usedClauses,
        )}) or with a raw \`transformations\` program, not both`,
      );
    }
  }
  let required = REQUIRED_CLAUSE[base];
  if (required !== undefined && declaration[required] === undefined) {
    // A program replaces the work a clause describes, but not a clause that
    // names a type: a program computes a new card's fields without saying
    // what kind of card to create.
    if (TYPE_NAMING_KEYS.includes(required)) {
      throw new Error(
        `${label}: a "${base}" operation needs \`${required}\` to name what it creates`,
      );
    }
    if (!hasProgram) {
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
  if (base === 'query') {
    assertQueryIsWellFormed(label, declaration.query);
  }
}

// The realm's own validator, consulted as a second opinion on a declared
// query.
//
// The placement rule in the walk above encodes where the filter grammar puts
// a type, which means it has to stay in step with a grammar defined
// elsewhere. This hands the query to `assertQuery` — that grammar's one
// definition — with every def class swapped for a sentinel that reads as a
// code ref where a type belongs and as a function everywhere else. The realm
// therefore re-checks both the placement and the rest of the shape, so a
// grammar this module has not kept up with surfaces here rather than at
// invocation.
//
// Skipped when the query carries a typed reference: a reference stands in for
// a value the realm types concretely — a `matches` string, an `in` array — so
// before lowering resolves it, the realm would reject the shape it has.
function assertQueryIsWellFormed(label: string, query: unknown) {
  if (!isPlainObject(query) || holdsReference(query)) {
    return;
  }
  try {
    assertQuery(withTypeSentinels(query));
  } catch (error) {
    if (error instanceof InvalidQueryError) {
      throw new Error(
        `${label}: \`query\` is not a query the realm accepts — ${error.message}`,
      );
    }
    throw error;
  }
}

function holdsReference(node: unknown): boolean {
  if (Array.isArray(node)) {
    return node.some(holdsReference);
  }
  if (!isPlainObject(node)) {
    return false;
  }
  if (hasOwn(node, '$ref') || hasOwn(node, '$bxl')) {
    return true;
  }
  return Object.values(node).some(holdsReference);
}

// A def class stands in for the code ref lowering derives from it. The
// sentinel satisfies the realm's code-ref check, which reads `module` and
// `name`, while carrying a function under `notJson` — which the realm's JSON
// check refuses anywhere it walks a value — so the sentinel is accepted
// exactly where a type belongs and refused wherever a value does.
function withTypeSentinels(node: unknown): unknown {
  if (typeof node === 'function') {
    return {
      notJson: () => {},
      module: TYPE_SLOT_SENTINEL,
      name: TYPE_SLOT_SENTINEL,
    };
  }
  if (Array.isArray(node)) {
    return node.map(withTypeSentinels);
  }
  if (!isPlainObject(node)) {
    return node;
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, withTypeSentinels(value)]),
  );
}

const TYPE_SLOT_SENTINEL = '$operation-type-slot';

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
    assertOnlyKeys(label, 'assert', assertion, [
      'unique',
      'by',
      'message',
      'snapshot',
    ]);
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
    if (
      assertion.snapshot !== undefined &&
      typeof assertion.snapshot !== 'boolean'
    ) {
      throw new Error(`${label}: \`assert.snapshot\` must be a boolean`);
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
  if (base === 'appendLine') {
    assertAppendsALine(label, declaration);
  }
  if (base === 'appendContainsMany') {
    assertNamesItemsToAppend(label, declaration);
  }
  if (base === 'query' && declaration.query !== undefined) {
    let query = declaration.query;
    if (!isPlainObject(query) || Object.keys(query).length === 0) {
      throw new Error(
        `${label}: \`query\` must be an object with at least one of \`filter\`, \`sort\`, \`queryString\`, \`page\` and \`realms\``,
      );
    }
    assertOnlyKeys(label, 'query', query, [
      'filter',
      'sort',
      'queryString',
      'page',
      'realms',
    ]);
    if (query.queryString !== undefined) {
      let term = query.queryString;
      if (
        !(typeof term === 'string' && term.length > 0) &&
        !isReferenceMarker(term)
      ) {
        throw new Error(
          `${label}: \`query.queryString\` must be a search term, or a reference to one`,
        );
      }
    }
    if (query.page !== undefined) {
      if (!isPlainObject(query.page)) {
        throw new Error(
          `${label}: \`query.page\` must be an object with \`size\` and an optional \`number\``,
        );
      }
      assertOnlyKeys(label, 'query.page', query.page, ['size', 'number']);
      // A page with no length pages nothing: the offset the realm computes is
      // a multiple of `size`.
      let size = query.page.size;
      if (typeof size !== 'number' || !Number.isInteger(size) || size < 1) {
        throw new Error(
          `${label}: \`query.page.size\` must be a positive integer`,
        );
      }
      let pageNumber = query.page.number;
      if (
        pageNumber !== undefined &&
        (typeof pageNumber !== 'number' ||
          !Number.isInteger(pageNumber) ||
          pageNumber < 0)
      ) {
        throw new Error(
          `${label}: \`query.page.number\` must be a whole number, counting from 0`,
        );
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

// An `appendLine` names no clause, so the only thing it can get wrong is
// where the line comes from. The base operation appends what the payload
// carries under `line`, so a declaration that neither declares that param nor
// shapes one with an `input` program describes an append with nothing to
// append — every invocation of it would be refused at the endpoint.
//
// A `linkTo(…)` there is refused for the same reason it would be refused at
// the endpoint: a link is a card's identity, and what goes into a text file is
// text.
function assertAppendsALine(
  label: string,
  declaration: Record<string, unknown>,
) {
  if (declaration.input !== undefined) {
    return;
  }
  let line = (declaration.params as Record<string, unknown> | undefined)?.line;
  if (line === undefined) {
    throw new Error(
      `${label}: an "appendLine" operation appends the line its payload carries, so it declares a \`line\` param — or an \`input\` program that produces one`,
    );
  }
  if (isPlainObject(line)) {
    throw new Error(
      `${label}: \`params.line\` is the text a line holds, so it is a field class rather than a linkTo(…)`,
    );
  }
}

// An `appendContainsMany` names what it appends and where, in one of two
// spellings: `field` with its `item`, or `fields` mapping each field name to
// its own item. Mixing them would leave two answers for a field named in both,
// so a declaration picks one.
function assertNamesItemsToAppend(
  label: string,
  declaration: Record<string, unknown>,
) {
  let singular =
    declaration.field !== undefined || declaration.item !== undefined;
  let plural = declaration.fields !== undefined;
  if (singular && plural) {
    throw new Error(
      `${label}: an "appendContainsMany" operation names one field with its \`item\`, or several under \`fields\` — not both`,
    );
  }
  if (!singular && !plural) {
    throw new Error(
      `${label}: an "appendContainsMany" operation needs \`field\` and \`item\`, or \`fields\` mapping each field to the item to append to it`,
    );
  }
  if (plural) {
    let fields = declaration.fields;
    if (!isPlainObject(fields) || Object.keys(fields).length === 0) {
      throw new Error(
        `${label}: \`fields\` must be an object mapping each \`containsMany\` field to the item to append to it`,
      );
    }
    for (let [name, item] of Object.entries(fields)) {
      if (item === undefined) {
        throw new Error(
          `${label}: \`fields.${name}\` must carry the item to append to "${name}"`,
        );
      }
    }
    return;
  }
  if (typeof declaration.field !== 'string' || declaration.field.length === 0) {
    throw new Error(
      `${label}: \`field\` must name the \`containsMany\` field to append to`,
    );
  }
  if (declaration.item === undefined) {
    throw new Error(
      `${label}: an "appendContainsMany" operation needs an \`item\` to append to "${declaration.field}"`,
    );
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
      let linked = (type as { $linkTo: unknown }).$linkTo;
      if (
        isDefConstructor(linked) &&
        !isSubclassOf(linked, CardDef) &&
        !isSubclassOf(linked, FileDef)
      ) {
        throw new Error(
          `${label}: param "${name}" links to a card or file class — a link points at something with a URL`,
        );
      }
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
// A def class is legal only where the grammar names a type: the `of` a
// `create` targets, and a filter node's `on` or `type` (`type` is how the
// realm spells a pure card-type filter). Those are positions, not key names —
// under `eq` / `in` / `contains` / `range` / `matches` the keys are field
// names, so an `on` there means a field called `on` and a class would lower
// to nothing, leaving a saved search that matches every card instead of one.
function assertReferencesResolve(
  label: string,
  declaration: Record<string, unknown>,
  paramNames: Set<string>,
) {
  // The current DFS path, not a memo: a node is unwound on the way back out,
  // so a cycle is caught while the same object legitimately appearing twice
  // is validated in each place it appears.
  let ancestors = new Set<object>();
  let walk = (node: unknown, path: string, position: WalkPosition) => {
    if (node === null) {
      return;
    }
    if (typeof node === 'function') {
      if (position !== 'type') {
        throw new Error(
          `${label}: \`${path}\` is a function; a declaration is data — name a run-time value with params(), actor(), instance(), realmConfig() or card(), or a program with the bxl tag`,
        );
      }
      // A thunk defers its class past this point; one named directly is held
      // to a kind that has a type to name. A field is addressed through the
      // card that contains it and has no type row of its own.
      if (
        isDefConstructor(node) &&
        !isSubclassOf(node, CardDef) &&
        !isSubclassOf(node, FileDef)
      ) {
        throw new Error(
          `${label}: \`${path}\` must be a card or file class — a field has no type of its own to name`,
        );
      }
      return;
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
    if (isReferenceMarker(node)) {
      assertValidReference(label, path, node, paramNames, ancestors);
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
      let elementPosition = positionInside(position);
      node.forEach((entry, index) =>
        walk(entry, `${path}[${index}]`, elementPosition),
      );
    } else {
      for (let [key, value] of Object.entries(node)) {
        // The params schema holds field classes and linkTo markers rather
        // than references, and is validated on its own terms.
        if (position === 'declaration' && key === 'params') {
          continue;
        }
        walk(
          value,
          path === '' ? key : `${path}.${key}`,
          positionUnder(position, key),
        );
      }
    }
    ancestors.delete(node);
  };
  walk(declaration, '', 'declaration');
}

// Where in a declaration the walk currently is. Only the positions that
// govern whether a def class belongs are named; everything else is data.
type WalkPosition =
  | 'declaration'
  | 'value'
  | 'type'
  | 'query'
  | 'filter'
  | 'filterList'
  | 'sortList'
  | 'sortEntry';

// The realm's filter grammar, followed structurally: a filter node carries an
// optional `on` (or a `type`, for a pure card-type filter) and one predicate,
// where `any` and `every` hold further filter nodes and `not` holds one. A
// sort entry names the type its `by` path is rooted in. Anything else — the
// field-name maps under the predicates, `page`, `realms` — is data.
function positionUnder(position: WalkPosition, key: string): WalkPosition {
  switch (position) {
    case 'declaration':
      if (key === 'of') {
        return 'type';
      }
      return key === 'query' ? 'query' : 'value';
    case 'query':
      if (key === 'filter') {
        return 'filter';
      }
      return key === 'sort' ? 'sortList' : 'value';
    case 'filter':
      if (key === 'on' || key === 'type') {
        return 'type';
      }
      if (key === 'any' || key === 'every') {
        return 'filterList';
      }
      return key === 'not' ? 'filter' : 'value';
    case 'sortEntry':
      return key === 'on' ? 'type' : 'value';
    // A code ref written out by hand is plain data, and nothing below a
    // value slot names a type.
    case 'type':
    case 'value':
    case 'filterList':
    case 'sortList':
      return 'value';
  }
}

function positionInside(position: WalkPosition): WalkPosition {
  switch (position) {
    case 'filterList':
      return 'filter';
    case 'sortList':
      return 'sortEntry';
    default:
      return 'value';
  }
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
  ancestors: Set<object>,
) {
  if (ancestors.has(node)) {
    throw new Error(
      `${label}: \`${path}\` refers back to a value that contains it; a declaration is a tree`,
    );
  }
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
    case 'actor': {
      // Named before the generic key check, so a key gets the reason rather
      // than a list of the one key that is allowed.
      if (reference.key !== undefined) {
        throw new Error(
          `${label}: the actor reference at \`${path}\` carries a key; actor() is the caller's user id and has no members to read`,
        );
      }
      assertOnlyKeys(label, path, reference, ['$ref']);
      return;
    }
    case 'instance': {
      assertOnlyKeys(label, path, reference, ['$ref', 'key']);
      if (
        reference.key !== undefined &&
        (typeof reference.key !== 'string' || reference.key.length === 0)
      ) {
        throw new Error(
          `${label}: the instance reference at \`${path}\` must name a member, or none at all`,
        );
      }
      return;
    }
    case 'realmConfig': {
      // The name is not held to anything a declaration knows: which settings a
      // realm carries is the realm's, and a type is declared once for every
      // realm that holds a card of it.
      assertOnlyKeys(label, path, reference, ['$ref', 'key']);
      if (
        reference.key !== undefined &&
        (typeof reference.key !== 'string' || reference.key.length === 0)
      ) {
        throw new Error(
          `${label}: the realmConfig reference at \`${path}\` must name a setting, or none at all`,
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
      if (!isReferenceMarker(value)) {
        throw new Error(
          `${label}: the card reference at \`${path}\` must carry a card URL or a reference to one`,
        );
      }
      if ((value as { $ref?: unknown }).$ref === 'actor') {
        throw new Error(
          `${label}: ${actorIsNotACard(`the card reference at \`${path}\``)}`,
        );
      }
      ancestors.add(node);
      assertValidReference(
        label,
        `${path}.value`,
        value as object,
        paramNames,
        ancestors,
      );
      ancestors.delete(node);
      return;
    }
    default:
      throw new Error(
        `${label}: \`${path}\` is not a typed reference; build one with params(), actor(), instance(), realmConfig() or card()`,
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

// A marker is identified by a key of its own. Reached through a prototype it
// would validate here and then serialize as `{}`.
function isReferenceMarker(value: unknown): boolean {
  return isPlainObject(value) && hasOwn(value, '$ref');
}

function isBxlMarker(value: unknown): boolean {
  return isPlainObject(value) && hasOwn(value, '$bxl');
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

// ============================================================================
// Invoking operations
// ============================================================================
//
// `operations(x)` answers the callable form of everything `x` carries: a card
// instance's own operations, a class's type-scoped ones, and — for a card
// instance — `atomic`, which sends several as one all-or-nothing batch.
//
//   let result = await operations(report).addComment({ body: 'Reviewed.' });
//   let [activity] = await operations(classroom).atomic((b) => {
//     let created = b.create(ClassroomActivity, { headline: 'Lab safety' });
//     b.addActivity({ activity: created });
//     return [created];
//   });
//
// Nothing hangs off the instance itself: a card's property namespace belongs to
// its author's fields, so an instance is passed to a function the way it is to
// `isSaved(instance)`. That also keeps the transport explicit — the host
// registers the one that carries the caller's session, and this module reads it
// back through a bridge rather than holding a service it could not reach from
// inside a card module.
//
// What a bucket carries is what can be invoked on what it was built for. A
// file's bucket has its reads and the two writes that work on its bytes and
// nothing else; a class's has the creates and the saved searches its author
// declared. `readSource` has no member at all — the card source and byte routes
// serve stored bytes.
//
// **A saved search is as fresh as the index.** A declared `query` is carried
// out by the search engine rather than by the realm's operation endpoint, so it
// reads the search index — which lags a write until that write is indexed. To
// read a card you just wrote, read the card (`operations(card).read()`, or the
// store); a query is for collections, and its resource refreshes itself as the
// realms it covers index. It is also the one member that is not awaited: it
// answers the live entries resource, so make the call once and keep what it
// answers rather than calling it again per render.
//
// **Typing an instance call.** A def's operations are declared as statics, and
// TypeScript cannot read a class's statics through an instance type, so an
// instance call is typed from the class only when the call names it:
// `operations<typeof Report>(report)` types the declared operations and makes
// the names the def does not carry visible as absent. A call that does not name
// the class types the base operations and `atomic` exactly and leaves a
// declared name callable without checking its payload — which is what keeps the
// ordinary spelling, `operations(report).addComment(…)`, from needing a type
// argument it would carry only to satisfy the compiler. The run-time bucket is
// the same either way: it carries what the def carries.

// The values an operation answers with, re-exported so a card declares,
// invokes and reads a result through one import. Their definitions live with
// the client core, which is isomorphic — a realm reads the same shapes off the
// wire that a caller reads back.
export type {
  InvokeOptions,
  OperationDocument,
  OperationResultTree,
  OperationValueResult,
  OperationWriteResult,
  SearchEntries,
  SearchInvokeOptions,
} from '@cardstack/runtime-common';
export { OperationsError } from '@cardstack/runtime-common';

// The payload an operation takes, as an argument list. A declaration's own
// `params` schema is the single source for it, so an operation that declares
// none takes none — and one whose schema survived inference takes exactly what
// it declared.
type PayloadArgs<Declaration> = Declaration extends {
  params: infer Schema extends object;
}
  ? [payload: { [Key in keyof Schema]: ParamValueOf<Schema[Key]> }]
  : [payload?: Record<string, unknown>];

// What an operation resolves to, by the behavior it is built on: a write
// reports the identity and version of what it wrote, a delete reports that
// there is nothing left to describe, and a read reports its document.
type ResultOf<Declaration> = Declaration extends { base: 'delete' }
  ? null
  : Declaration extends { base: 'read' }
    ? OperationDocument
    : OperationWriteResult;

// The behaviors invocable on an instance, and the one invocable on a class.
// A declared `create` appears in both: invoked on the class it mints a card
// outright, and invoked on an instance that instance is the context its
// declaration reads.
type InstanceScopedBase =
  | 'read'
  | 'update'
  | 'delete'
  | 'transform'
  | 'appendLine'
  | 'appendContainsMany'
  | 'create';
type TypeScopedBase = 'create' | 'query';

type ScopedBase<Scope extends 'instance' | 'type'> = Scope extends 'instance'
  ? InstanceScopedBase
  : TypeScopedBase;

// The names a def declares that are invocable in this scope, read off the
// class the declarations are statics of.
type DeclaredNames<Type, Scope extends 'instance' | 'type'> = {
  [Name in keyof OperationsOf<Type>]: OperationsOf<Type>[Name] extends {
    base: infer Base extends BaseOperationName;
  }
    ? Base extends ScopedBase<Scope>
      ? Name
      : never
    : never;
}[keyof OperationsOf<Type>];

// A type-scoped call takes the same options the base `create` does: it has no
// instance to read a realm from, so the realm is the caller's to name — and a
// declared create is reached that way as readily as the base one.
type ScopedArgs<
  Declaration,
  Scope extends 'instance' | 'type',
> = Scope extends 'type'
  ? [...PayloadArgs<Declaration>, opts?: InvokeOptions]
  : PayloadArgs<Declaration>;

type DeclaredOperationMembers<Type, Scope extends 'instance' | 'type'> = {
  [Name in DeclaredNames<Type, Scope>]: OperationsOf<Type>[Name] extends {
    base: 'query';
  }
    ? QueryOperation<OperationsOf<Type>[Name]>
    : (
        ...args: ScopedArgs<OperationsOf<Type>[Name], Scope>
      ) => Promise<ResultOf<OperationsOf<Type>[Name]>>;
};

// A saved search, as the two ways one is reached.
//
// Called, it answers the live entries resource a search runs as — the one
// return shape in this API that is not an awaited result, because a query is
// carried out by the search engine rather than by the realm's operation
// endpoint: results are a collection that re-runs as realms index, not a
// document a request returns once. Make the call once and keep what it
// answers — a field, a one-time assignment, never in a getter or during a
// render — since every call builds an independent search.
//
// `.query()` answers the wire query the same invocation resolves to, which is
// what a card hands to `@context.searchResultsComponent` to render the rows
// itself.
export interface QueryOperation<Declaration> {
  (
    ...args: [...PayloadArgs<Declaration>, opts?: SearchInvokeOptions]
  ): SearchEntries;
  // Answers no query when the session cannot say who the caller is — nobody
  // signed in, or a render, which authenticates as itself rather than as a
  // viewer. The search component reads that as an idle search, so a card hands
  // the result over either way and an actor-scoped search renders its rows
  // when a viewer is there to have them.
  query(
    ...args: [...PayloadArgs<Declaration>, opts?: SearchInvokeOptions]
  ): SearchEntryWireQuery | undefined;
}

// Whether the call named the class its operations are declared on. It did not
// when the type parameter is still its own constraint, which is every call
// that passes an instance without a type argument — `InstanceType<Type>` is
// not an inference site, so nothing there narrows `Type`.
//
// The constraint travels in rather than being assumed: each overload
// constrains `Type` differently, and comparing against `BaseDefConstructor`
// answers "no" for every one of them, because a card constructor's instances
// carry members a base def's do not. That made this fallback dead and the
// ordinary spelling — `operations(report).addComment(…)` — uncallable.
type NamesNoClass<Type, Constraint> = [Constraint] extends [Type]
  ? true
  : false;

// The operations a call could not read off the class: callable by name, with a
// payload nothing here can check. Present only on a call that named no class,
// so the exact surface — and the names a def does not carry — stays visible to
// the calls that did.
export interface UncheckedOperations {
  [name: string]: (payload?: any, opts?: any) => Promise<any>;
}

type Bucket<Type, Constraint, Members> =
  NamesNoClass<Type, Constraint> extends true
    ? Members & UncheckedOperations
    : Members;

// A card's declarative update: the field values to merge, and the links to
// replace. It is the same document a `PATCH` of the card carries, which is the
// behavior this is the other front door onto — minus the type, which the call
// fills from the class of the card being patched.
export interface CardPatch {
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}

// Items to add to a card's `containsMany` fields — one field with its items,
// or several fields each with their own. The card's stored JSON is edited in
// place, so the cost does not grow with a collection that is already large.
export type AppendContainsManyPayload =
  | { field: string; items: unknown[] }
  | { fields: Record<string, unknown[]> };

// The base operations every card instance carries, whatever its author
// declared. A bare `transform` is not among them: a transform runs a program
// over the card's document and a batch entry has no member to carry one, so the
// behavior is reached under the name a declaration gives it.
export interface CardInstanceBaseOperations {
  // No payload: the read executor reads none, and a declaration that would
  // give one meaning — an `input`, an `output`, a program — is refused as a
  // stage a batch does not run. A parameterized read is a declared operation,
  // and arrives under its own name with its own payload type.
  read(): Promise<OperationDocument>;
  update(patch: CardPatch): Promise<OperationWriteResult>;
  delete(): Promise<null>;
  appendContainsMany(
    payload: AppendContainsManyPayload,
  ): Promise<OperationWriteResult>;
}

// A file's, whose writes work on its bytes: `update` replaces the content and
// `appendLine` adds one newline-terminated line without reading what is
// already there. A file's metadata is derived from its bytes, so there is no
// document to merge into and no collection to append to.
export interface FileInstanceBaseOperations {
  read(): Promise<OperationDocument>;
  update(payload: { content: string }): Promise<OperationWriteResult>;
  appendLine(payload: { line: string }): Promise<OperationWriteResult>;
}

// Everything else addressable: the document read every def has.
export interface BaseInstanceOperations {
  read(): Promise<OperationDocument>;
}

// What a class carries: the create that mints one of its cards. The field
// values are the new card's own, and the realm is where it lands — the
// session's default writable realm when the caller names none, which is the
// realm a card created through the store lands in.
export interface CardTypeBaseOperations {
  create(
    attributes?: Record<string, unknown>,
    opts?: InvokeOptions,
  ): Promise<OperationWriteResult>;
}

// A declaration takes the place of the base operation it names, so a card that
// declares `delete` on `transform` has the declared member and not the base
// one.
type WithDeclared<BaseMembers, Declared> = Omit<BaseMembers, keyof Declared> &
  Declared;

export type CardInstanceOperations<Type> = Bucket<
  Type,
  CardDefConstructor,
  WithDeclared<
    CardInstanceBaseOperations,
    DeclaredOperationMembers<Type, 'instance'>
  > &
    AtomicOperations<Type>
>;

export type FileInstanceOperations<Type> = Bucket<
  Type,
  FileDefConstructor,
  WithDeclared<
    FileInstanceBaseOperations,
    DeclaredOperationMembers<Type, 'instance'>
  >
>;

export type CardTypeOperations<Type> = WithDeclared<
  CardTypeBaseOperations,
  DeclaredOperationMembers<Type, 'type'>
>;

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

declare const resultOfHandle: unique symbol;
declare const targetExpects: unique symbol;

// What a call on the batch builder answers with: a stand-in for the result the
// entry will produce, and — for a create — the local id a later entry links
// the new card by.
export interface BatchHandle<Result> extends OperationHandle {
  readonly [resultOfHandle]: Result;
}

// A target found by search rather than named by reference, for entries that run
// against whatever the realm matches.
export interface QueryTarget<
  Expect extends 'one' | 'many',
> extends QueryTargetHandle {
  readonly [targetExpects]: Expect;
}

type HandleResult<Handle> =
  Handle extends BatchHandle<infer Result> ? Result : never;

// The results of a batch.
//
// A builder that returns nothing is answered positionally: every entry's
// result, in the order the entries were registered, with a group's members
// nested where the group sat. A builder that returns handles is answered with
// those handles' results, in the order it listed them — which is what types
// each one, since a handle knows the behavior its entry is built on.
export type BatchResults<Returned> = Returned extends void
  ? OperationResultTree
  : Returned extends readonly unknown[]
    ? { -readonly [Index in keyof Returned]: HandleResult<Returned[Index]> }
    : never;

export interface AtomicOperations<Type> {
  atomic<const Returned extends readonly unknown[] | void>(
    build: (builder: BatchBuilder<Type>) => Returned,
  ): Promise<BatchResults<Returned>>;
}

// A batch's payloads take one value a single call's cannot: the handle of a
// card the same batch mints, wherever a link is expected. The card has no URL
// until the batch commits, and the handle is the local id the entry links it
// by — so this is the one spelling of a link to a card that does not exist yet.
type BatchParamValue<Param> =
  Param extends LinkToParam<LinkableDefConstructor>
    ? LinkParamValue | BatchHandle<unknown>
    : ParamValueOf<Param>;

type BatchPayloadArgs<Declaration> = Declaration extends {
  params: infer Schema extends object;
}
  ? [payload: { [Key in keyof Schema]: BatchParamValue<Schema[Key]> }]
  : [payload?: Record<string, unknown>];

type BatchMembers<Type> = {
  [Name in DeclaredNames<Type, 'instance'>]: (
    ...args: BatchPayloadArgs<OperationsOf<Type>[Name]>
  ) => BatchHandle<ResultOf<OperationsOf<Type>[Name]>>;
};

// The base operations of a card in the batch, registering an entry rather than
// sending one.
export interface CardBatchBaseOperations {
  read(): BatchHandle<OperationDocument>;
  update(patch: CardPatch): BatchHandle<OperationWriteResult>;
  delete(): BatchHandle<null>;
  appendContainsMany(
    payload: AppendContainsManyPayload,
  ): BatchHandle<OperationWriteResult>;
}

// Operations a batch registers, for a card whose class the call named — and,
// when it did not, the same unchecked callables a single call falls back to.
export interface UncheckedBatchOperations {
  [name: string]: (payload?: any) => BatchHandle<any>;
}

export type BatchOperations<Type> =
  NamesNoClass<Type, CardDefConstructor> extends true
    ? WithDeclared<CardBatchBaseOperations, BatchMembers<Type>> &
        UncheckedBatchOperations
    : WithDeclared<CardBatchBaseOperations, BatchMembers<Type>>;

// A file's, in the batch. Its writes work on the file's bytes, which is what
// puts a log line and the card change that produced it in one commit.
export interface FileBatchBaseOperations {
  read(): BatchHandle<OperationDocument>;
  update(payload: { content: string }): BatchHandle<OperationWriteResult>;
  appendLine(payload: { line: string }): BatchHandle<OperationWriteResult>;
}

export type FileBatchOperations<Type> =
  NamesNoClass<Type, FileDefConstructor> extends true
    ? WithDeclared<FileBatchBaseOperations, BatchMembers<Type>> &
        UncheckedBatchOperations
    : WithDeclared<FileBatchBaseOperations, BatchMembers<Type>>;

// A file named by its path, whose type nothing here knows. A path says where
// the bytes are and not what they are, so what it carries is what every file
// carries and nothing more — a name a `FileDef` subclass declares is not
// reachable this way.
//
// Deliberately not the unchecked fallback a call that named no class gets.
// That fallback is honest where a `Proxy` passes every name to the realm to
// resolve, as a query target's does; the bucket behind a path is a plain
// object built from the operations above, so a name outside them would type-
// check and then arrive as a bare `TypeError` rather than as a sentence. And
// the realm could not resolve one anyway: it types a file by its *registered*
// extension, so the unregistered ones a log tends to use resolve as a card and
// carry no declared file operation at all.
export type PathBatchOperations = FileBatchBaseOperations;

// The operations of whatever a search reached. Which ones those cards carry is
// their own types' to say and the realm resolves each name against the card it
// reached, so a name is not knowable here — and for the same reason the result
// is the realm's answer as it reported it: whether an identity or a document
// comes back is that card's to decide. Under `expect: 'many'` the array holds
// one result per card the search reached — one per match when the target names
// no `field`, and one per distinct card the hop reached when it does, which is
// fewer when several matches link to the same card.
export type QueriedOperations<Expect extends 'one' | 'many'> = Record<
  string,
  (
    payload?: Record<string, unknown>,
  ) => BatchHandle<
    Expect extends 'many' ? OperationDocument[] : OperationDocument
  >
>;

export type BatchBuilder<Type> = BatchOperations<Type> & {
  // Another card in this batch's realm, or a target found with `find`. A card
  // in another realm is refused: a batch commits under one realm's write lock.
  on<Other extends CardDefConstructor>(
    instance: InstanceType<Other>,
  ): BatchOperations<Other>;
  // A file in this batch's realm. It is reached the same way a card is, and
  // for the same reason: an entry that appends to a log has to commit with the
  // card change it records, or the two can disagree.
  //
  // `Other` is never inferred here — `InstanceType<Other>` is not an inference
  // site — so each overload's parameter is its constraint's instance type, and
  // which one a value selects is decided by assignability to that. A card and
  // a file are assignable to neither the other's, so their order carries
  // nothing.
  on<Other extends FileDefConstructor>(
    instance: InstanceType<Other>,
  ): FileBatchOperations<Other>;
  // A file named by its path in this batch's realm, for the file no instance
  // can stand for: one the realm does not hold yet. A `FileDef` is hydrated
  // from a stored file, so a log that has never been written has nothing to
  // pass here — and an `appendLine` creates the file it appends to, which is
  // the whole reason a card needs to be able to name one.
  //
  // Written the way the realm addresses it: `'logs/lot-114.txt'`, or with a
  // leading slash for the realm's root. An absolute URL works too, and one
  // outside this batch's realm is refused — a batch commits under one realm's
  // write lock. A realm addressed by a registered prefix is refused rather
  // than resolved: resolving a prefix means reading the virtual network, which
  // is no part of what a card module can see.
  on(path: string): PathBatchOperations;
  on<Expect extends 'one' | 'many'>(
    target: QueryTarget<Expect>,
  ): QueriedOperations<Expect>;
  // A card this batch mints. The handle is the local id a later entry links it
  // by, so a link to a card that has no URL yet is a value rather than a token
  // to keep consistent by hand.
  create<NewCard extends CardDefConstructor>(
    type: NewCard,
    attributes?: Record<string, unknown>,
    opts?: { relationships?: Record<string, unknown> },
  ): BatchHandle<OperationWriteResult>;
  // A card the caller is already holding, minted under the name they hold it
  // by. The instance is the whole of what the entry says, so there are no
  // attributes to pass beside it.
  create<NewCard extends CardDefConstructor>(
    instance: InstanceType<NewCard>,
  ): BatchHandle<OperationWriteResult>;
  find(
    filter: OperationFilter,
    opts?: { field?: string; expect?: 'one' },
  ): QueryTarget<'one'>;
  find(
    filter: OperationFilter,
    opts: { field?: string; expect: 'many' },
  ): QueryTarget<'many'>;
  // Members that may be staged at the same time, and members that must be
  // staged one after another. The top level of a batch is serial, and the two
  // nest to any depth; results mirror the nesting.
  parallel<const Returned extends readonly unknown[] | void>(
    build: (builder: BatchBuilder<Type>) => Returned,
  ): BatchHandle<BatchResults<Returned>>;
  serial<const Returned extends readonly unknown[] | void>(
    build: (builder: BatchBuilder<Type>) => Returned,
  ): BatchHandle<BatchResults<Returned>>;
};

// A filter as an author writes it: the realm's own query filter, with the card
// classes themselves naming types. The classes are read as the code refs that
// name them on the way to the wire, the same reading a declaration's type
// clauses get when they are lowered.
export type OperationFilter = Record<string, unknown>;

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

export function operations<Type extends CardDefConstructor>(
  instance: InstanceType<Type>,
): CardInstanceOperations<Type>;
export function operations<Type extends FileDefConstructor>(
  instance: InstanceType<Type>,
): FileInstanceOperations<Type>;
export function operations<Type extends BaseDefConstructor>(
  instance: InstanceType<Type>,
): BaseInstanceOperations;
export function operations<Type extends CardDefConstructor>(
  type: Type,
): CardTypeOperations<Type>;
// The implementation answers a bucket whose shape the overloads above pin: the
// members it carries are decided at run time from what the def carries, so
// there is no one return type the four scopes share.
export function operations(target: unknown): any {
  return buildOperations(subjectFor(target), {
    transport: getOperationsTransport(),
    subject: (other: unknown) => subjectFor(other),
    codeRef: (value: unknown) => identifyDef(value),
    resourceFor: (instance: unknown) => adoptedResource(instance),
  });
}

// The resource a card the caller is already holding would be minted from.
//
// The same document the card's own save sends, minus the parts a batch entry
// has nowhere to put: no linked graph rides along, because an entry carries a
// resource rather than a document, so a card the batch is to co-create is
// registered as its own `create` entry and linked by the handle that answers.
function adoptedResource(instance: unknown): Record<string, unknown> {
  let { id: _id, ...resource } = serializeCard(instance as CardDef, {
    useAbsoluteURL: true,
    omitQueryFields: true,
    includedScope: 'none',
  }).data;
  return resource as unknown as Record<string, unknown>;
}

// What `operations()` was handed, in the terms the client core works in. The
// core resolves no name against a class and reads no instance: a def's
// declarations and an instance's identity are only readable from inside a card
// module, which is where this runs.
function subjectFor(target: unknown): OperationsSubject {
  if (typeof target === 'string') {
    // A file named by its path. Which operations it carries is the file
    // family's to say and is answered here, where `FileDef` is in scope; where
    // the path points is the batch's to say, since a path alone names no
    // realm. So the path travels as the id and the batch resolves it.
    return {
      scope: 'instance',
      family: 'file',
      displayName: `file ${target}`,
      operations: carriedOperations(FileDef),
      id: target,
    };
  }
  if (isDefConstructor(target)) {
    let codeRef = identifyCard(target);
    if (!codeRef) {
      // A type-scoped call names no resource, so the class is the only thing
      // it can say it runs against — and a class no module exports cannot be
      // named on the wire at all. Refused here, where the caller can see which
      // class they passed, rather than at the entry that would have to invent
      // a type for it.
      throw new Error(
        `operations() takes a class some module exports, and no module exports ${defName(
          target,
        )} — an operation on a type names it by its module and export`,
      );
    }
    return {
      scope: 'type',
      family: familyOf(target, 'operations'),
      displayName: defName(target),
      operations: carriedOperations(target),
      codeRef,
    };
  }
  let owner = defConstructorFor(target as BaseDef, 'operations');
  let instance = target as CardDef;
  let realm = instance[realmURL];
  // The instance's own type travels with it: a patch of a card's document is a
  // card resource, which names the type it patches, and the caller is naming
  // field values rather than restating what the card already is.
  let codeRef = identifyCard(owner);
  return {
    scope: 'instance',
    family: familyOf(owner, 'operations'),
    displayName: defName(owner),
    operations: carriedOperations(owner),
    ...(instance.id ? { id: instance.id } : {}),
    ...(instance[localId] ? { localId: instance[localId] } : {}),
    ...(realm ? { realmURL: realm.href } : {}),
    ...(codeRef ? { codeRef } : {}),
  };
}

// Every operation the def carries, and for each one whether an author declared
// it. The client core reads the distinction for one behavior: a declared create
// is anchored on an instance for context, while the base create it builds on
// has no instance to read.
function carriedOperations(
  owner: typeof BaseDef,
): Record<string, CarriedOperationInfo> {
  let carried = Object.create(null) as Record<string, CarriedOperationInfo>;
  for (let base of impliedOperations(owner)) {
    carried[base] = { base, declared: false };
  }
  for (let [name, declaration] of Object.entries(declaredOperations(owner))) {
    carried[name] = {
      base: declaration.base,
      declared: true,
      ...(declaration.base === 'query'
        ? { query: queryDeclaration(declaration) }
        : {}),
    };
  }
  return carried;
}

// A declared query travels whole rather than resolved, because a saved search
// is resolved when it is invoked: the query still names its types with the
// classes themselves and still holds the markers an invocation fills, and what
// fills them — the caller's identity, the payload — is known only then.
function queryDeclaration(
  declaration: OperationDeclaration,
): CarriedQueryDeclaration {
  let { query, params } = declaration as QueryOperationDeclaration;
  return {
    ...(query === undefined
      ? {}
      : { query: query as unknown as Record<string, unknown> }),
    ...(params === undefined
      ? {}
      : { params: params as unknown as Record<string, unknown> }),
  };
}

// Which def family the target belongs to, which is what decides the shape of
// its bucket. A field is not addressable at all, so it carries nothing to
// invoke — its data is reached through the operations of the card that contains
// it.
function familyOf(
  owner: typeof BaseDef,
  reader: string,
): 'card' | 'file' | 'base' {
  if (isSubclassOf(owner, FieldDef)) {
    throw new Error(
      `${reader}() takes a card, a file or a class of one; a field has no URL of its own, so nothing is invocable on it — reach a field's data through the operations of the card that contains it`,
    );
  }
  if (isSubclassOf(owner, CardDef)) {
    return 'card';
  }
  if (isSubclassOf(owner, FileDef)) {
    return 'file';
  }
  return 'base';
}

// A def class, or a thunk deferring one past its own class body, as the code
// ref that names it — the same reading the realm gives a declaration it
// lowers, so a class written in a query means one type on both sides.
function identifyDef(value: unknown): CodeRef | undefined {
  return codeRefForDef(value, identifyCard);
}

function defName(owner: typeof BaseDef): string {
  return owner.displayName || owner.name || 'card';
}
