import { module, test } from 'qunit';

import type { ValidationStepResult } from '../src/factory-agent';

import {
  ParseValidationStep,
  type ParseValidationStepConfig,
  type ParseValidationDetails,
  type SpecExampleInfo,
} from '../src/validators/parse-step';
import type { RealmFetchOptions } from '../src/realm-operations';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeConfig(
  overrides: Partial<ParseValidationStepConfig> = {},
): ParseValidationStepConfig {
  return {
    realmServerUrl: 'https://example.test/',
    parseResultsModuleUrl: 'https://example.test/parse-result',
    getNextSequenceNumber: async () => 1,
    ...overrides,
  };
}

function makeFetchFilenames(
  filenames: string[],
): (
  realmUrl: string,
  options?: RealmFetchOptions,
) => Promise<{ filenames: string[]; error?: string }> {
  return async () => ({ filenames });
}

function makeFetchFilenamesError(
  error: string,
): (
  realmUrl: string,
  options?: RealmFetchOptions,
) => Promise<{ filenames: string[]; error?: string }> {
  return async () => ({ filenames: [], error });
}

function makeReadFile(
  contents: Record<string, string>,
): (
  realmUrl: string,
  path: string,
  options?: RealmFetchOptions,
) => Promise<{ ok: boolean; content?: string; error?: string }> {
  return async (_realmUrl, path) => {
    let content = contents[path];
    if (content != null) {
      return { ok: true, content };
    }
    return { ok: false, error: `File not found: ${path}` };
  };
}

function makeSearchSpecs(
  specs: SpecExampleInfo[],
): () => Promise<{ specs: SpecExampleInfo[]; error?: string }> {
  return async () => ({ specs });
}

