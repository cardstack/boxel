import { parseNativeJq } from '../bxl/bridge/native.ts';
import {
  mutationBuiltinLibraries,
  resolveBuiltinRegistry,
  type ResolvedBuiltinRegistry,
} from '../bxl/registry/index.ts';
import { applyNormalBinaryOperator } from '../jqtools/evaluate/applyBinary.ts';
import { evaluateItemsWithRegistry } from '../jqtools/evaluate/evaluate.ts';
import {
  createItem,
  type Item,
  isTrue,
} from '../jqtools/evaluate/utils/utils.ts';
import {
  withRequestContext,
  withRuntimeDiagnostics,
} from '../jqtools/evaluate/runtimeState.ts';
import type {
  DestructuringAst,
  ExpressionAst,
  NormalBinaryOperator,
  RuntimeAnnotatedExpressionAst,
} from '../jqtools/parser/AST.ts';
import {
  parseBxlMutationProgram,
  printMutationAst,
  readAssertSnapshotOption,
  type MutationAssignmentOperator,
  type ParsedMutationArgument,
  type ParsedMutationStatement,
} from './syntax.ts';
import {
  addressesPrototype,
  clone,
  deleteAt,
  equalJson,
  hasAt,
  pathKey,
  setAt,
  valueAt,
} from './json-path.ts';
import {
  classifyOverlayRead,
  EMPTY_OVERLAY_INDEX,
  indexBxlMutationOverlays,
  layerBxlMutationOverlays,
  overlayWriteOwner,
  settleOverlayUpdate,
  type OverlayIndex,
} from './overlays.ts';
import {
  BxlMutationError,
  type BxlMutationContext,
  type BxlMutationField,
  type BxlMutationFieldType,
  type BxlMutationIntent,
  type BxlMutationJson,
  type BxlMutationPath,
  type BxlMutationPlan,
  type BxlMutationPlanOptions,
  type BxlMutationPrepareOptions,
  type BxlMutationReadEvent,
  type BxlMutationReturning,
  type BxlMutationSchema,
  type BxlMutationStatementPlan,
  type BxlMutationUnavailableOverlay,
  type PreparedBxlMutation,
} from './types.ts';

/**
 * The value a `card(…)` marker leaves behind while the value expression it
 * sits inside is evaluated — whether it stands for the whole value or for one
 * Field nested inside it.
 *
 * Identity is what makes a marker a marker, and it is the only thing that
 * does. A program builds arbitrary JSON, so a marker recognised by its shape
 * could be forged: a value spelled out as data would name a relationship
 * target that the program never wrote `card(…)` for, and the vocabulary the
 * platform reasons about — declaration lowering emits `card(…)`, the profile
 * classifies it, a reviewer reads it — would have a second, silent spelling. A
 * symbol key has no JSON spelling, and the planner mints one only from a
 * `card(…)` node the program itself wrote — directly where such a node is the
 * whole value, and by rewriting the node where it sits inside one — so a
 * marker can be neither forged nor confused with the data around it.
 *
 * Keeping it also means not losing it, which is a property of the routes a
 * value travels rather than of the symbol: a rebuilt object keeps its string
 * keys and drops its symbol ones. So every route the walk resolves through is
 * one that carries the brand — object and array literals build around it and
 * `+` spreads it — and `VALUE_COMBINING_OPERATORS` says which those are.
 * `clone` is not one, since `structuredClone` drops symbol-keyed properties,
 * which is why the evaluated tree is searched for markers before anything
 * copies it and a reference becomes a `cardId` at the write path rather than
 * being stored in the working document.
 */
const CARD_MARKER = Symbol('bxl.mutation.card-marker');

interface CardReference {
  readonly [CARD_MARKER]: string;
}

function cardReference(id: string): CardReference {
  return { [CARD_MARKER]: id };
}

function isCardReference(value: unknown): value is CardReference {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as Record<symbol, unknown>)[CARD_MARKER] === 'string',
  );
}

/** `card(id)` as a program writes it: the node the planner rewrites. */
function isCardCall(
  ast: ExpressionAst,
): ast is Extract<ExpressionAst, { type: 'filter' }> {
  return (
    ast.type === 'filter' && ast.name === 'card/1' && ast.args.length === 1
  );
}

/** One `card(…)` marker, at its path inside the value that carried it. */
interface NestedCardReference {
  path: BxlMutationPath;
  id: string;
}

/** A value expression's result, and the markers found inside it. */
interface EvaluatedValue {
  value: BxlMutationJson | CardReference;
  references: NestedCardReference[];
}

interface ResolvedLocation {
  path: BxlMutationPath;
  value: BxlMutationJson | undefined;
  exists: boolean;
}

interface FieldResolution {
  field?: BxlMutationField;
  fieldType?: BxlMutationFieldType;
  fieldPath: BxlMutationPath;
  relationship?: { type: 'linksTo' | 'linksToMany'; path: BxlMutationPath };
  writeBehavior?: 'write' | 'skip';
}

interface PlannerContext {
  prepare: BxlMutationPrepareOptions;
  plan: BxlMutationPlanOptions;
  registry: ResolvedBuiltinRegistry;
  /** What the overlays answer for, against the document as it now stands. */
  overlays: OverlayIndex;
  /** Paths earlier statements have made their own. */
  claimed: ReadonlySet<string>;
  /** The layered view of the working document, and what it was built from. */
  view?: { of: BxlMutationJson; revision: number; value: BxlMutationJson };
  /** Bumped by every write, so a cached view is never handed back stale. */
  revision: number;
  onRead?: (event: BxlMutationReadEvent) => void;
  /**
   * The request context as the host supplied it, held by reference.
   *
   * Not copied here: the builtins copy each value as they hand it to a
   * program, which is what keeps the host's object out of the plan and out of
   * reach of a builtin that writes into its argument. A copy at this boundary
   * would clone the whole context once per plan whether a program reads any
   * of it or not.
   *
   * On the way out, a written value is isolated by `setAt`'s own copy and by
   * the structural inserts' — not by the per-statement `clone(working)`,
   * which runs on entry to the *next* statement and so does not cover the
   * last one.
   */
  requestContext?: BxlMutationContext;
}

/**
 * The document an expression is evaluated against: the Card's own document
 * with the overlays layered under it.
 *
 * The planner's working state is the Card's document alone, so a plan's output
 * and its intents carry stored values without anything having to be undone.
 * The view exists only for the duration of an evaluation, and shares the
 * working document's shape — an overlay never adds or retypes a container —
 * so a path resolved in one addresses the same element in the other.
 */
function readView(
  root: BxlMutationJson,
  context: PlannerContext,
): BxlMutationJson {
  if (context.overlays.empty) return root;
  const cached = context.view;
  if (cached && cached.of === root && cached.revision === context.revision) {
    return cached.value;
  }
  const value = layerBxlMutationOverlays(root, context.overlays);
  context.view = { of: root, revision: context.revision, value };
  return value;
}

/**
 * Record that the working document changed, so the next read builds a fresh
 * view. A bulk statement writes between locations and its value expression may
 * read what an earlier location left behind.
 */
function documentChanged(context: PlannerContext): void {
  context.revision++;
}

/**
 * What a statement's reads resolved to. `strict` reads raise
 * `snapshot-unavailable` on a path the host could not supply; a best-effort
 * assert takes the unavailability back instead and fails with its own message.
 */
interface RecordedReads {
  events: BxlMutationReadEvent[];
  overlay: boolean;
  unavailable?: BxlMutationUnavailableOverlay;
}

/**
 * Where an expression's reads are anchored, and whether an unavailable one
 * stops the statement. A value expression reads from the Card root; the value
 * side of `|=` reads from the location it updates.
 */
interface ReadContext {
  prefix?: BxlMutationPath;
  policy?: 'strict' | 'best-effort';
  /**
   * Report only reads an overlay answered. A location is resolved for every
   * statement, and saying so each time would drown the log in the paths a
   * program is plainly writing to; what matters is when index data helped
   * choose the write set.
   */
  onlyOverlay?: boolean;
}

function recordReads(
  argument: ParsedMutationArgument,
  input: BxlMutationJson,
  context: PlannerContext,
  statement: number,
  reads: ReadContext = {},
): RecordedReads {
  const result: RecordedReads = { events: [], overlay: false };
  if (context.onRead === undefined && context.overlays.empty) return result;
  const prefix = reads.prefix ?? [];
  for (const relative of argument.readPaths) {
    const path = [...prefix, ...relative];
    const resolved = classifyOverlayRead(
      context.overlays,
      path,
      valueAt(input, relative),
    );
    if (reads.onlyOverlay && resolved.event.tier === 'source') continue;
    result.events.push(resolved.event);
    if (resolved.event.tier !== 'source') result.overlay = true;
    if (resolved.unavailable && !result.unavailable) {
      result.unavailable = resolved.unavailable;
    }
    context.onRead?.(resolved.event);
  }
  if ((reads.policy ?? 'strict') === 'strict' && result.unavailable) {
    const { path, tier, reason } = result.unavailable;
    throw new BxlMutationError(
      'plan',
      'snapshot-unavailable',
      statement,
      `The ${tier} value at ${namePath(path)} is unavailable (${reason}).`,
      { details: { path, tier, reason } },
    );
  }
  return result;
}

