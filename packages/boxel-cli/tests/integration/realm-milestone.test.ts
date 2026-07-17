import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CheckpointManager } from '../../src/lib/checkpoint-manager.ts';
import type { MilestoneResult } from '../../src/commands/realm/milestone.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// `boxel realm milestone <local-dir>` lists, marks, and removes milestones in
// the workspace's local `.boxel-history/` checkpoint log — pure local, no
// realm server. We drive the installed binary; checkpoint/milestone setup
// stays in-process via `CheckpointManager`. The command supports `--json`, so
// its result payload is read back with `res.json()` (structured errors ride
// stdout under `--json`; argv-level guards still bail out on stderr).

let workspaceDir: string;

function writeFile(relPath: string, content: string): void {
  let full = path.join(workspaceDir, relPath);
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
  let cp = await cm.createCheckpoint(source, [{ file, status: 'added' }]);
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
      let res = await runBoxel(['realm', 'milestone', workspaceDir, '--json']);
      expect(res.ok, res.stderr).toBe(true);
      let result = res.json<MilestoneResult>();
      expect(result.ok).toBe(true);
      expect(result.milestones).toEqual([]);
    });

    it('returns empty list when no milestones are marked', async () => {
      let cm = new CheckpointManager(workspaceDir);
      await makeCheckpoint(cm, 'a.gts', 'a');

      let res = await runBoxel(['realm', 'milestone', workspaceDir, '--json']);
      expect(res.ok, res.stderr).toBe(true);
      let result = res.json<MilestoneResult>();
      expect(result.ok).toBe(true);
      expect(result.milestones).toEqual([]);
    });

    it('returns milestones with correct names', async () => {
      let cm = new CheckpointManager(workspaceDir);
      let hash = await makeCheckpoint(cm, 'a.gts', 'a');
      await cm.markMilestone(hash, 'v1.0');

      let res = await runBoxel(['realm', 'milestone', workspaceDir, '--json']);
      expect(res.ok, res.stderr).toBe(true);
      let result = res.json<MilestoneResult>();
      expect(result.milestones).toHaveLength(1);
      expect(result.milestones![0].isMilestone).toBe(true);
      expect(result.milestones![0].milestoneName).toBe('v1.0');
    });

    it('returns multiple milestones', async () => {
      let cm = new CheckpointManager(workspaceDir);
      let h1 = await makeCheckpoint(cm, 'a.gts', 'a');
      let h2 = await makeCheckpoint(cm, 'b.gts', 'b');
      await cm.markMilestone(h1, 'first');
      await cm.markMilestone(h2, 'second');

      let res = await runBoxel(['realm', 'milestone', workspaceDir, '--json']);
      expect(res.ok, res.stderr).toBe(true);
      let result = res.json<MilestoneResult>();
      expect(result.milestones).toHaveLength(2);
    });

    it('returns error for non-existent directory', async () => {
      let missing = fs.mkdtempSync(
        path.join(os.tmpdir(), 'boxel-milestone-missing-'),
      );
      fs.rmSync(missing, { recursive: true, force: true });

      let res = await runBoxel(['realm', 'milestone', missing, '--json']);
      expect(res.exitCode).toBe(1);
      expect(res.json<MilestoneResult>().error).toMatch(/directory not found/i);
    });
  });

  describe('mark mode (--mark + --name)', () => {
    it('marks a checkpoint by hash and returns it', async () => {
      let cm = new CheckpointManager(workspaceDir);
      let hash = await makeCheckpoint(cm, 'a.gts', 'a');

      let res = await runBoxel([
        'realm',
        'milestone',
        workspaceDir,
        '--mark',
        hash,
        '--name',
        'release-1',
        '--json',
      ]);

      expect(res.ok, res.stderr).toBe(true);
      let result = res.json<MilestoneResult>();
      expect(result.marked).toBeDefined();
      expect(result.marked!.isMilestone).toBe(true);
      expect(result.marked!.milestoneName).toBe('release 1');
    });

    it('marks a checkpoint by 1-based index', async () => {
      let cm = new CheckpointManager(workspaceDir);
      await makeCheckpoint(cm, 'a.gts', 'a');

      let res = await runBoxel([
        'realm',
        'milestone',
        workspaceDir,
        '--mark',
        '1',
        '--name',
        'first',
        '--json',
      ]);

      expect(res.ok, res.stderr).toBe(true);
      let result = res.json<MilestoneResult>();
      expect(result.marked).toBeDefined();
      expect(result.marked!.isMilestone).toBe(true);
    });

    it('marks a checkpoint by short hash', async () => {
      let cm = new CheckpointManager(workspaceDir);
      let hash = await makeCheckpoint(cm, 'a.gts', 'a');
      let shortHash = hash.substring(0, 7);

      let res = await runBoxel([
        'realm',
        'milestone',
        workspaceDir,
        '--mark',
        shortHash,
        '--name',
        'short-ref',
        '--json',
      ]);

      expect(res.ok, res.stderr).toBe(true);
      expect(res.json<MilestoneResult>().marked).toBeDefined();
    });

    it('returns error when --name is missing', async () => {
      // The missing-`--name` guard bails out on stderr before the `--json`
      // branch, so there's no JSON payload to parse here.
      let res = await runBoxel([
        'realm',
        'milestone',
        workspaceDir,
        '--mark',
        '1',
      ]);
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toMatch(/--name is required/i);
    });

    it('returns error when --name is empty', async () => {
      let cm = new CheckpointManager(workspaceDir);
      await makeCheckpoint(cm, 'a.gts', 'a');

      let res = await runBoxel([
        'realm',
        'milestone',
        workspaceDir,
        '--mark',
        '1',
        '--name',
        '   ',
        '--json',
      ]);
      expect(res.exitCode).toBe(1);
      expect(res.json<MilestoneResult>().error).toMatch(
        /--name must not be empty/i,
      );
    });

    it('returns error for out-of-range index', async () => {
      let cm = new CheckpointManager(workspaceDir);
      await makeCheckpoint(cm, 'a.gts', 'a');

      let res = await runBoxel([
        'realm',
        'milestone',
        workspaceDir,
        '--mark',
        '99',
        '--name',
        'nope',
        '--json',
      ]);
      expect(res.exitCode).toBe(1);
      expect(res.json<MilestoneResult>().error).toMatch(/not found/i);
    });

    it('returns error when no checkpoint history exists', async () => {
      let res = await runBoxel([
        'realm',
        'milestone',
        workspaceDir,
        '--mark',
        '1',
        '--name',
        'x',
        '--json',
      ]);
      expect(res.exitCode).toBe(1);
      expect(res.json<MilestoneResult>().error).toMatch(
        /no checkpoint history/i,
      );
    });
  });

  describe('remove mode (--remove)', () => {
    it('removes a milestone by hash', async () => {
      let cm = new CheckpointManager(workspaceDir);
      let hash = await makeCheckpoint(cm, 'a.gts', 'a');
      await cm.markMilestone(hash, 'v1');

      let res = await runBoxel([
        'realm',
        'milestone',
        workspaceDir,
        '--remove',
        hash,
        '--json',
      ]);
      expect(res.ok, res.stderr).toBe(true);
      expect(res.json<MilestoneResult>().removed).toBe(true);

      let after = await runBoxel([
        'realm',
        'milestone',
        workspaceDir,
        '--json',
      ]);
      expect(after.ok, after.stderr).toBe(true);
      expect(after.json<MilestoneResult>().milestones).toHaveLength(0);
    });

    it('removes a milestone by index', async () => {
      let cm = new CheckpointManager(workspaceDir);
      let hash = await makeCheckpoint(cm, 'a.gts', 'a');
      await cm.markMilestone(hash, 'v1');

      let res = await runBoxel([
        'realm',
        'milestone',
        workspaceDir,
        '--remove',
        '1',
        '--json',
      ]);
      expect(res.ok, res.stderr).toBe(true);
      expect(res.json<MilestoneResult>().removed).toBe(true);
    });

    it('returns error when checkpoint is not a milestone', async () => {
      let cm = new CheckpointManager(workspaceDir);
      let hash = await makeCheckpoint(cm, 'a.gts', 'a');

      let res = await runBoxel([
        'realm',
        'milestone',
        workspaceDir,
        '--remove',
        hash,
        '--json',
      ]);
      expect(res.exitCode).toBe(1);
      expect(res.json<MilestoneResult>().error).toMatch(
        /not marked as a milestone/i,
      );
    });

    it('returns error for unknown ref', async () => {
      let cm = new CheckpointManager(workspaceDir);
      await makeCheckpoint(cm, 'a.gts', 'a');

      let res = await runBoxel([
        'realm',
        'milestone',
        workspaceDir,
        '--remove',
        '99',
        '--json',
      ]);
      expect(res.exitCode).toBe(1);
      expect(res.json<MilestoneResult>().error).toMatch(/not found/i);
    });
  });

  describe('validation', () => {
    it('returns error when --mark and --remove are both set', async () => {
      // Bails out on stderr before the `--json` branch.
      let res = await runBoxel([
        'realm',
        'milestone',
        workspaceDir,
        '--mark',
        '1',
        '--name',
        'x',
        '--remove',
        '1',
      ]);
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toMatch(/only one of/i);
    });

    it('returns error for non-positive limit', async () => {
      let res = await runBoxel([
        'realm',
        'milestone',
        workspaceDir,
        '--limit',
        '0',
      ]);
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toMatch(/limit/i);
    });
  });
});
