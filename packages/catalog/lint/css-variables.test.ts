import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyBaseline, lintFile, type Definitions } from './css-variables.ts';

let definitions: Definitions = {
  global: new Set([
    '--foreground',
    '--font-sans',
    '--boxel-sp-sm',
    '--boxel-heading-font-family',
    '--pretui-button-radius',
  ]),
  theme: new Set([
    '--foreground',
    '--font-sans',
    '--boxel-heading-font-family',
  ]),
};

function lint(css: string, file = 'card.gts') {
  let source = file.endsWith('.css')
    ? css
    : `<template><style scoped>${css}</style></template>`;
  return lintFile(file, source, definitions);
}

function rules(css: string, file?: string) {
  return lint(css, file).map((e) => e.rule);
}

test('a read of a defined variable passes', () => {
  assert.deepEqual(
    rules('.a { color: var(--foreground); padding: var(--boxel-sp-sm); }'),
    [],
  );
});

test('a Pret UI knob passes', () => {
  assert.deepEqual(
    rules('.a { border-radius: var(--pretui-button-radius); }'),
    [],
  );
});

test('a read of an undefined variable fails', () => {
  assert.deepEqual(rules('.a { color: var(--ink-3); }'), [
    'css-variables/undefined',
  ]);
});

test('a variable declared in the same file passes', () => {
  assert.deepEqual(rules('.a { --gap: 1rem; margin: var(--gap); }'), []);
});

test('a variable set by an inline style or setProperty passes', () => {
  let source = `<template><div style='--x: 1' /><style scoped>.a{width:var(--x)}</style></template>
    el.style.setProperty('--y', '1'); const s = '.b{width:var(--y)}';`;
  assert.deepEqual(lintFile('card.gts', source, definitions), []);
});

test('a variable declared in another file does not count', () => {
  assert.deepEqual(rules('.a { width: var(--other-file-var); }'), [
    'css-variables/undefined',
  ]);
});

test('--font-heading points at the heading font role', () => {
  let [error] = lint('h1 { font-family: var(--font-heading); }');
  assert.equal(error.rule, 'css-variables/undefined');
  assert.match(error.message, /--boxel-heading-font-family/);
});

test('a name built at runtime is not checked', () => {
  let source =
    '<template><style scoped>.a { color: var(--tier-${x}); }</style></template>';
  assert.deepEqual(lintFile('card.gts', source, definitions), []);
});

test('a comment does not count as a read', () => {
  assert.deepEqual(
    rules('/* var(--font-heading) */ .a { color: var(--foreground); }'),
    [],
  );
});

test('a fallback on a theme variable fails, on a --boxel primitive it does not', () => {
  assert.deepEqual(rules('.a { color: var(--foreground, #333); }'), [
    'css-variables/theme-fallback',
  ]);
  assert.deepEqual(rules('.a { padding: var(--boxel-sp-sm, 0.5rem); }'), []);
});

test('a private name with a theme variable as its fallback fails', () => {
  let errors = lint(
    '.a { --card-ink: red; color: var(--card-ink, var(--foreground)); }',
  );
  assert.deepEqual(
    errors.map((e) => e.rule),
    ['css-variables/private-name-fallback'],
  );
  assert.match(errors[0].message, /var\(--foreground\)/);
});

test('a private name with a literal fallback passes', () => {
  assert.deepEqual(rules('.a { --size: 1rem; width: var(--size, 2rem); }'), []);
});

test('the font shorthand fails, longhands and font: inherit do not', () => {
  assert.deepEqual(rules('.a { font: 600 0.8rem/1.2 var(--font-sans); }'), [
    'css-variables/font-shorthand',
  ]);
  assert.deepEqual(
    rules('.a { font-size: 1rem; font-weight: 600; } .b { font: inherit; }'),
    [],
  );
});

test('font: outside a style block is not a declaration', () => {
  let source = `const x = { font: '12px serif' };`;
  assert.deepEqual(lintFile('card.gts', source, definitions), []);
});

test('errors carry the line and column of the read', () => {
  let [error] = lintFile(
    'card.css',
    '.a {\n  color: var(--nope);\n}',
    definitions,
  );
  assert.equal(error.line, 2);
  assert.equal(error.column, 10);
});

test('a baseline absorbs recorded errors per file, rule and variable', () => {
  let errors = [
    ...lint('.a { color: var(--ink-3); } .b { color: var(--ink-3); }'),
    ...lint('.a { color: var(--ink-4); }'),
  ];
  let left = applyBaseline(errors, [
    {
      file: 'card.gts',
      rule: 'css-variables/undefined',
      subject: '--ink-3',
      count: 1,
    },
  ]);
  assert.deepEqual(
    left.map((e) => e.subject),
    ['--ink-3', '--ink-4'],
  );
});
