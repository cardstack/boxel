import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { realmMilestone } from '../../src/commands/realm/milestone.ts';
import { CheckpointManager } from '../../src/lib/checkpoint-manager.ts';

let workspaceDir: string;

function writeFile(relPath: string, content: string): void {
  const full = path.join(workspaceDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

async function makeCheckpoint(
  cm: CheckpointManager,
  file: string,
  content: string,
  source: 'manual' | 'local' | 'remote' = 'manual',
): Promise<string> {
  writeFile(file, content);
  const cp = await cm.createCheckpoint(source, [{ file, status: 'added' }]);
  return cp!.hash;
}

beforeEach(() => {
  workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-milestone-int-'));
});

afterEach(() => {
  fs.rmSync(workspaceDir, { recursive: true, force: true });
});

describe('realm milestone (integration)', () => {
  describe('list mode (no options)', () => {
    it('returns empty list for uninitialized workspace', async () => {
      const result = await realmMilestone(workspaceDir);
      expect(result.ok).toBe(true);
      expect(result.milestones).toEqual([]);
    });

    it('returns empty list when no milestones are marked', async () => {
      const cm = new CheckpointManager(workspaceDir);
      await makeCheckpoint(cm, 'a.gts', 'a');

      const result = await realmMilestone(workspaceDir);
      expect(result.ok).toBe(true);
      expect(result.milestones).toEqual([]);
    });

    it('returns milestones with correct names', async () => {
      const cm = new CheckpointManager(workspaceDir);
      const hash = await makeCheckpoint(cm, 'a.gts', 'a');
      await cm.markMilestone(hash, 'v1.0');

      const result = await realmMilestone(workspaceDir);
      expect(result.ok).toBe(true);
      expect(result.milestones).toHaveLength(1);
      expect(result.milestones![0].isMilestone).toBe(true);
      expect(result.milestones![0].milestoneName).toBe('v1.0');
    });

    it('returns multiple milestones', async () => {
      const cm = new CheckpointManager(workspaceDir);
      const h1 = await makeCheckpoint(cm, 'a.gts', 'a');
      const h2 = await makeCheckpoint(cm, 'b.gts', 'b');
      await cm.markMilestone(h1, 'first');
      await cm.markMilestone(h2, 'second');

      const result = await realmMilestone(workspaceDir);
      expect(result.ok).toBe(true);
      expect(result.milestones).toHaveLength(2);
    });

    it('returns error for non-existent directory', async () => {
      const missing = fs.mkdtempSync(
        path.join(os.tmpdir(), 'boxel-milestone-missing-'),
      );
      fs.rmSync(missing, { recursive: true, force: true });

      const result = await realmMilestone(missing);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/directory not found/i);
    });
  });

  describe('mark mode (--mark + --name)', () => {
    it('marks a checkpoint by hash and returns it', async () => {
      const cm = new CheckpointManager(workspaceDir);
      const hash = await makeCheckpoint(cm, 'a.gts', 'a');

      const result = await realmMilestone(workspaceDir, {
        mark: hash,
        name: 'release-1',
      });

      expect(result.ok).toBe(true);
      expect(result.marked).toBeDefined();
      expect(result.marked!.isMilestone).toBe(true);
      expect(result.marked!.milestoneName).toBe('release 1');
    });

    it('marks a checkpoint by 1-based index', async () => {
      const cm = new CheckpointManager(workspaceDir);
      await makeCheckpoint(cm, 'a.gts', 'a');

      const result = await realmMilestone(workspaceDir, {
        mark: '1',
        name: 'first',
      });

      expect(result.ok).toBe(true);
      expect(result.marked).toBeDefined();
      expect(result.marked!.isMilestone).toBe(true);
    });

    it('marks a checkpoint by short hash', async () => {
      const cm = new CheckpointManager(workspaceDir);
      const hash = await makeCheckpoint(cm, 'a.gts', 'a');
      const shortHash = hash.substring(0, 7);

      const result = await realmMilestone(workspaceDir, {
        mark: shortHash,
        name: 'short-ref',
      });

      expect(result.ok).toBe(true);
      expect(result.marked).toBeDefined();
    });

    it('returns error when --name is missing', async () => {
      const result = await realmMilestone(workspaceDir, { mark: '1' });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/--name is required/i);
    });

    it('returns error when --name is empty', async () => {
      const cm = new CheckpointManager(workspaceDir);
      await makeCheckpoint(cm, 'a.gts', 'a');

      const result = await realmMilestone(workspaceDir, {
        mark: '1',
        name: '   ',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/--name must not be empty/i);
    });

    it('returns error for out-of-range index', async () => {
      const cm = new CheckpointManager(workspaceDir);
      await makeCheckpoint(cm, 'a.gts', 'a');

      const result = await realmMilestone(workspaceDir, {
        mark: '99',
        name: 'nope',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    it('returns error when no checkpoint history exists', async () => {
      const result = await realmMilestone(workspaceDir, {
        mark: '1',
        name: 'x',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/no checkpoint history/i);
    });
  });

  describe('remove mode (--remove)', () => {
    it('removes a milestone by hash', async () => {
      const cm = new CheckpointManager(workspaceDir);
      const hash = await makeCheckpoint(cm, 'a.gts', 'a');
      await cm.markMilestone(hash, 'v1');

      const result = await realmMilestone(workspaceDir, { remove: hash });
      expect(result.ok).toBe(true);
      expect(result.removed).toBe(true);

      const after = await realmMilestone(workspaceDir);
      expect(after.milestones).toHaveLength(0);
    });

    it('removes a milestone by index', async () => {
      const cm = new CheckpointManager(workspaceDir);
      const hash = await makeCheckpoint(cm, 'a.gts', 'a');
      await cm.markMilestone(hash, 'v1');

      const result = await realmMilestone(workspaceDir, { remove: '1' });
      expect(result.ok).toBe(true);
      expect(result.removed).toBe(true);
    });

    it('returns error when checkpoint is not a milestone', async () => {
      const cm = new CheckpointManager(workspaceDir);
      const hash = await makeCheckpoint(cm, 'a.gts', 'a');

      const result = await realmMilestone(workspaceDir, { remove: hash });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not marked as a milestone/i);
    });

    it('returns error for unknown ref', async () => {
      const cm = new CheckpointManager(workspaceDir);
      await makeCheckpoint(cm, 'a.gts', 'a');

      const result = await realmMilestone(workspaceDir, { remove: '99' });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });
  });

  describe('validation', () => {
    it('returns error when --mark and --remove are both set', async () => {
      const result = await realmMilestone(workspaceDir, {
        mark: '1',
        name: 'x',
        remove: '1',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/only one of/i);
    });

    it('returns error for non-positive limit', async () => {
      const result = await realmMilestone(workspaceDir, { limit: 0 });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/limit/i);
    });
  });
});
