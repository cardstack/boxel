import { bxl, getBxlComputeDefinition } from '@cardstack/bxl';
import type { BuiltinLibraryName, BxlComputeFunction } from '@cardstack/bxl';
import type {
  BaseCardComputeName,
  BxlComputeDefinition,
  Definition,
} from '@cardstack/runtime-common/definitions';
import {
  baseCardTitle,
  baseCardDescription,
  baseCardTheme,
  baseCardThumbnailURL,
} from '@cardstack/runtime-common/base-card-computations';
import type { BaseCardInfoValues } from '@cardstack/runtime-common/base-card-computations';
import type {
  LatticeComputedFieldTiming,
  LatticeNativeComputeMeasurements,
} from '@cardstack/runtime-common/lattice-native-index';
import type {
  LatticeBxlInput,
  LatticeBxlShape,
  LatticeBxlValue,
} from './lattice-bxl-derivation.ts';

export interface LatticeCardComputePlan {
  version: 1;
  definition: { module: string; name: string; revision: string };
  displayName: string;
  input: { object: Record<string, LatticeBxlShape> };
  omittedInputs?: string[];
  // Query parameters sometimes need a computed prerequisite before the rest
  // of the inputs can be queried. This is not a complete card publication.
  requestedFields?: string[];
  fields: Record<
    string,
    {
      output: LatticeBxlShape;
      bxl?: BxlComputeDefinition;
      baseCompute?: BaseCardComputeName;
    }
  >;
}

export interface LatticeCardComputeInput extends LatticeBxlInput {
  // A URL from the revision-pinned screenshot metadata, not a capture request.
  thumbnailURL?: string;
}

export interface LatticeCardComputeResult {
  artifacts: Array<{
    id: string;
    inputRevision: string;
    definitionRevision: string;
    values: Record<string, LatticeBxlValue | undefined>;
    // Raw time-grain results per grained field (a date, an instant or
    // null); the caller converts and stores the earliest.
    grains?: Record<string, string | null>;
    // Raw freshness-grain results per field (BxlOptions.freshUntil), same
    // value shape; the caller keeps the earliest as the owner's fresh bound.
    fresh?: Record<string, string | null>;
    // Raw staleness-bound results per field (BxlOptions.staleAfter), same
    // value shape; the caller keeps the earliest as the owner's deadline.
    stale?: Record<string, string | null>;
    // The input paths the programs read, normalized (`players.*.average`,
    // `season`; `x.*` when an object under `x` was enumerated). A derive
    // program is pure, so if none of the values it read changed its output
    // cannot change: the publication uses these to skip re-dirtying this
    // owner for an input change outside its reads (read-path change
    // detection). Absent when nothing recorded the reads.
    reads?: string[];
  }>;
  measurements: LatticeNativeComputeMeasurements;
}

// Program admission only. The caller must supply a complete, normalized input
// snapshot and retain all its revisions through conditional publication. This
// does not yet admit serialization, query membership or a complete index row.
export function makeLatticeCardComputePlan(
  definition: Definition,
  revision: string,
  input: LatticeCardComputePlan['input'],
  outputs: Record<string, LatticeBxlShape>,
): LatticeCardComputePlan {
  // A card definition, or a contained FieldDef whose own computeds run per
  // node (lattice-card-data evaluateNested).
  if (
    (definition.type !== 'card-def' && definition.type !== 'field-def') ||
    !('module' in definition.codeRef) ||
    !revision
  ) {
    throw new Error('Native computation requires a revisioned card definition');
  }
  const displayName = definition.displayName ?? definition.codeRef.name;
  const fields: LatticeCardComputePlan['fields'] = {};
  for (const [name, key] of Object.entries(definition.fields)) {
    const field = definition.fieldDefs[key];
    if (!field) throw new Error(`Missing definition for ${name}`);
    if (!field.isComputed) continue;
    if (Object.hasOwn(input.object, name)) {
      throw new Error(`Computed input ${name} must be evaluated, not supplied`);
    }
    if (!Object.hasOwn(outputs, name)) {
      throw new Error(`Missing computed output shape: ${name}`);
    }
    if (field.bxl && field.baseCompute) {
      throw new Error(`Ambiguous computation: ${name}`);
    }
    if (field.bxl) {
      assertSupportedProgram(field.bxl, outputs[name]);
      fields[name] = { bxl: field.bxl, output: outputs[name] };
    } else if (field.baseCompute) {
      fields[name] = { baseCompute: field.baseCompute, output: outputs[name] };
    } else {
      throw new Error(`Unported application computation: ${name}`);
    }
  }
  if (Object.keys(outputs).some((name) => !Object.hasOwn(fields, name))) {
    throw new Error('Output shape names an undeclared computation');
  }
  for (const field of Object.values(fields)) {
    assertRootInputs(field.bxl?.deps ?? ['cardInfo'], input, fields);
  }
  return {
    version: 1,
    definition: { ...definition.codeRef, revision },
    displayName,
    input,
    omittedInputs: Object.keys(definition.fields).filter(
      (name) =>
        !Object.hasOwn(fields, name) && !Object.hasOwn(input.object, name),
    ),
    fields,
  };
}

