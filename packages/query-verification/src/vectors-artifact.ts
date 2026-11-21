// The conformance vectors are not kept in the repo. The Lean model writes
// them (`pnpm vectors`, which needs Lean) as one file named by its sha256,
// published at VECTORS_URL. Tests read that file from vectors/ (gitignored),
// downloading it on first use and checking its sha256 every time.
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';

// The sha256 of the file `pnpm vectors` writes; `pnpm vectors:check` fails
// when the model no longer writes it.
export const VECTORS_SHA256 =
  '7fe72ecc75323b8970a699cbe0176258d24c168bcd281b3f67077736df48b46d';

// TODO(reviewer): publish the artifact and set this base URL.
const VECTORS_BASE_URL = 'https://TODO-publish-query-v2-vectors.invalid';

export const vectorsFileName = (sha: string) => `query-v2-vectors-${sha}.json`;

export const VECTORS_URL = `${VECTORS_BASE_URL}/${vectorsFileName(VECTORS_SHA256)}`;

const cacheDir = new URL('../vectors/', import.meta.url);

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// Writes the file into vectors/ under its own sha256 and returns its path.
export function cacheVectors(bytes: Buffer): string {
  mkdirSync(cacheDir, { recursive: true });
  let file = fileURLToPath(new URL(vectorsFileName(sha256(bytes)), cacheDir));
  // Write then rename, so a concurrent reader never sees half a file.
  let tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, file);
  return file;
}

async function download(): Promise<Buffer> {
  let hint =
    'to build it with Lean instead, run `pnpm vectors` in packages/query-verification';
  let response: Response;
  try {
    response = await fetch(VECTORS_URL);
  } catch (e) {
    throw new Error(`cannot download ${VECTORS_URL} (${e}); ${hint}`);
  }
  if (!response.ok) {
    throw new Error(
      `cannot download ${VECTORS_URL} (${response.status}); ${hint}`,
    );
  }
  let bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== VECTORS_SHA256) {
    throw new Error(`${VECTORS_URL} does not have sha256 ${VECTORS_SHA256}`);
  }
  cacheVectors(bytes);
  return bytes;
}

let text: Promise<string> | undefined;

// The pinned vectors file's text: { filters, grammar, paths, values, dates }.
export function vectorsText(): Promise<string> {
  return (text ??= (async () => {
    let file = new URL(vectorsFileName(VECTORS_SHA256), cacheDir);
    let cached: Buffer | undefined = existsSync(file)
      ? readFileSync(file)
      : undefined;
    let bytes =
      cached && sha256(cached) === VECTORS_SHA256 ? cached : await download();
    return bytes.toString('utf8');
  })());
}
