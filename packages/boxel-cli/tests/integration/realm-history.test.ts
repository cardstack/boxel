import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CheckpointManager } from '../../src/lib/checkpoint-manager.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// `boxel realm history <local-dir>` views, creates, and restores local
// checkpoints in the workspace's `.boxel-history/` git repo — pure local,
// no realm server. We drive the installed binary; checkpoint setup and
// on-disk verification stay in-process via `CheckpointManager` (the command
// has no `--json`, so its own output is asserted from stdout/stderr).

let workspaceDir: string;

function writeFile(relPath: string, content: string): void {
  let full = path.join(workspaceDir, relPath);
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
      let res = await runBoxel(['realm', 'history', workspaceDir]);
      expect(res.ok, res.stderr).toBe(true);
      expect(res.stdout).toContain('No checkpoints found.');
    });

    it('lists checkpoints in reverse-chronological order', async () => {
      let cm = new CheckpointManager(workspaceDir);
      writeFile('a.gts', 'first');
      let manual = await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'added' },
      ]);
      writeFile('b.gts', 'second');
      let local = await cm.createCheckpoint('local', [
        { file: 'b.gts', status: 'added' },
      ]);

      let res = await runBoxel(['realm', 'history', workspaceDir]);

      expect(res.ok, res.stderr).toBe(true);
      // Newest-first: the local checkpoint is listed before the manual one.
      expect(res.stdout).toContain(local!.shortHash);
      expect(res.stdout).toContain(manual!.shortHash);
      expect(res.stdout.indexOf(local!.shortHash)).toBeLessThan(
        res.stdout.indexOf(manual!.shortHash),
      );
      // truncated=false → no truncation note.
      expect(res.stdout).not.toContain('Showing first');
    });

    it('returns truncated=true when checkpoints exceed limit', async () => {
      let cm = new CheckpointManager(workspaceDir);
      writeFile('a.gts', '1');
      let cp1 = await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'added' },
      ]);
      writeFile('a.gts', '2');
      let cp2 = await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'modified' },
      ]);
      writeFile('a.gts', '3');
      let cp3 = await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'modified' },
      ]);

      let capped = await runBoxel([
        'realm',
        'history',
        workspaceDir,
        '--limit',
        '2',
      ]);
      expect(capped.ok, capped.stderr).toBe(true);
      // Newest two are shown, the oldest omitted, and truncation is noted.
      expect(capped.stdout).toContain(cp3!.shortHash);
      expect(capped.stdout).toContain(cp2!.shortHash);
      expect(capped.stdout).not.toContain(cp1!.shortHash);
      expect(capped.stdout).toContain('Showing first 2 checkpoints');

      let all = await runBoxel([
        'realm',
        'history',
        workspaceDir,
        '--limit',
        '10',
      ]);
      expect(all.ok, all.stderr).toBe(true);
      expect(all.stdout).toContain(cp1!.shortHash);
      expect(all.stdout).toContain(cp2!.shortHash);
      expect(all.stdout).toContain(cp3!.shortHash);
      expect(all.stdout).not.toContain('Showing first');
    });
  });

  describe('manual checkpoint (-m)', () => {
    it('creates a checkpoint with the provided message', async () => {
      writeFile('a.gts', 'a');

      let res = await runBoxel([
        'realm',
        'history',
        workspaceDir,
        '-m',
        'before cleanup',
      ]);
      expect(res.ok, res.stderr).toBe(true);

      let cps = await new CheckpointManager(workspaceDir).getCheckpoints();
      expect(cps[0].message.trim()).toBe('before cleanup');
      expect(cps[0].source).toBe('manual');
    });

    it('initializes the history repo on first use', async () => {
      writeFile('a.gts', 'a');
      let historyDir = path.join(workspaceDir, '.boxel-history', '.git');
      expect(fs.existsSync(historyDir)).toBe(false);

      let res = await runBoxel([
        'realm',
        'history',
        workspaceDir,
        '-m',
        'first',
      ]);

      expect(res.ok, res.stderr).toBe(true);
      expect(fs.existsSync(historyDir)).toBe(true);
    });

    it('returns an error when there are no changes to checkpoint', async () => {
      writeFile('a.gts', 'a');
      let first = await runBoxel([
        'realm',
        'history',
        workspaceDir,
        '-m',
        'first',
      ]);
      expect(first.ok, first.stderr).toBe(true);

      let res = await runBoxel([
        'realm',
        'history',
        workspaceDir,
        '-m',
        'second',
      ]);

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('No changes to checkpoint');
    });

    it('rejects an empty message', async () => {
      writeFile('a.gts', 'a');
      let res = await runBoxel(['realm', 'history', workspaceDir, '-m', '   ']);
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('--message must not be empty');
    });
  });

  describe('restore (-r)', () => {
    it('restores by 1-based index', async () => {
      let cm = new CheckpointManager(workspaceDir);
      writeFile('a.gts', 'original');
      await cm.createCheckpoint('manual', [{ file: 'a.gts', status: 'added' }]);
      writeFile('a.gts', 'modified');
      writeFile('b.gts', 'b');
      await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'modified' },
        { file: 'b.gts', status: 'added' },
      ]);

      // Index 2 is the older "original" checkpoint; getCheckpoints is newest-first.
      // Non-interactive stdin isn't a TTY, so `--restore` requires `--yes`.
      let res = await runBoxel([
        'realm',
        'history',
        workspaceDir,
        '-r',
        '2',
        '-y',
      ]);

      expect(res.ok, res.stderr).toBe(true);
      expect(fs.readFileSync(path.join(workspaceDir, 'a.gts'), 'utf8')).toBe(
        'original',
      );
      expect(fs.existsSync(path.join(workspaceDir, 'b.gts'))).toBe(false);
    });

    it('restores by short hash', async () => {
      let cm = new CheckpointManager(workspaceDir);
      writeFile('a.gts', 'original');
      let target = await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'added' },
      ]);
      writeFile('a.gts', 'modified');
      await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'modified' },
      ]);

      let res = await runBoxel([
        'realm',
        'history',
        workspaceDir,
        '-r',
        target!.shortHash,
        '-y',
      ]);

      expect(res.ok, res.stderr).toBe(true);
      expect(res.stdout).toContain(target!.shortHash);
      expect(fs.readFileSync(path.join(workspaceDir, 'a.gts'), 'utf8')).toBe(
        'original',
      );
    });

    it('restores by full hash', async () => {
      let cm = new CheckpointManager(workspaceDir);
      writeFile('a.gts', 'original');
      let target = await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'added' },
      ]);
      writeFile('a.gts', 'modified');
      await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'modified' },
      ]);

      expect(target!.hash.length).toBe(40);
      let res = await runBoxel([
        'realm',
        'history',
        workspaceDir,
        '-r',
        target!.hash,
        '-y',
      ]);

      expect(res.ok, res.stderr).toBe(true);
      expect(res.stdout).toContain(target!.shortHash);
      expect(fs.readFileSync(path.join(workspaceDir, 'a.gts'), 'utf8')).toBe(
        'original',
      );
    });

    it('returns an error for an out-of-range numeric index', async () => {
      let cm = new CheckpointManager(workspaceDir);
      writeFile('a.gts', 'a');
      await cm.createCheckpoint('manual', [{ file: 'a.gts', status: 'added' }]);
      writeFile('b.gts', 'b');
      await cm.createCheckpoint('manual', [{ file: 'b.gts', status: 'added' }]);

      // Digit-only refs are always treated as index lookups; they must not
      // silently match a short hash whose prefix happens to be digits.
      let res = await runBoxel([
        'realm',
        'history',
        workspaceDir,
        '-r',
        '99',
        '-y',
      ]);

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('Checkpoint not found');
    });

    it('preserves untracked dotfiles across restore', async () => {
      let cm = new CheckpointManager(workspaceDir);
      writeFile('a.gts', 'original');
      let target = await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'added' },
      ]);
      writeFile('.gitkeep', 'marker');
      writeFile('a.gts', 'modified');
      await cm.createCheckpoint('manual', [
        { file: 'a.gts', status: 'modified' },
      ]);

      let res = await runBoxel([
        'realm',
        'history',
        workspaceDir,
        '-r',
        target!.shortHash,
        '-y',
      ]);

      expect(res.ok, res.stderr).toBe(true);
      let dotfilePath = path.join(workspaceDir, '.gitkeep');
      expect(fs.existsSync(dotfilePath)).toBe(true);
      expect(fs.readFileSync(dotfilePath, 'utf8')).toBe('marker');
    });

    it('returns an error for an invalid reference', async () => {
      let cm = new CheckpointManager(workspaceDir);
      writeFile('a.gts', 'a');
      await cm.createCheckpoint('manual', [{ file: 'a.gts', status: 'added' }]);

      let res = await runBoxel([
        'realm',
        'history',
        workspaceDir,
        '-r',
        'deadbeef',
        '-y',
      ]);

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('Checkpoint not found');
    });

    it('returns an error when the workspace has no history', async () => {
      let res = await runBoxel([
        'realm',
        'history',
        workspaceDir,
        '-r',
        '1',
        '-y',
      ]);
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('No checkpoint history');
    });

    it('rejects an empty restore ref instead of restoring the newest', async () => {
      let cm = new CheckpointManager(workspaceDir);
      writeFile('a.gts', 'a');
      await cm.createCheckpoint('manual', [{ file: 'a.gts', status: 'added' }]);
      writeFile('b.gts', 'b');
      await cm.createCheckpoint('manual', [{ file: 'b.gts', status: 'added' }]);

      let res = await runBoxel([
        'realm',
        'history',
        workspaceDir,
        '-r',
        '',
        '-y',
      ]);

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('Checkpoint not found');
      expect(fs.existsSync(path.join(workspaceDir, 'b.gts'))).toBe(true);
    });

    it('rejects a whitespace-only restore ref', async () => {
      let cm = new CheckpointManager(workspaceDir);
      writeFile('a.gts', 'a');
      await cm.createCheckpoint('manual', [{ file: 'a.gts', status: 'added' }]);

      let res = await runBoxel([
        'realm',
        'history',
        workspaceDir,
        '-r',
        '   ',
        '-y',
      ]);

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('Checkpoint not found');
    });

    it('rejects an ambiguous hash prefix', async () => {
      let cm = new CheckpointManager(workspaceDir);
      // Create enough checkpoints that some non-digit hex prefix collides.
      // Digit-only refs are treated as index lookups, not hash prefixes.
      for (let i = 0; i < 40; i++) {
        writeFile('a.gts', `v${i}`);
        await cm.createCheckpoint('manual', [
          { file: 'a.gts', status: i === 0 ? 'added' : 'modified' },
        ]);
      }
      let cps = await cm.getCheckpoints(100);
      let counts = new Map<string, number>();
      for (let cp of cps) {
        let c = cp.hash[0];
        if (/[a-f]/.test(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      let ambiguousPrefix = [...counts.entries()].find(([, n]) => n >= 2)?.[0];
      expect(ambiguousPrefix).toBeDefined();

      let res = await runBoxel([
        'realm',
        'history',
        workspaceDir,
        '-r',
        ambiguousPrefix!,
        '-y',
      ]);

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('Ambiguous reference');
    });
  });

  describe('argument validation', () => {
    it('rejects a missing workspace directory', async () => {
      let res = await runBoxel([
        'realm',
        'history',
        path.join(workspaceDir, 'does-not-exist'),
      ]);
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('Directory not found');
    });

    it('rejects --restore and --message together', async () => {
      let res = await runBoxel([
        'realm',
        'history',
        workspaceDir,
        '-r',
        '1',
        '-m',
        'oops',
      ]);
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('Only one of --restore or --message');
    });

    it.each([
      ['zero', '0'],
      ['negative', '-1'],
      ['non-integer', '1.5'],
      ['NaN', 'NaN'],
    ])('rejects an invalid limit (%s)', async (_name, limit) => {
      // `--limit=<v>` binds the value so a leading-`-` value isn't parsed as
      // a flag; all four are rejected by the CLI's positive-integer check.
      let res = await runBoxel([
        'realm',
        'history',
        workspaceDir,
        `--limit=${limit}`,
      ]);
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('positive integer');
    });
  });
});
