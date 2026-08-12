// Precompressed variants of published bytes, derived once and kept forever.
//
// ─── WHY NOT IN THE PACK ────────────────────────────────────────────────────
//
// The obvious move is to compress at publish and seal the `.br`/`.gz` beside
// the source. It is the wrong move, and the reason matters: **compressed output
// is not reproducible**. gzip and brotli do not promise byte-identical results
// across library versions or build flags, so sealing them would make a
// Version's `treeHash` depend on whichever zlib the publishing machine
// happened to link. A content-addressed store whose digest moves with the
// toolchain is not content-addressed. Deck's determinism is the whole asset;
// compression is not allowed to spend it.
//
// So a compressed variant is a CACHE, not a Version — derived from sealed
// bytes, never part of them, and reproducible or not without consequence.
//
// ─── WHY IT STILL NEEDS NO INVALIDATION ─────────────────────────────────────
//
// Keyed by `treeHash` + path + encoding. A Version is immutable, so its digest
// never changes; publish a new Version and you get a new digest and therefore
// a new cache path. Nothing is ever stale, so nothing is ever evicted for
// being stale — the same trick the HTTP layer uses, applied on disk.
//
// Filesystem, no database, and portable to object storage: the layout is
// `<store>-derived/<aa>/<treeHash>/<path>.<ext>`, which is a key an S3 bucket
// takes verbatim.
//
// ─── WHAT IS WORTH COMPRESSING ──────────────────────────────────────────────
//
// Text. Not PNGs, not woff2, not anything already carrying its own entropy
// coder — recompressing those spends CPU to add bytes. And not tiny files: a
// gzip header is 18 bytes before any payload, so below about a kilobyte the
// arithmetic stops working and the round trip is dominated by latency anyway.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);

export type Encoding = 'br' | 'gzip';

// Below this, the header outweighs the saving and the transfer is latency-bound
// regardless. 1 KiB is the conventional floor and nothing here argues with it.
const MIN_COMPRESSIBLE_BYTES = 1024;

// Allowlist rather than a denylist: a new binary format added to the store
// should default to being left alone, not to being pointlessly recompressed
// because nobody remembered to exclude it.
const COMPRESSIBLE = [
  /^text\//,
  /^application\/javascript/,
  /^application\/json/,
  /^application\/vnd\.card\+source/,
  /^image\/svg\+xml/,
  /^application\/wasm/,
];

export function isCompressible(
  contentType: string,
  byteLength: number,
): boolean {
  if (byteLength < MIN_COMPRESSIBLE_BYTES) {
    return false;
  }
  return COMPRESSIBLE.some((pattern) => pattern.test(contentType));
}

/**
 * The best encoding a client will take, or `undefined` for identity.
 *
 * Brotli first where both are offered: it is meaningfully smaller on
 * JavaScript and every browser that speaks it also speaks gzip, so preferring
 * it costs nothing in reach. `q=0` is honoured — a client is allowed to say it
 * does NOT want an encoding, and ignoring that turns a preference into a
 * decision made on the client's behalf.
 */
export function negotiateEncoding(
  header: string | undefined,
): Encoding | undefined {
  if (!header) {
    return undefined;
  }
  let accepted = new Map<string, number>();
  for (let part of header.split(',')) {
    let [token, ...params] = part.trim().split(';');
    let q = params
      .map((p) => p.trim())
      .filter((p) => p.startsWith('q='))
      .map((p) => Number(p.slice(2)))
      .find((n) => !Number.isNaN(n));
    accepted.set(token.trim().toLowerCase(), q ?? 1);
  }
  let wants = (token: string) =>
    (accepted.get(token) ?? accepted.get('*') ?? 0) > 0;
  if (wants('br')) {
    return 'br';
  }
  return wants('gzip') ? 'gzip' : undefined;
}

function derivedPathFor(
  packageStorePath: string,
  treeHash: string,
  path: string,
  encoding: Encoding,
): string {
  // Two-character fan-out on the digest, the same shape Deck's own object
  // directories use: one flat directory with a hundred thousand entries is a
  // filesystem's worst case and an S3 prefix's too.
  let shard = treeHash.slice(0, 2);
  // The path is hashed rather than nested: a package path can be arbitrarily
  // deep, and rebuilding that tree under every digest multiplies directories
  // for no lookup benefit.
  let key = createHash('sha256').update(path).digest('hex');
  return join(
    `${packageStorePath.replace(/\/+$/, '')}-derived`,
    shard,
    treeHash,
    `${key}.${encoding}`,
  );
}

/**
 * The compressed form of these bytes, derived on first ask and reused after.
 *
 * Returns `undefined` when compression did not pay — a file that grew, which
 * happens on already-dense input — so the caller serves identity rather than a
 * larger body wearing a smaller name.
 *
 * FAILS OPEN: any error compressing or caching yields `undefined` and the
 * caller serves the original. A compression cache that can take the response
 * down with it is worse than no compression cache.
 */
export async function compressedVariant(
  packageStorePath: string,
  treeHash: string,
  path: string,
  encoding: Encoding,
  bytes: Uint8Array,
): Promise<Buffer | undefined> {
  let file = derivedPathFor(packageStorePath, treeHash, path, encoding);
  try {
    return await readFile(file);
  } catch {
    // Not derived yet — fall through and derive it.
  }
  try {
    let out =
      encoding === 'br'
        ? await compressBrotli(bytes, {
            params: {
              // Text mode and a size hint: brotli picks a better context model
              // when it knows both, and everything routed here is text by the
              // allowlist above.
              [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
              [constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength,
              // 11 is the maximum and normally too slow to consider — but this
              // runs ONCE per immutable Version and is then read from disk
              // forever, so the usual latency argument does not apply. Spend
              // the CPU once; save the bytes on every request after.
              [constants.BROTLI_PARAM_QUALITY]: 11,
            },
          })
        : await compressGzip(bytes, { level: 9 });
    if (out.byteLength >= bytes.byteLength) {
      return undefined;
    }
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, out);
    return out;
  } catch {
    return undefined;
  }
}
