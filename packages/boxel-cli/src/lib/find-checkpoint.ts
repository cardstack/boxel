import type { Checkpoint } from './checkpoint-manager.ts';

/**
 * Length of a checkpoint's `shortHash`. SHA-1's first 7 hex chars, set in
 * `CheckpointManager.createCheckpoint`. Used to short-circuit the exact
 * short-hash scan for refs that can't possibly be one.
 */
const SHORT_HASH_LENGTH = 7;

export type FindResult =
  | { kind: 'found'; target: Checkpoint }
  | { kind: 'none' }
  | { kind: 'ambiguous'; matches: Checkpoint[] };

/**
 * Resolve a `--restore` ref against a list of checkpoints. The ref may be a
 * 1-based index (`'2'`), an exact short hash (`'6701186'`), or a hex prefix
 * of a full hash (`'abc'`).
 *
 * Resolution order:
 *   1. Exact short-hash match. SHA-1 short hashes are all-digits ~5.9% of
 *      the time, so digit-only refs that match a short hash exactly must
 *      win before the index branch.
 *   2. Digit-only refs → 1-based index. Out-of-range returns `none` rather
 *      than falling through to hash-prefix matching, since silently matching
 *      a hash whose prefix happens to be digits would surprise users typing
 *      what they think is an index.
 *   3. Hex-prefix match against the full hash.
 */
export function findCheckpoint(
  ref: string,
  checkpoints: Checkpoint[],
): FindResult {
  const trimmed = ref.trim();
  // Empty refs would `startsWith('')`-match every hash and silently restore
  // the newest checkpoint — guard explicitly.
  if (trimmed === '') return { kind: 'none' };

  // Exact short-hash match wins before the digit-only branch.
  if (trimmed.length === SHORT_HASH_LENGTH) {
    const exactShort = checkpoints.filter((cp) => cp.shortHash === trimmed);
    if (exactShort.length === 1) {
      return { kind: 'found', target: exactShort[0] };
    }
    if (exactShort.length > 1) {
      return { kind: 'ambiguous', matches: exactShort };
    }
  }

  // Digit-only input is an index lookup. Falling through to hash-prefix
  // matching when out of range would silently match short hashes whose prefix
  // happens to be digits.
  if (/^\d+$/.test(trimmed)) {
    const num = parseInt(trimmed, 10);
    if (num >= 1 && num <= checkpoints.length) {
      return { kind: 'found', target: checkpoints[num - 1] };
    }
    return { kind: 'none' };
  }

  const matches = checkpoints.filter((cp) => cp.hash.startsWith(trimmed));
  if (matches.length === 0) return { kind: 'none' };
  if (matches.length === 1) return { kind: 'found', target: matches[0] };
  return { kind: 'ambiguous', matches };
}