export function makeLatticeCardPrerequisitePlan(
  definition: Definition,
  revision: string,
  input: LatticeCardComputePlan['input'],
  outputs: Record<string, LatticeBxlShape>,
  requestedFields: string[],
): LatticeCardComputePlan {
  if (!requestedFields.length || requestedFields.length > 64)
    throw new Error('Native prerequisites must be nonempty and bounded');
  const selected = new Set<string>();
  const field = (name: string) => definition.fieldDefs[definition.fields[name]];
  for (const name of Object.keys(input.object)) {
    if (field(name)?.isComputed)
      throw new Error(`Computed input ${name} must be evaluated, not supplied`);
  }
  function include(name: string) {
    const current = field(name);
    if (!current?.isComputed)
      throw new Error(`Unknown computed prerequisite: ${name}`);
    if (selected.has(name)) return;
    selected.add(name);
    // Captured hints choose the prerequisite closure. Worker compilation
    // independently checks the actual program's roots and rejects omissions.
    for (const dependency of current.bxl?.deps ?? []) {
      if (field(dependency)?.isComputed) include(dependency);
    }
  }
  requestedFields.forEach(include);
  const plan = makeLatticeCardComputePlan(
    {
      ...definition,
      fields: Object.fromEntries(
        Object.entries(definition.fields).filter(
          ([name]) => !field(name)?.isComputed || selected.has(name),
        ),
      ),
    },
    revision,
    input,
    Object.fromEntries(
      [...selected].map((name) => {
        if (!Object.hasOwn(outputs, name))
          throw new Error(`Missing computed output shape: ${name}`);
        return [name, outputs[name]];
      }),
    ),
  );
  return {
    ...plan,
    requestedFields: [...requestedFields],
    omittedInputs: Object.keys(definition.fields).filter(
      (name) =>
        !Object.hasOwn(plan.fields, name) && !Object.hasOwn(input.object, name),
    ),
  };
}

// The recorded form of a read: `$.players[3].average` becomes
// `players.*.average`, so one entry stands for every member of an array.
function readPath(path: string): string {
  return path.replace(/^\$\.?/, '').replace(/\[\d+\]/g, '.*');
}

// A JSON-shaped input (a query field presented whole, a JsonField) admits
// any key, so it needs no coverage guard, but its reads still have to be
// seen. Wrap lazily on access: an index read on an array records the
// member (`x.*`), `length` and the array methods are not reads (a method
// called on the proxy indexes back through it), enumerating an object
// records the wildcard, and a property read returns the wrapped child.
function recordingInputs(
  value: unknown,
  path: string,
  reads: Set<string>,
): unknown {
  if (value === null || typeof value !== 'object') return value;
  const isArray = Array.isArray(value);
  return new Proxy(value as object, {
    get(target, key) {
      if (typeof key !== 'string') return Reflect.get(target, key);
      if (isArray) {
        if (!/^\d+$/.test(key)) return Reflect.get(target, key);
        const child = `${path}[${key}]`;
        reads.add(readPath(child));
        return recordingInputs(Reflect.get(target, key), child, reads);
      }
      if (key === 'toJSON' && !Object.hasOwn(target, key)) return undefined;
      const child = `${path}.${key}`;
      reads.add(readPath(child));
      const value = Reflect.get(target, key);
      // A compound value (an object or array) read whole: the search
      // document does not carry it faithfully, so mark it as a compound
      // read (`field.*`), which the publication treats as always changed.
      if (value !== null && typeof value === 'object')
        reads.add(readPath(`${child}.*`));
      return recordingInputs(value, child, reads);
    },
    ownKeys(target) {
      // Enumerating an array yields its indexes (membership, which always
      // invalidates); enumerating an object reads all of it.
      if (!isArray) reads.add(readPath(`${path}.*`));
      return Reflect.ownKeys(target);
    },
    has(target, key) {
      if (typeof key === 'string' && !(isArray && !/^\d+$/.test(key)))
        reads.add(readPath(isArray ? `${path}[${key}]` : `${path}.${key}`));
      return Reflect.has(target, key);
    },
  });
}

