import type { BaseDef, CardDef, Field } from './card-api';
import { getRelationshipMembershipState } from './field-support';

type InputRead = { pending: boolean; loads: Set<Promise<unknown>> };
let currentRead: InputRead | undefined;
const resolving = new WeakMap<BaseDef, Set<string>>();
let inputLoads:
  | ((instance: BaseDef, field: Field) => readonly Promise<unknown>[])
  | undefined;

export function registerLatticeQueryInputLoads(
  readLoads: NonNullable<typeof inputLoads>,
): void {
  inputLoads = readLoads;
}

export class LatticeQueryInputsPending extends Error {
  readonly loads: readonly Promise<unknown>[];
  constructor(field: string, loads: readonly Promise<unknown>[] = []) {
    super(`Lattice query '${field}' is waiting for its input relationships`);
    this.loads = loads;
  }
}

export function isReadingLatticeQueryInputs(): boolean {
  return currentRead !== undefined;
}

// Parameter expressions are synchronous, even when reading a relationship
// starts an asynchronous load. Never interpret their placeholder value as a
// confirmed parameter, including a computed that defaults to an empty list.
export function readLatticeQueryInputs<T>(
  instance: BaseDef,
  field: Field,
  read: () => T,
): T {
  let fields = resolving.get(instance);
  if (!fields) resolving.set(instance, (fields = new Set()));
  if (fields.has(field.name)) {
    throw new Error(`Lattice query dependency cycle at '${field.name}'`);
  }
  fields.add(field.name);
  let parent = currentRead;
  let capture: InputRead = { pending: false, loads: new Set() };
  currentRead = capture;
  try {
    let value: T;
    try {
      value = read();
    } catch (error) {
      // A computed may dereference an unavailable target without optional
      // chaining. Retry after that target loads; an error with ready inputs
      // still propagates unchanged.
      if (!capture.pending) throw error;
      throw new LatticeQueryInputsPending(field.name, [...capture.loads]);
    }
    if (capture.pending)
      throw new LatticeQueryInputsPending(field.name, [...capture.loads]);
    return value;
  } finally {
    currentRead = parent;
    if (parent && capture.pending) {
      parent.pending = true;
      for (let load of capture.loads) parent.loads.add(load);
    }
    fields.delete(field.name);
  }
}

// Invoked after a declared relationship getter has initiated its normal load.
// Computed relationships are traced through the declared inputs they read;
// probing the computed itself would recursively evaluate it again.
export function recordLatticeQueryInput(instance: BaseDef, field: Field): void {
  if (
    !currentRead ||
    field.computeVia ||
    (field.fieldType !== 'linksTo' && field.fieldType !== 'linksToMany')
  )
    return;
  let state = getRelationshipMembershipState(instance as CardDef, field.name);
  if (state.isPartial) {
    throw new Error(
      `Lattice query input '${field.name}' has incomplete membership`,
    );
  }
  if (
    !state.isLoaded ||
    state.membership?.some((member) => member.kind === 'not-loaded') ||
    (field.queryDefinition &&
      field.fieldType === 'linksToMany' &&
      state.totalMatchCount === undefined)
  ) {
    currentRead.pending = true;
    for (let load of inputLoads?.(instance, field) ?? []) {
      currentRead.loads.add(load);
    }
  }
}
