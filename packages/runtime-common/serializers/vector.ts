import type {
  BaseDefConstructor,
  BaseInstanceType,
} from '@cardstack/base/card-api';

// A fixed-dimension embedding vector, as stored in a card's JSON.
//
// Encoding choice: `int8` (the default) quantizes each component to a signed
// byte with one per-vector `scale` (component ≈ byte * scale). A 256-d vector
// is 256 bytes, or 344 base64 characters, a quarter of `float32`'s 1,368.
// Ranking by cosine similarity is scale-invariant, and per-vector symmetric
// int8 quantization keeps nearest-neighbour order nearly intact for
// normalized text embeddings (a 205k × 256-d benchmark kept the same top 8 of
// 10). `float32` is accepted for callers that need full precision.
//
// Base64 rather than a JSON number array keeps card JSON small and the
// embedded value opaque to diffs and to the AI's context window.
export type VectorEncoding = 'int8' | 'float32';

export interface Vector {
  dims: number;
  encoding: VectorEncoding;
  // int8 only: the dequantization factor (component = byte * scale).
  scale?: number;
  data: string;
}

// The largest dimension the index accepts. pgvector's HNSW and IVFFlat
// indexes stop at 2,000 dimensions for `vector`, so this keeps every stored
// vector indexable should a realm opt into an approximate index later.
export const MAX_VECTOR_DIMENSIONS = 2000;

// The search-doc form of a vector: a marked string the index writer
// recognizes when it copies vectors into `boxel_index_vectors`, and that
// Postgres can cast to pgvector's `vector` (`substr(x, 5)::vector`) when it
// has to read a vector straight from the search doc. int8 vectors keep their
// bytes (cosine ignores the scale); float32 vectors keep 7 significant digits.
export const VECTOR_QUERYABLE_PREFIX = 'vec:';

export function isQueryableVector(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(VECTOR_QUERYABLE_PREFIX);
}

export function queryableValue(val: Vector | null | undefined) {
  if (val == null) {
    return undefined;
  }
  let components =
    val.encoding === 'int8'
      ? Array.from(int8Bytes(val))
      : Array.from(float32Components(val)).map((c) => Number(c.toPrecision(7)));
  return `${VECTOR_QUERYABLE_PREFIX}[${components.join(',')}]`;
}

// Parses a search-doc vector back to numbers (the inverse of
// `queryableValue`, up to the int8 scale).
export function parseQueryableVector(value: string): number[] {
  return JSON.parse(value.slice(VECTOR_QUERYABLE_PREFIX.length));
}

export function serialize(val: Vector | null): Vector | undefined {
  if (val == null) {
    return undefined;
  }
  return {
    dims: val.dims,
    encoding: val.encoding,
    ...(val.encoding === 'int8' ? { scale: val.scale } : {}),
    data: val.data,
  };
}

export async function deserialize<T extends BaseDefConstructor>(
  this: T,
  value: any,
): Promise<BaseInstanceType<T>> {
  let dims = (this as unknown as { dimensions?: number }).dimensions;
  return deserializeSync(value, dims) as BaseInstanceType<T>;
}

// Accepts the stored object form, or a plain number array (which is encoded
// as int8). Throws when the value is malformed or, given `expectedDims`, when
// its dimension differs: a vector of the wrong size can never be compared
// with its neighbours, so it fails loudly rather than indexing silently.
export function deserializeSync(
  value: any,
  expectedDims?: number,
): Vector | null {
  if (value == null) {
    return null;
  }
  let vector: Vector;
  if (Array.isArray(value)) {
    vector = encodeVector(value);
  } else {
    let error = validate(value);
    if (error) {
      throw new Error(`Invalid vector: ${error}`);
    }
    vector = Object.freeze({
      dims: value.dims,
      encoding: value.encoding,
      ...(value.encoding === 'int8' ? { scale: value.scale } : {}),
      data: value.data,
    });
  }
  if (expectedDims != null && vector.dims !== expectedDims) {
    throw new Error(
      `Invalid vector: expected ${expectedDims} dimensions, got ${vector.dims}`,
    );
  }
  return vector;
}

