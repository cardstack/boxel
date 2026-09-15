import type { LatticeIndexedSnapshotCapture } from './lattice-retained-snapshots.ts';
import type { ResolvedCodeRef } from './code-ref.ts';
import type {
  FileExtractResponse,
  FileRenderResponse,
  RenderResponse,
} from './index.ts';
import type { Querier } from './expression.ts';
import type { LatticeInputSnapshot } from './lattice-materialization.ts';
import type { LatticeCodeReference } from './lattice-code-reference.ts';
import type { LatticeQueryPreparation } from './lattice-query-registry.ts';
import type { LatticeExecution } from './lattice-adapters.ts';

export interface LatticeNativeCardIndexRequest {
  url: string;
  realmURL: string;
  sourceJSON: string;
  fileDefCodeRef?: ResolvedCodeRef;
  generation: number;
  loaderEpoch: string;
  lastModified: number;
  resourceCreatedAt: number;
  inputSnapshot?: LatticeInputSnapshot;
}

export interface LatticeNativeCardIndexResult {
  queryPreparation?: LatticeQueryPreparation;
  retainedInputs?: LatticeIndexedSnapshotCapture;
  codeReference?: LatticeCodeReference;
  card: RenderResponse;
  file?: { extract: FileExtractResponse; render: FileRenderResponse };
  timings?: LatticeNativeIndexTimings;
  compute?: LatticeNativeComputeMeasurements;
  // Recheck every consumed input/code revision in the publication transaction.
  // The producer must use this transaction, never a separate connection or a
  // network read. A thrown error prevents the entire batch from publishing.
  assertCurrent(tx: Querier): Promise<void>;
}

export interface LatticeNativeIndexTimings {
  admission: number;
  computeAndAssemble: number;
  openWork?: number;
  openInputs?: number;
  queryPreparation?: number;
  assembly?: LatticeCardAssemblyTimings;
  inputStages?: LatticeInputStageTiming[];
  omittedInputStages?: number;
}

// Sequential walls inside card assembly. Worker time includes transport and
// worker startup; compare with the evaluator's separately reported duration.
export interface LatticeCardAssemblyTimings {
  normalize: number;
  queryInputs: number;
  plan: number;
  encodeInputs: number;
  worker: number;
  output: number;
  inputBytes: number;
}

// Query prerequisites can recursively settle other inputs. These stages time
// only the query, projection or worker call, never the surrounding recursion.
export interface LatticeInputStageTiming {
  field: string;
  kind: 'query' | 'projection' | 'prerequisite';
  elapsedMs: number;
  cards?: number;
  inputBytes?: number;
  evaluatorMs?: number;
}

// Timings are inclusive when a conditional dependency invokes another field.
// CPU belongs to the evaluator thread, not all threads in its worker process.
// No input values, output values or formula source are retained here.
export interface LatticeComputedFieldTiming {
  field: string;
  evaluator: 'bxl' | 'base';
  phase: 'evaluate' | 'validate';
  status: 'fulfilled' | 'rejected';
  elapsedMs: number;
  cpuMs: number;
}

export interface LatticeNativeComputeMeasurements {
  prepareMs: number;
  evaluateMs: number;
  workerHeapBytes: number;
  processRssBytes: number;
  fields: Array<LatticeComputedFieldTiming & { cardIndex: number }>;
  omittedFieldTimings: number;
}

// Server-supplied capability, absent in the browser and disabled by default.
// Undefined means the definition/input shape was not admitted. Once admitted,
// computation failures throw; they must not be disguised as successful output.
export type LatticeNativeCardIndexer = LatticeExecution<
  LatticeNativeCardIndexRequest,
  LatticeNativeCardIndexResult
>['execute'];

export interface LatticeNativeFileIndexRequest extends Omit<
  LatticeNativeCardIndexRequest,
  'sourceJSON' | 'inputSnapshot' | 'fileDefCodeRef'
> {
  source: string;
  fileDefCodeRef: ResolvedCodeRef;
}

export interface LatticeNativeFileIndexResult {
  extract: FileExtractResponse;
  // Rendering is independent of extraction. A trusted static SVG may avoid
  // the icon visit; absent that artifact the existing renderer still owns it.
  render?: FileRenderResponse;
  timings: { admission: number; computeAndAssemble: number };
  assertCurrent(tx: Querier): Promise<void>;
}

export type LatticeNativeFileIndexer = (
  request: LatticeNativeFileIndexRequest,
) => Promise<LatticeNativeFileIndexResult | undefined>;
