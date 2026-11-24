import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'fs';
import { after, test } from 'node:test';
import { tmpdir } from 'os';
import { join } from 'path';
import { sharedSynapseDataDir } from '../../../scripts/synapse-data-dir.js';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'synapse-data-dir-')));
after(() => rmSync(scratch, { recursive: true, force: true }));

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

const main = join(scratch, 'main');
mkdirSync(main);
git(main, 'init', '--quiet');
git(
  main,
  '-c',
  'user.name=test',
  '-c',
  'user.email=test@example.com',
  'commit',
  '--quiet',
  '--allow-empty',
  '-m',
  'initial',
);
const worktree = join(scratch, 'worktree');
git(main, 'worktree', 'add', '--quiet', '--detach', worktree);

const expected = join(main, 'packages', 'matrix', 'synapse-data');

test('a checkout that is not a linked worktree uses its own directory', () => {
  assert.equal(sharedSynapseDataDir(main), expected);
});

test("a linked worktree uses the main checkout's directory", () => {
  assert.equal(sharedSynapseDataDir(worktree), expected);
});

test('a directory outside git uses its own directory', () => {
  let plain = join(scratch, 'plain');
  mkdirSync(plain);
  assert.equal(
    sharedSynapseDataDir(plain),
    join(plain, 'packages', 'matrix', 'synapse-data'),
  );
});

test('a bare repository uses the directory given', () => {
  let bare = join(scratch, 'bare.git');
  git(scratch, 'init', '--quiet', '--bare', bare);
  assert.equal(
    sharedSynapseDataDir(bare),
    join(bare, 'packages', 'matrix', 'synapse-data'),
  );
});
