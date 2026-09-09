import type {
  ReadableField,
  ReadableSchema,
  ReadableSyntaxWarning,
} from '../bxl/compiler/readable-syntax.ts';
import type { BuiltinLibraryName } from '../bxl/registry/index.ts';
import type { NativeRuntimeLimits } from '../jqtools/evaluate/runtimeState.ts';

export type BxlMutationJson =
  | null
  | boolean
  | number
  | string
  | BxlMutationJson[]
  | { [key: string]: BxlMutationJson };

/** A JSON object, as distinct from the other JSON shapes. */
export type BxlMutationJsonObject = { [key: string]: BxlMutationJson };

export type BxlMutationPath = Array<string | number>;

export type BxlMutationFieldType =
  | 'contains'
  | 'containsMany'
  | 'linksTo'
  | 'linksToMany';

/**
 * Mutation metadata layers the Card/Field facts needed at planning time over
 * the existing readable-schema shape. A Boxel adapter should derive this from
 * CardDef/FieldDef metadata; authors should not maintain a second schema.
 */
export interface BxlMutationField extends ReadableField {
  fieldType?: BxlMutationFieldType;
  writable?: boolean;
  /** A computed Field accepts author intent as an intentional no-op. */
  writeBehavior?: 'write' | 'skip';
  item?: BxlMutationSchema;
  fields?: BxlMutationField[];
  /**
   * Loaderless Boxel serialization facts. The mutation planner ignores this;
   * the card-source adapter uses it to keep attributes, relationships, and
   * `meta.fields` in the same shapes as Boxel's runtime serializer.
   */
  boxelSource?: {
    isPrimitive: boolean;
    fieldOrCard?: unknown;
    serializerName?: string;
  };
}

export interface BxlMutationRootField {
  label?: string;
  fieldType?: BxlMutationFieldType;
  writable?: boolean;
  writeBehavior?: 'write' | 'skip';
  item?: BxlMutationSchema;
}

export interface BxlMutationSchema extends ReadableSchema {
  fields: BxlMutationField[];
  /** Metadata for a Field target whose value is the planner root. */
  rootField?: BxlMutationRootField;
}

export type BxlMutationIntent =
  | {
      op: 'set';
      path: BxlMutationPath;
      before?: BxlMutationJson;
      after: BxlMutationJson;
    }
  | { op: 'delete'; path: BxlMutationPath; before: BxlMutationJson }
  | { op: 'copy'; from: BxlMutationPath; path: BxlMutationPath }
  | {
      op: 'insert';
      collection: BxlMutationPath;
      index: number;
      value: BxlMutationJson;
    }
  | {
      op: 'move';
      from: BxlMutationPath;
      toCollection: BxlMutationPath;
      toIndex: number;
    }
  | {
      op: 'reorder';
      collection: BxlMutationPath;
      key: BxlMutationPath;
      order: Array<null | boolean | number | string>;
    }
  | {
      op: 'relate';
      field: BxlMutationPath;
      cardId: string;
      index?: number;
    }
  | { op: 'unrelate'; field: BxlMutationPath; cardId: string }
  | {
      op: 'move-relation';
      field: BxlMutationPath;
      cardId: string;
      toIndex: number;
    };

export type BxlMutationOverlayTier = 'computed' | 'linked';

export type BxlMutationOverlayReason =
  | 'not-indexed'
  | 'not-searchable'
  | 'key-absent';

/** One path the host could not supply an overlay value for, and why. */
export interface BxlMutationUnavailableOverlay {
  path: string;
  tier: BxlMutationOverlayTier;
  reason: BxlMutationOverlayReason;
}

/**
 * Read-only values a host layers over a Card's stored document. `computeds`
 * carries the Card with its computed Fields filled in; `linked` carries the
 * searchable Fields of the Cards this one links to. Both sit *under* the
 * stored document: a stored value always answers a read, and an overlay
 * answers only where the stored document holds nothing — an absent key or a
 * `null`, which is what a Card that never persists computed or linked values
 * holds at those paths.
 *
 * Overlay paths are dotted strings addressing the loaded Card model, with
 * collection indices as their own segment: `status`, `patient.name`,
 * `recommendations.0.title`.
 */
export interface BxlMutationOverlays {
  computeds?: BxlMutationJson;
  linked?: BxlMutationJson;
  unavailable?: readonly BxlMutationUnavailableOverlay[];
}

export type BxlMutationReadTier = 'source' | BxlMutationOverlayTier;

export type BxlMutationReadOutcome = 'value' | 'null' | 'unavailable';

/** One resolved read, reported so a host can see which layer answered it. */
export interface BxlMutationReadEvent {
  path: string;
  tier: BxlMutationReadTier;
  outcome: BxlMutationReadOutcome;
}

export interface BxlMutationStatementPlan {
  statement: number;
  source: string;
  canonical: string;
  affected: number;
  intents: BxlMutationIntent[];
  paths: BxlMutationPath[];
}

export interface BxlMutationChange {
  op: BxlMutationIntent['op'];
  path?: BxlMutationPath;
  from?: BxlMutationPath;
  field?: BxlMutationPath;
  collection?: BxlMutationPath;
  before?: BxlMutationJson;
  after?: BxlMutationJson;
  cardId?: string;
  index?: number;
  toIndex?: number;
}

