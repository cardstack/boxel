import { describe, it, expect } from 'vitest';
import {
  classifyLocal,
  classifyRemote,
  determineAction,
  resolveConflict,
  type FileClassification,
  type SyncOptions,
} from '../../src/lib/sync-logic.ts';
import type { SyncManifest } from '../../src/lib/sync-manifest.ts';

function makeManifest(
  files: Record<string, string> = {},
  remoteMtimes?: Record<string, number>,
): SyncManifest {
  return {
    realmUrl: 'http://test-realm/',
    files,
    remoteMtimes,
  };
}

describe('classifyLocal', () => {
  it('returns unchanged when hash matches manifest', () => {
    const hashes = new Map([['a.json', 'abc123']]);
    const manifest = makeManifest({ 'a.json': 'abc123' });
    expect(classifyLocal('a.json', hashes, manifest)).toBe('unchanged');
  });

  it('returns changed when hash differs from manifest', () => {
    const hashes = new Map([['a.json', 'new-hash']]);
    const manifest = makeManifest({ 'a.json': 'old-hash' });
    expect(classifyLocal('a.json', hashes, manifest)).toBe('changed');
  });

  it('returns added when not in manifest', () => {
    const hashes = new Map([['new.json', 'abc123']]);
    expect(classifyLocal('new.json', hashes, null)).toBe('added');
    expect(classifyLocal('new.json', hashes, makeManifest({}))).toBe('added');
  });

  it('returns deleted when in manifest but not local', () => {
    const hashes = new Map<string, string>();
    const manifest = makeManifest({ 'gone.json': 'abc123' });
    expect(classifyLocal('gone.json', hashes, manifest)).toBe('deleted');
  });

  it('returns unchanged for remote-only file (not local, not in manifest)', () => {
    const hashes = new Map<string, string>();
    expect(classifyLocal('remote-only.json', hashes, null)).toBe('unchanged');
  });
});

describe('classifyRemote', () => {
  it('returns unchanged when mtime matches manifest.remoteMtimes', () => {
    const mtimes = new Map([['a.json', 1000]]);
    const manifest = makeManifest({ 'a.json': 'hash' }, { 'a.json': 1000 });
    expect(classifyRemote('a.json', mtimes, manifest)).toBe('unchanged');
  });

  it('returns changed when mtime differs from manifest.remoteMtimes', () => {
    const mtimes = new Map([['a.json', 2000]]);
    const manifest = makeManifest({ 'a.json': 'hash' }, { 'a.json': 1000 });
    expect(classifyRemote('a.json', mtimes, manifest)).toBe('changed');
  });

  it('returns added when not in manifest at all', () => {
    const mtimes = new Map([['new.json', 1000]]);
    expect(classifyRemote('new.json', mtimes, null)).toBe('added');
    expect(classifyRemote('new.json', mtimes, makeManifest({}))).toBe('added');
  });

  it('returns deleted when in manifest but not remote', () => {
    const mtimes = new Map<string, number>();
    const manifest = makeManifest(
      { 'gone.json': 'hash' },
      { 'gone.json': 1000 },
    );
    expect(classifyRemote('gone.json', mtimes, manifest)).toBe('deleted');
  });

  it('returns changed when known in manifest.files but no remoteMtimes entry', () => {
    const mtimes = new Map([['a.json', 1000]]);
    // Manifest has the file in files but no remoteMtimes (e.g., created when _mtimes was unavailable)
    const manifest = makeManifest({ 'a.json': 'hash' });
    expect(classifyRemote('a.json', mtimes, manifest)).toBe('changed');
  });

  it('returns deleted when file in manifest.files only and not on remote', () => {
    const mtimes = new Map<string, number>();
    const manifest = makeManifest({ 'gone.json': 'hash' });
    expect(classifyRemote('gone.json', mtimes, manifest)).toBe('deleted');
  });

  it('returns unchanged for local-only file (not remote, not in manifest)', () => {
    const mtimes = new Map<string, number>();
    expect(classifyRemote('local-only.json', mtimes, null)).toBe('unchanged');
  });
});