function protectedInputs(
  value: unknown,
  shape: LatticeBxlShape,
  path: string,
  missing: Set<string>,
  reads?: Set<string>,
): unknown {
  if (value == null) return value;
  if (typeof shape === 'string')
    return shape === 'json' && reads
      ? recordingInputs(value, path, reads)
      : value;
  if ('array' in shape) {
    return (value as unknown[]).map((item, i) =>
      protectedInputs(item, shape.array, `${path}[${i}]`, missing, reads),
    );
  }
  const target = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(shape.object)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) {
      throw new Error(`Invalid native input name: ${key}`);
    }
    target[key] = protectedInputs(
      target[key],
      child,
      `${path}.${key}`,
      missing,
      reads,
    );
  }
  return new Proxy(target, {
    get(object, key) {
      // JSON's own serializer probes this optional method. No user hook is
      // present: the target was parsed from bytes inside this worker.
      if (key === 'toJSON' && !Object.hasOwn(object, key)) return undefined;
      if (typeof key === 'string' && !Object.hasOwn(object, key)) {
        missing.add(`${path}.${key}`);
        throw new Error(`Unadmitted computed input: ${path}.${key}`);
      }
      if (typeof key === 'string' && reads)
        reads.add(readPath(`${path}.${key}`));
      return Reflect.get(object, key);
    },
    // Enumerating an object (keys, to_entries, emitting it whole) reads all
    // of it; record the wildcard so the owner stays conservative.
    ownKeys(object) {
      reads?.add(readPath(`${path}.*`));
      return Reflect.ownKeys(object);
    },
    has(object, key) {
      if (typeof key === 'string' && reads)
        reads.add(readPath(`${path}.${key}`));
      return Reflect.has(object, key);
    },
  });
}

function assertRootInputs(
  roots: string[],
  input: LatticeCardComputePlan['input'],
  fields: LatticeCardComputePlan['fields'],
) {
  for (const name of roots) {
    if (!Object.hasOwn(input.object, name) && !Object.hasOwn(fields, name)) {
      throw new Error(`Unadmitted computed input: ${name}`);
    }
  }
}

// The builtin libraries a native program may resolve against. `formula` is
// the spreadsheet function set (AVERAGE, STDEV, CORREL, SLOPE, FORECAST, ...);
// the `derive` profile the worker re-checks already bans its volatile members
// (NOW, RAND, ...) for every library, so admitting it keeps outputs a pure
// function of the inputs. The lazily chunked families (formula-statistical
// and friends) stay out until the worker loads their chunk.
export const LATTICE_NATIVE_BXL_LIBRARIES: readonly BuiltinLibraryName[] = [
  'core',
  'formula',
];

export function assertNativeBxlLibraries(
  libraries: readonly string[] | undefined,
): BuiltinLibraryName[] {
  if (
    !Array.isArray(libraries) ||
    !libraries.length ||
    !libraries.includes('core') ||
    libraries.some(
      (name) =>
        !LATTICE_NATIVE_BXL_LIBRARIES.includes(name as BuiltinLibraryName),
    )
  ) {
    throw new Error('Unsupported native BXL program libraries');
  }
  return [...new Set(libraries)] as BuiltinLibraryName[];
}

// A program that builds records declares the FieldDef it materializes
// (`bxl(source, { as: BoxLine })`), which is how the browser turns the raw
// output into field instances it can serialize. The native path never runs
// that constructor: it validates the raw record against the declared shape
// and normalizes it with the field's own codecs. So the option is admitted
// exactly where the output is a record, and still refused for a scalar or
// JSON output, where materializing a class would mean the value is not the
// plain data the engine indexes.
function isRecordShape(shape: LatticeBxlShape | undefined): boolean {
  if (!shape || typeof shape === 'string') return false;
  return 'array' in shape ? isRecordShape(shape.array) : true;
}

