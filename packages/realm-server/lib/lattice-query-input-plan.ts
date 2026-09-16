import {
  getImmediateFieldDef,
  type Definition,
} from '@cardstack/runtime-common/definitions';
import {
  normalizeQueryDefinition,
  buildQuerySearchURL,
} from '@cardstack/runtime-common/query-field-utils';
import type { Query } from '@cardstack/runtime-common/query';
import type { CodeRef } from '@cardstack/runtime-common/code-ref';
import type { LatticeInputStageTiming } from '@cardstack/runtime-common/lattice-native-index';
import { makeLatticeCardPrerequisitePlan } from './lattice-card-compute.ts';
import type {
  LatticeBxlShape,
  LatticeBxlWorker,
} from './lattice-bxl-derivation.ts';
import type { LatticeMaterializationInputs } from './lattice-materialization-inputs.ts';
import {
  LatticeDataProjector,
  assertLatticeDataProjection,
} from './lattice-data-projection.ts';

export interface LatticeResolvedQueryInput {
  values: Record<string, any>[];
  identities: string[];
  query: Query;
  searchURL: string;
}
export type LatticeQueryInputResolver = (inputs: {
  values: Record<string, any>;
  shapes: Record<string, LatticeBxlShape>;
  outputShapes: Record<string, LatticeBxlShape>;
}) => Promise<Map<string, LatticeResolvedQueryInput>>;