/** How a path reads in a message. The root has no name of its own. */
function namePath(path: string): string {
  return path === '' ? 'the whole Card' : path;
}

/** Keep an update's result to what the Card can store. */
function settleUpdate(
  produced: BxlMutationJson,
  layered: BxlMutationJson,
  location: ResolvedLocation,
  context: PlannerContext,
  statement: number,
): BxlMutationJson {
  const settled = settleOverlayUpdate(
    context.overlays,
    location.path,
    layered,
    location.value,
    produced,
  );
  if ('value' in settled) return settled.value;
  throw new BxlMutationError(
    'validate',
    settled.tier === 'computed' ? 'computed-read-only' : 'write-through-link',
    statement,
    settled.tier === 'computed'
      ? `${settled.refused} is a computed value and cannot be written.`
      : `${settled.refused} belongs to a linked Card and cannot be written through the link.`,
    { details: { path: settled.refused, tier: settled.tier } },
  );
}

/** Overlay values are read-only: a write that lands on one is refused. */
function assertWritableOverlayPath(
  path: BxlMutationPath,
  context: PlannerContext,
  statement: number,
): void {
  const owner = overlayWriteOwner(context.overlays, path);
  if (!owner) return;
  throw new BxlMutationError(
    'validate',
    owner.tier === 'computed' ? 'computed-read-only' : 'write-through-link',
    statement,
    owner.tier === 'computed'
      ? `${owner.path} is a computed value and cannot be written.`
      : `${owner.path} belongs to a linked Card and cannot be written through the link.`,
    { details: { path: owner.path, tier: owner.tier } },
  );
}

function collectionAt(
  root: BxlMutationJson,
  path: BxlMutationPath,
): BxlMutationJson[] {
  const value = valueAt(root, path);
  if (!Array.isArray(value))
    throw new Error(`Location ${pathKey(path)} is not a collection.`);
  return value;
}

function objectId(value: BxlMutationJson | undefined): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  return typeof value.id === 'string' ? value.id : undefined;
}

/**
 * Describe a value that is not JSON, or `undefined` when it is.
 *
 * `BxlMutationContext` declares the context as JSON, but a type is not a
 * runtime guarantee: a `Date`, `Map`, `Set`, `RegExp` or `TypedArray` reaches
 * a program as itself and can be written into the document, and so does a
 * `bigint`. The `bigint` is the sharpest edge — `params("v") | tostring` on
 * one yields `undefined`, the silent unset these builtins exist to refuse —
 * but a live `Map` in a plan is no better, and `NaN` reaching a document as
 * `null` is a value the host never sent.
 */
function nonJsonTypeName(value: unknown): string | undefined {
  if (value === null) return undefined;
  switch (typeof value) {
    case 'boolean':
      return undefined;
    case 'number':
      // `NaN` and the infinities have no JSON form and serialize to `null`,
      // which is a value the host did not send appearing in the document.
      return Number.isFinite(value) ? undefined : String(value);
    case 'string':
      return undefined;
    case 'bigint':
    case 'symbol':
    case 'function':
      return typeof value;
    case 'undefined':
      // Tolerated rather than rejected: a host spreading an object with
      // optional fields produces these readily, and the builtins already
      // treat a key held with `undefined` as absent when a program reads it.
      return undefined;
    default:
      break;
  }
  if (Array.isArray(value)) return undefined;
  // The built-in tag decides. It reports `Date`, `Map` and `URL` reliably,
  // and says `Object` for every plain object — one from another realm and one
  // carrying only a class's own data fields included, since both hold nothing
  // but JSON.
  //
  // A `Symbol.toStringTag` can rename the tag or blank it, so an empty tag is
  // reported rather than read as "no problem found". The reverse, an exotic
  // object branded `Object`, is not distinguishable from a plain one in JS and
  // is not defended against: this guard is for a host's mistake, and a
  // symbol-keyed brand cannot come from a JSON payload.
  const tag = Object.prototype.toString.call(value).slice(8, -1);
  if (tag === 'Object') return undefined;
  return tag || 'an object with no type name';
}

/**
 * Reject a request context carrying anything the planner cannot put in a JSON
 * document, naming the path so the host can find it.
 *
 * The check is the only thing standing between a host's mistake and a live
 * `Map` or a `bigint` in a plan, so it runs before the context is reachable
 * rather than leaving the type declaration as the sole guard.
 */
