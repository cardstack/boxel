import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { refusal, stylesheetRefusal } from '../build/import-allowlist.ts';
import { PACKAGE_ROOT } from '../build/module-package.ts';

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

test('the base realm, the host and runtime-common may not', () => {
  for (let path of [
    ['base', 'card-api.gts'],
    ['host', 'app', 'app.ts'],
    ['runtime-common', 'index.ts'],
  ]) {
    assert.match(
      refusal(join(PACKAGE_ROOT, '..', ...path)) ?? '',
      /is from a package not in the import allowlist$/,
      path.join('/'),
    );
  }
});

test("Pret UI, boxel-ui and boxel-icons' build may ship", () => {
  for (let path of [
    ['pretui', 'components', 'accordion.gts'],
    ['boxel-ui', 'src', 'components', 'accordion', 'index.gts'],
    [
      'boxel-icons',
      'dist',
      '@cardstack',
      'boxel-icons',
      'v1',
      'icons',
      'key-round.js',
    ],
  ]) {
    assert.equal(
      refusal(join(PACKAGE_ROOT, '..', ...path)),
      undefined,
      path.join('/'),
    );
  }
});

test('a package a listed package depends on may not, unless it is listed', () => {
  // boxel-icons depends on `@embroider/addon-shim`, which no shipped module
  // needs, so the list doesn't name it.
  let boxelIcons = createRequire(
    join(PACKAGE_ROOT, '..', 'boxel-icons', 'package.json'),
  );
  assert.match(
    refusal(boxelIcons.resolve('@embroider/addon-shim')) ?? '',
    /^@embroider\/addon-shim@\S+ .* is from a package not in the import allowlist$/,
  );
});

test('only the bundler modules named may ship', () => {
  assert.equal(refusal('\0rolldown/runtime.js'), undefined);
  assert.match(refusal('\0some-plugin/virtual.js') ?? '', /is not allowed/);
});

test("a stylesheet's relative url() inside the package may be built", () => {
  assert.equal(
    stylesheetRefusal(
      join(PACKAGE_ROOT, 'src/shell/global.css'),
      "src: url('./IBMPlexSansVar-Roman.woff2') format('woff2');",
    ),
    undefined,
  );
});

test('a stylesheet may not @import', () => {
  assert.match(
    stylesheetRefusal(
      join(PACKAGE_ROOT, 'src/shell/global.css'),
      "@import '../../../boxel-ui/addon/src/styles/global.css';",
    ) ?? '',
    /uses @import/,
  );
});

test('a stylesheet may not name a file outside the package or another origin', () => {
  let globalCSS = join(PACKAGE_ROOT, 'src/shell/global.css');
  assert.match(
    stylesheetRefusal(
      globalCSS,
      "background: url('../../../host/logo.svg');",
    ) ?? '',
    /outside the package/,
  );
  for (let url of ['https://example.test/font.woff2', '//example.test/x.png']) {
    assert.match(
      stylesheetRefusal(globalCSS, `background: url(${url});`) ?? '',
      /not a relative path/,
      url,
    );
  }
});
