import type { LatticeDataProjection } from '@cardstack/runtime-common/definitions';
import type {
  LatticeCardInput,
  LatticeLinkInput,
} from './lattice-materialization-inputs.ts';

// Validate before reading inputs. Finite declared joins cannot accidentally
// become recursive expansion of whatever relationships a card happens to have.
export function assertLatticeDataProjection(
  value: unknown,
): asserts value is LatticeDataProjection {
  let nodes = 0;
  const visit = (value: any, depth: number) => {
    if (
      ++nodes > 256 ||
      depth > 8 ||
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value)
    )
      throw new Error('Invalid or oversized Lattice data projection');
    if (Object.keys(value).some((key) => key !== 'links'))
      throw new Error('Unknown Lattice projection option');
    if (value.links === undefined) return;
    if (
      !value.links ||
      typeof value.links !== 'object' ||
      Array.isArray(value.links)
    )
      throw new Error('Invalid Lattice projection links');
    for (const [name, spec] of Object.entries<any>(value.links)) {
      if (
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
        ['__proto__', 'constructor', 'prototype', 'id'].includes(name)
      )
        throw new Error('Invalid Lattice projection field');
      if (
        !spec ||
        typeof spec !== 'object' ||
        typeof spec.many !== 'boolean' ||
        Object.keys(spec).some((key) => key !== 'many' && key !== 'projection')
      )
        throw new Error('Invalid Lattice relationship projection');
      if (spec.projection !== 'id') visit(spec.projection, depth + 1);
    }
  };
  visit(value, 0);
}

export class LatticeDataProjector {
  #cards = new Map<string, LatticeLinkInput>();
  #values = new Map<string, Record<string, any> | null>();
  #read: (urls: string[]) => Promise<LatticeLinkInput[]>;
  #resolve: (reference: string, relativeTo: string) => string;
  #retain?: (
    owner: LatticeCardInput,
    fieldPath: string,
    targets: string[],
  ) => Promise<void>;
  constructor(
    read: (urls: string[]) => Promise<LatticeLinkInput[]>,
    resolve: (reference: string, relativeTo: string) => string,
    retain?: (
      owner: LatticeCardInput,
      fieldPath: string,
      targets: string[],
    ) => Promise<void>,
  ) {
    this.#read = read;
    this.#resolve = resolve;
    this.#retain = retain;
  }
  get residentCardCount() {
    return this.#cards.size;
  }

  #id(value: unknown, base: string): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string' || !value)
      throw new Error('Invalid projected identity');
    const url = new URL(this.#resolve(value, base));
    if (url.search || url.hash) throw new Error('Qualified projected identity');
    return url.href.replace(/\.json$/, '');
  }

  #targets(card: LatticeCardInput, name: string, many: boolean): string[] {
    const relationships = card.resource.relationships ?? {};
    const read = (relation: any) => {
      if (!relation) return null;
      if (relation.links && Object.hasOwn(relation.links, 'self'))
        return this.#id(relation.links.self, card.url);
      if (relation.data && !Array.isArray(relation.data))
        return this.#id(relation.data.id, card.url);
      if (relation.data === null) return null;
      throw new Error(`Unresolved projected relationship: ${name}`);
    };
    if (!many) {
      const id = read(relationships[name]);
      return id ? [id] : [];
    }
    const whole = relationships[name];
    if (Array.isArray(whole))
      throw new Error('Unsupported projected relationship array');
    if (whole && Array.isArray(whole.data)) {
      const ids = whole.data.map((item) =>
        this.#id('id' in item ? item.id : null, card.url),
      );
      if (ids.some((id) => !id))
        throw new Error('Missing projected member identity');
      if (whole.meta?.total !== undefined && whole.meta.total !== ids.length)
        throw new Error('Incomplete projected membership');
      return ids as string[];
    }
    const keys = Object.keys(relationships).filter((key) =>
      key.startsWith(name + '.'),
    );
    if (keys.some((key) => !/^\d+$/.test(key.slice(name.length + 1))))
      throw new Error('Unsupported nested projected relationship');
    if (whole && keys.length) throw new Error('Ambiguous projected membership');
    if (whole && read(whole))
      throw new Error('Singular input for projected collection');
    keys.sort(
      (a, b) =>
        Number(a.slice(name.length + 1)) - Number(b.slice(name.length + 1)),
    );
    return keys
      .map((key) => read(relationships[key]))
      .filter((id): id is string => Boolean(id));
  }

  async project(cards: LatticeCardInput[], projection: LatticeDataProjection) {
    assertLatticeDataProjection(projection);
    // Freeze the declaration so later caller edits cannot change the joined data.
    const shape = structuredClone(projection);
    const identity = (card: LatticeLinkInput) => this.#id(card.url, card.url)!;
    for (const card of cards) this.#cards.set(identity(card), card);
    let pending = cards.map((card) => ({ id: identity(card), shape }));
    const visited = new Set<string>();
    while (pending.length) {
      if (visited.size + pending.length > 16384)
        throw new Error('Lattice projection exceeds join bound');
      const missing = [
        ...new Set(
          pending.map((p) => p.id).filter((id) => !this.#cards.has(id)),
        ),
      ];
      if (missing.length)
        for (const card of await this.#read(missing.map((id) => id + '.json')))
          this.#cards.set(identity(card), card);
      const next: typeof pending = [];
      for (const item of pending) {
        const key = item.id + '#' + JSON.stringify(item.shape);
        if (visited.has(key)) continue;
        visited.add(key);
        const card = this.#cards.get(item.id);
        if (!card) throw new Error('Missing projected card input');
        if (card.resource === null) continue;
        for (const [name, spec] of Object.entries(item.shape.links ?? {})) {
          if (spec.projection === 'id') continue;
          const child = spec.projection;
          const targets = this.#targets(card, name, spec.many);
          // Report the edge even when another projection already loaded its
          // target. Retention belongs to this card/field, not the traversal root.
          if (targets.length) await this.#retain?.(card, name, targets);
          next.push(
            ...targets.map((id) => ({
              id,
              shape: child,
            })),
          );
        }
      }
      pending = next;
    }
    const value = (
      id: string,
      projection: 'id' | LatticeDataProjection,
    ): Record<string, any> | null => {
      if (projection === 'id') return { id };
      const key = id + '#' + JSON.stringify(projection);
      const cached = this.#values.get(key);
      if (this.#values.has(key)) return cached!;
      const card = this.#cards.get(id);
      if (!card) throw new Error('Missing projected card input');
      if (card.resource === null) {
        this.#values.set(key, null);
        return null;
      }
      const out = { ...card.resource.attributes, id } as Record<string, any>;
      for (const [name, spec] of Object.entries(projection.links ?? {})) {
        const targets = this.#targets(card, name, spec.many);
        out[name] = spec.many
          ? targets.map((id) => value(id, spec.projection))
          : targets.length
            ? value(targets[0], spec.projection)
            : null;
      }
      this.#values.set(key, out);
      return out;
    };
    return structuredClone(cards.map((card) => value(identity(card), shape)!));
  }
}
