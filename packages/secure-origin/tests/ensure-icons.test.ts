import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  DEPENDENCY_INPUTS,
  ICON_INPUTS,
  ICONS_ROOT,
  iconsInputsHash,
  iconsStale,
  REPO_ROOT,
  STAMP,
} from '../build/ensure-icons.ts';

function write(root: string, path: string, content = '') {
  let file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

test('boxel-icons is built when it has no build, or its stamp no longer matches its inputs', () => {
  let repo = mkdtempSync(join(tmpdir(), 'boxel-icons-'));
  let root = join(repo, 'packages', 'boxel-icons');
  try {
    write(root, 'src/icons/key-round.gts', 'one');
    write(repo, 'pnpm-lock.yaml', 'lock one');
    assert.equal(iconsStale(root, repo), 'boxel-icons has no build');

    // A build something else made, with no stamp, is kept.
    write(root, 'dist/@cardstack/boxel-icons/v1/boxel-icons-meta.js');
    assert.equal(iconsStale(root, repo), undefined);

    write(root, STAMP, `${iconsInputsHash(root, repo)}\n`);
    assert.equal(iconsStale(root, repo), 'its build has no type declarations');
    write(root, 'declarations/icons/key-round.d.ts');
    assert.equal(iconsStale(root, repo), undefined);

    // A source changing, or only the lockfile, makes the build stale.
    write(root, 'src/icons/key-round.gts', 'two');
    assert.match(iconsStale(root, repo) ?? '', /have changed/);
    write(root, STAMP, `${iconsInputsHash(root, repo)}\n`);
    write(repo, 'pnpm-lock.yaml', 'lock two');
    assert.match(iconsStale(root, repo) ?? '', /have changed/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// CI's cache of boxel-icons' build is keyed on two `hashFiles` calls, one
// over boxel-icons' own inputs and one over the dependency fetch's. They
// have to name the inputs the stamp hashes, or CI restores a build made
// from inputs the stamp would call stale.
test("CI's boxel-icons cache key names the inputs the stamp hashes", () => {
  let action = readFileSync(
    join(REPO_ROOT, '.github', 'actions', 'restore-icons-cache', 'action.yml'),
    'utf8',
  );
  let calls = [...action.matchAll(/hashFiles\(([^)]*)\)/g)].map((match) =>
    [...match[1]!.matchAll(/'([^']+)'/g)].map((arg) => arg[1]!),
  );
  let patterns = (base: string, inputs: readonly string[], prefix: string) =>
    inputs.map((input) =>
      statSync(join(base, input)).isDirectory()
        ? `${prefix}${input}/**`
        : `${prefix}${input}`,
    );
  assert.deepEqual(calls, [
    patterns(ICONS_ROOT, ICON_INPUTS, 'packages/boxel-icons/'),
    patterns(REPO_ROOT, DEPENDENCY_INPUTS, ''),
  ]);
});
