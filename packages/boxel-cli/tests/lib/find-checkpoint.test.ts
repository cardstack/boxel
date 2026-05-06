import { describe, it, expect } from 'vitest';
import { findCheckpoint } from '../../src/lib/find-checkpoint';
import type { Checkpoint } from '../../src/lib/checkpoint-manager';

function cp(hash: string, shortHash?: string): Checkpoint {
  return {
    hash,
    shortHash: shortHash ?? hash.substring(0, 7),
    message: 'test',
    description: '',
    date: new Date(),
    isMajor: false,
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    source: 'manual',
    isMilestone: false,
  };
}

describe('findCheckpoint', () => {
  describe('all-digit short hash regression', () => {
    // SHA-1 short hashes (first 7 hex chars) are all-digits ~5.9% of the time
    // ((10/16)^7). Routing digit-only refs straight to index lookup loses
    // those — exact short-hash match must win.
    const target = cp('6701186b1d624af1b692cbf741c6990fbd10040b');
    const newer = cp('abc1234deadbeefabc1234deadbeefabc1234dea');

    it('resolves an all-digit short hash to the matching checkpoint', () => {
      const result = findCheckpoint(target.shortHash, [newer, target]);
      expect(result.kind).toBe('found');
      if (result.kind === 'found') {
        expect(result.target.hash).toBe(target.hash);
      }
    });

    it('still treats an out-of-range numeric ref that is not a short hash as none', () => {
      // '99' is digit-only, not a 7-char short hash, and out of index range.
      const result = findCheckpoint('99', [newer, target]);
      expect(result.kind).toBe('none');
    });

    it('prefers an in-range index over a coincidental hash-prefix match', () => {
      // '1' is a valid index; do not let an exact-shortHash check
      // accidentally promote a 1-char ref over the index UX.
      const result = findCheckpoint('1', [newer, target]);
      expect(result.kind).toBe('found');
      if (result.kind === 'found') {
        expect(result.target.hash).toBe(newer.hash);
      }
    });

    it('reports ambiguous when two checkpoints share the same short hash', () => {
      const a = cp('6701186b1d624af1b692cbf741c6990fbd10040b');
      const b = cp('6701186cccccccccccccccccccccccccccccccc');
      const result = findCheckpoint('6701186', [a, b]);
      expect(result.kind).toBe('ambiguous');
    });
  });

  describe('basic resolution', () => {
    const a = cp('aaaaaaa1234567890aaaaaaa1234567890aaaaaa');
    const b = cp('bbbbbbb1234567890bbbbbbb1234567890bbbbbb');

    it('returns none for an empty ref', () => {
      expect(findCheckpoint('', [a, b]).kind).toBe('none');
      expect(findCheckpoint('   ', [a, b]).kind).toBe('none');
    });

    it('resolves a 1-based index', () => {
      const result = findCheckpoint('2', [a, b]);
      expect(result.kind).toBe('found');
      if (result.kind === 'found') expect(result.target.hash).toBe(b.hash);
    });

    it('resolves a hex prefix to the matching checkpoint', () => {
      const result = findCheckpoint('aaa', [a, b]);
      expect(result.kind).toBe('found');
      if (result.kind === 'found') expect(result.target.hash).toBe(a.hash);
    });

    it('returns ambiguous when a hex prefix matches multiple', () => {
      const c = cp('aaaaaaaffffffffaaaaaaaffffffffaaaaaaffff');
      const result = findCheckpoint('aaa', [a, c]);
      expect(result.kind).toBe('ambiguous');
    });
  });
});
