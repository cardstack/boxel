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
// over boxel-icons' own inputs and one over the dependency fetch's. A build
// CI restores carries no stamp, so nothing checks it against its inputs
// after the restore: the key has to name every input that changes the
// build, or CI keeps restoring a build that differs from the one the stamp
// and the realm-server image would make.
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

// The realm-server image builds boxel-icons on top of its dependency fetch:
// the files the base stage copies in before `pnpm fetch`, and those the
// boxel-icons stage copies from the repository's root. Those are the
// dependency inputs the stamp and CI's key hash. The stage also copies the
// manifests of the workspace packages boxel-icons depends on; their
// dependencies reach the build through the lockfile.
test("the realm-server image's boxel-icons stage rebuilds on the dependency inputs the stamp hashes", () => {
  let lines = readFileSync(
    join(REPO_ROOT, 'packages', 'realm-server', 'realm-server.Dockerfile'),
    'utf8',
  ).split('\n');
  let fetch = lines.findIndex((line) => /^RUN .*\bpnpm fetch\b/.test(line));
  let stage = lines.findIndex((line) =>
    /^FROM base AS boxel-icons\b/.test(line),
  );
  let stageEnd = lines.findIndex(
    (line, index) => index > stage && line.startsWith('FROM '),
  );
  assert.ok(fetch > 0 && stage > fetch && stageEnd > stage);
  let sources = [...lines.slice(0, fetch), ...lines.slice(stage, stageEnd)]
    .filter((line) => line.startsWith('COPY ') && !line.includes('--from'))
    .flatMap((line) => line.split(/\s+/).slice(1, -1))
    .filter((source) => !source.startsWith('packages/'))
    .map((source) => source.replace(/\/$/, ''));
  assert.deepEqual([...sources].sort(), [...DEPENDENCY_INPUTS].sort());
});
