import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { realmHistory } from '../../src/commands/realm/history';
import { CheckpointManager } from '../../src/lib/checkpoint-manager';

let workspaceDir: string;

function writeFile(relPath: string, content: string): void {
  const full = path.join(workspaceDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

beforeEach(() => {
  workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-history-int-'));
});

afterEach(() => {
  fs.rmSync(workspaceDir, { recursive: true, force: true });
});

describe('realm history (integration)', () => {
  describe('view mode', () => {
    it('returns an empty list for an uninitialized workspace', async () => {
      const result = await realmHistory(workspaceDir);
      expect(result.ok).toBe(true);
      expect(result.checkpoints).toEqual([]);
    });

    it('lists checkpoints in reverse-chronological order', async () => {
      const cm = new CheckpointManager(workspaceDir);
      writeFile('a.gts', 'first');
      await cm.createCheckpoint('manual', [{ file: 'a.gts', status: 'added' }]);
      writeFile('b.gts', 'second');
      await cm.createCheckpoint('local', [{ file: 'b.gts', status: 'added' }]);

      const result = await realmHistory(workspaceDir);

      expect(result.ok).toBe(true);
      expect(result.checkpoints).toBeDefined();
      expect(result.checkpoints!.length).toBe(2);
      expect(result.checkpoints![0].source).toBe('local');
      expect(result.checkpoints![1].source).toBe('manual');
      expect(result.truncated).toBe(false);
    });

    it('returns truncated=true when checkpoints exceed limit', async () => {
      const cm = new CheckpointManager(workspaceDir);
      writeFile('a.gts', '1');
      await cm.createCheckpoint('manual', [{ file: 'a.gts', status: 'added' }]);
      writeFile('a.gts', '2');
      await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'modified' },
      ]);
      writeFile('a.gts', '3');
      await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'modified' },
      ]);

      const capped = await realmHistory(workspaceDir, { limit: 2 });
      expect(capped.ok).toBe(true);
      expect(capped.checkpoints!.length).toBe(2);
      expect(capped.truncated).toBe(true);

      const all = await realmHistory(workspaceDir, { limit: 10 });
      expect(all.checkpoints!.length).toBe(3);
      expect(all.truncated).toBe(false);
    });
  });

  describe('manual checkpoint (-m)', () => {
    it('creates a checkpoint with the provided message', async () => {
      writeFile('a.gts', 'a');

      const result = await realmHistory(workspaceDir, {
        message: 'before cleanup',
      });

      expect(result.ok).toBe(true);
      expect(result.created).toBeDefined();
      expect(result.created!.source).toBe('manual');

      const cps = await new CheckpointManager(workspaceDir).getCheckpoints();
      expect(cps[0].message.trim()).toBe('before cleanup');
    });

    it('initializes the history repo on first use', async () => {
      writeFile('a.gts', 'a');
      const historyDir = path.join(workspaceDir, '.boxel-history', '.git');
      expect(fs.existsSync(historyDir)).toBe(false);

      const result = await realmHistory(workspaceDir, { message: 'first' });

      expect(result.ok).toBe(true);
      expect(fs.existsSync(historyDir)).toBe(true);
    });

    it('returns an error when there are no changes to checkpoint', async () => {
      writeFile('a.gts', 'a');
      await realmHistory(workspaceDir, { message: 'first' });

      const result = await realmHistory(workspaceDir, { message: 'second' });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('No changes to checkpoint');
    });

    it('rejects an empty message', async () => {
      writeFile('a.gts', 'a');
      const result = await realmHistory(workspaceDir, { message: '   ' });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('--message must not be empty');
    });
  });

  describe('restore (-r)', () => {
    it('restores by 1-based index', async () => {
      const cm = new CheckpointManager(workspaceDir);
      writeFile('a.gts', 'original');
      await cm.createCheckpoint('manual', [{ file: 'a.gts', status: 'added' }]);
      writeFile('a.gts', 'modified');
      writeFile('b.gts', 'b');
      await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'modified' },
        { file: 'b.gts', status: 'added' },
      ]);

      // Index 2 is the older "original" checkpoint; getCheckpoints is newest-first.
      const result = await realmHistory(workspaceDir, { restore: '2' });

      expect(result.ok).toBe(true);
      expect(result.restored).toBeDefined();
      expect(fs.readFileSync(path.join(workspaceDir, 'a.gts'), 'utf8')).toBe(
        'original',
      );
      expect(fs.existsSync(path.join(workspaceDir, 'b.gts'))).toBe(false);
    });

    it('restores by short hash', async () => {
      const cm = new CheckpointManager(workspaceDir);
      writeFile('a.gts', 'original');
      const target = await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'added' },
      ]);
      writeFile('a.gts', 'modified');
      await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'modified' },
      ]);

      const result = await realmHistory(workspaceDir, {
        restore: target!.shortHash,
      });

      expect(result.ok).toBe(true);
      expect(result.restored?.hash).toBe(target!.hash);
      expect(fs.readFileSync(path.join(workspaceDir, 'a.gts'), 'utf8')).toBe(
        'original',
      );
    });

    it('restores by full hash', async () => {
      const cm = new CheckpointManager(workspaceDir);
      writeFile('a.gts', 'original');
      const target = await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'added' },
      ]);
      writeFile('a.gts', 'modified');
      await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'modified' },
      ]);

      expect(target!.hash.length).toBe(40);
      const result = await realmHistory(workspaceDir, {
        restore: target!.hash,
      });

      expect(result.ok).toBe(true);
      expect(result.restored?.hash).toBe(target!.hash);
      expect(fs.readFileSync(path.join(workspaceDir, 'a.gts'), 'utf8')).toBe(
        'original',
      );
    });

    it('returns an error for an out-of-range numeric index', async () => {
      const cm = new CheckpointManager(workspaceDir);
      writeFile('a.gts', 'a');
      await cm.createCheckpoint('manual', [{ file: 'a.gts', status: 'added' }]);
      writeFile('b.gts', 'b');
      await cm.createCheckpoint('manual', [{ file: 'b.gts', status: 'added' }]);

      // Digit-only refs are always treated as index lookups; they must not
      // silently match a short hash whose prefix happens to be digits.
      const result = await realmHistory(workspaceDir, { restore: '99' });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Checkpoint not found');
    });

    it('preserves .realm.json across restore', async () => {
      const cm = new CheckpointManager(workspaceDir);
      writeFile('a.gts', 'original');
      const target = await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'added' },
      ]);
      writeFile('.realm.json', '{"name":"test"}');
      writeFile('a.gts', 'modified');
      await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'modified' },
      ]);

      const result = await realmHistory(workspaceDir, {
        restore: target!.shortHash,
      });

      expect(result.ok).toBe(true);
      const realmJsonPath = path.join(workspaceDir, '.realm.json');
      expect(fs.existsSync(realmJsonPath)).toBe(true);
      expect(fs.readFileSync(realmJsonPath, 'utf8')).toBe('{"name":"test"}');
    });

    it('returns an error for an invalid reference', async () => {
      const cm = new CheckpointManager(workspaceDir);
      writeFile('a.gts', 'a');
      await cm.createCheckpoint('manual', [{ file: 'a.gts', status: 'added' }]);

      const result = await realmHistory(workspaceDir, { restore: 'deadbeef' });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Checkpoint not found');
    });

    it('returns an error when the workspace has no history', async () => {
      const result = await realmHistory(workspaceDir, { restore: '1' });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('No checkpoint history');
    });

    it('rejects an empty restore ref instead of restoring the newest', async () => {
      const cm = new CheckpointManager(workspaceDir);
      writeFile('a.gts', 'a');
      await cm.createCheckpoint('manual', [{ file: 'a.gts', status: 'added' }]);
      writeFile('b.gts', 'b');
      await cm.createCheckpoint('manual', [{ file: 'b.gts', status: 'added' }]);

      const result = await realmHistory(workspaceDir, { restore: '' });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Checkpoint not found');
      expect(fs.existsSync(path.join(workspaceDir, 'b.gts'))).toBe(true);
    });

    it('rejects a whitespace-only restore ref', async () => {
      const cm = new CheckpointManager(workspaceDir);
      writeFile('a.gts', 'a');
      await cm.createCheckpoint('manual', [{ file: 'a.gts', status: 'added' }]);

      const result = await realmHistory(workspaceDir, { restore: '   ' });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Checkpoint not found');
    });

    it('rejects an ambiguous hash prefix', async () => {
      const cm = new CheckpointManager(workspaceDir);
      // Create enough checkpoints that some non-digit hex prefix collides.
      // Digit-only refs are treated as index lookups, not hash prefixes.
      for (let i = 0; i < 40; i++) {
        writeFile('a.gts', `v${i}`);
        await cm.createCheckpoint('manual', [
          { file: 'a.gts', status: i === 0 ? 'added' : 'modified' },
        ]);
      }
      const cps = await cm.getCheckpoints(100);
      const counts = new Map<string, number>();
      for (const cp of cps) {
        const c = cp.hash[0];
        if (/[a-f]/.test(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      const ambiguousPrefix = [...counts.entries()].find(
        ([, n]) => n >= 2,
      )?.[0];
      expect(ambiguousPrefix).toBeDefined();

      const result = await realmHistory(workspaceDir, {
        restore: ambiguousPrefix!,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Ambiguous reference');
    });
  });

  describe('argument validation', () => {
    it('rejects a missing workspace directory', async () => {
      const result = await realmHistory(
        path.join(workspaceDir, 'does-not-exist'),
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Directory not found');
    });

    it('rejects --restore and --message together', async () => {
      const result = await realmHistory(workspaceDir, {
        restore: '1',
        message: 'oops',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Only one of --restore or --message');
    });

    it.each([
      ['zero', 0],
      ['negative', -1],
      ['non-integer', 1.5],
      ['NaN', Number.NaN],
    ])('rejects an invalid limit (%s)', async (_name, limit) => {
      const result = await realmHistory(workspaceDir, { limit });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('positive integer');
    });
  });
});
