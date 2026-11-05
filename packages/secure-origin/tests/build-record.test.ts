import assert from 'node:assert/strict';
import { test } from 'node:test';

import { movedModules } from '../build/build-record.ts';
import { layersNamed, unorderedLayers } from '../build/layer-order.ts';
import { runTimeStyleRefusals } from '../build/pret-ui-lint.ts';
import { portableSource } from '../build/relative-module-names.ts';

function record(modules: object[]): string {
  return JSON.stringify({
    entries: {},
    files: { 'probe/probe.js': { bytes: 1, modules } },
  });
}

test('a moved hash names the module, and one only a record ships names how', () => {
  let before = record([
    {
      package: '@cardstack/pretui@0.0.0',
      module: 'components/accordion.gts',
      size: 1,
      sha256: 'a',
    },
    {
      package: '@cardstack/boxel-ui@0.0.0',
      module: 'src/helpers/cn.ts',
      size: 1,
      sha256: 'b',
    },
    { package: 'ember-source@6.10.1', module: 'dist/index.js', size: 1 },
  ]);
  let after = record([
    {
      package: '@cardstack/pretui@0.0.0',
      module: 'components/accordion.gts',
      size: 1,
      sha256: 'c',
    },
    {
      package: '@cardstack/boxel-icons@0.0.0',
      module: 'dist/key-round.js',
      size: 1,
      sha256: 'd',
    },
    { package: 'ember-source@6.10.1', module: 'dist/index.js', size: 2 },
  ]);
  assert.deepEqual(movedModules(before, after), [
    '@cardstack/boxel-icons@0.0.0 dist/key-round.js (added)',
    '@cardstack/boxel-ui@0.0.0 src/helpers/cn.ts (removed)',
    '@cardstack/pretui@0.0.0 components/accordion.gts (changed)',
  ]);
  assert.deepEqual(movedModules(before, before), []);
});

test("a prebuilt module's absolute moduleName is cut back to the repository's packages/", () => {
  assert.equal(
    portableSource(
      '{ "moduleName": "/home/runner/work/boxel/boxel/packages/boxel-icons/src/icons/key-round.gts" }',
    ),
    '{ "moduleName": "packages/boxel-icons/src/icons/key-round.gts" }',
  );
  let relative =
    '{ "moduleName": "packages/boxel-icons/src/icons/key-round.gts" }';
  assert.equal(portableSource(relative), relative);
});

test('every layer a stylesheet names must be ordered by layers.css', () => {
  let order = layersNamed(
    '@layer reset, boxelComponentL1, PretComponent, PretComposite;',
  );
  assert.deepEqual(order, [
    'reset',
    'boxelComponentL1',
    'PretComponent',
    'PretComposite',
  ]);
  assert.equal(
    unorderedLayers(
      'probe.css',
      '@layer PretComponent { a {} } @layer PretComponent, PretComposite;',
      order,
    ),
    undefined,
  );
  assert.match(
    unorderedLayers(
      'probe.css',
      '/* @layer Commented; */ @layer boxelComponentL3 { a {} }',
      order,
    ) ?? '',
    /^probe\.css names the cascade layer boxelComponentL3, which src\/styles\/layers\.css doesn't order$/,
  );
});

test('a style the policy refuses that the template lint cannot see is refused', () => {
  assert.deepEqual(
    runTimeStyleRefusals('<template><style scoped>.a {}</style></template>'),
    [],
  );
  assert.deepEqual(
    runTimeStyleRefusals('// a refcounted <style> in document.head'),
    [],
  );
  assert.equal(
    runTimeStyleRefusals('<template><style>.a {}</style></template>').length,
    1,
  );
  assert.equal(
    runTimeStyleRefusals("let s = document.createElement('style');").length,
    1,
  );
  assert.equal(
    runTimeStyleRefusals("el.setAttribute('style', 'color: red');").length,
    1,
  );
});

test("the type check fails on the package's own diagnostics alone", async () => {
  let { ownDiagnostics } = await import('../build/type-check.ts');
  let { own, others } = ownDiagnostics(
    [
      "src/probe/probe-page.gts(10,5): error TS2322: Type 'string' is not assignable to type 'boolean'.",
      "  The expected type comes from property 'displayContainer'.",
      "node_modules/@cardstack/pretui/node_modules/@cardstack/boxel-ui/src/components.gts(139,3): error TS1205: Re-exporting a type when 'verbatimModuleSyntax' is enabled requires using 'export type'.",
      '../boxel-ui/src/components/kanban/engine.ts(36,1): error TS1287: A top-level export.',
      '  continued.',
      '',
    ].join('\n'),
  );
  assert.deepEqual(own, [
    "src/probe/probe-page.gts(10,5): error TS2322: Type 'string' is not assignable to type 'boolean'.\n  The expected type comes from property 'displayContainer'.",
  ]);
  assert.equal(others, 2);
});