export function validate(value: any): string | null {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    return 'a vector must be an object with dims, encoding and data';
  }
  let { dims, encoding, scale, data } = value;
  if (!Number.isInteger(dims) || dims < 1 || dims > MAX_VECTOR_DIMENSIONS) {
    return `dims must be an integer from 1 to ${MAX_VECTOR_DIMENSIONS}`;
  }
  if (encoding !== 'int8' && encoding !== 'float32') {
    return `encoding must be "int8" or "float32"`;
  }
  if (encoding === 'int8' && !(typeof scale === 'number' && scale >= 0)) {
    return 'an int8 vector needs a non-negative numeric scale';
  }
  if (typeof data !== 'string') {
    return 'data must be a base64 string';
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(data);
  } catch {
    return 'data must be a base64 string';
  }
  let expectedBytes = encoding === 'int8' ? dims : dims * 4;
  if (bytes.length !== expectedBytes) {
    return `data holds ${bytes.length} bytes; ${dims} ${encoding} components need ${expectedBytes}`;
  }
  return null;
}

// Encodes plain numbers as a vector. int8 uses symmetric per-vector
// quantization: scale = max |component| / 127.
export function encodeVector(
  components: ArrayLike<number>,
  opts: { encoding?: VectorEncoding } = {},
): Vector {
  let dims = components.length;
  if (dims < 1 || dims > MAX_VECTOR_DIMENSIONS) {
    throw new Error(
      `Invalid vector: dims must be from 1 to ${MAX_VECTOR_DIMENSIONS}, got ${dims}`,
    );
  }
  for (let i = 0; i < dims; i++) {
    if (!Number.isFinite(components[i])) {
      throw new Error(`Invalid vector: component ${i} is not a finite number`);
    }
  }
  let encoding = opts.encoding ?? 'int8';
  if (encoding === 'float32') {
    let floats = Float32Array.from(components);
    return Object.freeze({
      dims,
      encoding,
      data: bytesToBase64(new Uint8Array(floats.buffer)),
    });
  }
  let maxAbs = 0;
  for (let i = 0; i < dims; i++) {
    maxAbs = Math.max(maxAbs, Math.abs(components[i]));
  }
  let scale = maxAbs === 0 ? 0 : maxAbs / 127;
  let bytes = new Int8Array(dims);
  for (let i = 0; i < dims; i++) {
    bytes[i] = scale === 0 ? 0 : Math.round(components[i] / scale);
  }
  return Object.freeze({
    dims,
    encoding,
    scale,
    data: bytesToBase64(new Uint8Array(bytes.buffer)),
  });
}

// The vector's components as floats (int8 dequantized by its scale).
export function decodeVector(vector: Vector): Float32Array {
  if (vector.encoding === 'float32') {
    return float32Components(vector);
  }
  let scale = vector.scale ?? 1;
  return Float32Array.from(int8Bytes(vector), (b) => b * scale);
}

export function cosineSimilarity(
  a: Vector | ArrayLike<number>,
  b: Vector | ArrayLike<number>,
): number {
  let x = isVector(a) ? decodeVector(a) : a;
  let y = isVector(b) ? decodeVector(b) : b;
  if (x.length !== y.length) {
    throw new Error(
      `Cannot compare vectors of ${x.length} and ${y.length} dimensions`,
    );
  }
  let dot = 0;
  let nx = 0;
  let ny = 0;
  for (let i = 0; i < x.length; i++) {
    dot += x[i] * y[i];
    nx += x[i] * x[i];
    ny += y[i] * y[i];
  }
  return nx === 0 || ny === 0 ? 0 : dot / Math.sqrt(nx * ny);
}

export function isVector(value: unknown): value is Vector {
  return (
    typeof value === 'object' &&
    value != null &&
    !Array.isArray(value) &&
    !ArrayBuffer.isView(value) &&
    validate(value) === null
  );
}

// A `near` sort's target as the text form pgvector parses ('[1,2,3]'). The
// target may be a stored vector or plain numbers.
export function vectorToSqlLiteral(value: Vector | ArrayLike<number>): string {
  let components = isVector(value) ? decodeVector(value) : value;
  return `[${Array.from(components).join(',')}]`;
}

export function vectorDimensions(value: Vector | ArrayLike<number>): number {
  return isVector(value) ? value.dims : value.length;
}

function int8Bytes(vector: Vector): Int8Array {
  let bytes = base64ToBytes(vector.data);
  return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function float32Components(vector: Vector): Float32Array {
  let bytes = base64ToBytes(vector.data);
  // copy so the Float32Array view starts on a 4-byte boundary
  return new Float32Array(Uint8Array.from(bytes).buffer);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  let binary = atob(base64);
  let bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
