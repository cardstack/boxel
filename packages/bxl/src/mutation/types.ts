import type {
  ReadableField,
  ReadableSchema,
  ReadableSyntaxWarning,
} from '../bxl/compiler/readable-syntax.js';
import type { BuiltinLibraryName } from '../bxl/registry/index.js';
import type { NativeRuntimeLimits } from '../jqtools/evaluate/runtimeState.js';

export type BxlMutationJson =
  | null
  | boolean
  | number
  | string
  | BxlMutationJson[]
  | { [key: string]: BxlMutationJson };

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

export interface BxlMutationPlanOptions {
  programId: string;
  targetId?: string;
  targetPath?: BxlMutationPath;
  delivery?: 'complete' | 'streaming';
  transaction?: 'atomic' | 'statement';
  baseRevision?: string;
  currentRevision?: string;
  returning?: ReadonlyArray<'old' | 'new' | 'changes' | 'affected' | 'paths'>;
  /** Loaded Card projections addressable by the `card(id)` constructor. */
  cards?: Readonly<Record<string, BxlMutationJson>>;
  resolveCard?: (id: string) => BxlMutationJson | undefined;
  /** Optional concrete-write-set authorization hook supplied by the host. */
  authorize?: (statement: BxlMutationStatementPlan) => boolean | void;
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

export class BxlMutationError extends Error {
  readonly name = 'BxlMutationError';

  constructor(
    public readonly phase: BxlMutationErrorPhase,
    public readonly code: string,
    public readonly statement: number,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
  }
}