export interface BxlMutationReturning {
  old?: BxlMutationJson;
  new?: BxlMutationJson;
  changes?: BxlMutationIntent[];
  affected?: number;
  paths?: BxlMutationPath[];
}

export interface BxlMutationPlan {
  language: 'bxl-mutation/1' | 'bxl-mutation-ops/1';
  programId: string;
  target: { kind: 'card' | 'field'; id?: string; path?: BxlMutationPath };
  source: string;
  canonicalSource: string;
  warnings: ReadableSyntaxWarning[];
  before: BxlMutationJson;
  output: BxlMutationJson;
  statements: BxlMutationStatementPlan[];
  intents: BxlMutationIntent[];
  affected: number;
  paths: BxlMutationPath[];
  returning: BxlMutationReturning;
}

export interface BxlMutationPrepareOptions {
  schema: BxlMutationSchema;
  targetKind: 'card' | 'field';
  syntax?: 'readable' | 'solidified';
  libraries?: BuiltinLibraryName[];
  runtimeLimits?: NativeRuntimeLimits;
}

/**
 * The request-scoped values a mutation program reads through the `params`,
 * `actor` and `instance` builtins.
 *
 * Every value arrives already resolved. This package never loads a card or
 * reaches a network, so `instance` is the stored document as the host read it
 * and `actor` is the caller as the host authenticated it.
 *
 * Each slot is optional and a program that asks for one the host left out
 * fails rather than reading `null`, so a host supplies exactly the slots its
 * operation declares. Every slot is a keyed object, because that is what the
 * builtins can read a key out of — a bare string or array would type-check
 * against a looser declaration and then fail every lookup at runtime.
 */
export interface BxlMutationContext {
  /** What the caller sent, keyed by the operation's declared parameters. */
  params?: BxlMutationJsonObject;
  /** The authenticated caller. `id` is the stable principal. */
  actor?: { id: string; [key: string]: BxlMutationJson };
  /** The stored document the program is editing. */
  instance?: BxlMutationJsonObject;
}

export interface BxlMutationPlanOptions {
  programId: string;
  targetId?: string;
  targetPath?: BxlMutationPath;
  delivery?: 'complete' | 'streaming';
  transaction?: 'atomic' | 'statement';
  baseRevision?: string;
  currentRevision?: string;
  returning?: ReadonlyArray<'old' | 'new' | 'changes' | 'affected' | 'paths'>;
  /**
   * Request-scoped values for the `params`, `actor` and `instance` builtins.
   * Omit it and a program naming one of them fails; a program that names none
   * of them behaves the same either way.
   */
  context?: BxlMutationContext;
  /** Loaded Card projections addressable by the `card(id)` constructor. */
  cards?: Readonly<Record<string, BxlMutationJson>>;
  resolveCard?: (id: string) => BxlMutationJson | undefined;
  /** Optional concrete-write-set authorization hook supplied by the host. */
  authorize?: (statement: BxlMutationStatementPlan) => boolean | void;
  /** Read-only computed and linked-Card values fetched by the host. */
  overlays?: BxlMutationOverlays;
  /**
   * Read telemetry sink, called once per path a program's expressions resolve,
   * in program order. Write locations report through the plan's intents
   * instead, so a compound assignment's implicit read of its own target is not
   * a read event.
   */
  onRead?: (event: BxlMutationReadEvent) => void;
}

export interface PreparedBxlMutation {
  readonly language: 'bxl-mutation/1' | 'bxl-mutation-ops/1';
  readonly source: string;
  readonly canonicalSource: string;
  readonly syntax: 'readable' | 'solidified';
  readonly warnings: ReadableSyntaxWarning[];
  readonly statementCount: number;
  plan(
    snapshot: BxlMutationJson,
    options: BxlMutationPlanOptions,
  ): BxlMutationPlan;
}

export interface BxlStructuredMutationOperation {
  id: string;
  op:
    | 'assert'
    | 'set'
    | 'set-all'
    | 'update'
    | 'update-all'
    | 'replace'
    | 'copy'
    | 'delete'
    | 'delete-all'
    | 'insert'
    | 'move'
    | 'reorder'
    | 'relate'
    | 'unrelate'
    | 'move-relation';
  [key: string]: unknown;
}

export type BxlMutationErrorPhase =
  | 'parse'
  | 'plan'
  | 'validate'
  | 'authorize'
  | 'commit';

/**
 * Machine-readable facts about the location an error is about. `snapshot-
 * unavailable` carries the full `{ path, tier, reason }` the host declared;
 * `computed-read-only` and `write-through-link` carry the offending path and
 * the overlay tier that owns it.
 */
export type BxlMutationErrorDetails = Readonly<Record<string, BxlMutationJson>>;

export class BxlMutationError extends Error {
  readonly name = 'BxlMutationError';
  readonly phase: BxlMutationErrorPhase;
  readonly code: string;
  readonly statement: number;
  readonly details?: BxlMutationErrorDetails;

  constructor(
    phase: BxlMutationErrorPhase,
    code: string,
    statement: number,
    message: string,
    options: { cause?: unknown; details?: BxlMutationErrorDetails } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.phase = phase;
    this.code = code;
    this.statement = statement;
    if (options.details !== undefined) this.details = options.details;
  }
}
