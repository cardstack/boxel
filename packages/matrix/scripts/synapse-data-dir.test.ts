import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'fs';
import { after, test } from 'node:test';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  sharedSynapseDataDir,
  synapseDataDir,
} from '../../../scripts/synapse-data-dir.js';

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

test('worktrees of a bare repository share a directory in it', () => {
  let bare = join(scratch, 'bare.git');
  git(scratch, 'clone', '--quiet', '--bare', main, bare);
  let first = join(scratch, 'bare-first');
  let second = join(scratch, 'bare-second');
  git(bare, 'worktree', 'add', '--quiet', '--detach', first);
  git(bare, 'worktree', 'add', '--quiet', '--detach', second);
  let shared = join(bare, 'boxel-synapse-data');
  assert.equal(sharedSynapseDataDir(first), shared);
  assert.equal(sharedSynapseDataDir(second), shared);
});

test("environment mode uses the checkout's own directory for the slug", () => {
  let previous = process.env.BOXEL_ENVIRONMENT;
  process.env.BOXEL_ENVIRONMENT = 'Feature/Thing';
  try {
    assert.equal(
      synapseDataDir(worktree),
      join(worktree, 'packages', 'matrix', 'synapse-data-feature-thing'),
    );
  } finally {
    if (previous === undefined) {
      delete process.env.BOXEL_ENVIRONMENT;
    } else {
      process.env.BOXEL_ENVIRONMENT = previous;
    }
  }
});

test('outside environment mode uses the shared directory', () => {
  let previous = process.env.BOXEL_ENVIRONMENT;
  delete process.env.BOXEL_ENVIRONMENT;
  try {
    assert.equal(synapseDataDir(worktree), expected);
  } finally {
    if (previous !== undefined) {
      process.env.BOXEL_ENVIRONMENT = previous;
    }
  }
});