function assertJsonContext(context: BxlMutationContext) {
  // Two sets, because they answer different questions. `ancestors` is the
  // current path and finds a cycle; `cleared` is every object already walked
  // and keeps shared structure from being walked once per route to it —
  // without it a graph that merely shares subtrees costs exponential time.
  const ancestors = new Set<unknown>();
  const cleared = new Set<unknown>();
  const walk = (value: unknown, path: string) => {
    const typeName = nonJsonTypeName(value);
    if (typeName) {
      throw new BxlMutationError(
        'plan',
        'context-not-json',
        1,
        `The request context at ${path} is not JSON — its type is ` +
          `${typeName}. The host supplies context values already resolved ` +
          'to JSON.',
      );
    }
    if (value === null || typeof value !== 'object') return;
    if (ancestors.has(value)) {
      throw new BxlMutationError(
        'plan',
        'context-not-json',
        1,
        `The request context is cyclic at ${path}; a JSON document cannot ` +
          'hold a cycle.',
      );
    }
    if (cleared.has(value)) return;
    ancestors.add(value);
    if (Array.isArray(value)) {
      // An index loop, not `forEach`, which skips holes — and a hole reads as
      // `undefined`, which an array cannot carry: an absent object member
      // serializes as absent, but an absent array entry serializes as `null`,
      // a value the host never sent.
      for (let index = 0; index < value.length; index += 1) {
        const entry: unknown = value[index];
        if (entry === undefined) {
          throw new BxlMutationError(
            'plan',
            'context-not-json',
            1,
            `The request context at ${path}[${index}] has no value. An ` +
              'array entry cannot be absent the way an object member can — ' +
              'it would reach the document as `null`.',
          );
        }
        walk(entry, `${path}[${index}]`);
      }
    } else {
      // Own properties, enumerable or not, matching what the builtins read.
      for (const key of Object.getOwnPropertyNames(value)) {
        walk((value as Record<string, unknown>)[key], `${path}.${key}`);
      }
    }
    ancestors.delete(value);
    cleared.add(value);
  };

  for (const slot of ['params', 'actor', 'instance'] as const) {
    const value = context[slot];
    if (value === undefined) continue;
    try {
      walk(value, `context.${slot}`);
    } catch (error) {
      if (error instanceof BxlMutationError) throw error;
      // A property accessor on the host's object threw. That is still an
      // unusable context, reported as one instead of escaping raw.
      throw new BxlMutationError(
        'plan',
        'context-not-json',
        1,
        `The request context at context.${slot} could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
  }
}

/** Evaluate one expression against the budget the caller already opened. */
type EvaluateItems = (ast: ExpressionAst, input: Item[]) => Item[];

/**
 * Run `body` under one runtime budget, handing it the evaluator to use.
 *
 * Every limit lives on the frame `withRuntimeDiagnostics` opens — steps,
 * milliseconds and output bytes all start again with each one — so what shares
 * a frame shares a ceiling. A value expression and the `card(…)` arguments
 * standing inside it are one evaluation, and spend the host's allowance
 * between them rather than each taking the whole of it.
 */
function withEvaluationBudget<T>(
  context: PlannerContext,
  body: (evaluate: EvaluateItems) => T,
): T {
  const evaluate: EvaluateItems = (ast, input) =>
    Array.from(evaluateItemsWithRegistry(ast, input, context.registry));
  const run = () =>
    withRuntimeDiagnostics(() => body(evaluate), context.prepare.runtimeLimits);
  // Scoped outside the diagnostics frame, and around every statement's
  // evaluation, so `params`/`actor`/`instance` read this plan's context
  // wherever in the program they appear.
  const runtime = context.requestContext
    ? withRequestContext(context.requestContext, run)
    : run();
  if (runtime.error) throw runtime.error;
  return runtime.result as T;
}

function evaluateItems(
  ast: ExpressionAst,
  input: Item[],
  context: PlannerContext,
): Item[] {
  return withEvaluationBudget(context, (evaluate) => evaluate(ast, input));
}

/** Every expression a destructuring pattern holds, keys included. */
function destructuringExpressions(
  destructuring: DestructuringAst,
): ExpressionAst[] {
  switch (destructuring.type) {
    case 'arrayDestructuring':
      return destructuring.destructuring.flatMap(destructuringExpressions);
    case 'objectDestructuring':
      return destructuring.entries.flatMap((entry) => [
        ...(typeof entry.key === 'string' ? [] : [entry.key]),
        ...(entry.destructuring
          ? destructuringExpressions(entry.destructuring)
          : []),
      ]);
    default:
      return [];
  }
}

/** Every child expression of a node, so a whole tree can be searched. */
function childExpressions(ast: ExpressionAst): ExpressionAst[] {
  switch (ast.type) {
    case 'binary':
      return [ast.left, ast.right];
    case 'def':
      return ast.next ? [ast.body, ast.next] : [ast.body];
    case 'str':
      return ast.interpolated
        ? ast.parts.filter(
            (part): part is ExpressionAst => typeof part !== 'string',
          )
        : [];
    case 'filter':
      return ast.args;
    case 'if':
      return [
        ast.cond,
        ast.then,
        ...(ast.elifs ?? []).flatMap((elif) => [elif.cond, elif.then]),
        ...(ast.else ? [ast.else] : []),
      ];
    case 'try':
      return ast.catch ? [ast.body, ast.catch] : [ast.body];
    case 'reduce':
      return [ast.expr, ast.init, ast.update];
    case 'foreach':
      return [
        ast.expr,
        ast.init,
        ast.update,
        ...(ast.extract ? [ast.extract] : []),
      ];
    case 'label':
      return [ast.next];
    case 'unary':
    case 'iterator':
      return [ast.expr];
    case 'index':
      return typeof ast.index === 'string' ? [ast.expr] : [ast.expr, ast.index];
    case 'slice':
      return [
        ast.expr,
        ...(ast.from ? [ast.from] : []),
        ...(ast.to ? [ast.to] : []),
      ];
    case 'array':
      return ast.expr ? [ast.expr] : [];
    case 'object':
      return ast.entries.flatMap((entry) => [
        ...(typeof entry.key === 'string' ? [] : [entry.key]),
        ...(entry.value === undefined ? [] : [entry.value]),
      ]);
    case 'varDeclaration':
      return [
        ast.expr,
        ...ast.destructuring.flatMap(destructuringExpressions),
        ast.next,
      ];
    default:
      return [];
  }
}

/**
 * Binary operators whose operands are values the result is built from, rather
 * than a stream re-rooted or a decision made from them.
 *
 * `*` is not one of them, though it combines values too. It merges objects
 * recursively, and the merge rebuilds each object from its string keys, so a
 * marker at a key the left operand already holds an object at is merged into
 * and its brand dropped — which would take the relationship with it and leave
 * the write looking like it succeeded. Refusing the position reports what a
 * program cannot express here instead of losing an edge to it; `+` is the
 * merge a value expression writes part of a contained value with, and it
 * spreads its operands rather than descending into them.
 */
const VALUE_COMBINING_OPERATORS: ReadonlySet<string> = new Set([
  ',',
  '//',
  '+',
]);

function containsCardCall(ast: ExpressionAst): boolean {
  return isCardCall(ast) || childExpressions(ast).some(containsCardCall);
}

/** The Card a `card(…)` marker names, read from its one argument. */
function readCardId(
  argument: ExpressionAst,
  input: BxlMutationJson,
  evaluate: EvaluateItems,
  statement: number,
): string {
  const items = evaluate(argument, [createItem(input)]);
  if (items.length !== 1 || typeof items[0]!.value !== 'string') {
    throw new BxlMutationError(
      'plan',
      'card-id-invalid',
      statement,
      'card(id) requires exactly one string Card ID.',
    );
  }
  return items[0]!.value;
}

/**
 * A node standing in for one marker, yielding it and nothing else.
 *
 * The Card it names is read when the node is reached, not while the tree is
 * being rewritten, so a marker in a branch the program does not take costs
 * nothing: no argument evaluated for a branch that never runs, no error from
 * one that only makes sense there, and no share of the statement's steps. The
 * budget frame is already open around the whole evaluation, so reading it here
 * is still metered with everything else.
 *
 * `singleOutput` stays false, as it is for every filter node the annotator
 * marks: the single-output evaluator has no case for a filter and throws on
 * one. Nothing in the walk puts a marker where that evaluator runs, and saying
 * `true` here would arm that throw for whoever widens the walk next.
 */
function cardMarkerNode(
  argument: ExpressionAst,
  input: BxlMutationJson,
  evaluate: EvaluateItems,
  statement: number,
): ExpressionAst {
  let marker: CardReference | undefined;
  const node: RuntimeAnnotatedExpressionAst = {
    type: 'filter',
    name: '_card_marker/0',
    arity: 0,
    args: [],
    singleOutput: false,
    resolvedNative: function* () {
      marker ??= cardReference(
        readCardId(argument, input, evaluate, statement),
      );
      yield createItem(marker);
    },
  };
  return node;
}

/**
 * Resolve the `card(…)` markers a value expression builds into its result, so
 * the rest of the expression can evaluate as jq wrote it.
 *
 * A marker reads its argument against the input the value expression itself was
 * handed, so the walk follows the nodes that pass that input down unchanged and
 * whose operands flow into the result: object entries, array and comma streams,
 * the operands of `//` and `+`, and the branches of an `if`. Everywhere
 * else the marker is left as written and `evaluateSingleJson` reports it as
 * unresolvable — a node that re-roots the input (the body of `map`, either side
 * of a pipe) would answer it from the wrong place, and a condition chooses a
 * branch rather than being the value. `try` needs no thought here: the mutation
 * profile refuses it.
 *
 * A subtree carrying no marker comes back as it went in, so a program without
 * one is never rebuilt.
 */
function resolveValueTreeCards(
  ast: ExpressionAst,
  input: BxlMutationJson,
  evaluate: EvaluateItems,
  statement: number,
): ExpressionAst {
  if (isCardCall(ast)) {
    return cardMarkerNode(ast.args[0]!, input, evaluate, statement);
  }
  const resolve = (child: ExpressionAst) =>
    resolveValueTreeCards(child, input, evaluate, statement);
  switch (ast.type) {
    case 'object': {
      let changed = false;
      const entries = ast.entries.map((entry) => {
        if (entry.value === undefined) return entry;
        const value = resolve(entry.value);
        if (value === entry.value) return entry;
        changed = true;
        return { ...entry, value };
      });
      return changed ? { ...ast, entries } : ast;
    }
    case 'array': {
      if (!ast.expr) return ast;
      const expr = resolve(ast.expr);
      return expr === ast.expr ? ast : { ...ast, expr };
    }
    case 'binary': {
      // `.` merged with an object literal is how a program writes part of a
      // contained value, so the operators that combine two values into the one
      // that results carry markers as much as the structural nodes do.
      if (!VALUE_COMBINING_OPERATORS.has(ast.operator)) return ast;
      const left = resolve(ast.left);
      const right = resolve(ast.right);
      return left === ast.left && right === ast.right
        ? ast
        : { ...ast, left, right };
    }
    case 'if': {
      const branches = ast.elifs?.map((elif) => {
        const then = resolve(elif.then);
        return then === elif.then ? elif : { ...elif, then };
      });
      const then = resolve(ast.then);
      const otherwise = ast.else === undefined ? undefined : resolve(ast.else);
      const changed =
        then !== ast.then ||
        otherwise !== ast.else ||
        Boolean(branches?.some((elif, index) => elif !== ast.elifs![index]));
      return changed
        ? {
            ...ast,
            then,
            ...(branches === undefined ? {} : { elifs: branches }),
            ...(otherwise === undefined ? {} : { else: otherwise }),
          }
        : ast;
    }
    default:
      return ast;
  }
}

/**
 * Copy an evaluated value into JSON, lifting every marker out of it.
 *
 * A marker's slot is left holding `null` and is filled in by the caller, the
 * only place that knows the Field the value lands in: what the Card stores
 * drops the relationship entirely, and the planner's own view puts the loaded
 * Card there instead.
 */
function liftCardMarkers(raw: unknown): {
  value: BxlMutationJson;
  references: NestedCardReference[];
} {
  const references: NestedCardReference[] = [];
  const copy = (value: unknown, path: BxlMutationPath): BxlMutationJson => {
    if (isCardReference(value)) {
      references.push({ path, id: value[CARD_MARKER] });
      return null;
    }
    if (Array.isArray(value)) {
      return value.map((entry, index) => copy(entry, [...path, index]));
    }
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          copy(entry, [...path, key]),
        ]),
      );
    }
    return value as BxlMutationJson;
  };
  return { value: copy(raw, []), references };
}

