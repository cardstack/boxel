import { createHash } from 'node:crypto';
import type { LatticeJsonSourceFingerprint } from '@cardstack/runtime-common/lattice-json-source';

export interface LatticePreparedJsonSource {
  fingerprint: LatticeJsonSourceFingerprint;
  reused: boolean;
  elapsedMs: number;
}

// The JSON FileDef's data preparation is also used before card admission.
// Admission bounds sources to 1 MiB, so the existing MD5 receipt covers ALL
// bytes. A sampled realm_file_meta hash must never authorize reuse here.
export function prepareLatticeJsonSource(
  source: string,
  receipt: { version: string; content_hash: string; content_size: number },
  stored?: unknown,
): LatticePreparedJsonSource | undefined {
  const started = performance.now();
  const size = Buffer.byteLength(source);
  if (size > 1_048_576 || size !== receipt.content_size) return undefined;
  const contentHash = createHash('md5').update(source).digest('hex');
  if (contentHash !== receipt.content_hash) return undefined;
  const cached = stored as Partial<LatticeJsonSourceFingerprint> | null;
  const reused = Boolean(
    cached &&
    cached.version === 1 &&
    cached.algorithm === 'sha256' &&
    typeof cached.digest === 'string' &&
    /^[a-f0-9]{64}$/.test(cached.digest) &&
    cached.fileVersion === receipt.version &&
    cached.contentHash === contentHash &&
    cached.contentSize === size,
  );
  return {
    fingerprint: {
      version: 1,
      algorithm: 'sha256',
      digest: reused
        ? cached!.digest!
        : createHash('sha256').update(source).digest('hex'),
      fileVersion: receipt.version,
      contentHash,
      contentSize: size,
    },
    reused,
    elapsedMs: performance.now() - started,
  };
}
