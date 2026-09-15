import { parentPort } from 'node:worker_threads';
import { compileBxl, assertValidBxlProfile, prepareBxl } from '@cardstack/bxl';
import type { PreparedBxl } from '@cardstack/bxl';
import {
  prepareLatticeCardCompute,
  assertLatticeShape as assertShape,
  latticeBxlOutputLimit,
  latticeNativeRuntimeLimits,
} from './lattice-card-compute.ts';
import type {
  LatticeCardComputePlan,
  LatticeCardComputeResult,
} from './lattice-card-compute.ts';
import type {
  LatticeBxlInput,
  LatticeBxlManifest,
  LatticeBxlResult,
  LatticeBxlValue,
} from './lattice-bxl-derivation.ts';

const programs = new Map<string, PreparedBxl>();
const cardPrograms = new Map<
  string,
  ReturnType<typeof prepareLatticeCardCompute>
>();

function prepare(manifest: LatticeBxlManifest): PreparedBxl {
  if (
    manifest.version !== 1 ||
    !manifest.definition?.revision ||
    !manifest.field ||
    !manifest.output
  ) {
    throw new Error('Unsupported BXL manifest');
  }
  // Key includes the expression and revision; a changed formula cannot reuse a
  // prepared program even if a caller mistakenly reuses its definition label.
  let key = JSON.stringify(manifest);
  let program = programs.get(key);
  if (program) return program;
  let ast = compileBxl(manifest.expression, {
    target: 'ast',
    readableSyntax: false,
    libraries: ['core'],
    profile: 'derive',
    attachment: 'formula',
  });
  assertValidBxlProfile(ast, { profile: 'derive', attachment: 'formula' });
  program = prepareBxl(manifest.expression, {
    readableSyntax: false,
    libraries: ['core'],
  });
  if (programs.size >= 16) programs.delete(programs.keys().next().value!);
  programs.set(key, program);
  return program;
}

parentPort?.on(
  'message',
  ({
    kind,
    manifest,
    inputs,
  }: {
    kind: 'field' | 'card';
    manifest: LatticeBxlManifest;
    inputs: LatticeBxlInput[];
  }) => {
    try {
      let start = performance.now();
      if (kind === 'card') {
        const plan = manifest as unknown as LatticeCardComputePlan;
        const key = JSON.stringify(plan);
        let compute = cardPrograms.get(key);
        if (!compute) {
          compute = prepareLatticeCardCompute(plan);
          if (cardPrograms.size >= 16) {
            cardPrograms.delete(cardPrograms.keys().next().value!);
          }
          cardPrograms.set(key, compute);
        }
        const prepared = performance.now();
        const fields: LatticeCardComputeResult['measurements']['fields'] = [];
        let omittedFieldTimings = 0;
        const artifacts = inputs.map((input, cardIndex) => {
          if (!input.id || !input.revision) {
            throw new Error('Missing BXL input identity');
          }
          return compute(input, (timing) => {
            // A large admitted batch must not produce an unbounded diagnostic.
            if (fields.length < 1024) fields.push({ ...timing, cardIndex });
            else omittedFieldTimings++;
          });
        });
        const memory = process.memoryUsage();
        parentPort!.postMessage({
          result: {
            artifacts,
            measurements: {
              prepareMs: prepared - start,
              evaluateMs: performance.now() - prepared,
              workerHeapBytes: memory.heapUsed,
              processRssBytes: memory.rss,
              fields,
              omittedFieldTimings,
            },
          },
        });
        return;
      }
      let program = prepare(manifest);
      let prepared = performance.now();
      let artifacts = inputs.map(({ id, revision, json }) => {
        if (!id || !revision) throw new Error('Missing BXL input identity');
        let input: unknown = JSON.parse(json);
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          throw new Error('BXL input must be an attribute object');
        }
        assertShape(input, manifest.input, '$');
        let result = program.evaluate(input, {
          runtimeLimits: {
            ...latticeNativeRuntimeLimits(),
            maxOutputs: 1,
            maxOutputBytes: latticeBxlOutputLimit(manifest.output),
          },
        });
        // Multi-output / error / unsupported coercion falls back rather than
        // publishing a guessed value. Null is a valid explicit blank.
        if (result.outputs.length !== 1) {
          throw new Error('BXL derivation must return exactly one value');
        }
        let value = result.value;
        assertShape(value, manifest.output, 'output');
        return {
          id,
          inputRevision: revision,
          definitionRevision: manifest.definition.revision,
          field: manifest.field,
          value: value as LatticeBxlValue,
        };
      });
      let memory = process.memoryUsage();
      let result: LatticeBxlResult = {
        artifacts,
        measurements: {
          prepareMs: prepared - start,
          evaluateMs: performance.now() - prepared,
          workerHeapBytes: memory.heapUsed,
          processRssBytes: memory.rss,
        },
      };
      parentPort!.postMessage({ result });
    } catch (error) {
      parentPort!.postMessage({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