function evaluateSingleJson(
  argument: ParsedMutationArgument,
  input: BxlMutationJson,
  context: PlannerContext,
  statement: number,
  reads: ReadContext = {},
): EvaluatedValue {
  recordReads(argument, input, context, statement, reads);
  return withEvaluationBudget(context, (evaluate): EvaluatedValue => {
    if (isCardCall(argument.ast)) {
      return {
        value: cardReference(
          readCardId(argument.ast.args[0]!, input, evaluate, statement),
        ),
        references: [],
      };
    }
    const resolved = resolveValueTreeCards(
      argument.ast,
      input,
      evaluate,
      statement,
    );
    if (containsCardCall(resolved)) {
      throw new BxlMutationError(
        'validate',
        'card-marker-position',
        statement,
        'card(id) names the Card a relationship points at, so it stands where a value is written: on its own, or inside an object or array the value expression builds.',
      );
    }
    const values = evaluate(resolved, [createItem(input)]);
    if (values.length !== 1) {
      throw new BxlMutationError(
        'plan',
        'value-cardinality',
        statement,
        `Mutation value expressions must produce exactly one value; received ${values.length}.`,
      );
    }
    if (resolved === argument.ast) {
      return {
        value: clone(values[0]!.value) as BxlMutationJson,
        references: [],
      };
    }
    const lifted = liftCardMarkers(values[0]!.value);
    // A marker the whole value resolved to is the whole-value form arrived at
    // by another route — a conditional, say — and answers the same way.
    const whole = lifted.references.find(
      (reference) => reference.path.length === 0,
    );
    return whole
      ? { value: cardReference(whole.id), references: [] }
      : { value: lifted.value, references: lifted.references };
  });
}