export function createLatticeQueryInputResolver({
  frame,
  definition,
  definitionRevision,
  id,
  sourceRevision,
  realmURL,
  worker,
  resolve,
  lookup,
  signal,
  onTiming,
}: {
  frame: LatticeMaterializationInputs;
  definition: Definition;
  definitionRevision: string;
  id: string;
  sourceRevision: string;
  realmURL: string;
  worker: LatticeBxlWorker;
  resolve(reference: string, relativeTo: string): string;
  lookup(reference: CodeRef): Promise<Definition>;
  signal?: AbortSignal;
  onTiming?(timing: LatticeInputStageTiming): void;
}): LatticeQueryInputResolver {
  const linkDefinitions = new Map<string, Promise<Definition>>();
  const projector = new LatticeDataProjector(
    (urls) => frame.readLinks(urls),
    resolve,
    async (owner, fieldPath, targets) => {
      const adopted = owner.resource.meta.adoptsFrom;
      if (!('module' in adopted))
        throw new Error('Missing trusted projected relationship definition');
      const ref = {
        ...adopted,
        module: resolve(adopted.module, owner.url) as typeof adopted.module,
      };
      const key = JSON.stringify(ref);
      let pending = linkDefinitions.get(key);
      if (!pending) {
        // The admission supplies cached reviewed schema only, never a loader.
        // Freeze it so the same frame cannot observe changing opt-out policy.
        pending = lookup(ref).then((definition) => structuredClone(definition));
        linkDefinitions.set(key, pending);
      }
      const definition = await pending;
      const field = getImmediateFieldDef(definition, fieldPath);
      if (
        definition.type !== 'card-def' ||
        !field ||
        (field.type !== 'linksTo' && field.type !== 'linksToMany')
      )
        throw new Error('Missing trusted projected relationship definition');
      frame.retainLinks(
        owner.url,
        fieldPath,
        targets.map((url) => url + '.json'),
        { snapshot: field.snapshot },
      );
    },
  );
  const declarations = structuredClone(definition.nativeQueryInputs ?? {});
  for (const [name, projection] of Object.entries(declarations)) {
    if (!getImmediateFieldDef(definition, name)?.query)
      throw new Error('Lattice projection names an undeclared query');
    assertLatticeDataProjection(projection);
  }
  return async ({
    values: authoredValues,
    shapes: authoredShapes,
    outputShapes,
  }) => {
    const values = { ...authoredValues },
      shapes = { ...authoredShapes };
    const resolved = new Map<string, LatticeResolvedQueryInput>();
    const active = new Set<string>();
    const computed = new Set<string>();
    const field = (name: string) => getImmediateFieldDef(definition, name);
    const ready = (name: string) =>
      Object.hasOwn(shapes, name) || computed.has(name);
    const ensure = async (name: string): Promise<void> => {
      signal?.throwIfAborted();
      if (ready(name)) return;
      if (active.has(name))
        throw new Error(`Lattice query/computation cycle: ${name}`);
      const current = field(name);
      if (!current) throw new Error(`Undeclared Lattice query input: ${name}`);
      active.add(name);
      try {
        if (current.query) {
          if (current.type !== 'linksToMany' || !declarations[name])
            throw new Error(`Missing Lattice query data projection: ${name}`);
          // Interpolation itself stays in the existing query normalizer. A
          // requested but unready root triggers dependency settlement, never
          // an empty parameter or a broadened query.
          let normalized;
          for (
            let attempt = 0;
            attempt <= Object.keys(definition.fields).length;
            attempt++
          ) {
            let needed: string | undefined;
            try {
              normalized = normalizeQueryDefinition({
                fieldDefinition: current,
                queryDefinition: current.query,
                realmURL: new URL(realmURL),
                fieldName: name,
                relativeTo: new URL(id),
                resolvePathValue: (path) => {
                  const [root, ...tail] = path.split('.');
                  if (!ready(root)) {
                    needed = root;
                    throw new Error('Lattice input not ready');
                  }
                  let value = values[root];
                  for (const part of tail) {
                    if (
                      ['__proto__', 'prototype', 'constructor'].includes(part)
                    )
                      throw new Error('Invalid input path');
                    if (value == null || !Object.hasOwn(value, part))
                      return undefined;
                    value = value[part];
                  }
                  return value;
                },
              });
            } catch (error) {
              if (!needed) throw error;
              await ensure(needed);
              continue;
            }
            break;
          }
          if (!normalized)
            throw new Error(`Unresolved Lattice query parameters: ${name}`);
          // The normalizer returns realms separately from the filter. Carry
          // them into the reader so it can enforce its single-realm authority.
          const { realm: _realm, realms: _realms, ...body } = normalized.query;
          const query: Query = { ...body, realms: normalized.realms };
          const queryStart = performance.now();
          const result = await frame.query(name, query, {
            snapshot: current.snapshot,
          });
          onTiming?.({
            field: name,
            kind: 'query',
            elapsedMs: performance.now() - queryStart,
            cards: result.cards.length,
          });
          signal?.throwIfAborted();
          if (result.meta.page?.total !== result.cards.length)
            throw new Error(`Incomplete Lattice query membership: ${name}`);
          const projectionStart = performance.now();
          const projected = await projector.project(
            result.cards,
            declarations[name],
          );
          onTiming?.({
            field: name,
            kind: 'projection',
            elapsedMs: performance.now() - projectionStart,
            cards: result.cards.length,
          });
          const identities = result.cards.map((card) =>
            card.url.replace(/\.json$/, ''),
          );
          resolved.set(name, {
            values: projected,
            identities,
            query,
            searchURL: buildQuerySearchURL(normalized.realms, normalized.query),
          });
          values[name] = projected;
          shapes[name] = 'json';
        } else if (current.isComputed) {
          const deps =
            current.bxl?.deps ??
            (current.baseCompute ? ['cardInfo'] : undefined);
          if (!deps) throw new Error(`Unported query prerequisite: ${name}`);
          for (const dep of deps) await ensure(dep);
          const plan = makeLatticeCardPrerequisitePlan(
            definition,
            definitionRevision,
            { object: shapes },
            outputShapes,
            [name],
          );
          const input = Object.fromEntries(
            Object.keys(shapes).map((key) => [key, values[key]]),
          );
          const json = JSON.stringify(input);
          const prerequisiteStart = performance.now();
          const result = await worker.evaluateCard(
            plan,
            [{ id, revision: sourceRevision, json }],
            undefined,
            signal,
          );
          onTiming?.({
            field: name,
            kind: 'prerequisite',
            elapsedMs: performance.now() - prerequisiteStart,
            inputBytes: Buffer.byteLength(json),
            evaluatorMs: result.measurements.evaluateMs,
          });
          Object.assign(values, result.artifacts[0].values);
          Object.keys(result.artifacts[0].values).forEach((name) =>
            computed.add(name),
          );
        } else throw new Error(`Unadmitted Lattice query input: ${name}`);
      } finally {
        active.delete(name);
      }
    };
    for (const name of Object.keys(definition.fields))
      if (field(name)?.query) await ensure(name);
    return resolved;
  };
}
