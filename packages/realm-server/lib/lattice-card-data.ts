import type { LatticeTrace } from '@cardstack/runtime-common/lattice-trace';
import type { CodeRef } from '@cardstack/runtime-common';
import type { LatticeCardAssemblyTimings } from '@cardstack/runtime-common/lattice-native-index';
import type {
  Definition,
  NativeValueCodec,
} from '@cardstack/runtime-common/definitions';
import { getSerializer } from '@cardstack/runtime-common/serializers';
import type { LatticeBxlShape } from './lattice-bxl-derivation.ts';
import type { LatticeBxlWorker } from './lattice-bxl-derivation.ts';
import { makeLatticeCardComputePlan } from './lattice-card-compute.ts';
import type { LatticeQueryInputResolver } from './lattice-query-input-plan.ts';
import { assertLatticeDataProjection } from './lattice-data-projection.ts';
import { latticeClock, latticeValidUntilInstant } from './lattice-clock.ts';
import {
  getImmediateFieldDef,
  type LatticeDataProjection,
} from '@cardstack/runtime-common/definitions';

export interface LatticeDefinitionSnapshot {
  definition: Definition;
  revision: string;
}

interface DataNode {
  definition: Definition;
  values: Record<string, any>;
  children: Map<string, DataNode | DataNode[] | null>;
  shapes: Record<string, LatticeBxlShape>;
  usedLinks: Set<string>;
  wireLinks: Map<string, string[]>;
  // Contained-field computeds (a FieldDef's own BXL programs), evaluated per
  // node right after its authored values are normalized, so the holder's
  // programs read them like any other contained value.
  nestedComputed: Record<string, LatticeBxlShape>;
  // Date / datetime fields: values stay Date objects for the official
  // serializer and search codec; programs read them as the browser bridge
  // presents them (calendar date `YYYY-MM-DD`, or the ISO instant).
  dateKinds: Record<string, 'date' | 'datetime'>;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
function presentDate(value: unknown, kind: 'date' | 'datetime'): unknown {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return kind === 'date'
    ? `${pad(value.getFullYear(), 4)}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
    : value.toISOString();
}
// The values a node's programs read: every input shape's value, dates
// presented as strings, contained nodes presented recursively (including
// their own computed values).
function presentForProgram(node: DataNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(node.shapes)) {
    const value = node.values[name];
    const kind = node.dateKinds[name];
    if (kind) {
      out[name] = Array.isArray(value)
        ? value.map((item) => presentDate(item, kind))
        : presentDate(value, kind);
    } else if (node.children.has(name)) {
      const child = node.children.get(name);
      out[name] = Array.isArray(child)
        ? child.map(presentForProgram)
        : child
          ? presentForProgram(child)
          : null;
    } else out[name] = value;
  }
  return out;
}

const linkShape: LatticeBxlShape = { object: { id: 'string' } };

function primitiveShape(codec: NativeValueCodec): LatticeBxlShape {
  if (codec.kind === 'json') return 'json';
  if (codec.kind !== 'primitive') throw new Error('Expected primitive codec');
  if (codec.scalar === 'string') return 'string';
  if (codec.serializer === 'number') return 'number';
  if (codec.serializer === 'boolean') return 'boolean';
  throw new Error(`Unadmitted BXL input codec: ${codec.serializer}`);
}

// Produce an entire shallow card resource and search document from authored
// bytes. Definition lookups must be cache-only, scoped to the caller's authority.
// Constructor/default semantics for the admitted application definitions must
// be verified separately; nativeCodec attests value hooks, not constructors.
// This builds a candidate artifact. It does not write or authorize publication.
export async function assembleLatticeCardData({
  id,
  sourceRevision,
  sourceJSON,
  root,
  lookup,
  resolve,
  worker,
  resolveQueryInputs,
  resolveLinkInputs,
  signal,
  deferComputation = false,
  trace,
}: {
  id: string;
  sourceRevision: string;
  sourceJSON: string;
  trace?: LatticeTrace;
  root: LatticeDefinitionSnapshot;
  lookup: (codeRef: CodeRef) => Promise<LatticeDefinitionSnapshot>;
  resolve: (reference: string, relativeTo: string) => string;
  worker: LatticeBxlWorker;
  resolveQueryInputs?: LatticeQueryInputResolver;
  // Declared-link projections (CardDef.linkInputs): replaces a link's
  // identities with the projected records read by the caller, for feeders
  // whose computeds read through their links. Each entry names the link
  // field, its target identities and the declared projection; the result
  // maps field name to the projected value (a record, an array of records,
  // or null). Not used during deferred discovery.
  resolveLinkInputs?: (
    links: Array<{
      name: string;
      many: boolean;
      ids: string[];
      projection: LatticeDataProjection;
    }>,
  ) => Promise<Map<string, unknown>>;
  signal?: AbortSignal;
  // Source discovery only: normalize authored values and register a pending
  // owner. Do not invent empty query results or evaluate against old inputs.
  deferComputation?: boolean;
}) {
  const started = performance.now();
  signal?.throwIfAborted();
  if (
    deferComputation &&
    (!root.definition.nativeIndex?.materialized || resolveQueryInputs)
  )
    throw new Error(
      'Deferred native data requires a materialized source discovery',
    );
  if (Buffer.byteLength(sourceJSON) > 1_048_576) {
    throw new Error('Native card source exceeds 1 MiB');
  }
  const source = JSON.parse(sourceJSON);
  if (!source?.data?.meta?.adoptsFrom || !id || !sourceRevision) {
    throw new Error('Native card source requires identity and adoptsFrom');
  }
  if (
    root.definition.type !== 'card-def' ||
    root.definition.nativeCodec?.kind !== 'compound' ||
    !('module' in root.definition.codeRef)
  ) {
    throw new Error('Unadmitted native card definition');
  }
  const adopted = source.data.meta.adoptsFrom;
  if (
    adopted.name !== root.definition.codeRef.name ||
    resolve(adopted.module, id) !== resolve(root.definition.codeRef.module, id)
  ) {
    throw new Error('Native source does not match its definition');
  }
  const snapshots = new Map<string, LatticeDefinitionSnapshot>();
  snapshots.set(JSON.stringify(root.definition.codeRef), root);
  let nodes = 0;
  async function childSnapshot(ref: CodeRef) {
    const key = JSON.stringify(ref);
    let snapshot = snapshots.get(key);
    if (!snapshot) {
      snapshot = await lookup(ref);
      if (!snapshot.revision)
        throw new Error('Missing field definition revision');
      snapshots.set(key, snapshot);
    }
    return snapshot;
  }
  // Grain instants from every evaluated node (root and contained); the card's
  // valid_until is the earliest. Freshness bounds likewise: the owner is
  // held until the earliest field needs re-deriving.
  const grainInstants: string[] = [];
  const freshInstants: string[] = [];
  const staleInstants: string[] = [];
  let nestedEvaluations = 0;
  // Run a contained definition's own BXL computeds for each of its nodes in
  // one worker call. Their values join the node (and so the holder's inputs)
  // and their grains join the card's. Source discovery defers all computation.
  async function evaluateNested(
    snapshot: LatticeDefinitionSnapshot,
    nodes: DataNode[],
    path: string,
  ) {
    const outputs = nodes[0].nestedComputed;
    if (deferComputation || !Object.keys(outputs).length) return;
    if (++nestedEvaluations > 256)
      throw new Error('Native nested computation exceeds bounds');
    const inputShapes: Record<string, LatticeBxlShape> = {};
    for (const [name, shape] of Object.entries(nodes[0].shapes)) {
      if (!Object.hasOwn(outputs, name)) inputShapes[name] = shape;
    }
    inputShapes.__clock = { object: { today: 'string', now: 'string' } };
    const plan = makeLatticeCardComputePlan(
      snapshot.definition,
      snapshot.revision!,
      { object: inputShapes },
      outputs,
    );
    const clock = latticeClock();
    const inputs = nodes.map((item, i) => {
      const presented = presentForProgram(item);
      for (const name of Object.keys(outputs)) delete presented[name];
      return {
        id: `${id}#${path}.${i}`,
        revision: sourceRevision,
        json: JSON.stringify({ ...presented, __clock: clock }),
      };
    });
    const computed = await worker.evaluateCard(plan, inputs, undefined, signal);
    signal?.throwIfAborted();
    nodes.forEach((item, i) => {
      const artifact = computed.artifacts[i];
      Object.assign(item.values, artifact.values);
      for (const raw of Object.values(artifact.grains ?? {})) {
        const instant = latticeValidUntilInstant(raw);
        if (instant !== null) grainInstants.push(instant);
      }
      for (const raw of Object.values(artifact.fresh ?? {})) {
        const instant = latticeValidUntilInstant(raw);
        if (instant !== null) freshInstants.push(instant);
      }
      for (const raw of Object.values(artifact.stale ?? {})) {
        const instant = latticeValidUntilInstant(raw);
        if (instant !== null) staleInstants.push(instant);
      }
    });
  }
  async function normalize(
    definition: Definition,
    attributes: Record<string, any> | null | undefined,
    relationships: Record<string, any>,
    prefix: string,
    depth: number,
  ): Promise<DataNode> {
    if (++nodes > 4096 || depth > 32)
      throw new Error('Native card shape exceeds bounds');
    if (
      attributes != null &&
      (typeof attributes !== 'object' || Array.isArray(attributes))
    ) {
      throw new Error(`Expected contained attributes at ${prefix}`);
    }
    const node: DataNode = {
      definition,
      values: {},
      children: new Map(),
      shapes: {},
      usedLinks: new Set(),
      wireLinks: new Map(),
      nestedComputed: {},
      dateKinds: {},
    };
    for (const [name, key] of Object.entries(definition.fields)) {
      const field = definition.fieldDefs[key];
      if (!field?.nativeCodec)
        throw new Error(`Unadmitted field codec: ${prefix}${name}`);
      if (['__proto__', 'constructor', 'prototype'].includes(name))
        throw new Error('Invalid native field name');
      if (
        field.query &&
        (resolveQueryInputs || deferComputation) &&
        depth === 0 &&
        field.type === 'linksToMany'
      )
        continue;
      if (field.query || field.searchable)
        throw new Error(
          `Native input membership is not resolved: ${prefix}${name}`,
        );
      if (depth === 0 && name === 'id') {
        if (
          field.isComputed ||
          !field.isPrimitive ||
          field.type !== 'contains'
        ) {
          throw new Error('Unadmitted native card identity field');
        }
        node.values.id = id;
        node.shapes.id = 'string';
        continue;
      }
      if (field.isComputed) {
        if (depth !== 0) {
          // A contained FieldDef's computed: ported BXL programs run natively
          // per node (see evaluateNested); anything else needs the browser.
          if (!field.bxl)
            throw new Error(`Unported nested computation: ${prefix}${name}`);
          let shape: LatticeBxlShape;
          if (field.type === 'linksTo') shape = linkShape;
          else if (
            (field.type === 'contains' || field.type === 'containsMany') &&
            (field.nativeCodec?.kind === 'primitive' ||
              field.nativeCodec?.kind === 'json')
          ) {
            const item = primitiveShape(field.nativeCodec);
            shape = field.type === 'containsMany' ? { array: item } : item;
          } else
            throw new Error(
              `Unadmitted nested computed output: ${prefix}${name}`,
            );
          node.nestedComputed[name] = shape;
          node.shapes[name] = shape;
        }
        continue;
      }
      const codec = field.nativeCodec;
      const raw = attributes?.[name];
      if (field.type === 'linksTo' || field.type === 'linksToMany') {
        if (codec.kind !== 'compound' || !codec.resourceType)
          throw new Error('Expected a linkable codec');
        const base = `${prefix}${name}`;
        const entries = Object.entries(relationships).filter(
          ([key]) => key === base || key.startsWith(base + '.'),
        );
        if (
          field.type === 'linksToMany' &&
          entries.some(
            ([key]) =>
              key !== base &&
              !new RegExp(
                `^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.\\d+$`,
              ).test(key),
          )
        ) {
          throw new Error('Unsupported nested link shape');
        }
        const links: Array<{ id: string }> = [];
        const wireLinks: string[] = [];
        for (const [, rel] of entries.sort(([a], [b]) =>
          a.localeCompare(b, 'en', { numeric: true }),
        )) {
          node.usedLinks.add(name);
          const refs = Array.isArray(rel.data)
            ? rel.data.map((item: any) => item.id)
            : [rel.links?.self ?? rel.data?.id];
          for (const ref of refs) {
            if (ref) {
              links.push({ id: resolve(ref, id) });
              wireLinks.push(ref);
            }
          }
        }
        if (field.type === 'linksTo' && links.length > 1)
          throw new Error('Plural input for a singular link');
        node.values[name] = field.type === 'linksTo' ? links[0] : links;
        node.wireLinks.set(name, wireLinks);
        node.shapes[name] =
          field.type === 'linksTo' ? linkShape : { array: linkShape };
        continue;
      }
      const plural = field.type === 'containsMany';
      if (field.type !== 'contains' && !plural)
        throw new Error('Unsupported native field kind');
      const present = Object.hasOwn(attributes ?? {}, name);
      const entries = plural ? (present ? raw : []) : [raw];
      if (plural && entries != null && !Array.isArray(entries))
        throw new Error(`Expected array: ${prefix}${name}`);
      if (codec.kind === 'primitive' || codec.kind === 'json') {
        const serializer =
          codec.kind === 'primitive' && codec.serializer
            ? getSerializer(codec.serializer)
            : undefined;
        const decode = async (value: any) =>
          serializer ? await serializer.deserialize(value, new URL(id)) : value;
        node.values[name] =
          !present && !plural
            ? codec.empty
            : plural
              ? entries == null
                ? null
                : await Promise.all(entries.map(decode))
              : await decode(raw);
        // Chrome owner recomputation reads the indexed card JSON, whose
        // serialization has already turned absent scalar values into null.
        // Normalize before computation (including trusted base computeds), so
        // Node produces the same values and search doc from the authored file.
        // Source indexing/discovery still preserves its original empty values.
        if (resolveQueryInputs && node.values[name] === undefined) {
          node.values[name] = null;
        }
        // Date objects are kept for the official serializer/search codec;
        // programs read them presented as strings (see presentForProgram).
        if (
          codec.kind === 'primitive' &&
          (codec.serializer === 'date' || codec.serializer === 'datetime')
        ) {
          node.dateKinds[name] = codec.serializer;
          node.shapes[name] = plural ? { array: 'string' } : 'string';
        } else {
          const shape = primitiveShape(codec);
          node.shapes[name] = plural ? { array: shape } : shape;
        }
      } else {
        const child = await childSnapshot(field.fieldOrCard);
        if (child.definition.nativeCodec?.kind !== 'compound')
          throw new Error('Unadmitted contained definition');
        const children =
          entries == null
            ? null
            : await Promise.all(
                entries.map((value: any, i: number) =>
                  normalize(
                    child.definition,
                    value,
                    relationships,
                    `${prefix}${name}.${plural ? i + '.' : ''}`,
                    depth + 1,
                  ),
                ),
              );
        if (children?.length)
          await evaluateNested(child, children, `${prefix}${name}`);
        node.children.set(name, plural ? children : children![0]);
        node.values[name] = plural
          ? (children?.map((child) => child.values) ?? null)
          : children![0].values;
        // An empty collection still needs the complete declared item shape.
        const sample =
          children?.[0] ??
          (await normalize(
            child.definition,
            undefined,
            {},
            `${prefix}${name}.*.`,
            depth + 1,
          ));
        const childShape = { object: sample.shapes };
        node.shapes[name] = plural ? { array: childShape } : childShape;
      }
    }
    return node;
  }
  // The declared shape a program must return for a computed contained field.
  // Derived from an empty node of the child definition, so it is exactly the
  // shape an authored value of the same type presents to a program: dates as
  // strings, nested records as objects. The child's own computeds are left
  // out, because they are evaluated after the holder's program returns, and
  // links are refused, because a returned record cannot name an identity the
  // publication is allowed to retain.
  async function compoundOutputShape(
    definition: Definition,
    prefix: string,
  ): Promise<LatticeBxlShape> {
    const sample = await normalize(definition, undefined, {}, prefix, 1);
    const shapes: Record<string, LatticeBxlShape> = {};
    for (const [name, key] of Object.entries(definition.fields)) {
      const field = definition.fieldDefs[key];
      if (field.isComputed) continue;
      if (field.type === 'linksTo' || field.type === 'linksToMany')
        throw new Error(`Unadmitted computed output link: ${prefix}${name}`);
      shapes[name] = sample.shapes[name];
    }
    return { object: shapes };
  }
  // Turn each computed contained value the program returned back into data
  // nodes, by the same normalization an authored value goes through: the
  // record's leaves are deserialized with their own codecs and the child's
  // own computeds run over the result, so `output` below serializes it and
  // indexes it exactly as if it had been authored in the file.
  async function materializeCompoundOutputs(current: DataNode) {
    for (const [name, child] of compoundOutputs) {
      const plural =
        current.definition.fieldDefs[current.definition.fields[name]].type ===
        'containsMany';
      const value = current.values[name];
      if (plural && value != null && !Array.isArray(value))
        throw new Error(`Expected array: ${name}`);
      const entries =
        value == null ? null : plural ? (value as unknown[]) : [value];
      const children =
        entries == null
          ? null
          : await Promise.all(
              entries.map((item, i) =>
                normalize(
                  child.definition,
                  item as Record<string, any>,
                  {},
                  `${name}.${plural ? i + '.' : ''}`,
                  1,
                ),
              ),
            );
      if (children?.length) await evaluateNested(child, children, name);
      current.children.set(name, plural ? children : (children?.[0] ?? null));
      current.values[name] = plural
        ? (children?.map((node) => node.values) ?? null)
        : (children?.[0]?.values ?? null);
    }
  }
  // Polymorphic overrides need their own revisioned schema selection. Never
  // silently serialize them using the holder's declared field type.
  if (source.data.meta.fields && Object.keys(source.data.meta.fields).length) {
    throw new Error('Native polymorphic field metadata is not yet admitted');
  }
  const node = await normalize(
    root.definition,
    source.data.attributes,
    source.data.relationships ?? {},
    '',
    0,
  );
  node.values.id = id;
  node.shapes.id = 'string';
  // The engine reads the clock; programs read `.__clock` as data. Not a
  // field, so it never reaches the serialized document or search doc.
  const rootWall = Date.now();
  const rootClock = latticeClock(new Date(rootWall));
  node.values.__clock = rootClock;
  node.shapes.__clock = { object: { today: 'string', now: 'string' } };
  if (resolveLinkInputs && !deferComputation) {
    const declared = root.definition.nativeLinkInputs ?? {};
    const links: Parameters<typeof resolveLinkInputs>[0] = [];
    for (const [name, projection] of Object.entries(declared)) {
      const field = getImmediateFieldDef(root.definition, name);
      if (
        !field ||
        (field.type !== 'linksTo' && field.type !== 'linksToMany') ||
        field.query ||
        field.isComputed
      )
        throw new Error(
          `Lattice link projection names an undeclared link: ${name}`,
        );
      assertLatticeDataProjection(projection);
      const value = node.values[name];
      const ids: string[] = (
        field.type === 'linksToMany'
          ? ((value ?? []) as Array<{ id: string }>)
          : value
            ? [value as { id: string }]
            : []
      ).map((link) => link.id);
      links.push({ name, many: field.type === 'linksToMany', ids, projection });
    }
    if (links.length) {
      const projected = await resolveLinkInputs(links);
      signal?.throwIfAborted();
      for (const { name } of links) {
        if (!projected.has(name))
          throw new Error(`Unresolved Lattice link projection: ${name}`);
        node.values[name] = projected.get(name);
        node.shapes[name] = 'json';
      }
    }
  }
  const outputShapes: Record<string, LatticeBxlShape> = {};
  // Computed fields whose value is a contained FieldDef: the program returns
  // the record itself, so after evaluation it is normalized back into nodes
  // like an authored value (see materializeCompoundOutputs).
  const compoundOutputs = new Map<string, LatticeDefinitionSnapshot>();
  for (const [name, key] of Object.entries(root.definition.fields)) {
    const field = root.definition.fieldDefs[key];
    if (!field.isComputed) continue;
    const plural = field.type === 'containsMany';
    if (field.type === 'linksTo') outputShapes[name] = linkShape;
    else if (
      (field.type === 'contains' || plural) &&
      (field.nativeCodec?.kind === 'primitive' ||
        field.nativeCodec?.kind === 'json')
    ) {
      const shape = primitiveShape(field.nativeCodec);
      outputShapes[name] = plural ? { array: shape } : shape;
    } else if (
      (field.type === 'contains' || plural) &&
      field.nativeCodec?.kind === 'compound' &&
      !field.nativeCodec.resourceType
    ) {
      const child = await childSnapshot(field.fieldOrCard);
      if (child.definition.nativeCodec?.kind !== 'compound')
        throw new Error('Unadmitted contained definition');
      compoundOutputs.set(name, child);
      const item = await compoundOutputShape(
        child.definition,
        `${name}.${plural ? '*.' : ''}`,
      );
      outputShapes[name] = plural ? { array: item } : item;
    } else throw new Error(`Unadmitted computed output: ${name}`);
  }
  const normalizedAt = performance.now();
  const queryInputs = await resolveQueryInputs?.({
    values: node.values,
    shapes: node.shapes,
    outputShapes,
  });
  const queriedAt = performance.now();
  for (const [name, result] of queryInputs ?? []) {
    if (!root.definition.fieldDefs[root.definition.fields[name]]?.query)
      throw new Error('Resolved data names an undeclared query');
    node.values[name] = result.values;
    node.shapes[name] = 'json';
  }
  const plan = deferComputation
    ? undefined
    : makeLatticeCardComputePlan(
        root.definition,
        root.revision,
        { object: node.shapes },
        outputShapes,
      );
  const inputs = presentForProgram(node);
  const plannedAt = performance.now();
  const encodedInputs = plan ? JSON.stringify(inputs) : undefined;
  const encodedAt = performance.now();
  trace?.event('evaluation-input', {
    planHash: trace.hash(JSON.stringify(plan)),
    inputHash:
      encodedInputs === undefined ? undefined : trace.hash(encodedInputs),
    dataHash: trace.hash(
      JSON.stringify(inputs, (key, value) =>
        key === '__clock' ? undefined : value,
      ),
    ),
    clockHash: trace.hash(JSON.stringify(rootClock)),
    sourceRevision,
    bytes: encodedInputs ? Buffer.byteLength(encodedInputs) : 0,
  });
  const computed = plan
    ? await worker.evaluateCard(
        plan,
        [{ id, revision: sourceRevision, json: encodedInputs! }],
        undefined,
        signal,
      )
    : undefined;
  const evaluatedAt = performance.now();
  signal?.throwIfAborted();
  if (computed) Object.assign(node.values, computed.artifacts[0].values);
  if (computed && compoundOutputs.size) await materializeCompoundOutputs(node);
  let validUntil: string | null = null;
  for (const raw of Object.values(computed?.artifacts[0].grains ?? {})) {
    const instant = latticeValidUntilInstant(raw);
    if (instant !== null) grainInstants.push(instant);
  }
  for (const instant of grainInstants) {
    if (validUntil === null || instant < validUntil) validUntil = instant;
  }
  let freshUntil: string | null = null;
  for (const raw of Object.values(computed?.artifacts[0].fresh ?? {})) {
    const instant = latticeValidUntilInstant(raw);
    if (instant !== null) freshInstants.push(instant);
  }
  for (const instant of freshInstants) {
    // The programs read a minute-truncated clock, so an instant they derive
    // from it is up to a minute behind the wall: `now + 2s` would already be
    // past for most of every minute and hold nothing. The hold is the window
    // the program declared, measured from when it ran: re-base the instant
    // from the clock it read onto the wall clock of that read.
    const offset = Date.parse(instant) - Date.parse(rootClock.now);
    const rebased = Number.isFinite(offset)
      ? new Date(rootWall + Math.max(0, offset)).toISOString()
      : instant;
    if (freshUntil === null || rebased < freshUntil) freshUntil = rebased;
  }
  // And as a window from the render, so the registry can arm the hold from
  // the publication's own clock (a hold shorter than the swap still holds).
  const freshWithin =
    freshUntil === null
      ? null
      : Math.max(1, Math.round((Date.parse(freshUntil) - rootWall) / 1000));
  // The deadline likewise, as a window: the earliest `staleAfter` instant
  // measured from the clock the programs read, in whole seconds. The engine
  // arms it when the owner becomes dirty, not at publication, so a burst
  // shorter than the window coalesces the ordinary way.
  let staleWithin: number | null = null;
  for (const raw of Object.values(computed?.artifacts[0].stale ?? {})) {
    const instant = latticeValidUntilInstant(raw);
    if (instant !== null) staleInstants.push(instant);
  }
  for (const instant of staleInstants) {
    const seconds = Math.max(
      1,
      Math.round((Date.parse(instant) - Date.parse(rootClock.now)) / 1000),
    );
    if (staleWithin === null || seconds < staleWithin) staleWithin = seconds;
  }
  // Per input root, the fields of an input card the root programs read:
  // `players.*.average` contributes `average` to `players`; enumerating a
  // member (`players.*`) or reading past what the search document holds
  // contributes `*`, which disables the filter for that root. A root read
  // only as a whole (`.players | length`) contributes nothing: membership
  // changes always invalidate, member field changes never need to.
  let readPaths: Record<string, string[]> | undefined;
  if (plan && computed?.artifacts[0].reads) {
    readPaths = {};
    const compound = new Map<string, Set<string>>();
    for (const root of Object.keys(plan.input.object)) {
      readPaths[root] = [];
      compound.set(root, new Set());
    }
    for (const read of computed.artifacts[0].reads) {
      const parts = read.split('.');
      const [root, second] = parts;
      if (!root || !Object.hasOwn(readPaths, root)) continue;
      // A `*` second segment is an index read (a query field is presented
      // as one JSON value, so its shape does not say it is an array):
      // `games.*.winner` reads a member's field, `games.*` is the member
      // itself, `games.*.*` enumerated it. Otherwise the root is an object:
      // `cardInfo.theme` reads a field, `cardInfo.*` all of them. A read
      // that goes deeper than the field (`games.*.lines.*.pa`, or the
      // compound marker `games.*.lines.*`) is a compound read: the search
      // document cannot compare it, so it is recorded as `lines.*`.
      const depth = second === '*' ? 3 : 2;
      const field = parts[depth - 1];
      if (field === undefined) continue;
      if (!readPaths[root].includes(field)) readPaths[root].push(field);
      if (parts.length > depth) compound.get(root)!.add(field);
    }
    for (const [root, fields] of compound)
      readPaths[root] = readPaths[root].map((field) =>
        fields.has(field) && field !== '*' ? `${field}.*` : field,
      );
  }

  function output(current: DataNode, prefix = '') {
    const attributes: Record<string, any> = {};
    const relationships: Record<string, any> = {};
    const search: Record<string, any> = {};
    for (const [name, key] of Object.entries(current.definition.fields)) {
      const field = current.definition.fieldDefs[key];
      if (deferComputation && (field.isComputed || field.query)) continue;
      const codec = field.nativeCodec!;
      const value = current.values[name];
      if (field.query) {
        const membership = queryInputs?.get(name);
        if (prefix || !membership)
          throw new Error('Missing query membership in native output');
        relationships[name] = {
          links: { self: null, search: membership.searchURL },
          data: membership.identities.map((id) => ({ type: 'card', id })),
          meta: { total: membership.identities.length },
        };
        continue;
      }
      if (name === 'id' && !prefix) {
        search.id = id;
        continue;
      }
      if (field.type === 'linksTo' || field.type === 'linksToMany') {
        const plural = field.type === 'linksToMany';
        const links = plural ? (value ?? []) : value ? [value] : [];
        search[name] = plural ? (links.length ? links : null) : (value ?? null);
        if (links.length || current.usedLinks.has(name)) {
          if (!links.length)
            relationships[`${prefix}${name}`] = { links: { self: null } };
          links.forEach((link: { id: string }, i: number) => {
            // Like an unloaded linksTo value, preserve the authored reference
            // on the wire. Computation and search use the resolved identity.
            const reference = current.wireLinks.get(name)?.[i] ?? link.id;
            relationships[`${prefix}${name}${plural ? '.' + i : ''}`] = {
              links: { self: reference },
              data: {
                type: codec.kind === 'compound' ? codec.resourceType : 'card',
                id: reference,
              },
            };
          });
        }
      } else if (codec.kind === 'primitive' || codec.kind === 'json') {
        const serializer =
          codec.kind === 'primitive' && codec.serializer
            ? getSerializer(codec.serializer)
            : undefined;
        const encode = (value: any) =>
          value == null
            ? null
            : serializer
              ? serializer.serialize(value)
              : value;
        const query = (value: any) =>
          codec.kind === 'json'
            ? null
            : serializer
              ? serializer.queryableValue(value)
              : value;
        if (field.type === 'containsMany') {
          attributes[name] = value?.map(encode) ?? null;
          const items =
            value
              ?.filter((v: any) => v != null)
              .map(query)
              .filter((v: any) => v != null) ?? [];
          search[name] = items.length ? items : null;
        } else {
          attributes[name] = encode(value);
          search[name] = query(value);
        }
      } else {
        const child = current.children.get(name);
        const children =
          child == null ? [] : Array.isArray(child) ? child : [child];
        const projected = children.map((child, i) =>
          output(
            child,
            `${prefix}${name}.${field.type === 'containsMany' ? i + '.' : ''}`,
          ),
        );
        // Relationship prefixes depend on the field cardinality, not the child node.
        projected.forEach((part) =>
          Object.assign(relationships, part.relationships),
        );
        if (field.type === 'containsMany') {
          attributes[name] =
            child === null ? null : projected.map((part) => part.attributes);
          search[name] = projected.length
            ? projected.map((part) => part.search)
            : null;
        } else {
          attributes[name] = projected[0]?.attributes;
          search[name] = projected[0]?.search ?? null;
        }
      }
    }
    return { attributes, relationships, search };
  }
  const result = output(node);
  const timings: LatticeCardAssemblyTimings = {
    normalize: normalizedAt - started,
    queryInputs: queriedAt - normalizedAt,
    plan: plannedAt - queriedAt,
    encodeInputs: encodedAt - plannedAt,
    worker: evaluatedAt - encodedAt,
    output: performance.now() - evaluatedAt,
    inputBytes: encodedInputs ? Buffer.byteLength(encodedInputs) : 0,
  };
  return {
    serialized: {
      data: {
        type: 'card',
        id,
        attributes: result.attributes,
        ...(Object.keys(result.relationships).length
          ? { relationships: result.relationships }
          : {}),
        meta: { adoptsFrom: root.definition.codeRef },
      },
    },
    searchDoc: result.search,
    validUntil,
    freshUntil,
    freshWithin,
    staleWithin,
    readPaths,
    sourceRevision,
    definitionRevisions: [...snapshots.values()].map(
      ({ definition, revision }) => ({ codeRef: definition.codeRef, revision }),
    ),
    computed: computed?.measurements,
    timings,
  };
}
