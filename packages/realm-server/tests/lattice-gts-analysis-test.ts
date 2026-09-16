import QUnit from 'qunit';
import { basename } from 'node:path';
import { bxl, getBxlComputeDefinition } from '@cardstack/bxl';
import { analyzeLatticeGtsSource } from '@cardstack/runtime-common/lattice-gts-analysis';

const { module, test } = QUnit;
const fileId = 'https://lattice-source.example/counter.gts';
const imports = `import { CardDef, FieldDef, field, contains, NumberField } from '@cardstack/base/card-api';
import { bxl as formula } from '@cardstack/bxl';`;
const source = `${imports}
export class Counter extends CardDef {
  @field amount = contains(NumberField);
  @field doubled = contains(NumberField, { computeVia: formula('.amount * 2', { readableSyntax: false, libraries: ['core'] }) });
  static isolated = <template><div>{{@model.doubled}}</div></template>;
}`;

module(basename(import.meta.filename), function () {
  test('captures official BXL data without treating templates or unresolved imports as Node authority', function (assert) {
    const result = analyzeLatticeGtsSource(fileId, source);
    assert.strictEqual(result.state, 'analyzed');
    assert.strictEqual(result.coverage, 'local-syntax');
    assert.strictEqual(result.fileId, fileId);
    const card = result.exports.find((item) => item.name === 'Counter')!;
    assert.strictEqual(
      card.indexing,
      'requires-linking',
      JSON.stringify(card.reasons),
    );
    assert.deepEqual(
      card.fields.find((item) => item.name === 'doubled')?.bxl,
      getBxlComputeDefinition(
        bxl('.amount * 2', { readableSyntax: false, libraries: ['core'] }),
      ),
    );
    assert.deepEqual(
      result.imports.map((item) => item.module),
      ['@cardstack/base/card-api', '@cardstack/bxl'],
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(result)),
      result,
      'only serializable artifact data survives analysis',
    );
  });

  test('never executes constructors, module effects, getters or JavaScript computations', function (assert) {
    const analyzed = analyzeLatticeGtsSource(
      fileId,
      `${imports}
throw new Error('must not run the module');
export class Custom extends CardDef {
  constructor() { throw new Error('must not construct'); }
  static get icon() { throw new Error('must not read'); }
  @field value = contains(NumberField, { computeVia: function () { throw new Error('must not compute'); } });
}`,
    );
    assert.strictEqual(analyzed.state, 'analyzed');
    assert.strictEqual(analyzed.exports[0].indexing, 'chrome-data');
    const reasons = analyzed.exports[0].reasons.map((item) => item.code);
    assert.true(reasons.includes('module-runtime-initialization'));
    assert.true(reasons.includes('custom-class-behavior'));
    assert.true(reasons.includes('javascript-compute'));
  });

  test('mixed exported definitions retain separate data classifications', function (assert) {
    const result = analyzeLatticeGtsSource(
      fileId,
      source +
        `
export class Custom extends CardDef {
  @field value = contains(NumberField, {computeVia: function () { return Math.random(); }});
}`,
    );
    assert.strictEqual(
      result.exports.find((item) => item.name === 'Counter')?.indexing,
      'requires-linking',
    );
    assert.strictEqual(
      result.exports.find((item) => item.name === 'Custom')?.indexing,
      'chrome-data',
    );
  });

  test('shadowed BXL, dynamic options and static side effects cannot masquerade as a data plan', function (assert) {
    const forged = analyzeLatticeGtsSource(
      fileId,
      source.replace(
        "import { bxl as formula } from '@cardstack/bxl';",
        'function formula() { return () => 9; }',
      ),
    );
    assert.strictEqual(forged.exports[0].indexing, 'chrome-data');
    assert.notOk(
      forged.exports[0].fields.find((item) => item.name === 'doubled')?.bxl,
    );
    const dynamic = analyzeLatticeGtsSource(
      fileId,
      source.replace(
        "{ readableSyntax: false, libraries: ['core'] }",
        'readOptions()',
      ),
    );
    assert.strictEqual(dynamic.exports[0].indexing, 'chrome-data');
    const effects = analyzeLatticeGtsSource(
      fileId,
      source +
        '\nclass SideEffect { static { throw new Error("must not run"); } }',
    );
    assert.strictEqual(effects.exports[0].indexing, 'chrome-data');
  });

  test('source and import-declaration changes replace the source receipt; re-exports require linking', function (assert) {
    const before = analyzeLatticeGtsSource(fileId, source);
    const edited = analyzeLatticeGtsSource(
      fileId,
      source.replace('.amount * 2', '.amount * 3'),
    );
    assert.notStrictEqual(
      before.sourceRevision.digest,
      edited.sourceRevision.digest,
    );
    const redirected = analyzeLatticeGtsSource(
      fileId,
      source.replace('@cardstack/base/card-api', './other-api'),
    );
    assert.notStrictEqual(
      before.sourceRevision.digest,
      redirected.sourceRevision.digest,
    );
    assert.deepEqual(redirected.exports[0].extends, {
      type: 'external',
      module: './other-api',
      name: 'CardDef',
    });
    const reexport = analyzeLatticeGtsSource(
      fileId,
      'export { Counter } from "./other";',
    );
    assert.strictEqual(reexport.exports[0].indexing, 'requires-linking');
    assert.deepEqual(reexport.imports, [
      { module: './other', kind: 'reexport', typeOnly: false },
    ]);
  });

  test('local field references address persisted local definitions, not discarded AST objects', function (assert) {
    const result = analyzeLatticeGtsSource(
      fileId,
      `${imports}
class LocalField extends FieldDef { @field score = contains(NumberField); }
export class Card extends CardDef { @field score = contains(LocalField); }`,
    );
    const ref = result.exports[0].fields[0].value;
    assert.strictEqual(ref.type, 'internal');
    if (ref.type !== 'internal' || ref.classIndex == null)
      throw new Error('Expected local field reference');
    assert.strictEqual(
      result.localDefinitions[ref.classIndex].name,
      'LocalField',
    );
  });

  test('retains imports in modules with no class declarations', function (assert) {
    const result = analyzeLatticeGtsSource(
      fileId,
      'import "./register"; export * from "./cards";',
    );
    assert.deepEqual(result.imports, [
      { module: './register', kind: 'import', typeOnly: false },
      { module: './cards', kind: 'reexport', typeOnly: false },
    ]);
    assert.deepEqual(
      result.exports,
      [],
      'wildcard exports need external linking, not invented local eligibility',
    );
  });

  test('export bindings retain aliases and module diagnostics without granting execution authority', function (assert) {
    const result = analyzeLatticeGtsSource(
      fileId,
      `${imports}
import External from './external';
class Local extends CardDef {}
export { Local as First, Local as Second, External as Imported };
export default Local;
export { default as Forwarded } from './external';
export * from './stars';`,
    );
    assert.strictEqual(
      result.state,
      'analyzed',
      JSON.stringify(result.diagnostics),
    );
    const targets = new Map(
      result.exports.map((item) => [item.name, item.target]),
    );
    assert.deepEqual(targets.get('First'), { type: 'internal', classIndex: 0 });
    assert.deepEqual(targets.get('Second'), targets.get('First'));
    assert.deepEqual(targets.get('default'), targets.get('First'));
    assert.deepEqual(targets.get('Imported'), {
      type: 'external',
      module: './external',
      name: 'default',
    });
    assert.deepEqual(targets.get('Forwarded'), targets.get('Imported'));
    assert.deepEqual(result.exportStars, ['./stars']);
    const effects = analyzeLatticeGtsSource(
      fileId,
      'export { Card } from "./other"; throw new Error("never execute");',
    );
    assert.true(
      effects.diagnostics.some(
        (item) => item.code === 'module-runtime-initialization',
      ),
    );
    assert.strictEqual(effects.exports[0].indexing, 'chrome-data');
  });

  test('invalid and oversized source retains an explicit blocked analysis', function (assert) {
    const invalid = analyzeLatticeGtsSource(fileId, 'export class {');
    assert.strictEqual(invalid.state, 'blocked');
    assert.strictEqual(invalid.diagnostics[0].code, 'source-analysis-error');
    const large = analyzeLatticeGtsSource(fileId, ' '.repeat(1_048_577));
    assert.strictEqual(large.state, 'blocked');
    assert.strictEqual(large.diagnostics[0].code, 'analysis-size-limit');
  });

  test('type-only exports are absent from the runtime binding table', function (assert) {
    const result = analyzeLatticeGtsSource(
      fileId,
      `${imports}
class Local extends CardDef {}
export type { Local };
export { type External, Value } from './mixed';
export { type OnlyType } from './types';`,
    );
    assert.strictEqual(
      result.state,
      'analyzed',
      JSON.stringify(result.diagnostics),
    );
    assert.deepEqual(
      result.exports.map((item) => item.name),
      ['Value'],
    );
    assert.deepEqual(
      result.imports.filter((item) => item.kind === 'reexport'),
      [
        { module: './mixed', kind: 'reexport', typeOnly: false },
        { module: './types', kind: 'reexport', typeOnly: true },
      ],
    );
  });
});
