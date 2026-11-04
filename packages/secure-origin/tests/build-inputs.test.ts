import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import {
  describeInputs,
  describeOutputs,
  INPUTS_FILE,
  staleInput,
} from '../build/build-inputs.ts';

// A workspace laid out as the package's is: the package two levels below
// the lockfile, a module of its own, and a module of another package the
// bundle compiles from source.
let repo: string;
let root: string;
let dist: string;
let ownModule: string;
let otherPackageModule: string;

function write(file: string, content: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function build() {
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'manifest.json'), '{}');
  writeFileSync(join(dist, 'shell.js'), 'export {};');
  writeFileSync(
    join(dist, INPUTS_FILE),
    JSON.stringify({
      ...describeInputs(
        [
          ownModule,
          `${otherPackageModule}?query`,
          '\0virtual:module',
          join(root, 'not-a-file.js'),
        ],
        root,
      ),
      outputs: describeOutputs(dist, ['manifest.json', 'shell.js']),
    }),
  );
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'secure-origin-inputs-'));
  root = join(repo, 'packages', 'secure-origin');
  dist = join(root, 'dist');
  ownModule = join(root, 'src', 'page.gts');
  otherPackageModule = join(repo, 'packages', 'pretui', 'button.gts');
  write(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  write(join(root, 'package.json'), '{"name":"@cardstack/secure-origin"}');
  write(join(root, 'vite.config.ts'), 'export default {};');
  write(join(root, 'build', 'plugin.ts'), 'export {};');
  write(ownModule, '<template>page</template>');
  write(otherPackageModule, '<template>button</template>');
  write(
    join(repo, 'packages', 'pretui', 'package.json'),
    '{"name":"@cardstack/pretui","exports":{"./*":"./*.gts"}}',
  );
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

test('a build that matches its sources is current', () => {
  build();
  assert.equal(staleInput(dist, root), undefined);
});

test('the record holds the files the bundle read and the build config', () => {
  build();
  assert.deepEqual(Object.keys(describeInputs([ownModule], root).files), [
    '../../pnpm-lock.yaml',
    'build/plugin.ts',
    'package.json',
    'src/page.gts',
    'vite.config.ts',
  ]);
});

test('no build, or no record of its inputs, is stale', () => {
  assert.match(staleInput(dist, root)!, /holds no build/);
  build();
  unlinkSync(join(dist, INPUTS_FILE));
  assert.match(staleInput(dist, root)!, /no record of its inputs/);
});

test("a change to the package's own module is stale", () => {
  build();
  writeFileSync(ownModule, '<template>changed</template>');
  assert.equal(staleInput(dist, root), 'src/page.gts has changed');
});

test("a change to another package's module the bundle read is stale", () => {
  build();
  writeFileSync(otherPackageModule, '<template>changed</template>');
  assert.equal(staleInput(dist, root), '../pretui/button.gts has changed');
});

test('a change to the lockfile or the build config is stale', () => {
  build();
  writeFileSync(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 10\n');
  assert.equal(staleInput(dist, root), '../../pnpm-lock.yaml has changed');
  build();
  writeFileSync(join(root, 'vite.config.ts'), 'export default { a: 1 };');
  assert.equal(staleInput(dist, root), 'vite.config.ts has changed');
});

test('an input that is gone, or a build plugin added since, is stale', () => {
  build();
  unlinkSync(ownModule);
  assert.equal(staleInput(dist, root), 'src/page.gts is gone');
  write(ownModule, '<template>page</template>');
  build();
  write(join(root, 'build', 'another-plugin.ts'), 'export {};');
  assert.equal(
    staleInput(dist, root),
    "build/another-plugin.ts is not among the build's inputs",
  );
});

test('a change to the manifest of another package the bundle read is stale', () => {
  build();
  write(
    join(repo, 'packages', 'pretui', 'package.json'),
    '{"name":"@cardstack/pretui","exports":{"./*":"./*.js"}}',
  );
  assert.equal(staleInput(dist, root), '../pretui/package.json has changed');
});

test('an output that is gone or has changed, or no record of outputs, is stale', () => {
  build();
  writeFileSync(join(dist, 'shell.js'), 'export const x = 1;');
  assert.equal(staleInput(dist, root), "the build's shell.js has changed");
  unlinkSync(join(dist, 'shell.js'));
  assert.equal(staleInput(dist, root), "the build's shell.js is gone");
  writeFileSync(
    join(dist, INPUTS_FILE),
    JSON.stringify(describeInputs([ownModule], root)),
  );
  assert.match(staleInput(dist, root)!, /records no outputs/);
});
