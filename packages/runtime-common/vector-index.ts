import type { DBAdapter } from './db.ts';
import {
  isQueryableVector,
  parseQueryableVector,
} from './serializers/vector.ts';

// `boxel_index_vectors` exists only on a Postgres that has pgvector (see the
// `add-boxel-index-vectors` migration). Probed once per adapter; the answer
// cannot change while the process runs, because migrations run at startup.
const vectorIndexAvailability = new WeakMap<DBAdapter, Promise<boolean>>();

export function hasVectorIndex(dbAdapter: DBAdapter): Promise<boolean> {
  if (dbAdapter.kind !== 'pg') {
    return Promise.resolve(false);
  }
  let known = vectorIndexAvailability.get(dbAdapter);
  if (!known) {
    known = dbAdapter
      .execute(
        `SELECT to_regclass('boxel_index_vectors') IS NOT NULL AS available`,
      )
      .then((rows) => Boolean(rows[0]?.available))
      .catch(() => false);
    vectorIndexAvailability.set(dbAdapter, known);
  }
  return known;
}

export const VECTOR_INDEX_UNAVAILABLE_MESSAGE =
  'vector search needs the pgvector Postgres extension, which this realm server does not have';

export interface SearchDocVector {
  fieldPath: string;
  ordinal: number;
  components: number[];
}

// The vectors a search doc carries, keyed by field path. Plural fields
// (a containsMany of vectors, or of compound fields holding one) give one
// entry per position, numbered by `ordinal` within the path. A linked card's
// fields are skipped (an object with an `id` is a linked card, not a compound
// field): a card is ranked by its own vectors, and copying every linked
// card's vectors would multiply the table by the link fan-out.
export function collectSearchDocVectors(searchDoc: unknown): SearchDocVector[] {
  let found: SearchDocVector[] = [];
  let ordinals = new Map<string, number>();
  let visit = (value: unknown, path: string[], isRoot: boolean) => {
    if (isQueryableVector(value)) {
      let fieldPath = path.join('.');
      let ordinal = ordinals.get(fieldPath) ?? 0;
      ordinals.set(fieldPath, ordinal + 1);
      let components: number[];
      try {
        components = parseQueryableVector(value);
      } catch {
        return;
      }
      found.push({ fieldPath, ordinal, components });
      return;
    }
    if (Array.isArray(value)) {
      for (let item of value) {
        visit(item, path, false);
      }
      return;
    }
    if (typeof value === 'object' && value != null) {
      if (!isRoot && typeof (value as { id?: unknown }).id === 'string') {
        return;
      }
      for (let [key, child] of Object.entries(value)) {
        visit(child, [...path, key], false);
      }
    }
  };
  visit(searchDoc, [], true);
  return found;
}