function resolveLocations(
  argument: ParsedMutationArgument,
  root: BxlMutationJson,
  context: PlannerContext,
  statement: number,
  cardinality: 'one' | 'bulk' = argument.bulk ? 'bulk' : 'one',
): ResolvedLocation[] {
  const view = readView(root, context);
  // A selector reads the document to decide what it matches, so an unavailable
  // value cannot be allowed to quietly settle a write set. A location that
  // addresses one place directly selects nothing, and whatever it reads its
  // statement reads too.
  if (argument.bulk) {
    recordReads(argument, view, context, statement, { onlyOverlay: true });
  }
  let items: Item[];
  try {
    items = evaluateItems(argument.ast, [createItem(view)], context);
  } catch (error) {
    throw new BxlMutationError(
      'plan',
      'target-evaluation',
      statement,
      `Could not resolve mutation target ${argument.canonical}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const locations = items.map((item) => {
    if (
      !item.path.every(
        (part) => typeof part === 'string' || typeof part === 'number',
      )
    ) {
      throw new BxlMutationError(
        'validate',
        'location-not-concrete',
        statement,
        'Mutation locations must resolve to concrete string/number paths.',
      );
    }
    const path = item.path as BxlMutationPath;
    return { path, value: valueAt(root, path), exists: hasAt(root, path) };
  });
  const unique = new Map(
    locations.map((location) => [pathKey(location.path), location]),
  );
  if (unique.size !== locations.length) {
    throw new BxlMutationError(
      'plan',
      'target-duplicate',
      statement,
      'A mutation selector resolved the same concrete path more than once.',
    );
  }
  const deduplicated = [...unique.values()];
  if (cardinality === 'one' && deduplicated.length === 0) {
    throw new BxlMutationError(
      'plan',
      'target-not-found',
      statement,
      'Mutation target matched no locations.',
    );
  }
  if (cardinality === 'one' && deduplicated.length > 1) {
    throw new BxlMutationError(
      'plan',
      'target-ambiguous',
      statement,
      `Mutation target must match exactly one location; received ${deduplicated.length}.`,
    );
  }
  if (cardinality === 'bulk' && deduplicated.length === 0) {
    throw new BxlMutationError(
      'plan',
      'bulk-target-empty',
      statement,
      'Explicit bulk target matched no locations.',
    );
  }
  return deduplicated;
}

function fieldByKey(
  schema: BxlMutationSchema,
  key: string,
): BxlMutationField | undefined {
  return schema.fields.find((field) => field.key === key);
}

function nestedSchema(field: BxlMutationField): BxlMutationSchema | undefined {
  if (field.item) return field.item;
  if (field.fields) return { fields: field.fields };
  return undefined;
}

/**
 * What a Field with no Fields of its own descends into: nothing.
 *
 * A path that keeps going past such a Field addresses something the schema
 * does not describe, and reading the next key against the *parent* schema
 * would answer it with a sibling — `.label.friend` on a scalar `label`
 * resolving the `friend` beside it, and naming a Field the path never reaches.
 */
const NO_FIELDS: BxlMutationSchema = { fields: [] };

function resolveField(
  path: BxlMutationPath,
  context: PlannerContext,
  statement: number,
): FieldResolution {
  if (addressesPrototype(path)) {
    throw new BxlMutationError(
      'validate',
      'prototype-path-forbidden',
      statement,
      'Mutation paths cannot address JavaScript prototype keys.',
    );
  }
  if (path.some((part) => part === 'relationships' || part === 'included')) {
    throw new BxlMutationError(
      'plan',
      'storage-projection-forbidden',
      statement,
      'Mutation paths address the loaded Card model, not JSON:API storage projections.',
    );
  }
  if (path.length === 0) {
    const root = context.prepare.schema.rootField;
    const relationship =
      root?.fieldType === 'linksTo' || root?.fieldType === 'linksToMany'
        ? { type: root.fieldType, path: [] as BxlMutationPath }
        : undefined;
    if (root?.writable === false && root.writeBehavior !== 'skip') {
      throw new BxlMutationError(
        'validate',
        'field-read-only',
        statement,
        'The targeted Field is read-only.',
      );
    }
    return {
      fieldType: root?.fieldType,
      fieldPath: [],
      relationship,
      writeBehavior: root?.writeBehavior,
    };
  }

  let schema = context.prepare.schema;
  const rootField =
    context.prepare.targetKind === 'field'
      ? context.prepare.schema.rootField
      : undefined;
  let field: BxlMutationField | undefined = rootField
    ? {
        key: '',
        fieldType: rootField.fieldType,
        writable: rootField.writable,
        writeBehavior: rootField.writeBehavior,
        item: rootField.item,
        kind:
          rootField.fieldType === 'containsMany' ||
          rootField.fieldType === 'linksToMany'
            ? 'array'
            : rootField.item
              ? 'object'
              : 'scalar',
      }
    : undefined;
  let fieldPath: BxlMutationPath = [];
  let relationship: FieldResolution['relationship'] =
    rootField?.fieldType === 'linksTo' || rootField?.fieldType === 'linksToMany'
      ? { type: rootField.fieldType, path: [] }
      : undefined;
  let writeBehavior = rootField?.writeBehavior;
  if (rootField?.writable === false && writeBehavior !== 'skip') {
    throw new BxlMutationError(
      'validate',
      'field-read-only',
      statement,
      'The targeted Field is read-only.',
    );
  }
  for (let index = 0; index < path.length; index++) {
    const part = path[index]!;
    if (
      relationship &&
      typeof part === 'string' &&
      index > relationship.path.length
    ) {
      throw new BxlMutationError(
        'validate',
        'relationship-traversal',
        statement,
        'Mutation may change a relationship edge but cannot traverse it to mutate the related Card.',
      );
    }
    if (typeof part === 'number') {
      if (
        !field ||
        (field.fieldType !== 'containsMany' &&
          field.fieldType !== 'linksToMany' &&
          field.kind !== 'array')
      ) {
        throw new BxlMutationError(
          'validate',
          'path-schema-mismatch',
          statement,
          `Unexpected collection index at ${pathKey(path.slice(0, index + 1))}.`,
        );
      }
      schema = nestedSchema(field) ?? NO_FIELDS;
      field = undefined;
      continue;
    }
    field = fieldByKey(schema, part);
    if (!field) {
      throw new BxlMutationError(
        'validate',
        'field-unknown',
        statement,
        `Mutation path references unknown schema field ${pathKey(path.slice(0, index + 1))}.`,
      );
    }
    fieldPath = path.slice(0, index + 1);
    writeBehavior = field.writeBehavior;
    if (field.writable === false && writeBehavior !== 'skip') {
      throw new BxlMutationError(
        'validate',
        'field-read-only',
        statement,
        `Field ${field.key} is read-only.`,
      );
    }
    if (field.fieldType === 'linksTo' || field.fieldType === 'linksToMany') {
      relationship = { type: field.fieldType, path: [...fieldPath] };
      const selectsRelationshipItem =
        field.fieldType === 'linksToMany' &&
        index === path.length - 2 &&
        typeof path[index + 1] === 'number';
      if (index < path.length - 1 && !selectsRelationshipItem) {
        throw new BxlMutationError(
          'validate',
          'relationship-traversal',
          statement,
          'Mutation may change a relationship edge but cannot traverse it to mutate the related Card.',
        );
      }
    }
    schema = nestedSchema(field) ?? NO_FIELDS;
  }
  return {
    field,
    fieldType: field?.fieldType,
    fieldPath,
    relationship,
    writeBehavior,
  };
}

function validateWritableLocations(
  locations: ResolvedLocation[],
  argument: ParsedMutationArgument,
  context: PlannerContext,
  statement: number,
): FieldResolution[] {
  if (
    context.prepare.targetKind === 'card' &&
    locations.some((location) => location.path.length === 0)
  ) {
    throw new BxlMutationError(
      'plan',
      'card-root-write',
      statement,
      'Mutation profile cannot replace a complete Card root.',
    );
  }
  if (
    argument.explicitIndex &&
    context.plan.delivery === 'streaming' &&
    !context.plan.baseRevision
  ) {
    throw new BxlMutationError(
      'validate',
      'position-unstable',
      statement,
      'Numeric collection positions require a pinned base revision during streaming execution.',
    );
  }
  return locations.map((location) => {
    let field: FieldResolution;
    try {
      field = resolveField(location.path, context, statement);
    } catch (error) {
      // The overlay often has the more specific reason to refuse a path the
      // schema rejects — a write through a link, which the schema can only
      // report as traversal. Let it speak first.
      assertWritableOverlayPath(location.path, context, statement);
      throw error;
    }
    // The schema is the authority on the Fields a Card declares. Where it
    // already answers a write with an intentional no-op, an overlay does not
    // turn that into an error: the refusal is a backstop for paths the schema
    // has no opinion about, not a second opinion about the ones it does.
    if (field.writeBehavior !== 'skip') {
      assertWritableOverlayPath(location.path, context, statement);
    }
    return field;
  });
}

function loadedCard(
  id: string,
  context: PlannerContext,
  statement: number,
): BxlMutationJson {
  const card = context.plan.resolveCard?.(id) ?? context.plan.cards?.[id];
  if (card === undefined) {
    throw new BxlMutationError(
      'plan',
      'card-not-loaded',
      statement,
      `card(${JSON.stringify(id)}) is not present in the supplied loaded Card Store projection.`,
    );
  }
  return clone(card);
}

/**
 * One marker resolved against the Field it lands on.
 *
 * `strip` is the relationship's own subtree inside the value rather than the
 * marker's slot, because a `linksToMany` holds its edges as a collection and
 * the whole collection is the relationship — none of it is stored as a value.
 */
interface NestedRelationship {
  /** Where the marker sat inside the value. */
  path: BxlMutationPath;
  /** What the stored value must not carry, inside the value. */
  strip: BxlMutationPath;
  /** Absent where the Field takes the write as an intentional no-op. */
  intent?: BxlMutationIntent;
  /** The loaded Card the marker named, for the planner's own view. */
  card?: BxlMutationJson;
}

/**
 * Resolve the markers lifted out of a value against the Fields they fill.
 *
 * `base` is where the value lands, so joining it to a marker's path inside the
 * value names a Field. That Field has to be a relationship: a link is an edge
 * in the Card's relationship map with no value of its own to hold it, which is
 * also why the stored value sheds the relationship's subtree —
 * `.examples[0].friend` is written as an edge at `examples.0.friend`, never as
 * a member of the contained value. The planner's own view keeps the loaded
 * Card there, so a later statement reads a link this program just wrote the
 * same way it reads one the document already held.
 */
function nestedRelationships(
  references: NestedCardReference[],
  base: BxlMutationPath,
  context: PlannerContext,
  statement: number,
): NestedRelationship[] {
  return references.map((reference) => {
    const path = [...base, ...reference.path];
    const field = resolveField(path, context, statement);
    if (!field.relationship) {
      throw new BxlMutationError(
        'validate',
        'card-reference-destination',
        statement,
        'card(id) may only be assigned to a relationship Field.',
      );
    }
    const edge = field.relationship.path;
    const strip = edge.slice(base.length);
    // An edge of a link collection is addressed by its position; the marker
    // standing where the collection itself goes names no edge to change.
    const last = path.at(-1);
    const index =
      path.length === edge.length + 1 && typeof last === 'number'
        ? last
        : undefined;
    if (field.relationship.type === 'linksToMany' && index === undefined) {
      throw new BxlMutationError(
        'validate',
        'collection-replacement-forbidden',
        statement,
        'Use relationship collection operations instead of replacing linksToMany wholesale.',
      );
    }
    if (field.writeBehavior === 'skip') {
      return { path: reference.path, strip };
    }
    assertWritableOverlayPath(path, context, statement);
    return {
      path: reference.path,
      strip,
      intent: {
        op: 'relate',
        field: [...edge],
        cardId: reference.id,
        ...(index === undefined ? {} : { index }),
      },
      card: loadedCard(reference.id, context, statement),
    };
  });
}

/**
 * Refuse a link collection whose members are not all markers.
 *
 * The whole collection leaves the stored value, so a member written beside the
 * edges would be dropped without a word rather than stored as it reads. This
 * sees the collections a marker writes to; one written wholly as data carries
 * no marker to resolve and reaches the Card the way any other value does.
 */
function assertLinkCollectionsAreEdges(
  value: BxlMutationJson,
  nested: NestedRelationship[],
  statement: number,
): void {
  const edges = new Map<string, { path: BxlMutationPath; at: Set<number> }>();
  for (const entry of nested) {
    const index = entry.path.at(-1);
    // A `linksTo` marker fills the relationship's own slot, so its path and
    // the subtree the value sheds are the same; only a collection's edge sits
    // one position deeper.
    if (entry.strip.length === entry.path.length || typeof index !== 'number') {
      continue;
    }
    const key = pathKey(entry.strip);
    const collection = edges.get(key) ?? { path: entry.strip, at: new Set() };
    collection.at.add(index);
    edges.set(key, collection);
  }
  for (const { path, at } of edges.values()) {
    const collection = valueAt(value, path);
    if (
      Array.isArray(collection) &&
      collection.length === at.size &&
      collection.every((_, index) => at.has(index))
    ) {
      continue;
    }
    throw new BxlMutationError(
      'validate',
      'relationship-value-required',
      statement,
      'Every member of a linksToMany written inside a value must be card("id").',
    );
  }
}

/**
 * The value as the planner reads it back: markers replaced by the Cards they
 * named, and a Field that takes the write as a no-op left holding nothing.
 */
function modelValue(
  value: BxlMutationJson,
  nested: NestedRelationship[],
): BxlMutationJson {
  if (nested.length === 0) return value;
  let model = clone(value);
  for (const entry of nested) {
    if (entry.card !== undefined) {
      model = setAt(model, entry.path, entry.card);
    } else if (hasAt(model, entry.strip)) {
      model = deleteAt(model, entry.strip);
    }
  }
  return model;
}

/**
 * The value as the Card stores it, with the relationships a marker named shed.
 *
 * A link written as plain data rather than through a marker is not a
 * relationship as far as this is concerned and stays in the value, which is
 * what `assertLinkCollectionsAreEdges` refuses for a collection a marker also
 * writes to.
 */
function storedValue(
  model: BxlMutationJson,
  nested: NestedRelationship[],
): BxlMutationJson {
  if (nested.length === 0) return model;
  let stored = clone(model);
  for (const entry of nested) {
    if (hasAt(stored, entry.strip)) stored = deleteAt(stored, entry.strip);
  }
  return stored;
}

function relateIntents(nested: NestedRelationship[]): BxlMutationIntent[] {
  return nested.flatMap((entry) => (entry.intent ? [entry.intent] : []));
}

function applyCompound(
  operator: MutationAssignmentOperator,
  current: BxlMutationJson | undefined,
  right: BxlMutationJson,
): BxlMutationJson {
  if (operator === '//=')
    return (
      current !== null && current !== false && current !== undefined
        ? current
        : right
    ) as BxlMutationJson;
  return applyNormalBinaryOperator(
    operator.slice(0, -1) as NormalBinaryOperator,
    current,
    right,
  ) as BxlMutationJson;
}

function intentPaths(intent: BxlMutationIntent): BxlMutationPath[] {
  switch (intent.op) {
    case 'set':
    case 'delete':
    case 'copy':
      return [[...intent.path]];
    case 'insert':
      return [[...intent.collection, intent.index]];
    case 'move':
      return [[...intent.from], [...intent.toCollection, intent.toIndex]];
    case 'reorder':
      return [[...intent.collection]];
    case 'relate':
      return [[...intent.field]];
    case 'unrelate':
    case 'move-relation':
      return [[...intent.field]];
  }
}

function statementPlan(
  statement: ParsedMutationStatement,
  intents: BxlMutationIntent[],
): BxlMutationStatementPlan {
  const seen = new Set<string>();
  const paths = intents.flatMap(intentPaths).filter((path) => {
    const key = pathKey(path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    statement: statement.statement,
    source: statement.source,
    canonical: statement.canonical,
    affected: intents.reduce(
      (count, intent) =>
        count + (intent.op === 'reorder' ? intent.order.length : 1),
      0,
    ),
    intents,
    paths,
  };
}

function planAssignment(
  statement: Extract<ParsedMutationStatement, { kind: 'assignment' }>,
  root: BxlMutationJson,
  context: PlannerContext,
): { root: BxlMutationJson; plan: BxlMutationStatementPlan } {
  const locations = resolveLocations(
    statement.location,
    root,
    context,
    statement.statement,
  );
  const fields = validateWritableLocations(
    locations,
    statement.location,
    context,
    statement.statement,
  );
  const intents: BxlMutationIntent[] = [];
  let output = root;

  for (let index = 0; index < locations.length; index++) {
    const location = locations[index]!;
    const field = fields[index]!;
    if (field.writeBehavior === 'skip') continue;
    // A marker in the relationship's own slot is the whole-value form, which
    // the branch below answers; resolving one against the Field it fills is
    // for a value the Card stores.
    const resolveNested = (evaluated: EvaluatedValue) => {
      if (field.relationship || isCardReference(evaluated.value)) return [];
      const nested = nestedRelationships(
        evaluated.references,
        location.path,
        context,
        statement.statement,
      );
      assertLinkCollectionsAreEdges(
        evaluated.value,
        nested,
        statement.statement,
      );
      return nested;
    };
    let next: BxlMutationJson | CardReference;
    let nested: NestedRelationship[] = [];
    if (statement.operator === '=') {
      const evaluated = evaluateSingleJson(
        statement.value,
        readView(output, context),
        context,
        statement.statement,
      );
      nested = resolveNested(evaluated);
      next = isCardReference(evaluated.value)
        ? evaluated.value
        : modelValue(evaluated.value, nested);
    } else if (statement.operator === '|=') {
      // An update sees the layered value, so a Field an overlay filled into
      // a stored container is in scope; what it returns is settled back
      // against the Card's.
      const layered = (valueAt(readView(output, context), location.path) ??
        null) as BxlMutationJson;
      const evaluated = evaluateSingleJson(
        statement.value,
        layered,
        context,
        statement.statement,
        { prefix: location.path },
      );
      nested = resolveNested(evaluated);
      next = evaluated.value;
      if (!isCardReference(next)) {
        // Settled as the planner reads it, links included: a marker's slot
        // still standing empty would read as a member the Card dropped.
        next = settleUpdate(
          modelValue(next, nested),
          layered,
          location,
          context,
          statement.statement,
        );
      }
    } else {
      const right = evaluateSingleJson(
        statement.value,
        readView(output, context),
        context,
        statement.statement,
      );
      if (isCardReference(right.value) || right.references.length > 0) {
        throw new BxlMutationError(
          'validate',
          'relationship-arithmetic',
          statement.statement,
          'Relationship references cannot be used with compound assignment.',
        );
      }
      next = applyCompound(
        statement.operator,
        location.value,
        right.value as BxlMutationJson,
      );
    }

    if (field.relationship) {
      if (!isCardReference(next)) {
        throw new BxlMutationError(
          'validate',
          'relationship-value-required',
          statement.statement,
          'Relationship assignment requires card("id"); loaded Card JSON is not accepted as a value.',
        );
      }
      if (field.relationship.type === 'linksToMany') {
        throw new BxlMutationError(
          'validate',
          'collection-replacement-forbidden',
          statement.statement,
          'Use relationship collection operations instead of replacing linksToMany wholesale.',
        );
      }
      const cardId = next[CARD_MARKER];
      intents.push({
        op: 'relate',
        field: field.relationship.path,
        cardId,
      });
      output = setAt(
        output,
        field.relationship.path,
        loadedCard(cardId, context, statement.statement),
      );
      documentChanged(context);
      continue;
    }
    if (isCardReference(next)) {
      throw new BxlMutationError(
        'validate',
        'card-reference-destination',
        statement.statement,
        'card(id) may only be assigned to a relationship Field.',
      );
    }
    const intent: BxlMutationIntent = {
      op: 'set',
      path: [...location.path],
      ...(location.exists ? { before: clone(location.value!) } : {}),
      after: clone(storedValue(next, nested)),
    };
    intents.push(intent, ...relateIntents(nested));
    output = setAt(output, location.path, next);
    documentChanged(context);
  }
  return { root: output, plan: statementPlan(statement, intents) };
}

function exactLocation(
  argument: ParsedMutationArgument,
  root: BxlMutationJson,
  context: PlannerContext,
  statement: number,
): { location: ResolvedLocation; field: FieldResolution } {
  const locations = resolveLocations(argument, root, context, statement, 'one');
  const fields = validateWritableLocations(
    locations,
    argument,
    context,
    statement,
  );
  return { location: locations[0]!, field: fields[0]! };
}

function jsonValue(
  argument: ParsedMutationArgument,
  root: BxlMutationJson,
  context: PlannerContext,
  statement: number,
  reads: ReadContext = {},
): EvaluatedValue {
  return evaluateSingleJson(
    argument,
    readView(root, context),
    context,
    statement,
    reads,
  );
}

/**
 * The value of an argument that names no Field to relate a Card to.
 *
 * An `assert` message, an insertion index and a reorder key are read as plain
 * values, so a marker in one has nothing to resolve against. Reporting it is
 * what keeps it from being quietly dropped — the lifted marker leaves `null`
 * behind, which an index or a key would go on to refuse for the wrong reason
 * and a message would print.
 */
function plainValue(
  evaluated: EvaluatedValue,
  statement: number,
): BxlMutationJson | CardReference {
  if (evaluated.references.length > 0) {
    throw new BxlMutationError(
      'validate',
      'card-marker-position',
      statement,
      'card(id) names the Card a relationship points at, so it stands where a value is written, not in an argument read as a plain value.',
    );
  }
  return evaluated.value;
}

/**
 * Resolve the markers in a value the Card stores at `base`, giving back what
 * the planner reads, what the document stores, and the edges in between.
 */
function containedValue(
  evaluated: EvaluatedValue,
  base: BxlMutationPath,
  context: PlannerContext,
  statement: number,
): {
  model: BxlMutationJson;
  stored: BxlMutationJson;
  intents: BxlMutationIntent[];
} {
  const value = evaluated.value as BxlMutationJson;
  const nested = nestedRelationships(
    evaluated.references,
    base,
    context,
    statement,
  );
  assertLinkCollectionsAreEdges(value, nested, statement);
  const model = modelValue(value, nested);
  return {
    model,
    stored: storedValue(model, nested),
    intents: relateIntents(nested),
  };
}

function planCall(
  statement: Extract<ParsedMutationStatement, { kind: 'call' }>,
  root: BxlMutationJson,
  context: PlannerContext,
): { root: BxlMutationJson; plan: BxlMutationStatementPlan } {
  const intents: BxlMutationIntent[] = [];
  let output = root;
  const number = statement.statement;

  switch (statement.name) {
    case 'assert': {
      const bestEffort =
        statement.args.length === 3 &&
        readAssertSnapshotOption(statement.args[2]!, number);
      const reads = recordReads(
        statement.args[0]!,
        readView(root, context),
        context,
        number,
        { policy: 'best-effort' },
      );
      if (reads.overlay && !bestEffort) {
        const overlay = reads.events.find((event) => event.tier !== 'source')!;
        throw new BxlMutationError(
          'validate',
          'assert-snapshot-required',
          number,
          `assert reads the ${overlay.tier} value at ${namePath(overlay.path)}, which can lag the stored document. Mark the assert best-effort with { snapshot: true }.`,
          { details: { path: overlay.path, tier: overlay.tier } },
        );
      }
      // A best-effort assert fails with its own message rather than raising
      // `snapshot-unavailable`, so the author's wording reaches the caller.
      const condition = reads.unavailable
        ? []
        : evaluateItems(
            statement.args[0]!.ast,
            [createItem(readView(root, context))],
            context,
          );
      if (
        reads.unavailable ||
        condition.length !== 1 ||
        !isTrue(condition[0]!.value)
      ) {
        // The whole statement is best-effort, message included: an author who
        // marked the assert tolerant of stale values gets their wording back
        // even when the message itself reads an unavailable path.
        const message = plainValue(
          jsonValue(statement.args[1]!, root, context, number, {
            policy: bestEffort ? 'best-effort' : 'strict',
          }),
          number,
        );
        throw new BxlMutationError(
          'plan',
          'assertion-failed',
          number,
          typeof message === 'string' ? message : 'Mutation assertion failed.',
          reads.unavailable
            ? {
                details: {
                  path: reads.unavailable.path,
                  tier: reads.unavailable.tier,
                  reason: reads.unavailable.reason,
                },
              }
            : {},
        );
      }
      break;
    }
    case 'replace': {
      const { location, field } = exactLocation(
        statement.args[0]!,
        root,
        context,
        number,
      );
      if (field.writeBehavior === 'skip') break;
      if (!location.exists) {
        throw new BxlMutationError(
          'plan',
          'replace-target-missing',
          number,
          'replace requires an existing target.',
        );
      }
      if (field.relationship) {
        throw new BxlMutationError(
          'validate',
          'replace-relationship-forbidden',
          number,
          'Use relationship operations for relationship Fields.',
        );
      }
      const value = jsonValue(statement.args[1]!, root, context, number);
      if (isCardReference(value.value)) {
        throw new BxlMutationError(
          'validate',
          'card-reference-destination',
          number,
          'card(id) may only target relationships.',
        );
      }
      const contained = containedValue(value, location.path, context, number);
      intents.push(
        {
          op: 'set',
          path: location.path,
          before: clone(location.value!),
          after: clone(contained.stored),
        },
        ...contained.intents,
      );
      output = setAt(output, location.path, contained.model);
      documentChanged(context);
      break;
    }
    case 'copy_value_to': {
      const source = exactLocation(statement.args[0]!, root, context, number);
      const destination = exactLocation(
        statement.args[1]!,
        root,
        context,
        number,
      );
      if (destination.field.writeBehavior === 'skip') break;
      if (!source.location.exists)
        throw new BxlMutationError(
          'plan',
          'copy-source-missing',
          number,
          'Copy source does not exist.',
        );
      if (source.field.relationship || destination.field.relationship) {
        throw new BxlMutationError(
          'validate',
          'copy-relationship-forbidden',
          number,
          'Relationship edges must be changed with relationship operations.',
        );
      }
      intents.push({
        op: 'copy',
        from: source.location.path,
        path: destination.location.path,
      });
      output = setAt(output, destination.location.path, source.location.value!);
      documentChanged(context);
      break;
    }
    case 'del': {
      const locations = resolveLocations(
        statement.args[0]!,
        root,
        context,
        number,
      );
      const fields = validateWritableLocations(
        locations,
        statement.args[0]!,
        context,
        number,
      );
      const ordered = [...locations.keys()].sort((a, b) => {
        const ap = locations[a]!.path;
        const bp = locations[b]!.path;
        const sameParent = equalJson(ap.slice(0, -1), bp.slice(0, -1));
        if (
          sameParent &&
          typeof ap.at(-1) === 'number' &&
          typeof bp.at(-1) === 'number'
        ) {
          return (bp.at(-1) as number) - (ap.at(-1) as number);
        }
        return b - a;
      });
      for (const index of ordered) {
        const location = locations[index]!;
        const field = fields[index]!;
        if (field.writeBehavior === 'skip') continue;
        if (!location.exists)
          throw new BxlMutationError(
            'plan',
            'delete-target-missing',
            number,
            'Delete target does not exist.',
          );
        if (field.relationship) {
          const id = objectId(location.value);
          if (!id)
            throw new BxlMutationError(
              'plan',
              'relationship-card-id-missing',
              number,
              'Loaded related Card has no string id.',
            );
          intents.push({
            op: 'unrelate',
            field: field.relationship.path,
            cardId: id,
          });
        } else {
          intents.push({
            op: 'delete',
            path: location.path,
            before: clone(location.value!),
          });
        }
        output = deleteAt(output, location.path);
        documentChanged(context);
      }
      break;
    }
    case 'prepend':
    case 'append':
    case 'insert_at': {
      const target = exactLocation(statement.args[0]!, root, context, number);
      if (target.field.writeBehavior === 'skip') break;
      const collection = collectionAt(output, target.location.path);
      let index = statement.name === 'prepend' ? 0 : collection.length;
      let valueArg = statement.args[1]!;
      if (statement.name === 'insert_at') {
        if (!context.plan.baseRevision) {
          throw new BxlMutationError(
            'validate',
            'position-requires-revision',
            number,
            'insert_at requires a pinned base revision.',
          );
        }
        const requested = plainValue(
          jsonValue(statement.args[1]!, root, context, number),
          number,
        );
        if (
          typeof requested !== 'number' ||
          !Number.isInteger(requested) ||
          requested < 0 ||
          requested > collection.length
        ) {
          throw new BxlMutationError(
            'plan',
            'insert-index-invalid',
            number,
            'insert_at index must be an in-range non-negative integer.',
          );
        }
        index = requested;
        valueArg = statement.args[2]!;
      }
      const value = jsonValue(valueArg, root, context, number);
      if (target.field.relationship) {
        if (!isCardReference(value.value)) {
          throw new BxlMutationError(
            'validate',
            'relationship-value-required',
            number,
            'Relationship insertion requires card("id").',
          );
        }
        const cardId = value.value[CARD_MARKER];
        intents.push({
          op: 'relate',
          field: target.field.relationship.path,
          cardId,
          index,
        });
        collection.splice(index, 0, loadedCard(cardId, context, number));
        documentChanged(context);
      } else {
        if (isCardReference(value.value)) {
          throw new BxlMutationError(
            'validate',
            'card-reference-destination',
            number,
            'card(id) may only target relationships.',
          );
        }
        const contained = containedValue(
          value,
          [...target.location.path, index],
          context,
          number,
        );
        intents.push(
          {
            op: 'insert',
            collection: target.location.path,
            index,
            value: clone(contained.stored),
          },
          ...contained.intents,
        );
        collection.splice(index, 0, clone(contained.model));
        documentChanged(context);
      }
      break;
    }
    case 'insert_item_before':
    case 'insert_item_after': {
      const anchor = exactLocation(statement.args[1]!, root, context, number);
      if (anchor.field.writeBehavior === 'skip') break;
      const anchorIndex = anchor.location.path.at(-1);
      if (typeof anchorIndex !== 'number')
        throw new BxlMutationError(
          'plan',
          'anchor-not-item',
          number,
          'Insertion anchor must be a collection item.',
        );
      const collectionPath = anchor.location.path.slice(0, -1);
      const collection = collectionAt(output, collectionPath);
      const index =
        anchorIndex + (statement.name === 'insert_item_after' ? 1 : 0);
      const value = jsonValue(statement.args[0]!, root, context, number);
      if (anchor.field.relationship) {
        if (!isCardReference(value.value)) {
          throw new BxlMutationError(
            'validate',
            'relationship-value-required',
            number,
            'Relationship insertion requires card("id").',
          );
        }
        const cardId = value.value[CARD_MARKER];
        intents.push({
          op: 'relate',
          field: anchor.field.relationship.path,
          cardId,
          index,
        });
        collection.splice(index, 0, loadedCard(cardId, context, number));
        documentChanged(context);
      } else {
        if (isCardReference(value.value)) {
          throw new BxlMutationError(
            'validate',
            'card-reference-destination',
            number,
            'card(id) may only target relationships.',
          );
        }
        const contained = containedValue(
          value,
          [...collectionPath, index],
          context,
          number,
        );
        intents.push(
          {
            op: 'insert',
            collection: collectionPath,
            index,
            value: clone(contained.stored),
          },
          ...contained.intents,
        );
        collection.splice(index, 0, clone(contained.model));
        documentChanged(context);
      }
      break;
    }
    case 'move_item_before':
    case 'move_item_after':
    case 'move_item_to_start':
    case 'move_item_to_end': {
      const item = exactLocation(statement.args[0]!, root, context, number);
      if (item.field.writeBehavior === 'skip') break;
      const sourceIndex = item.location.path.at(-1);
      if (typeof sourceIndex !== 'number')
        throw new BxlMutationError(
          'plan',
          'move-source-not-item',
          number,
          'Move source must be a collection item.',
        );
      const sourceCollectionPath = item.location.path.slice(0, -1);
      let targetCollectionPath: BxlMutationPath;
      let targetIndex: number;
      if (
        statement.name === 'move_item_before' ||
        statement.name === 'move_item_after'
      ) {
        const anchor = exactLocation(statement.args[1]!, root, context, number);
        if (equalJson(anchor.location.path, item.location.path)) {
          throw new BxlMutationError(
            'plan',
            'source-is-anchor',
            number,
            'Move source and anchor must be different items.',
          );
        }
        const anchorIndex = anchor.location.path.at(-1);
        if (typeof anchorIndex !== 'number')
          throw new BxlMutationError(
            'plan',
            'anchor-not-item',
            number,
            'Move anchor must be a collection item.',
          );
        targetCollectionPath = anchor.location.path.slice(0, -1);
        if (!equalJson(sourceCollectionPath, targetCollectionPath)) {
          throw new BxlMutationError(
            'validate',
            'cross-collection-move',
            number,
            'Version 1 moves require source and anchor in the same collection.',
          );
        }
        const adjustedAnchor =
          anchorIndex - (sourceIndex < anchorIndex ? 1 : 0);
        targetIndex =
          adjustedAnchor + (statement.name === 'move_item_after' ? 1 : 0);
      } else {
        const collection = exactLocation(
          statement.args[1]!,
          root,
          context,
          number,
        );
        targetCollectionPath = collection.location.path;
        if (!equalJson(sourceCollectionPath, targetCollectionPath)) {
          throw new BxlMutationError(
            'validate',
            'cross-collection-move',
            number,
            'Version 1 moves require the same source and target collection.',
          );
        }
        targetIndex =
          statement.name === 'move_item_to_start'
            ? 0
            : collectionAt(output, targetCollectionPath).length - 1;
      }
      const sourceCollection = collectionAt(output, sourceCollectionPath);
      const [moved] = sourceCollection.splice(sourceIndex, 1);
      documentChanged(context);
      if (moved === undefined)
        throw new BxlMutationError(
          'plan',
          'move-source-missing',
          number,
          'Move source no longer exists.',
        );
      sourceCollection.splice(targetIndex, 0, moved);
      documentChanged(context);
      if (item.field.relationship) {
        const id = objectId(moved);
        if (!id)
          throw new BxlMutationError(
            'plan',
            'relationship-card-id-missing',
            number,
            'Loaded related Card has no string id.',
          );
        intents.push({
          op: 'move-relation',
          field: item.field.relationship.path,
          cardId: id,
          toIndex: targetIndex,
        });
      } else {
        intents.push({
          op: 'move',
          from: item.location.path,
          toCollection: targetCollectionPath,
          toIndex: targetIndex,
        });
      }
      break;
    }
    case 'reorder_by': {
      const target = exactLocation(statement.args[0]!, root, context, number);
      if (target.field.writeBehavior === 'skip') break;
      if (target.field.relationship) {
        throw new BxlMutationError(
          'validate',
          'relationship-reorder-operation',
          number,
          'Use relationship move operations to reorder linksToMany.',
        );
      }
      const collection = collectionAt(output, target.location.path);
      const keyPathItems = evaluateItems(
        statement.args[1]!.ast,
        [createItem(collection[0] ?? null)],
        context,
      );
      if (
        keyPathItems.length !== 1 ||
        !keyPathItems[0]!.path.every(
          (part) => typeof part === 'string' || typeof part === 'number',
        )
      ) {
        throw new BxlMutationError(
          'plan',
          'reorder-key-invalid',
          number,
          'reorder_by key must resolve to one item-relative path.',
        );
      }
      const keyPath = keyPathItems[0]!.path as BxlMutationPath;
      const order = plainValue(
        jsonValue(statement.args[2]!, root, context, number),
        number,
      );
      if (
        !Array.isArray(order) ||
        order.some(
          (value) =>
            value !== null &&
            !['string', 'number', 'boolean'].includes(typeof value),
        )
      ) {
        throw new BxlMutationError(
          'plan',
          'order-invalid',
          number,
          'reorder_by order must be an array of scalar keys.',
        );
      }
      const currentKeys = collection.map((item) => valueAt(item, keyPath));
      const uniqueCurrent = new Set(
        currentKeys.map((value) => JSON.stringify(value)),
      );
      const uniqueOrder = new Set(order.map((value) => JSON.stringify(value)));
      if (
        currentKeys.length !== order.length ||
        uniqueCurrent.size !== currentKeys.length ||
        uniqueOrder.size !== order.length ||
        [...uniqueCurrent].some((key) => !uniqueOrder.has(key))
      ) {
        throw new BxlMutationError(
          'plan',
          'order-not-permutation',
          number,
          'reorder_by order must be an exact permutation of unique current keys.',
        );
      }
      const byKey = new Map(
        collection.map((value) => [
          JSON.stringify(valueAt(value, keyPath)),
          value,
        ]),
      );
      const reordered = order.map((key) => byKey.get(JSON.stringify(key))!);
      collection.splice(0, collection.length, ...reordered);
      documentChanged(context);
      intents.push({
        op: 'reorder',
        collection: target.location.path,
        key: keyPath,
        order: order as Array<null | boolean | number | string>,
      });
      break;
    }
  }
  return { root: output, plan: statementPlan(statement, intents) };
}

function projection(
  root: BxlMutationJson,
  paths: BxlMutationPath[],
): BxlMutationJson {
  if (paths.some((path) => path.length === 0)) return clone(root);
  let result: BxlMutationJson = {};
  for (const path of paths) {
    const value = valueAt(root, path);
    if (value !== undefined) result = setAt(result, path, value);
  }
  return result;
}

function returningProjection(
  requested: BxlMutationPlanOptions['returning'],
  before: BxlMutationJson,
  output: BxlMutationJson,
  intents: BxlMutationIntent[],
  affected: number,
  paths: BxlMutationPath[],
): BxlMutationReturning {
  const returning: BxlMutationReturning = {};
  const fields = requested ?? ['affected', 'paths', 'changes'];
  if (fields.includes('old')) returning.old = projection(before, paths);
  if (fields.includes('new')) returning.new = projection(output, paths);
  if (fields.includes('changes')) returning.changes = clone(intents);
  if (fields.includes('affected')) returning.affected = affected;
  if (fields.includes('paths')) returning.paths = clone(paths);
  return returning;
}

export function prepareBxlMutation(
  source: string,
  options: BxlMutationPrepareOptions,
): PreparedBxlMutation {
  const syntax = options.syntax ?? 'readable';
  const preparedOptions = { ...options, syntax };
  const parsed = parseBxlMutationProgram(source, preparedOptions);
  const registry = resolveBuiltinRegistry(
    mutationBuiltinLibraries(options.libraries),
  );

  return Object.freeze({
    language: 'bxl-mutation/1' as const,
    source,
    canonicalSource: parsed.canonicalSource,
    syntax,
    warnings: Object.freeze([
      ...parsed.warnings,
    ]) as unknown as typeof parsed.warnings,
    statementCount: parsed.statements.length,
    plan(
      snapshot: BxlMutationJson,
      planOptions: BxlMutationPlanOptions,
    ): BxlMutationPlan {
      if (!planOptions.programId) {
        throw new BxlMutationError(
          'plan',
          'program-id-required',
          1,
          'Mutation planning requires a stable programId.',
        );
      }
      if (
        planOptions.baseRevision !== undefined &&
        planOptions.currentRevision !== undefined &&
        planOptions.baseRevision !== planOptions.currentRevision
      ) {
        throw new BxlMutationError(
          'commit',
          'revision-conflict',
          1,
          'The loaded Card revision does not match baseRevision.',
        );
      }
      const claimed = new Set<string>();
      const context: PlannerContext = {
        prepare: preparedOptions,
        plan: {
          delivery: 'complete',
          transaction: 'atomic',
          ...planOptions,
        },
        registry,
        overlays: EMPTY_OVERLAY_INDEX,
        claimed,
        revision: 0,
        ...(planOptions.onRead ? { onRead: planOptions.onRead } : {}),
        requestContext: planOptions.context
          ? (assertJsonContext(planOptions.context), planOptions.context)
          : undefined,
      };
      const before = clone(snapshot);
      let working = clone(snapshot);
      const statementPlans: BxlMutationStatementPlan[] = [];

      for (const statement of parsed.statements) {
        const draft = clone(working);
        // Rebuild the index against the document as this statement finds it,
        // so what an overlay answers for is described in the positions the
        // statement will address rather than the ones it started life in —
        // minus whatever earlier statements have made their own.
        context.overlays = planOptions.overlays
          ? indexBxlMutationOverlays(draft, planOptions.overlays, claimed)
          : EMPTY_OVERLAY_INDEX;
        let result: { root: BxlMutationJson; plan: BxlMutationStatementPlan };
        try {
          result =
            statement.kind === 'assignment'
              ? planAssignment(statement, draft, context)
              : planCall(statement, draft, context);
        } catch (error) {
          if (error instanceof BxlMutationError) throw error;
          throw new BxlMutationError(
            'plan',
            'statement-failed',
            statement.statement,
            `Mutation statement failed: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        if (context.plan.authorize && result.plan.intents.length > 0) {
          try {
            const allowed = context.plan.authorize(result.plan);
            if (allowed === false)
              throw new Error('Authorization hook returned false.');
          } catch (error) {
            throw new BxlMutationError(
              'authorize',
              'authorization-denied',
              statement.statement,
              `Mutation write set was denied: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
          }
        }
        working = result.root;
        for (const path of result.plan.paths) claimed.add(path.join('.'));
        statementPlans.push(result.plan);
      }

      const intents = statementPlans.flatMap((statement) => statement.intents);
      const affected = statementPlans.reduce(
        (sum, statement) => sum + statement.affected,
        0,
      );
      const pathMap = new Map(
        statementPlans
          .flatMap((statement) => statement.paths)
          .map((path) => [pathKey(path), path]),
      );
      const paths = [...pathMap.values()];
      const output = working;
      return {
        language: 'bxl-mutation/1',
        programId: planOptions.programId,
        target: {
          kind: options.targetKind,
          ...(planOptions.targetId ? { id: planOptions.targetId } : {}),
          ...(planOptions.targetPath
            ? { path: [...planOptions.targetPath] }
            : {}),
        },
        source,
        canonicalSource: parsed.canonicalSource,
        warnings: [...parsed.warnings],
        before,
        output,
        statements: statementPlans,
        intents,
        affected,
        paths,
        returning: returningProjection(
          planOptions.returning,
          before,
          output,
          intents,
          affected,
          paths,
        ),
      };
    },
  });
}

export function planBxlMutation(
  source: string,
  snapshot: BxlMutationJson,
  prepareOptions: BxlMutationPrepareOptions,
  planOptions: BxlMutationPlanOptions,
): BxlMutationPlan {
  return prepareBxlMutation(source, prepareOptions).plan(snapshot, planOptions);
}

export function isBxlMutationError(error: unknown): error is BxlMutationError {
  return error instanceof BxlMutationError;
}

/** Parse a solidified value expression for host adapters that inspect plans. */
export function parseBxlMutationValueExpression(source: string): ExpressionAst {
  const parsed = parseNativeJq(source, { readableSyntax: false });
  if (!parsed.ast.expr) throw new Error('Mutation value expression is empty.');
  return parsed.ast.expr;
}

/** Canonicalize a mutation value AST for diagnostics and previews. */
export function printBxlMutationValueExpression(ast: ExpressionAst): string {
  return printMutationAst(ast);
}