describe('determineAction', () => {
  const noFlags: SyncOptions = {};
  const withDelete: SyncOptions = { deleteSync: true };
  const withPreferLocal: SyncOptions = { preferLocal: true };
  const withPreferRemote: SyncOptions = { preferRemote: true };

  it('returns noop when both unchanged', () => {
    expect(determineAction('unchanged', 'unchanged', noFlags)).toBe('noop');
  });

  it('returns push when local changed, remote unchanged', () => {
    expect(determineAction('changed', 'unchanged', noFlags)).toBe('push');
  });

  it('returns pull when local unchanged, remote changed', () => {
    expect(determineAction('unchanged', 'changed', noFlags)).toBe('pull');
  });

  it('returns push when local added, remote unchanged', () => {
    expect(determineAction('added', 'unchanged', noFlags)).toBe('push');
  });

  it('returns pull when local unchanged, remote added', () => {
    expect(determineAction('unchanged', 'added', noFlags)).toBe('pull');
  });

  it('returns conflict when both changed', () => {
    expect(determineAction('changed', 'changed', noFlags)).toBe('conflict');
  });

  it('returns conflict when both added', () => {
    expect(determineAction('added', 'added', noFlags)).toBe('conflict');
  });

  it('returns conflict for cross-state: changed+added', () => {
    expect(determineAction('changed', 'added', noFlags)).toBe('conflict');
  });

  it('returns conflict for cross-state: added+changed', () => {
    expect(determineAction('added', 'changed', noFlags)).toBe('conflict');
  });

  describe('deletions', () => {
    it('returns noop for local deleted without flags', () => {
      expect(determineAction('deleted', 'unchanged', noFlags)).toBe('noop');
    });

    it('returns push-delete for local deleted with --delete', () => {
      expect(determineAction('deleted', 'unchanged', withDelete)).toBe(
        'push-delete',
      );
    });

    it('returns push-delete for local deleted with --prefer-local', () => {
      expect(determineAction('deleted', 'unchanged', withPreferLocal)).toBe(
        'push-delete',
      );
    });

    it('returns noop for remote deleted without flags', () => {
      expect(determineAction('unchanged', 'deleted', noFlags)).toBe('noop');
    });

    it('returns pull-delete for remote deleted with --delete', () => {
      expect(determineAction('unchanged', 'deleted', withDelete)).toBe(
        'pull-delete',
      );
    });

    it('returns pull-delete for remote deleted with --prefer-remote', () => {
      expect(determineAction('unchanged', 'deleted', withPreferRemote)).toBe(
        'pull-delete',
      );
    });
  });

  describe('delete-vs-change conflicts', () => {
    it('returns conflict for local deleted, remote changed', () => {
      expect(determineAction('deleted', 'changed', noFlags)).toBe('conflict');
    });

    it('returns conflict for local changed, remote deleted', () => {
      expect(determineAction('changed', 'deleted', noFlags)).toBe('conflict');
    });
  });

  it('returns noop when both deleted', () => {
    expect(determineAction('deleted', 'deleted', noFlags)).toBe('noop');
  });

  it('returns push for local added, remote deleted', () => {
    expect(determineAction('added', 'deleted', noFlags)).toBe('push');
  });

  it('returns pull for local deleted, remote added', () => {
    expect(determineAction('deleted', 'added', noFlags)).toBe('pull');
  });
});

describe('resolveConflict', () => {
  function makeClassification(
    local: string,
    remote: string,
    path = 'test.json',
  ): FileClassification {
    return {
      relativePath: path,
      localStatus: local as any,
      remoteStatus: remote as any,
      action: 'conflict',
    };
  }

  const emptyMtimes = new Map<string, number>();
  const emptyLocalMtimes = new Map<string, { path: string; mtime: number }>();

  it('returns null when no strategy', () => {
    const c = makeClassification('changed', 'changed');
    expect(resolveConflict(c, emptyLocalMtimes, emptyMtimes, null)).toBe(null);
  });

  describe('prefer-local', () => {
    it('returns push for changed files', () => {
      const c = makeClassification('changed', 'changed');
      expect(
        resolveConflict(c, emptyLocalMtimes, emptyMtimes, 'prefer-local'),
      ).toBe('push');
    });

    it('returns push-delete when local is deleted', () => {
      const c = makeClassification('deleted', 'changed');
      expect(
        resolveConflict(c, emptyLocalMtimes, emptyMtimes, 'prefer-local'),
      ).toBe('push-delete');
    });
  });

  describe('prefer-remote', () => {
    it('returns pull for changed files', () => {
      const c = makeClassification('changed', 'changed');
      expect(
        resolveConflict(c, emptyLocalMtimes, emptyMtimes, 'prefer-remote'),
      ).toBe('pull');
    });

    it('returns pull-delete when remote is deleted', () => {
      const c = makeClassification('changed', 'deleted');
      expect(
        resolveConflict(c, emptyLocalMtimes, emptyMtimes, 'prefer-remote'),
      ).toBe('pull-delete');
    });
  });

  describe('prefer-newest', () => {
    it('pulls when local deleted and remote changed (change wins)', () => {
      const c = makeClassification('deleted', 'changed');
      expect(
        resolveConflict(c, emptyLocalMtimes, emptyMtimes, 'prefer-newest'),
      ).toBe('pull');
    });

    it('pushes when local changed and remote deleted (change wins)', () => {
      const c = makeClassification('changed', 'deleted');
      expect(
        resolveConflict(c, emptyLocalMtimes, emptyMtimes, 'prefer-newest'),
      ).toBe('push');
    });

    it('pushes when local is newer', () => {
      const c = makeClassification('changed', 'changed');
      const localMtimes = new Map([
        ['test.json', { path: '/tmp/test.json', mtime: 2000000 }], // 2000 seconds in ms
      ]);
      const remoteMtimes = new Map([['test.json', 1000]]); // 1000 seconds
      expect(
        resolveConflict(c, localMtimes, remoteMtimes, 'prefer-newest'),
      ).toBe('push');
    });

    it('pulls when remote is newer', () => {
      const c = makeClassification('changed', 'changed');
      const localMtimes = new Map([
        ['test.json', { path: '/tmp/test.json', mtime: 500000 }], // 500 seconds in ms
      ]);
      const remoteMtimes = new Map([['test.json', 1000]]); // 1000 seconds
      expect(
        resolveConflict(c, localMtimes, remoteMtimes, 'prefer-newest'),
      ).toBe('pull');
    });

    it('falls back to push when mtime data is missing', () => {
      const c = makeClassification('changed', 'changed');
      expect(
        resolveConflict(c, emptyLocalMtimes, emptyMtimes, 'prefer-newest'),
      ).toBe('push');
    });
  });
});
