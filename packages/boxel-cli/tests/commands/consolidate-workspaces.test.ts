import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { consolidateWorkspacesCommand } from '../../src/commands/consolidate-workspaces.js';

function writeManifest(dir: string, realmUrl: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.boxel-sync.json'),
    JSON.stringify({ realmUrl, files: {} }),
  );
}

describe('consolidateWorkspacesCommand', () => {
  let tmpRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-consolidate-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('moves a legacy-layout directory into the canonical <domain>/<owner>/<realm> path', async () => {
    const legacyDir = path.join(tmpRoot, 'old-notes');
    writeManifest(legacyDir, 'https://stack.cards/alice/notes');

    await consolidateWorkspacesCommand(tmpRoot, {});

    const targetDir = path.join(tmpRoot, 'stack.cards', 'alice', 'notes');
    expect(fs.existsSync(targetDir)).toBe(true);
    expect(fs.existsSync(path.join(targetDir, '.boxel-sync.json'))).toBe(true);
    expect(fs.existsSync(legacyDir)).toBe(false);
  });

  it('does not move anything when --dry-run is set', async () => {
    const legacyDir = path.join(tmpRoot, 'old-notes');
    writeManifest(legacyDir, 'https://stack.cards/alice/notes');

    await consolidateWorkspacesCommand(tmpRoot, { dryRun: true });

    expect(fs.existsSync(legacyDir)).toBe(true);
    expect(
      fs.existsSync(path.join(tmpRoot, 'stack.cards', 'alice', 'notes')),
    ).toBe(false);
    expect(
      logSpy.mock.calls.some((args) =>
        String(args[0] ?? '').includes('[DRY RUN]'),
      ),
    ).toBe(true);
  });

  it('reports "no misplaced" and moves nothing when all dirs are already canonical', async () => {
    const canonicalDir = path.join(tmpRoot, 'stack.cards', 'alice', 'notes');
    writeManifest(canonicalDir, 'https://stack.cards/alice/notes');

    await consolidateWorkspacesCommand(tmpRoot, {});

    expect(fs.existsSync(canonicalDir)).toBe(true);
    expect(
      logSpy.mock.calls.some((args) =>
        String(args[0] ?? '')
          .toLowerCase()
          .includes('no misplaced'),
      ),
    ).toBe(true);
  });

  it('skips an entry whose target path already exists and continues with others', async () => {
    // misplaced-a points at the same canonical destination as existing-target,
    // which already lives at the canonical path. misplaced-b's destination is free.
    const occupiedTarget = path.join(tmpRoot, 'stack.cards', 'alice', 'notes');
    writeManifest(occupiedTarget, 'https://stack.cards/alice/notes');

    const conflictDir = path.join(tmpRoot, 'misplaced-a');
    writeManifest(conflictDir, 'https://stack.cards/alice/notes');

    const freeMisplacedDir = path.join(tmpRoot, 'misplaced-b');
    writeManifest(freeMisplacedDir, 'https://stack.cards/bob/other');

    await consolidateWorkspacesCommand(tmpRoot, {});

    // The conflicting source remains in place — destination was occupied.
    expect(fs.existsSync(conflictDir)).toBe(true);
    // The free one moved to its canonical destination.
    expect(fs.existsSync(freeMisplacedDir)).toBe(false);
    expect(
      fs.existsSync(path.join(tmpRoot, 'stack.cards', 'bob', 'other')),
    ).toBe(true);
    // A skip warning was emitted for the conflict.
    expect(
      warnSpy.mock.calls.some((args) =>
        String(args[0] ?? '')
          .toLowerCase()
          .includes('target path already exists'),
      ),
    ).toBe(true);
  });

  it('does not throw when the root directory does not exist', async () => {
    const missing = path.join(tmpRoot, 'does-not-exist');

    await expect(
      consolidateWorkspacesCommand(missing, {}),
    ).resolves.toBeUndefined();
  });
});
