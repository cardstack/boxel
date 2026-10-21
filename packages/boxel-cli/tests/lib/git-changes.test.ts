import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { listChangedSince } from '../../src/lib/git-changes.ts';

function writeFile(dir: string, relPath: string, content: string): void {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function git(dir: string, ...args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: dir, encoding: 'utf8' },
  ).trim();
}

function commitAll(dir: string, message: string): string {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

describe('listChangedSince', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-git-changes-'));
    git(repoDir, 'init', '-q');
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('lists files modified, added, deleted and renamed since the revision', async () => {
    writeFile(repoDir, 'kept.gts', 'kept');
    writeFile(repoDir, 'edited.gts', 'before');
    writeFile(repoDir, 'removed.json', '{}');
    writeFile(repoDir, 'old-name.md', 'moved');
    let base = commitAll(repoDir, 'base');

    writeFile(repoDir, 'edited.gts', 'after');
    writeFile(repoDir, 'dir/added.json', '{}');
    fs.rmSync(path.join(repoDir, 'removed.json'));
    fs.renameSync(
      path.join(repoDir, 'old-name.md'),
      path.join(repoDir, 'new-name.md'),
    );
    commitAll(repoDir, 'changes');

    let changed = await listChangedSince(repoDir, base);

    expect([...changed].sort()).toEqual([
      'dir/added.json',
      'edited.gts',
      'new-name.md',
      'old-name.md',
      'removed.json',
    ]);
  });

  it('includes uncommitted edits and untracked files, but not ignored ones', async () => {
    writeFile(repoDir, '.gitignore', 'ignored.txt\n');
    writeFile(repoDir, 'tracked.gts', 'before');
    let base = commitAll(repoDir, 'base');

    writeFile(repoDir, 'tracked.gts', 'after');
    writeFile(repoDir, 'untracked.json', '{}');
    writeFile(repoDir, 'ignored.txt', 'x');

    let changed = await listChangedSince(repoDir, base);

    expect([...changed].sort()).toEqual(['tracked.gts', 'untracked.json']);
  });

  it('answers paths relative to a subdirectory of the repository', async () => {
    writeFile(repoDir, 'outside.gts', 'before');
    writeFile(repoDir, 'realm/inside.gts', 'before');
    let base = commitAll(repoDir, 'base');

    writeFile(repoDir, 'outside.gts', 'after');
    writeFile(repoDir, 'realm/inside.gts', 'after');
    writeFile(repoDir, 'realm/new.json', '{}');

    let changed = await listChangedSince(path.join(repoDir, 'realm'), base);

    expect([...changed].sort()).toEqual(['inside.gts', 'new.json']);
  });

  it('lists nothing when the tree matches the revision', async () => {
    writeFile(repoDir, 'a.gts', 'a');
    let base = commitAll(repoDir, 'base');

    expect((await listChangedSince(repoDir, base)).size).toBe(0);
  });

  it('keeps paths with spaces and non-ASCII characters intact', async () => {
    writeFile(repoDir, 'a.gts', 'a');
    let base = commitAll(repoDir, 'base');
    writeFile(repoDir, 'Card Listing/café.json', '{}');
    commitAll(repoDir, 'add');

    let changed = await listChangedSince(repoDir, base);

    expect([...changed]).toEqual(['Card Listing/café.json']);
  });

  it('rejects a revision the repository does not have', async () => {
    writeFile(repoDir, 'a.gts', 'a');
    commitAll(repoDir, 'base');

    await expect(
      listChangedSince(repoDir, '0123456789abcdef0123456789abcdef01234567'),
    ).rejects.toThrow(/is not a commit in the git repository/);
  });

  it('rejects a revision that would read as a git option', async () => {
    await expect(listChangedSince(repoDir, '--output=/tmp/x')).rejects.toThrow(
      /is not a git revision/,
    );
  });

  it('rejects a directory that is not in a git work tree', async () => {
    let plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-no-git-'));
    try {
      await expect(listChangedSince(plainDir, 'HEAD')).rejects.toThrow(
        /is not a commit in the git repository/,
      );
    } finally {
      fs.rmSync(plainDir, { recursive: true, force: true });
    }
  });
});
