import { OperationFailure, type OperationDefinition } from './types.ts';
import type { JsonValue } from '../json-validation.ts';

// ============================================================================
// The two transform stages around an operation.
//
// A declaration may carry `input`, which shapes the payload before the
// operation uses it, and `output`, which projects the result before the caller
// sees it. Both are BXL expressions — never JavaScript — read from the
// operation's stored definition, and both run here so that the two transports
// cannot disagree about when a stage runs or what it is handed.
//
// The order inside an operation is fixed: `input`, then the `params` check
// against the payload the input produced, then the behavior, then `output`.
// The check runs against the input's result and not the caller's payload
// because that is what makes an `input` able to supply a declared param the
// caller left out, which is most of what one is for.
//
// **Access posture.** These stages are identity-aware and not access-enforced.
// A program may read `actor()`, and an `output` may leave a field out of what
// it projects, but the realm verifies no claim the caller makes and refuses no
// invocation on the strength of who is asking: the realm's own read/write
// permission is the whole of what is checked. An `output` that hides a field
// hides it from the shape of this operation's answer, not from the caller —
// every operation's result must be treated as reachable by any caller
// permitted to read or write the realm. Treat a projection as a response
// shape, never as a boundary.
//
// **Where a failure leaves the realm.** An `input` runs before anything is
// staged, so a program that fails there refuses the operation with nothing
// written. An `output` projects the result, and a write's result does not
// exist until the write has committed — so a program that fails there answers
// 400 over a card that has already changed. The refusal says the caller cannot
// be told what happened, not that nothing did. What it cannot be is a
// surprise: a program that does not parse, or that reaches outside the
// dialect, is refused when the declaration is lowered, so the only way to
// reach this is a program that ran on values it could not handle.
//
// **What a transform is handed.** `.` is the value the stage was given: the
// payload for an `input`, the result document for an `output`. Alongside it
// the request context carries `params()`, `actor()` and `realmConfig()`. The
// settings are read at most once per stage and only when the program names
// one, since a cold read of them is a parse of the realm's config document and
// most programs name none. `instance()` is a slot on the context that no
// transport fills today — an operation's stored document is read under the
// write lock by the behavior itself, and neither a read nor the envelope has
// one in hand at the moment a stage runs — so a program naming it is told the
// host supplied none.
// ============================================================================

// BXL, and the shape of what this module asks of it.
//
// Stated here rather than imported, and loaded through a specifier TypeScript
// cannot follow, because reaching for `@cardstack/bxl` at all — for a value or
// for a type — pulls its sources into the typecheck program of every package
// that reaches the realm. `packages/postgres` gets here through
// `runtime-common/realm`, and compiles those sources under an older `lib` than
// they are written for.
//
// `bxl-mirror-check.ts` holds these shapes against the real ones. It imports
// bxl and nothing imports it, so the check runs in this package's own
// typecheck and reaches no consumer.
export interface TransformProgramError extends Error {
  phase: 'parse' | 'profile' | 'evaluate';
}

export interface BxlTransformModule {
  isBxlTransformError(err: unknown): err is TransformProgramError;
  runBxlTransform(
    source: string,
    input: unknown,
    context?: {
      params?: Record<string, unknown>;
      actor?: string;
      instance?: Record<string, unknown>;
      realmConfig?: Record<string, unknown>;
    },
    options?: { syntax?: 'readable' | 'solidified' },
  ): unknown;
}

// Resolved once per process. The module is pure and stateless, so holding it
// costs one resolution rather than one per program.
let bxlTransform: Promise<BxlTransformModule> | undefined;

function loadBxlTransform(): Promise<BxlTransformModule> {
  // The cast is what keeps the specifier opaque to TypeScript; see above.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  bxlTransform ??= import('@cardstack/bxl/transform' as string).then(
    (module) => module as BxlTransformModule,
  );
  return bxlTransform;
}

// The request-scoped values a stage reads. Every slot is optional, and a slot
// the caller leaves out is one the program may not read — the refusal names
// the slot rather than handing the program a null.
export interface TransformContext {
  // The caller's Matrix user id, absent for an anonymous request on a realm
  // anyone may read. A stage that reads `actor()` without one is refused
  // before it runs, by whichever transport knows the request authenticated
  // nobody — `readsActor` on the definition is what answers that statically.
  actor?: string;
  params?: Record<string, unknown>;
  instance?: Record<string, unknown>;
  // The realm's own settings, as `realmConfig()` answers with them. A thunk
  // rather than a value, and reached only when the program names one: a cold
  // read is a parse of the realm's config document, and the stages that name
  // no setting are most of them.
  realmConfig?: () => Promise<Record<string, JsonValue>>;
  // The target this operation runs against, for the refusal's `id`.
  id?: string;
  // The name the operation was invoked under, for the refusal's `meta`.
  name: string;
}

