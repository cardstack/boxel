// The conformance vectors are checked in, gzipped, as vectors.json.gz. The
// Lean model writes them (`pnpm vectors`, which needs Lean); tests read the
// checked-in file and check its sha256, so a run without Lean or a network
// holds the code to exactly what the model wrote.
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

// The sha256 of the (uncompressed) file `pnpm vectors` writes;
// `pnpm vectors:check` fails when the model no longer writes it.
export const VECTORS_SHA256 =
  '7fe72ecc75323b8970a699cbe0176258d24c168bcd281b3f67077736df48b46d';

export const VECTORS_FILE = fileURLToPath(
  new URL('../vectors.json.gz', import.meta.url),
);

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// Writes the vectors, gzipped, over the checked-in file and returns its path.
export function writeVectors(bytes: Buffer): string {
  // Write then rename, so a concurrent reader never sees half a file.
  let tmp = `${VECTORS_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, gzipSync(bytes, { level: 9 }));
  renameSync(tmp, VECTORS_FILE);
  return VECTORS_FILE;
}

let text: Promise<string> | undefined;

// The pinned vectors file's text: { filters, grammar, paths, values, dates }.
export function vectorsText(): Promise<string> {
  return (text ??= (async () => {
    let bytes = gunzipSync(readFileSync(VECTORS_FILE));
    let sha = sha256(bytes);
    if (sha !== VECTORS_SHA256) {
      throw new Error(
        `${VECTORS_FILE} has sha256 ${sha}, not the pinned ${VECTORS_SHA256}; run \`pnpm vectors\` in packages/query-verification and commit the result`,
      );
    }
    return bytes.toString('utf8');
  })());
}
