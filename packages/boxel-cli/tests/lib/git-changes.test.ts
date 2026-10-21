import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { listUnchangedSince } from '../../src/lib/git-changes.ts';

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

describe('listUnchangedSince', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-git-changes-'));
    git(repoDir, 'init', '-q');
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('lists only tracked files that are the same as at the revision', async () => {
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

    expect([...(await listUnchangedSince(repoDir, base))]).toEqual([
      'kept.gts',
    ]);
  });

  it('leaves out uncommitted edits, untracked files and ignored files', async () => {
    writeFile(repoDir, '.gitignore', 'ignored.txt\n');
    writeFile(repoDir, 'kept.gts', 'kept');
    writeFile(repoDir, 'tracked.gts', 'before');
    let base = commitAll(repoDir, 'base');

    writeFile(repoDir, 'tracked.gts', 'after');
    writeFile(repoDir, 'untracked.json', '{}');
    writeFile(repoDir, 'ignored.txt', 'x');

    expect([...(await listUnchangedSince(repoDir, base))].sort()).toEqual([
      '.gitignore',
      'kept.gts',
    ]);
  });

  it('leaves out files git ignores through rules outside the directory', async () => {
    // A parent directory's .gitignore and .git/info/exclude both hide files
    // that a push of the subdirectory still lists.
    writeFile(repoDir, '.gitignore', 'realm/from-parent.json\n');
    writeFile(repoDir, 'realm/kept.gts', 'kept');
    let base = commitAll(repoDir, 'base');
    writeFile(repoDir, '.git/info/exclude', 'from-exclude.json\n');
    writeFile(repoDir, 'realm/from-parent.json', '{}');
    writeFile(repoDir, 'realm/from-exclude.json', '{}');

    let unchanged = await listUnchangedSince(path.join(repoDir, 'realm'), base);

    expect([...unchanged]).toEqual(['kept.gts']);
  });

  it('leaves out the files inside a submodule', async () => {
    let subDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-git-sub-'));
    try {
      git(subDir, 'init', '-q');
      writeFile(subDir, 'inner.gts', 'inner');
      commitAll(subDir, 'sub');
      writeFile(repoDir, 'kept.gts', 'kept');
      git(
        repoDir,
        '-c',
        'protocol.file.allow=always',
        'submodule',
        'add',
        '-q',
        subDir,
        'sub',
      );
      let base = commitAll(repoDir, 'base');
      writeFile(repoDir, 'sub/inner.gts', 'edited');

      let unchanged = await listUnchangedSince(repoDir, base);

      expect(unchanged.has('kept.gts')).toBe(true);
      expect(unchanged.has('sub/inner.gts')).toBe(false);
    } finally {
      fs.rmSync(subDir, { recursive: true, force: true });
    }
  });

  it('answers paths relative to a subdirectory of the repository', async () => {
    writeFile(repoDir, 'outside.gts', 'outside');
    writeFile(repoDir, 'realm/kept.gts', 'kept');
    writeFile(repoDir, 'realm/edited.gts', 'before');
    let base = commitAll(repoDir, 'base');
    writeFile(repoDir, 'realm/edited.gts', 'after');

    let unchanged = await listUnchangedSince(path.join(repoDir, 'realm'), base);

    expect([...unchanged]).toEqual(['kept.gts']);
  });

  it('keeps paths with spaces and non-ASCII characters intact', async () => {
    writeFile(repoDir, 'Card Listing/café.json', '{}');
    let base = commitAll(repoDir, 'base');

    expect([...(await listUnchangedSince(repoDir, base))]).toEqual([
      'Card Listing/café.json',
    ]);
  });

  it('rejects a revision the repository does not have', async () => {
    writeFile(repoDir, 'a.gts', 'a');
    commitAll(repoDir, 'base');

    await expect(
      listUnchangedSince(repoDir, '0123456789abcdef0123456789abcdef01234567'),
    ).rejects.toThrow(/is not a commit in the git repository/);
  });

  it('rejects a revision that would read as a git option', async () => {
    await expect(
      listUnchangedSince(repoDir, '--output=/tmp/x'),
    ).rejects.toThrow(/is not a git revision/);
  });

  it('rejects a directory that is not in a git work tree', async () => {
    let plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-no-git-'));
    try {
      await expect(listUnchangedSince(plainDir, 'HEAD')).rejects.toThrow(
        /is not a commit in the git repository/,
      );
    } finally {
      fs.rmSync(plainDir, { recursive: true, force: true });
    }
  });
});