function assertSupportedProgram(
  program: BxlComputeDefinition,
  output?: LatticeBxlShape,
) {
  if (
    program.version !== 1 ||
    (program.materializesClass && !isRecordShape(output)) ||
    program.customRuntimeLimits
  ) {
    throw new Error('Unsupported native BXL program options');
  }
  assertNativeBxlLibraries(program.libraries);
}

function artifactValue(
  value: LatticeBxlValue | undefined,
): LatticeBxlValue | undefined {
  if (Array.isArray(value)) {
    return value.map((item) => artifactValue(item) as LatticeBxlValue);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, artifactValue(item)]),
    ) as LatticeBxlValue;
  }
  return value;
}

// Called on parsed JSON before adding internal computed getters. Validation
// cannot execute a realm getter, proxy, toJSON hook or userland module.
export function assertLatticeShape(
  value: unknown,
  shape: LatticeBxlShape,
  path: string,
  depth = 0,
): void {
  if (depth > 32) throw new Error('BXL input exceeds maximum depth');
  if (value === null || value === undefined) return;
  if (shape === 'json') {
    if (Array.isArray(value)) {
      value.forEach((item, i) =>
        assertLatticeShape(item, shape, `${path}[${i}]`, depth + 1),
      );
    } else if (typeof value === 'object') {
      if (
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      )
        throw new Error(`Expected JSON data at ${path}`);
      for (const [key, item] of Object.entries(value))
        assertLatticeShape(item, shape, `${path}.${key}`, depth + 1);
    } else if (
      !['string', 'number', 'boolean'].includes(typeof value) ||
      (typeof value === 'number' && !Number.isFinite(value))
    ) {
      throw new Error(`Expected JSON data at ${path}`);
    }
    return;
  }
  if (typeof shape === 'string') {
    if (
      typeof value !== shape ||
      (typeof value === 'number' && !Number.isFinite(value))
    ) {
      throw new Error(`BXL input shape mismatch at ${path}`);
    }
  } else if ('array' in shape) {
    if (!Array.isArray(value)) throw new Error(`Expected array at ${path}`);
    value.forEach((item, i) =>
      assertLatticeShape(item, shape.array, `${path}[${i}]`, depth + 1),
    );
  } else {
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Expected object at ${path}`);
    }
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(shape.object, key)) {
        throw new Error(`Unadmitted BXL input field ${path}.${key}`);
      }
      assertLatticeShape(item, shape.object[key], `${path}.${key}`, depth + 1);
    }
  }
}

// The real classroom day is larger than the scalar-field budget. JSON fields
// may publish up to 1 MiB; ordinary typed scalar/record outputs keep their
// existing bound. The evaluator still enforces time, steps and one output.
// Sized for the Nucleus day owner (a 1.3 MB JSON output): the earlier 1 MiB
// fit the per-field BATS experiment only.

// Per-evaluation budget for one card's programs. The Nucleus day owner needs
// several hundred thousand steps; the defaults leave headroom for a day's
// records while still bounding a runaway program. Tests lower them.
export function latticeNativeRuntimeLimits(): {
  maxSteps: number;
  maxMillis: number;
} {
  const steps = Number(process.env.LATTICE_NATIVE_BXL_MAX_STEPS);
  const millis = Number(process.env.LATTICE_NATIVE_BXL_MAX_MILLIS);
  return {
    maxSteps: Number.isSafeInteger(steps) && steps > 0 ? steps : 50_000_000,
    maxMillis: Number.isSafeInteger(millis) && millis > 0 ? millis : 10_000,
  };
}

export function latticeBxlOutputLimit(shape: LatticeBxlShape): number {
  if (shape === 'json') return 8 * 1_048_576;
  if (typeof shape === 'string') return 65_536;
  // A plural output is as many members as the input admits (a quadrant of
  // every qualified season): bound it like a JSON field, not like one member.
  if ('array' in shape)
    return Math.max(4 * 1_048_576, latticeBxlOutputLimit(shape.array));
  return Math.max(
    65_536,
    ...Object.values(shape.object).map(latticeBxlOutputLimit),
  );
}

// Runs inside the bounded worker. Only these built-in base functions and the
// official BXL factory execute; a definition cannot provide a module to import.
export function prepareLatticeCardCompute(plan: LatticeCardComputePlan) {
  if (plan.version !== 1 || !plan.definition.revision) {
    throw new Error('Unsupported native card compute plan');
  }
  const programs = new Map<string, BxlComputeFunction>();
  const grains = new Map<string, BxlComputeFunction>();
  const freshGrains = new Map<string, BxlComputeFunction>();
  const staleGrains = new Map<string, BxlComputeFunction>();
  const dependencies = new Map<string, string[]>();
  const compileGrain = (
    source: string,
    libraries: BuiltinLibraryName[],
  ): BxlComputeFunction => {
    const grain = bxl(source, {
      readableSyntax: false,
      libraries,
      memoize: false,
      runtimeLimits: {
        maxSteps: 1_000_000,
        maxMillis: 1_000,
        maxOutputs: 1,
        maxOutputBytes: 256,
      },
    });
    assertRootInputs(
      getBxlComputeDefinition(grain)!.deps,
      plan.input,
      plan.fields,
    );
    return grain;
  };
  for (const [name, field] of Object.entries(plan.fields)) {
    if (['__proto__', 'constructor', 'prototype'].includes(name)) {
      throw new Error(`Invalid computed field name: ${name}`);
    }
    if (Object.hasOwn(plan.input.object, name)) {
      throw new Error(`Computed input ${name} must be evaluated, not supplied`);
    }
    if (field.bxl) {
      assertSupportedProgram(field.bxl, field.output);
      const libraries = assertNativeBxlLibraries(field.bxl.libraries);
      const compute = bxl(field.bxl.expression, {
        readableSyntax: false,
        libraries,
        memoize: false,
        runtimeLimits: {
          ...latticeNativeRuntimeLimits(),
          maxOutputs: 1,
          maxOutputBytes: latticeBxlOutputLimit(field.output),
        },
      });
      // Re-derive the known roots with the official compiler. Persisted hints
      // cannot authorize an input that the worker's compiled program needs.
      const deps = getBxlComputeDefinition(compute)!.deps;
      assertRootInputs(deps, plan.input, plan.fields);
      dependencies.set(name, deps);
      programs.set(name, compute);
      // A grain runs over the same facade after the value; its roots were
      // folded into the field's dependencies by the factory.
      if (field.bxl.validUntil)
        grains.set(name, compileGrain(field.bxl.validUntil, libraries));
      if (field.bxl.freshUntil)
        freshGrains.set(name, compileGrain(field.bxl.freshUntil, libraries));
      if (field.bxl.staleAfter)
        staleGrains.set(name, compileGrain(field.bxl.staleAfter, libraries));
    } else {
      assertRootInputs(['cardInfo'], plan.input, plan.fields);
      dependencies.set(name, ['cardInfo']);
    }
  }
  // Stabilize known prerequisites before starting the consuming BXL timer.
  // Otherwise a parent's wall-time budget includes work done by nested fields,
  // even when each individual computation is within its own budget. Use the
  // compiler's actual roots, not the persisted dependency hints, for ordering.
  const evaluationOrder: string[] = [];
  const ordered = new Set<string>();
  const ordering = new Set<string>();
  let hasConditionalCycle = false;
  const order = (name: string) => {
    if (ordered.has(name)) return;
    if (ordering.has(name)) {
      hasConditionalCycle = true;
      return;
    }
    ordering.add(name);
    for (const dependency of dependencies.get(name) ?? []) {
      if (dependencies.has(dependency)) order(dependency);
    }
    ordering.delete(name);
    ordered.add(name);
    evaluationOrder.push(name);
  };
  Object.keys(plan.fields).forEach(order);
  // Static roots can contain conditional cycles that never execute. Back
  // edges retain the original lazy order rather than changing conditional
  // behavior. The getter guard still rejects cycles actually encountered.
  if (hasConditionalCycle) {
    evaluationOrder.splice(
      0,
      evaluationOrder.length,
      ...Object.keys(plan.fields),
    );
  }
  return (
    input: LatticeCardComputeInput,
    onField?: (timing: LatticeComputedFieldTiming) => void,
  ) => {
    const source: unknown = JSON.parse(input.json);
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error('BXL input must be an attribute object');
    }
    assertLatticeShape(source, plan.input, '$');
    const missing = new Set<string>();
    const reads = new Set<string>();
    const card = protectedInputs(
      source,
      plan.input,
      '$',
      missing,
      reads,
    ) as Record<string, unknown>;
    for (const name of plan.omittedInputs ?? []) {
      Object.defineProperty(card, name, {
        enumerable: true,
        get() {
          missing.add(`$.${name}`);
          throw new Error(`Unadmitted computed input: $.${name}`);
        },
      });
    }
    const values: Record<string, LatticeBxlValue | undefined> = {};
    const computing = new Set<string>();
    for (const [name, field] of Object.entries(plan.fields)) {
      Object.defineProperty(card, name, {
        enumerable: true,
        get() {
          if (Object.hasOwn(values, name)) return values[name];
          // Do not publish an order-dependent answer for mutually recursive
          // computed fields. The ordinary card runtime remains the fallback.
          if (computing.has(name)) {
            throw new Error(`Cyclic native computation: ${name}`);
          }
          computing.add(name);
          const start = performance.now();
          const cpu = process.threadCpuUsage();
          const timing: LatticeComputedFieldTiming = {
            field: name,
            evaluator: field.bxl ? 'bxl' : 'base',
            phase: 'evaluate',
            status: 'rejected',
            elapsedMs: 0,
            cpuMs: 0,
          };
          const finishTiming = () => {
            const used = process.threadCpuUsage(cpu);
            timing.elapsedMs = performance.now() - start;
            timing.cpuMs = (used.user + used.system) / 1_000;
          };
          try {
            let value: unknown;
            const program = programs.get(name);
            if (program) {
              value = program.call(card);
            } else {
              const info = (card.cardInfo ?? {}) as BaseCardInfoValues;
              switch (field.baseCompute) {
                case 'cardTitle':
                  value = baseCardTitle(info, plan.displayName);
                  break;
                case 'cardDescription':
                  value = baseCardDescription(info);
                  break;
                case 'cardTheme':
                  value = baseCardTheme(info);
                  break;
                case 'cardThumbnailURL':
                  value = baseCardThumbnailURL(info, () => input.thumbnailURL);
                  break;
                default:
                  throw new Error(`Unknown base computation: ${name}`);
              }
            }
            timing.phase = 'validate';
            assertLatticeShape(value, field.output, name);
            // Optional-path operators may catch an evaluator error. They must
            // not turn an unresolved projected input into a confirmed blank.
            if (missing.size) {
              throw new Error(
                `Unadmitted computed input: ${[...missing].join(', ')}`,
              );
            }
            values[name] = value as LatticeBxlValue | undefined;
            timing.status = 'fulfilled';
            return value;
          } catch (error) {
            finishTiming();
            throw new Error(
              `Lattice computation ${plan.definition.name}.${name} ` +
                `[${timing.evaluator}/${timing.phase}, ` +
                `wall=${timing.elapsedMs.toFixed(2)}ms, ` +
                `threadCPU=${timing.cpuMs.toFixed(2)}ms]: ` +
                (error instanceof Error ? error.message : String(error)),
              { cause: error },
            );
          } finally {
            finishTiming();
            onField?.(timing);
            computing.delete(name);
          }
        },
      });
    }
    // Lazy reads still handle conditional dependencies and reject real cycles.
    // Every declared computation completes once before the card can publish.
    for (const name of evaluationOrder) void card[name];
    const evaluateGrains = (
      kind: 'time' | 'freshness' | 'staleness',
      programs: Map<string, BxlComputeFunction>,
    ): Record<string, string | null> | undefined => {
      let results: Record<string, string | null> | undefined;
      for (const [name, grain] of programs) {
        let result: unknown;
        try {
          result = grain.call(card);
        } catch (error) {
          throw new Error(
            `Lattice ${kind} grain ${plan.definition.name}.${name}: ` +
              (error instanceof Error ? error.message : String(error)),
            { cause: error },
          );
        }
        if (result !== null && typeof result !== 'string') {
          throw new Error(
            `Lattice ${kind} grain ${plan.definition.name}.${name} must yield a date, an instant or null`,
          );
        }
        (results ??= {})[name] = result;
      }
      return results;
    };
    const grainResults = evaluateGrains('time', grains);
    const freshResults = evaluateGrains('freshness', freshGrains);
    const staleResults = evaluateGrains('staleness', staleGrains);
    return {
      id: input.id,
      inputRevision: input.revision,
      definitionRevision: plan.definition.revision,
      ...(grainResults ? { grains: grainResults } : {}),
      ...(freshResults ? { fresh: freshResults } : {}),
      ...(staleResults ? { stale: staleResults } : {}),
      reads: [...reads],
      // Trusted base functions can return a protected input reference. Leave
      // read guards inside this worker and send only plain data to publication.
      values: Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          artifactValue(value),
        ]),
      ),
    };
  };
}