function makeSearchSpecsError(
  error: string,
): () => Promise<{ specs: SpecExampleInfo[]; error?: string }> {
  return async () => ({ specs: [], error });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

module('ParseValidationStep', function () {
  // -----------------------------------------------------------------------
  // No files to validate
  // -----------------------------------------------------------------------

  test('no parseable files returns passed', async function (assert) {
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([
          'Cards/my-card.json',
          'index.json',
          '.realm.json',
        ]),
        readFileFn: makeReadFile({}),
        searchSpecsFn: makeSearchSpecs([]),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.true(result.passed);
    assert.strictEqual(result.step, 'parse');
    assert.strictEqual(result.errors.length, 0);
    assert.deepEqual(result.files, []);
  });

  // -----------------------------------------------------------------------
  // GTS parsing: valid files
  // -----------------------------------------------------------------------

  test('valid GTS files return passed', async function (assert) {
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames(['hello.gts', 'world.gts']),
        readFileFn: makeReadFile({
          'hello.gts': `import { CardDef } from "https://cardstack.com/base/card-api";
export class Hello extends CardDef {
  static displayName = 'Hello';
}`,
          'world.gts': `import { CardDef, Component } from "https://cardstack.com/base/card-api";
export class World extends CardDef {
  static isolated = class Isolated extends Component<typeof World> {
    <template><div>World</div></template>
  };
}`,
        }),
        searchSpecsFn: makeSearchSpecs([]),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.true(result.passed);
    assert.strictEqual(result.step, 'parse');
    assert.deepEqual(result.files, ['hello.gts', 'world.gts']);

    let details = result.details as unknown as ParseValidationDetails;
    assert.ok(details, 'has details');
    assert.strictEqual(details.filesChecked, 2);
    assert.strictEqual(details.filesWithErrors, 0);
    assert.strictEqual(details.totalErrors, 0);
  });

  // -----------------------------------------------------------------------
  // GTS parsing: syntax errors
  // -----------------------------------------------------------------------

  test('GTS file with unclosed template tag returns failed', async function (assert) {
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames(['bad.gts']),
        readFileFn: makeReadFile({
          'bad.gts': `export class Foo {
  static t = class {
    <template><div>hi</div>
  };
}`,
        }),
        searchSpecsFn: makeSearchSpecs([]),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed);
    assert.strictEqual(result.step, 'parse');
    assert.ok(result.errors.length > 0, 'has errors');

    let details = result.details as unknown as ParseValidationDetails;
    assert.strictEqual(details.filesChecked, 1);
    assert.strictEqual(details.filesWithErrors, 1);
    assert.ok(
      details.errors[0].message.includes('GTS preprocessing error'),
      'error mentions GTS preprocessing',
    );
  });

  test('GTS file with TypeScript syntax error after preprocessing returns failed', async function (assert) {
    // content-tag may allow certain TS syntax errors through;
    // TypeScript's parser catches them in the preprocessed output.
    // We test the parseGtsFile method directly for this case.
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([]),
        readFileFn: makeReadFile({}),
        searchSpecsFn: makeSearchSpecs([]),
      }),
    );

    // Directly test the parser with code that content-tag will preprocess
    // but TS will reject
    let errors = step.parseGtsFile(
      'test.gts',
      'export class Foo { @field name: = 5; }',
    );

    // content-tag should catch this as a parse error
    assert.ok(errors.length > 0, 'has errors');
    assert.strictEqual(errors[0].file, 'test.gts');
  });

  // -----------------------------------------------------------------------
  // JSON parsing: valid files
  // -----------------------------------------------------------------------

  test('valid JSON card documents return passed', async function (assert) {
    let validDoc = JSON.stringify({
      data: {
        type: 'card',
        attributes: { name: 'Test' },
        meta: {
          adoptsFrom: {
            module: '../my-card',
            name: 'MyCard',
          },
        },
      },
    });

    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([]),
        readFileFn: makeReadFile({
          'MyCard/example-1.json': validDoc,
        }),
        searchSpecsFn: makeSearchSpecs([
          {
            specId: 'Spec/my-card',
            exampleUrls: ['MyCard/example-1.json'],
          },
        ]),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.true(result.passed);
    assert.strictEqual(result.step, 'parse');

    let details = result.details as unknown as ParseValidationDetails;
    assert.strictEqual(details.filesChecked, 1);
    assert.strictEqual(details.filesWithErrors, 0);
  });

  // -----------------------------------------------------------------------
  // JSON parsing: syntax errors
  // -----------------------------------------------------------------------

  test('invalid JSON syntax returns failed', async function (assert) {
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([]),
        readFileFn: makeReadFile({
          'MyCard/bad.json': '{ invalid json }',
        }),
        searchSpecsFn: makeSearchSpecs([
          {
            specId: 'Spec/my-card',
            exampleUrls: ['MyCard/bad.json'],
          },
        ]),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed);
    assert.ok(result.errors.length > 0, 'has errors');

    let details = result.details as unknown as ParseValidationDetails;
    assert.strictEqual(details.filesWithErrors, 1);
    assert.ok(
      details.errors[0].message.includes('Invalid JSON'),
      'error mentions invalid JSON',
    );
  });

  // -----------------------------------------------------------------------
  // JSON parsing: card document structure errors
  // -----------------------------------------------------------------------

  test('JSON missing data object returns failed', async function (assert) {
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([]),
        readFileFn: makeReadFile({
          'MyCard/bad.json': JSON.stringify({ type: 'card' }),
        }),
        searchSpecsFn: makeSearchSpecs([
          {
            specId: 'Spec/my-card',
            exampleUrls: ['MyCard/bad.json'],
          },
        ]),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed);

    let details = result.details as unknown as ParseValidationDetails;
    assert.ok(
      details.errors[0].message.includes('"data" object'),
      'error mentions missing data',
    );
  });

  test('JSON missing adoptsFrom returns failed', async function (assert) {
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([]),
        readFileFn: makeReadFile({
          'MyCard/bad.json': JSON.stringify({
            data: {
              type: 'card',
              attributes: {},
              meta: {},
            },
          }),
        }),
        searchSpecsFn: makeSearchSpecs([
          {
            specId: 'Spec/my-card',
            exampleUrls: ['MyCard/bad.json'],
          },
        ]),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed);

    let details = result.details as unknown as ParseValidationDetails;
    assert.ok(
      details.errors[0].message.includes('adoptsFrom'),
      'error mentions missing adoptsFrom',
    );
  });

  // -----------------------------------------------------------------------
  // Mixed GTS + JSON
  // -----------------------------------------------------------------------

  test('mixed GTS and JSON files — pass and fail independently', async function (assert) {
    let validGts = `import { CardDef } from "https://cardstack.com/base/card-api";
export class Hello extends CardDef {}`;

    let validJson = JSON.stringify({
      data: {
        type: 'card',
        attributes: { name: 'Test' },
        meta: {
          adoptsFrom: { module: '../hello', name: 'Hello' },
        },
      },
    });

    let invalidJson = '{ broken json }';

    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames(['hello.gts']),
        readFileFn: makeReadFile({
          'hello.gts': validGts,
          'Hello/good.json': validJson,
          'Hello/bad.json': invalidJson,
        }),
        searchSpecsFn: makeSearchSpecs([
          {
            specId: 'Spec/hello',
            exampleUrls: ['Hello/good.json', 'Hello/bad.json'],
          },
        ]),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed, 'fails because bad.json is invalid');
    assert.strictEqual(result.errors.length, 1, 'one error from bad.json');

    let details = result.details as unknown as ParseValidationDetails;
    assert.strictEqual(details.filesChecked, 3, 'checked 1 GTS + 2 JSON');
    assert.strictEqual(details.filesWithErrors, 1, 'only bad.json has errors');
  });

  // -----------------------------------------------------------------------
  // File discovery errors
  // -----------------------------------------------------------------------

  test('fetchFilenames error returns failed', async function (assert) {
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenamesError('network error'),
        searchSpecsFn: makeSearchSpecs([]),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed);
    assert.ok(
      result.errors[0].message.includes('Failed to discover files'),
      'error mentions discovery failure',
    );
  });

  test('searchSpecs error does not block GTS validation', async function (assert) {
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames(['hello.gts']),
        readFileFn: makeReadFile({
          'hello.gts': `export class Hello {}`,
        }),
        searchSpecsFn: makeSearchSpecsError('spec search failed'),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    // GTS validation should still pass even though spec search failed
    assert.true(result.passed);
    assert.strictEqual(result.step, 'parse');

    let details = result.details as unknown as ParseValidationDetails;
    assert.strictEqual(details.filesChecked, 1);
  });

  // -----------------------------------------------------------------------
  // Unreadable files
  // -----------------------------------------------------------------------

  test('unreadable GTS file returns error for that file', async function (assert) {
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames(['missing.gts']),
        readFileFn: makeReadFile({}),
        searchSpecsFn: makeSearchSpecs([]),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed);
    assert.strictEqual(result.errors.length, 1);
    assert.ok(
      result.errors[0].message.includes('Could not read'),
      'error mentions read failure',
    );
  });

  // -----------------------------------------------------------------------
  // formatForContext
  // -----------------------------------------------------------------------

  test('formatForContext for passed result with files', function (assert) {
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([]),
        readFileFn: makeReadFile({}),
        searchSpecsFn: makeSearchSpecs([]),
      }),
    );

    let result: ValidationStepResult = {
      step: 'parse',
      passed: true,
      files: ['hello.gts'],
      errors: [],
      details: {
        parseResultId: 'Validations/parse_test-1',
        filesChecked: 1,
        filesWithErrors: 0,
        totalErrors: 0,
        errors: [],
      } as unknown as Record<string, unknown>,
    };

    let context = step.formatForContext(result);
    assert.ok(context.includes('PASSED'), 'mentions PASSED');
    assert.ok(context.includes('1 file(s) checked'), 'mentions file count');
  });

  test('formatForContext for failed result', function (assert) {
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([]),
        readFileFn: makeReadFile({}),
        searchSpecsFn: makeSearchSpecs([]),
      }),
    );

    let result: ValidationStepResult = {
      step: 'parse',
      passed: false,
      files: ['bad.gts'],
      errors: [
        { file: 'bad.gts', message: 'bad.gts:3 GTS preprocessing error' },
      ],
      details: {
        parseResultId: 'Validations/parse_test-1',
        filesChecked: 1,
        filesWithErrors: 1,
        totalErrors: 1,
        errors: [
          { file: 'bad.gts', line: 3, message: 'GTS preprocessing error' },
        ],
      } as unknown as Record<string, unknown>,
    };

    let context = step.formatForContext(result);
    assert.ok(context.includes('FAILED'), 'mentions FAILED');
    assert.ok(context.includes('bad.gts'), 'includes filename');
  });

  test('formatForContext for passed result with no files returns empty', function (assert) {
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([]),
        readFileFn: makeReadFile({}),
        searchSpecsFn: makeSearchSpecs([]),
      }),
    );

    let result: ValidationStepResult = {
      step: 'parse',
      passed: true,
      files: [],
      errors: [],
    };

    let context = step.formatForContext(result);
    assert.strictEqual(context, '', 'empty when no files checked');
  });

  // -----------------------------------------------------------------------
  // parseGtsFile direct tests
  // -----------------------------------------------------------------------

  test('parseGtsFile returns empty for valid GTS', function (assert) {
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([]),
        readFileFn: makeReadFile({}),
        searchSpecsFn: makeSearchSpecs([]),
      }),
    );

    let errors = step.parseGtsFile(
      'valid.gts',
      `import { CardDef, Component } from "https://cardstack.com/base/card-api";
export class MyCard extends CardDef {
  static isolated = class Isolated extends Component<typeof MyCard> {
    <template><div>Hello</div></template>
  };
}`,
    );

    assert.strictEqual(errors.length, 0);
  });

  test('parseGtsFile catches unclosed template', function (assert) {
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([]),
        readFileFn: makeReadFile({}),
        searchSpecsFn: makeSearchSpecs([]),
      }),
    );

    let errors = step.parseGtsFile(
      'bad.gts',
      `export class Foo {
  static t = class {
    <template><div>hi</div>
  };
}`,
    );

    assert.ok(errors.length > 0, 'has errors');
    assert.strictEqual(errors[0].file, 'bad.gts');
    assert.ok(errors[0].message.includes('GTS preprocessing error'));
  });

  // -----------------------------------------------------------------------
  // parseJsonFile direct tests
  // -----------------------------------------------------------------------

  test('parseJsonFile returns empty for valid card document', function (assert) {
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([]),
        readFileFn: makeReadFile({}),
        searchSpecsFn: makeSearchSpecs([]),
      }),
    );

    let errors = step.parseJsonFile(
      'test.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: { name: 'Test' },
          meta: { adoptsFrom: { module: '../card', name: 'Card' } },
        },
      }),
    );

    assert.strictEqual(errors.length, 0);
  });

  test('parseJsonFile catches invalid JSON', function (assert) {
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([]),
        readFileFn: makeReadFile({}),
        searchSpecsFn: makeSearchSpecs([]),
      }),
    );

    let errors = step.parseJsonFile('test.json', '{broken}');

    assert.ok(errors.length > 0);
    assert.ok(errors[0].message.includes('Invalid JSON'));
  });

  test('parseJsonFile catches missing adoptsFrom.module', function (assert) {
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([]),
        readFileFn: makeReadFile({}),
        searchSpecsFn: makeSearchSpecs([]),
      }),
    );

    let errors = step.parseJsonFile(
      'test.json',
      JSON.stringify({
        data: {
          type: 'card',
          meta: { adoptsFrom: { name: 'Card' } },
        },
      }),
    );

    assert.ok(errors.length > 0);
    assert.ok(errors[0].message.includes('module'));
  });

  test('parseJsonFile catches non-object document', function (assert) {
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([]),
        readFileFn: makeReadFile({}),
        searchSpecsFn: makeSearchSpecs([]),
      }),
    );

    let errors = step.parseJsonFile('test.json', '"just a string"');

    assert.ok(errors.length > 0);
    assert.ok(errors[0].message.includes('JSON object'));
  });
});
