import {
  decodeVector,
  encodeVector,
  MAX_VECTOR_DIMENSIONS,
} from './serializers/vector.ts';
import { spaceDimensions } from './vector-space.ts';

// A card's vectors live beside it, never inside its JSON:
//
//   Talk/keynote.json             the card: no key for any vector field
//   Talk/keynote.vectors.jsonl    one line per vector
//
//   {"field":"segments.vector","item":"s7","space":"…","sourceHash":"sha256:…",
//    "credits":0,"at":"2026-11-08T21:04:00Z","values":"<base64 float32 LE>"}
//
// `field` is the vector field's schema path; `item` is the stable id of the
// list item that holds it (absent or empty for a single field); `space` is
// the full space string (vector-space.ts); `values` is the vectorizer's
// output as float32, little-endian, base64. The indexer loads a card's
// sidecar into `boxel_index_vectors` with the card's row.
//
// `.vectors.jsonl` is a reserved suffix. A sidecar belongs to its card: it is
// never a file row of its own, and it moves, copies and deletes with its card.

export const VECTOR_SIDECAR_SUFFIX = '.vectors.jsonl';
// A sidecar may be much larger than an ordinary realm file: a float32 line at
// 1024 dimensions is about 5.6 KB, so an hour of video in 5-second segments
// is about 4 MB.
export const VECTOR_SIDECAR_MAX_BYTES = 64 * 1024 * 1024;

export function isVectorSidecar(url: string | URL): boolean {
  let href = typeof url === 'string' ? url : url.href;
  return href.endsWith(VECTOR_SIDECAR_SUFFIX);
}

// `Talk/keynote.json` (or `Talk/keynote`) → `Talk/keynote.vectors.jsonl`
export function vectorSidecarFor(cardURL: string): string {
  let base = cardURL.endsWith('.json') ? cardURL.slice(0, -5) : cardURL;
  return `${base}${VECTOR_SIDECAR_SUFFIX}`;
}

// `Talk/keynote.vectors.jsonl` → `Talk/keynote.json`
export function cardForVectorSidecar(sidecarURL: string): string {
  return `${sidecarURL.slice(0, -VECTOR_SIDECAR_SUFFIX.length)}.json`;
}

export interface VectorSidecarLine {
  field: string;
  item?: string;
  space: string;
  sourceHash?: string;
  credits?: number;
  at?: string;
  values: string;
}

export interface ParsedSidecarVector {
  field: string;
  item: string;
  space: string;
  sourceHash: string | undefined;
  components: Float32Array;
}

export interface SidecarLineError {
  line: number;
  field?: string;
  item?: string;
  code: string;
  message: string;
}

// What a sidecar holds, line by line. A malformed line is an error on that
// line alone; the rest still load.
export function parseVectorSidecar(text: string): {
  vectors: ParsedSidecarVector[];
  errors: SidecarLineError[];
} {
  let vectors: ParsedSidecarVector[] = [];
  let errors: SidecarLineError[] = [];
  let seen = new Set<string>();
  let lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i].trim();
    if (!raw) {
      continue;
    }
    let line: Partial<VectorSidecarLine>;
    try {
      line = JSON.parse(raw);
    } catch {
      errors.push({
        line: i + 1,
        code: 'invalid-sidecar-line',
        message: 'not a JSON object',
      });
      continue;
    }
    let fail = (code: string, message: string) =>
      errors.push({
        line: i + 1,
        field: typeof line.field === 'string' ? line.field : undefined,
        item: typeof line.item === 'string' ? line.item : undefined,
        code,
        message,
      });
    if (typeof line.field !== 'string' || !line.field) {
      fail('invalid-sidecar-line', 'field must name a vector field');
      continue;
    }
    if (typeof line.space !== 'string' || !line.space) {
      fail('invalid-sidecar-line', 'space must be the full space string');
      continue;
    }
    if (typeof line.values !== 'string') {
      fail('invalid-sidecar-line', 'values must be base64 float32');
      continue;
    }
    let item = typeof line.item === 'string' ? line.item : '';
    let key = `${line.field}\u0000${item}`;
    if (seen.has(key)) {
      fail(
        'invalid-sidecar-line',
        `a second vector for ${line.field}${item ? ` item ${item}` : ''}`,
      );
      continue;
    }
    let components: Float32Array;
    try {
      components = decodeVector({
        dims: 0,
        encoding: 'float32',
        data: line.values,
      } as any);
    } catch {
      fail('invalid-sidecar-line', 'values are not base64 float32');
      continue;
    }
    let dims = components.length;
    if (dims < 1 || dims > MAX_VECTOR_DIMENSIONS) {
      fail('invalid-sidecar-line', `a vector of ${dims} components`);
      continue;
    }
    if (spaceDimensions(line.space) !== dims) {
      fail(
        'vector-space-mismatch',
        `${dims} components in a space of ${spaceDimensions(line.space) ?? 'unknown'} dimensions`,
      );
      continue;
    }
    let bad = components.findIndex((c) => !Number.isFinite(c));
    if (bad >= 0) {
      fail('invalid-sidecar-line', `component ${bad} is not a finite number`);
      continue;
    }
    seen.add(key);
    vectors.push({
      field: line.field,
      item,
      space: line.space,
      sourceHash:
        typeof line.sourceHash === 'string' ? line.sourceHash : undefined,
      components,
    });
  }
  return { vectors, errors };
}

// One sidecar line, ready to append: `values` as float32.
export function vectorSidecarLine(vector: {
  field: string;
  item?: string;
  space: string;
  sourceHash?: string;
  credits?: number;
  at?: string;
  components: ArrayLike<number>;
}): string {
  let encoded = encodeVector(vector.components, { encoding: 'float32' });
  let line: VectorSidecarLine = {
    field: vector.field,
    ...(vector.item ? { item: vector.item } : {}),
    space: vector.space,
    ...(vector.sourceHash ? { sourceHash: vector.sourceHash } : {}),
    credits: vector.credits ?? 0,
    at: vector.at ?? new Date().toISOString(),
    values: encoded.data,
  };
  return JSON.stringify(line);
}

export async function sidecarHash(text: string): Promise<string> {
  let digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  );
  return `sha256:${Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
