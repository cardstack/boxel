import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { refusal } from '../build/import-allowlist.mjs';
import { PACKAGE_ROOT } from '../build/module-package.mjs';

const require = createRequire(import.meta.url);
const emberSource = dirname(require.resolve('ember-source/package.json'));

test("the package's own modules may ship", () => {
  assert.equal(
    refusal(join(PACKAGE_ROOT, 'src/security/redact.js')),
    undefined,
  );
  assert.equal(refusal(join(PACKAGE_ROOT, 'index.html')), undefined);
});

test("Ember's runtime may ship", () => {
  assert.equal(
    refusal(join(emberSource, 'dist/packages/@glimmer/runtime/index.js')),
    undefined,
  );
});

test("Ember's runtime template compiler may not", () => {
  for (let path of [
    'dist/ember-template-compiler.js',
    'dist/packages/@ember/template-compiler/index.js',
    'dist/packages/@ember/template-compiler/runtime.js',
  ]) {
    assert.match(
      refusal(join(emberSource, path)) ?? '',
      /runtime template compiler/,
      path,
    );
  }
});

test('a package outside the allowlist may not', () => {
  assert.match(
    refusal(require.resolve('@babel/core')) ?? '',
    /^@babel\/core@\S+ .* is from a package not in the import allowlist$/,
  );
});

test("another workspace package's source may not", () => {
  assert.match(
    refusal(join(PACKAGE_ROOT, '..', 'host', 'app', 'app.ts')) ?? '',
    /not in the import allowlist/,
  );
});

test('only the bundler modules named may ship', () => {
  assert.equal(refusal('\0rolldown/runtime.js'), undefined);
  assert.match(refusal('\0some-plugin/virtual.js') ?? '', /is not allowed/);
});
