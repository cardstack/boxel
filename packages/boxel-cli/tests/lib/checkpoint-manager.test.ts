import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CheckpointManager } from '../../src/lib/checkpoint-manager';

function writeFile(dir: string, relPath: string, content: string): void {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

describe('CheckpointManager', () => {
  let workspaceDir: string;
  let cm: CheckpointManager;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-cp-test-'));
    cm = new CheckpointManager(workspaceDir);
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  describe('initialization', () => {
    it('reports uninitialized on a fresh workspace', async () => {
      expect(await cm.isInitialized()).toBe(false);
    });

    it('init() creates the .boxel-history git repo', async () => {
      await cm.init();

      expect(await cm.isInitialized()).toBe(true);
      expect(
        fs.existsSync(path.join(workspaceDir, '.boxel-history', '.git')),
      ).toBe(true);
    });

    it('init() is idempotent', async () => {
      await cm.init();
      let firstCheckpoints = await cm.getCheckpoints();
      await cm.init();
      let secondCheckpoints = await cm.getCheckpoints();

      expect(secondCheckpoints.length).toBe(firstCheckpoints.length);
    });
  });

  describe('detectCurrentChanges', () => {
    it('returns all files as added when uninitialized', async () => {
      writeFile(workspaceDir, 'a.gts', 'a');
      writeFile(workspaceDir, 'nested/b.gts', 'b');

      const changes = await cm.detectCurrentChanges();
      const byFile = new Map(changes.map((c) => [c.file, c.status]));

      expect(byFile.get('a.gts')).toBe('added');
      expect(byFile.get('nested/b.gts')).toBe('added');
    });

    it('returns [] after creating a checkpoint of current state', async () => {
      writeFile(workspaceDir, 'a.gts', 'a');
      await cm.createCheckpoint('manual', [{ file: 'a.gts', status: 'added' }]);

      expect(await cm.detectCurrentChanges()).toEqual([]);
    });

    it('detects newly added files', async () => {
      writeFile(workspaceDir, 'a.gts', 'a');
      await cm.createCheckpoint('manual', [{ file: 'a.gts', status: 'added' }]);

      writeFile(workspaceDir, 'b.gts', 'b');
      const changes = await cm.detectCurrentChanges();

      expect(changes).toEqual([{ file: 'b.gts', status: 'added' }]);
    });

    it('detects modified files', async () => {
      writeFile(workspaceDir, 'a.gts', 'a');
      await cm.createCheckpoint('manual', [{ file: 'a.gts', status: 'added' }]);

      writeFile(workspaceDir, 'a.gts', 'modified');
      const changes = await cm.detectCurrentChanges();

      expect(changes).toEqual([{ file: 'a.gts', status: 'modified' }]);
    });

    it('detects deleted files', async () => {
      writeFile(workspaceDir, 'a.gts', 'a');
      await cm.createCheckpoint('manual', [{ file: 'a.gts', status: 'added' }]);

      fs.unlinkSync(path.join(workspaceDir, 'a.gts'));
      const changes = await cm.detectCurrentChanges();

      expect(changes).toEqual([{ file: 'a.gts', status: 'deleted' }]);
    });

    it('excludes .boxel-history, .boxel-sync.json, node_modules and dotfiles', async () => {
      writeFile(workspaceDir, 'a.gts', 'a');
      writeFile(workspaceDir, '.env', 'SECRET=1');
      writeFile(workspaceDir, '.boxel-sync.json', '{}');
      writeFile(workspaceDir, 'node_modules/pkg/index.js', 'x');

      const changes = await cm.detectCurrentChanges();
      const files = changes.map((c) => c.file);

      expect(files).toContain('a.gts');
      expect(files).not.toContain('.env');
      expect(files).not.toContain('.boxel-sync.json');
      expect(files.some((f) => f.startsWith('node_modules'))).toBe(false);
    });
  });

  describe('createCheckpoint', () => {
    it('returns null when there are no workspace changes', async () => {
      await cm.init();

      const result = await cm.createCheckpoint('manual', []);
      expect(result).toBeNull();
    });

    it('creates a checkpoint with expected metadata', async () => {
      writeFile(workspaceDir, 'a.gts', 'a');
      writeFile(workspaceDir, 'b.gts', 'b');

      const cp = await cm.createCheckpoint('remote', [
        { file: 'a.gts', status: 'added' },
        { file: 'b.gts', status: 'added' },
      ]);

      expect(cp).not.toBeNull();
      expect(cp!.hash).toMatch(/^[0-9a-f]{40}$/);
      expect(cp!.shortHash).toBe(cp!.hash.substring(0, 7));
      expect(cp!.source).toBe('remote');
      // adds are always major
      expect(cp!.isMajor).toBe(true);
    });

    it('honors customMessage (read back through getCheckpoints)', async () => {
      writeFile(workspaceDir, 'a.gts', 'a');

      await cm.createCheckpoint(
        'remote',
        [{ file: 'a.gts', status: 'added' }],
        'Pre-delete checkpoint: 1 files not on server',
      );

      const checkpoints = await cm.getCheckpoints();
      expect(checkpoints[0].message.trim()).toBe(
        'Pre-delete checkpoint: 1 files not on server',
      );
    });

    describe('classification', () => {
      it('marks a single .gts modification as major', async () => {
        writeFile(workspaceDir, 'a.gts', 'a');
        await cm.createCheckpoint('manual', [
          { file: 'a.gts', status: 'added' },
        ]);

        writeFile(workspaceDir, 'a.gts', 'modified');
        const cp = await cm.createCheckpoint('local', [
          { file: 'a.gts', status: 'modified' },
        ]);

        expect(cp!.isMajor).toBe(true);
      });

      it('marks a single non-.gts modification as minor', async () => {
        writeFile(workspaceDir, 'a.txt', 'a');
        await cm.createCheckpoint('manual', [
          { file: 'a.txt', status: 'added' },
        ]);

        writeFile(workspaceDir, 'a.txt', 'modified');
        const cp = await cm.createCheckpoint('local', [
          { file: 'a.txt', status: 'modified' },
        ]);

        expect(cp!.isMajor).toBe(false);
      });

      it('marks 4+ changes as major', async () => {
        for (let i = 0; i < 4; i++) {
          writeFile(workspaceDir, `file-${i}.txt`, 'x');
        }
        await cm.createCheckpoint('manual', [
          { file: 'file-0.txt', status: 'added' },
          { file: 'file-1.txt', status: 'added' },
          { file: 'file-2.txt', status: 'added' },
          { file: 'file-3.txt', status: 'added' },
        ]);

        for (let i = 0; i < 4; i++) {
          writeFile(workspaceDir, `file-${i}.txt`, 'modified');
        }
        const cp = await cm.createCheckpoint('local', [
          { file: 'file-0.txt', status: 'modified' },
          { file: 'file-1.txt', status: 'modified' },
          { file: 'file-2.txt', status: 'modified' },
          { file: 'file-3.txt', status: 'modified' },
        ]);

        expect(cp!.isMajor).toBe(true);
      });
    });

    it('source tags round-trip through getCheckpoints', async () => {
      writeFile(workspaceDir, 'a.gts', 'a');
      await cm.createCheckpoint('remote', [{ file: 'a.gts', status: 'added' }]);

      writeFile(workspaceDir, 'b.gts', 'b');
      await cm.createCheckpoint('local', [{ file: 'b.gts', status: 'added' }]);

      writeFile(workspaceDir, 'c.gts', 'c');
      await cm.createCheckpoint('manual', [{ file: 'c.gts', status: 'added' }]);

      const sources = (await cm.getCheckpoints()).map((c) => c.source);
      expect(sources).toContain('remote');
      expect(sources).toContain('local');
      expect(sources).toContain('manual');
    });
  });

  describe('history retrieval', () => {
    it('returns [] when uninitialized', async () => {
      expect(await cm.getCheckpoints()).toEqual([]);
    });

    it('respects the limit', async () => {
      for (let i = 0; i < 5; i++) {
        writeFile(workspaceDir, `a${i}.gts`, String(i));
        await cm.createCheckpoint('manual', [
          { file: `a${i}.gts`, status: 'added' },
        ]);
      }

      const limited = await cm.getCheckpoints(2);
      expect(limited.length).toBe(2);
    });

    it('getChangedFiles returns the files in a commit', async () => {
      writeFile(workspaceDir, 'a.gts', 'a');
      const cp = await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'added' },
      ]);

      const files = await cm.getChangedFiles(cp!.hash);
      expect(files).toContain('a.gts');
    });

    it('getDiff returns a non-empty string mentioning the file', async () => {
      writeFile(workspaceDir, 'a.gts', 'hello');
      const cp = await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'added' },
      ]);

      const diff = await cm.getDiff(cp!.hash);
      expect(diff.length).toBeGreaterThan(0);
      expect(diff).toContain('a.gts');
    });
  });

  describe('restore', () => {
    it('restores a previous checkpoint state', async () => {
      writeFile(workspaceDir, 'a.gts', 'original');
      const first = await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'added' },
      ]);

      fs.unlinkSync(path.join(workspaceDir, 'a.gts'));
      writeFile(workspaceDir, 'b.gts', 'b');
      await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'deleted' },
        { file: 'b.gts', status: 'added' },
      ]);

      await cm.restore(first!.hash);

      expect(fs.existsSync(path.join(workspaceDir, 'a.gts'))).toBe(true);
      expect(fs.readFileSync(path.join(workspaceDir, 'a.gts'), 'utf8')).toBe(
        'original',
      );
      expect(fs.existsSync(path.join(workspaceDir, 'b.gts'))).toBe(false);
    });

    it('does not remove protected files during restore', async () => {
      writeFile(workspaceDir, 'a.gts', 'a');
      const first = await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'added' },
      ]);

      // .realm.json is a protected file but is a dotfile, so it would not be
      // picked up by the workspace scan. Put it there anyway — restore must
      // not delete it even though it is not in the target checkpoint.
      writeFile(workspaceDir, '.realm.json', '{"name":"x"}');

      await cm.restore(first!.hash);

      expect(fs.existsSync(path.join(workspaceDir, '.realm.json'))).toBe(true);
    });
  });

  describe('milestones', () => {
    let firstHash: string;

    beforeEach(async () => {
      writeFile(workspaceDir, 'a.gts', 'a');
      const cp = await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'added' },
      ]);
      firstHash = cp!.hash;
    });

    it('markMilestone by hash returns { hash, name }', async () => {
      const res = await cm.markMilestone(firstHash, 'release-1');
      expect(res).toEqual({ hash: firstHash, name: 'release-1' });
    });

    it('markMilestone by index resolves the correct hash', async () => {
      const res = await cm.markMilestone(1, 'latest');
      expect(res?.hash).toBe(firstHash);
    });

    it('markMilestone with out-of-range index returns null', async () => {
      expect(await cm.markMilestone(99, 'bad')).toBeNull();
    });

    it('getMilestones returns only tagged checkpoints', async () => {
      await cm.markMilestone(firstHash, 'release-1');
      const milestones = await cm.getMilestones();

      expect(milestones.length).toBe(1);
      expect(milestones[0].hash).toBe(firstHash);
      expect(milestones[0].milestoneName).toBe('release 1');
    });

    it('getMilestones returns milestones beyond the most recent 100 checkpoints', async () => {
      // Tag the earliest checkpoint, then bury it under 120 more checkpoints.
      // The old implementation walked `getCheckpoints(100)` and would miss it.
      await cm.markMilestone(firstHash, 'ancient');
      for (let i = 0; i < 120; i++) {
        writeFile(workspaceDir, `f${i}.gts`, String(i));
        await cm.createCheckpoint('manual', [
          { file: `f${i}.gts`, status: 'added' },
        ]);
      }

      const milestones = await cm.getMilestones();
      expect(milestones.length).toBe(1);
      expect(milestones[0].hash).toBe(firstHash);
      expect(milestones[0].milestoneName).toBe('ancient');
    });

    it('unmarkMilestone removes the tag; second call returns false', async () => {
      await cm.markMilestone(firstHash, 'release-1');
      expect(await cm.unmarkMilestone(firstHash)).toBe(true);
      expect(await cm.unmarkMilestone(firstHash)).toBe(false);
    });

    it('unmarkMilestone on uninitialized workspace returns false', async () => {
      const empty = new CheckpointManager(
        fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-cp-empty-')),
      );
      expect(await empty.unmarkMilestone('deadbeef')).toBe(false);
    });
  });
});
