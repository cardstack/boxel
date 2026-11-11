import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

import {
  movedModules,
  recordMismatch,
  restyledModules,
  shippedModule,
} from '../build/build-record.ts';
import { layersNamed, unorderedLayers } from '../build/layer-order.ts';
import { runTimeStyleRefusals } from '../build/pret-ui-lint.ts';
import {
  portableSource,
  stableTemplateIds,
} from '../build/relative-module-names.ts';
import { stylesAtRunTime } from '../build/run-time-style.ts';

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

function shipped(module: string, stylesAtRunTime?: string[]) {
  return {
    package: 'some-package@1.0.0',
    module,
    size: 1,
    ...(stylesAtRunTime ? { stylesAtRunTime } : {}),
  };
}

function records(files: Record<string, object[]>): string {
  return JSON.stringify({
    entries: {},
    files: Object.fromEntries(
      Object.entries(files).map(([name, modules]) => [
        name,
        { bytes: 1, modules },
      ]),
    ),
  });
}

test('a module whose run-time styling mark changes is named with what it does', () => {
  let before = record([
    shipped('kept.js', ['creates a <style> element']),
    shipped('cleaned.js', ['sets a style attribute']),
    shipped('widened.js', ['creates a <style> element']),
    shipped('plain.js'),
  ]);
  let after = record([
    shipped('kept.js', ['creates a <style> element']),
    shipped('cleaned.js'),
    shipped('widened.js', [
      'creates a <style> element',
      'sets a style attribute',
    ]),
    shipped('plain.js'),
    shipped('added.js', ['creates a <style> element']),
  ]);
  assert.deepEqual(restyledModules(before, after), [
    'some-package@1.0.0 added.js in the probe: creates a <style> element',
    'some-package@1.0.0 cleaned.js in the probe (no longer marked)',
    'some-package@1.0.0 widened.js in the probe: creates a <style> element and sets a style attribute',
  ]);
  assert.deepEqual(restyledModules(before, before), []);
});

test("the pages' copy of a module and the probe's are compared apart", () => {
  let probeMarked = {
    'probe/probe.js': [shipped('a.js', ['creates a <style> element'])],
  };
  let both = records({
    ...probeMarked,
    'shared.js': [shipped('a.js', ['creates a <style> element'])],
  });
  let probeOnly = records({ ...probeMarked, 'shared.js': [shipped('a.js')] });
  assert.deepEqual(restyledModules(probeOnly, both), [
    'some-package@1.0.0 a.js: creates a <style> element',
  ]);
  assert.deepEqual(restyledModules(both, probeOnly), [
    'some-package@1.0.0 a.js (no longer marked)',
  ]);
  let moved = records({
    ...probeMarked,
    'shell.js': [shipped('a.js', ['creates a <style> element'])],
  });
  assert.deepEqual(
    restyledModules(both, moved),
    [],
    'a move between chunks of one build',
  );
});

test('a record check names styling marks, then moved hashes, then the diff', () => {
  let before = record([
    { ...shipped('styled.js'), sha256: 'a' },
    { ...shipped('moved.js'), sha256: 'b' },
  ]);
  let after = record([
    { ...shipped('styled.js', ['creates a <style> element']), sha256: 'a' },
    { ...shipped('moved.js'), sha256: 'c' },
  ]);
  let message = recordMismatch(before, after);
  let styled = message.indexOf('styled.js in the probe: creates a <style>');
  let moved = message.indexOf('moved.js (changed)');
  let diff = message.indexOf('differs from build-record.json');
  assert.ok(styled > message.indexOf('ADR 019 §1.5'), message);
  assert.ok(styled >= 0 && styled < moved && moved < diff, message);
});

test("a shipped module is marked from its rendered code, which it can't lack", () => {
  let name = { package: 'some-package@1.0.0', module: 'a.js' };
  assert.deepEqual(
    shippedModule(name, {
      code: "document.createElement('style')",
      renderedLength: 31,
    }),
    { ...name, size: 31, stylesAtRunTime: ['creates a <style> element'] },
  );
  assert.deepEqual(shippedModule(name, { code: 'x()', renderedLength: 3 }), {
    ...name,
    size: 3,
  });
  assert.throws(
    () => shippedModule(name, { code: null, renderedLength: 3 }),
    /without its code/,
  );
});

test('run-time styling is found whatever the case, with or without a namespace', () => {
  let does = (code: string) => stylesAtRunTime(code).map(({ does }) => does);
  assert.deepEqual(
    does(
      'let s = document.createElement("style");\ns.setAttribute(`style`, x);',
    ),
    ['creates a <style> element', 'sets a style attribute'],
  );
  assert.deepEqual(does("document.createElement('STYLE')"), [
    'creates a <style> element',
  ]);
  assert.deepEqual(does('document.createElementNS(svgNS, "style")'), [
    'creates a <style> element',
  ]);
  assert.deepEqual(does("el.setAttributeNS(null, 'style', v)"), [
    'sets a style attribute',
  ]);
  assert.deepEqual(
    does(
      "el.style.setProperty('--a', '1'); el.setAttribute('title', 'style'); document.createElement('div')",
    ),
    [],
  );
});

test('one template compiled at two paths gives the same portable source', () => {
  let { precompile } = createRequire(import.meta.url)(
    'ember-source/dist/ember-template-compiler.js',
  ) as {
    precompile: (source: string, options: object) => string;
  };
  let compiled = (root: string) =>
    precompile('<svg class="icon" ...attributes></svg>', {
      moduleName: `${root}/packages/boxel-icons/src/icons/key-round.gts`,
      strictMode: true,
    });
  let name =
    'packages/boxel-icons/dist/@cardstack/boxel-icons/v1/icons/key-round.js';
  // A checkout whose own path has a `packages` directory in it.
  let here = compiled('/home/someone/packages/boxel');
  let there = compiled('/home/runner/work/boxel/boxel');
  assert.notEqual(here, there, 'the compiler names the checkout');
  assert.equal(portableSource(here, name), portableSource(there, name));
  assert.match(
    portableSource(here, name),
    /"moduleName": ?"packages\/boxel-icons\/src\/icons\/key-round.gts"/,
  );
});

test("each template's id comes from its module's name and its place there", () => {
  let module =
    '{ id: "aaaaaaaa", block: "[]" } { "id": "bbbbbbbb", "block": "[]" }';
  let ids = (code: string) =>
    [...code.matchAll(/id"?: "([^"]+)"/g)].map(([, id]) => id);
  let [first, second] = ids(stableTemplateIds(module, 'src/a.gts'));
  assert.notEqual(first, second);
  assert.deepEqual(ids(stableTemplateIds(module, 'src/a.gts')), [
    first,
    second,
  ]);
  assert.notDeepEqual(ids(stableTemplateIds(module, 'src/b.gts')), [
    first,
    second,
  ]);
  let notTemplate = '{ id: "aaaaaaaa", name: "x" }';
  assert.equal(stableTemplateIds(notTemplate, 'src/a.gts'), notTemplate);
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