// Whether an operation carries either stage, which is what lets a caller skip
// the whole apparatus for the operations — every built-in one, and most
// declared ones — that carry neither.
export function hasTransforms(definition: OperationDefinition): boolean {
  return definition.input !== undefined || definition.output !== undefined;
}

// Run the `input` stage over the payload the caller sent, and answer the
// payload the operation uses.
//
// The result has to be an object, because what comes back is the `params` map
// every later stage reads by key: a program answering a string or an array has
// produced something no param can be read out of, and carrying on would report
// every declared param as missing rather than saying what went wrong.
export async function runInputTransform(
  definition: OperationDefinition,
  payload: Record<string, unknown>,
  ctx: TransformContext,
): Promise<Record<string, unknown>> {
  if (!definition.input) {
    return payload;
  }
  let produced = await runStage(definition.input.source, payload, 'input', ctx);
  if (!isPlainRecord(produced)) {
    throw refusal(
      ctx,
      'input',
      `the \`input\` stage produces the payload the operation uses, and this ` +
        `program produced ${describe(produced)}`,
    );
  }
  return produced;
}

// Run the `output` stage over the operation's result, and answer what the
// caller is sent. Whether the projection is a shape the transport can serve is
// the transport's to judge: a read serves a JSON:API document and says so, a
// batch entry's result is whatever the program produced.
export async function runOutputTransform(
  definition: OperationDefinition,
  result: unknown,
  ctx: TransformContext,
): Promise<unknown> {
  if (!definition.output) {
    return result;
  }
  return await runStage(definition.output.source, result, 'output', ctx);
}

async function runStage(
  source: string,
  input: unknown,
  stage: 'input' | 'output',
  ctx: TransformContext,
): Promise<unknown> {
  let bxl = await loadBxlTransform();
  // Read before the evaluation rather than from inside it: the program runs
  // synchronously, so a value it may ask for has to be in hand first.
  let realmConfig =
    ctx.realmConfig && namesRealmConfig(source)
      ? await ctx.realmConfig()
      : undefined;
  try {
    return bxl.runBxlTransform(
      source,
      input,
      {
        ...(ctx.actor === undefined ? {} : { actor: ctx.actor }),
        ...(ctx.params === undefined ? {} : { params: ctx.params }),
        ...(ctx.instance === undefined ? {} : { instance: ctx.instance }),
        ...(realmConfig === undefined ? {} : { realmConfig }),
      },
      // A stored program is already canonical: lowering canonicalizes whichever
      // spelling the author wrote, so one program shape reaches the realm.
      { syntax: 'solidified' },
    );
  } catch (err: unknown) {
    if (!bxl.isBxlTransformError(err)) {
      // Not the program's failure — the evaluator itself, or the module load.
      // Reported as the realm's rather than blamed on the author's program.
      throw new OperationFailure({
        ...(ctx.id ? { id: ctx.id } : {}),
        status: 500,
        code: 'internal-error',
        title: 'Cannot run transform',
        detail:
          `the \`${stage}\` stage of operation "${ctx.name}" could not be ` +
          `run: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    throw refusal(ctx, stage, err.message, err.phase);
  }
}

// An author's program is wrong, whichever of the three ways it is wrong: it
// does not parse, it reaches outside the transform dialect, or it failed on
// the values this request handed it. All three are 400 — the same status the
// mutation program a `transform` runs answers with — because the remedy is a
// change to the declaration, and a 500 would page whoever runs the realm for a
// defect in a card.
function refusal(
  ctx: TransformContext,
  stage: 'input' | 'output',
  detail: string,
  phase?: string,
): OperationFailure {
  return new OperationFailure({
    ...(ctx.id ? { id: ctx.id } : {}),
    status: 400,
    code: 'invalid-params',
    title: 'Cannot run transform',
    detail: `the \`${stage}\` stage of operation "${ctx.name}" failed: ${detail}`,
    meta: {
      operation: ctx.name,
      stage,
      ...(phase ? { phase } : {}),
    },
  });
}

// Whether the program mentions the settings builtin at all. A substring test
// on purpose: it is read to decide whether to pay for a read, so a false
// positive costs one cheap cached lookup and a false negative would hand the
// program nothing to answer with. The same test the mutation path uses.
function namesRealmConfig(source: string): boolean {
  return source.includes('realmConfig');
}

function describe(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'an array';
  }
  return `a ${typeof value}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
