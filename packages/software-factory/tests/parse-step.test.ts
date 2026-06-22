import QUnit from 'qunit';
const { module, test } = QUnit;

import type { ValidationStepResult } from '../src/factory-agent/index.ts';

import {
  ParseValidationStep,
  type ParseValidationStepConfig,
  type ParseValidationDetails,
  type SpecExampleInfo,
  parseJsonFile,
  validateCardDocumentStructure,
} from '../src/validators/parse-step.ts';
import type { ParseErrorData } from '../src/parse-result-cards.ts';
import { createMockClient } from './helpers/mock-client.ts';
import { createTestWorkspace } from './helpers/workspace-fixture.ts';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeConfig(
  overrides: Partial<ParseValidationStepConfig> = {},
): ParseValidationStepConfig {
  return {
    client: createMockClient(),
    realmServerUrl: 'https://example.test/',
    parseResultsModuleUrl: 'https://example.test/parse-result',
    workspaceDir: createTestWorkspace().dir,
    getNextSequenceNumber: async () => 1,
    // Default glint check mock — returns no errors (clean files)
    runGlintCheckFn: async () => [],
    ...overrides,
  };
}

function makeFetchFilenames(
  filenames: string[],
): (realmUrl: string) => Promise<{ filenames: string[]; error?: string }> {
  return async () => ({ filenames });
}

function makeFetchFilenamesError(
  error: string,
): (realmUrl: string) => Promise<{ filenames: string[]; error?: string }> {
  return async () => ({ filenames: [], error });
}

function makeReadFile(
  contents: Record<string, string>,
): (
  realmUrl: string,
  path: string,
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

function makeGlintCheck(
  errors: ParseErrorData[],
): (files: { path: string; content: string }[]) => Promise<ParseErrorData[]> {
  return async () => errors;
}

function makeGlintCheckThrows(
  message: string,
): (files: { path: string; content: string }[]) => Promise<ParseErrorData[]> {
  return async () => {
    throw new Error(message);
  };
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
          'realm.json',
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
  // GTS/TS file discovery
  // -----------------------------------------------------------------------

  test('discovers .gts, .gjs, .ts, and test files but not .js or .json', async function (assert) {
    let discoveredFiles: string[] = [];
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([
          'hello.gts',
          'world.gjs',
          'utils.ts',
          'helper.js',
          'Cards/my-card.json',
          'hello.test.gts',
          'utils.test.ts',
        ]),
        readFileFn: makeReadFile({
          'hello.gts': 'export class Hello {}',
          'world.gjs': 'export default class World {}',
          'utils.ts': 'export function hello() {}',
          'hello.test.gts': 'import { test } from "qunit";',
          'utils.test.ts': 'import { test } from "qunit";',
        }),
        searchSpecsFn: makeSearchSpecs([]),
        runGlintCheckFn: async (files) => {
          discoveredFiles = files.map((f) => f.path);
          return [];
        },
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.true(result.passed);
    // .js and .json are excluded; .test.gts and .test.ts are included
    assert.deepEqual(result.files, [
      'hello.gts',
      'hello.test.gts',
      'utils.test.ts',
      'utils.ts',
      'world.gjs',
    ]);
    assert.deepEqual(discoveredFiles, [
      'hello.gts',
      'hello.test.gts',
      'utils.test.ts',
      'utils.ts',
      'world.gjs',
    ]);
  });

  // -----------------------------------------------------------------------
  // GTS parsing: valid files (glint returns no errors)
  // -----------------------------------------------------------------------

  test('valid GTS files return passed', async function (assert) {
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames(['hello.gts', 'world.gts']),
        readFileFn: makeReadFile({
          'hello.gts': 'export class Hello {}',
          'world.gts': 'export class World {}',
        }),
        searchSpecsFn: makeSearchSpecs([]),
        runGlintCheckFn: makeGlintCheck([]),
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
  // GTS parsing: glint returns errors
  // -----------------------------------------------------------------------

  test('GTS file with type error returns failed', async function (assert) {
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames(['bad.gts']),
        readFileFn: makeReadFile({
          'bad.gts': 'export class Bad { x: number = "string"; }',
        }),
        searchSpecsFn: makeSearchSpecs([]),
        runGlintCheckFn: makeGlintCheck([
          {
            file: 'bad.gts',
            line: 1,
            column: 32,
            message: "Type 'string' is not assignable to type 'number'.",
          },
        ]),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed);
    assert.strictEqual(result.step, 'parse');
    assert.ok(result.errors.length > 0, 'has errors');

    let details = result.details as unknown as ParseValidationDetails;
    assert.strictEqual(details.filesChecked, 1);
    assert.strictEqual(details.filesWithErrors, 1);
    assert.strictEqual(details.totalErrors, 1);
    assert.ok(
      details.errors[0].message.includes('not assignable'),
      'error mentions type mismatch',
    );
  });

  test('glint check throwing returns failed', async function (assert) {
    let step = new ParseValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames(['hello.gts']),
        readFileFn: makeReadFile({
          'hello.gts': 'export class Hello {}',
        }),
        searchSpecsFn: makeSearchSpecs([]),
        runGlintCheckFn: makeGlintCheckThrows('ember-tsc crashed'),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed);
    assert.ok(
      result.errors[0].message.includes('Glint check failed'),
      'error mentions glint failure',
    );
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
  // JSON parsing: errors
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
          'hello.gts': 'export class Hello {}',
          'Hello/good.json': validJson,
          'Hello/bad.json': invalidJson,
        }),
        searchSpecsFn: makeSearchSpecs([
          {
            specId: 'Spec/hello',
            exampleUrls: ['Hello/good.json', 'Hello/bad.json'],
          },
        ]),
        runGlintCheckFn: makeGlintCheck([]),
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
          'hello.gts': 'export class Hello {}',
        }),
        searchSpecsFn: makeSearchSpecsError('spec search failed'),
        runGlintCheckFn: makeGlintCheck([]),
      }),
    );

    let result = await step.run('https://example.test/realm/');

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
        {
          file: 'bad.gts',
          message:
            "bad.gts:3 Type 'string' is not assignable to type 'number'.",
        },
      ],
      details: {
        parseResultId: 'Validations/parse_test-1',
        filesChecked: 1,
        filesWithErrors: 1,
        totalErrors: 1,
        errors: [
          {
            file: 'bad.gts',
            line: 3,
            message: "Type 'string' is not assignable to type 'number'.",
          },
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
  // parseJsonFile / validateCardDocumentStructure direct tests
  // -----------------------------------------------------------------------

  test('parseJsonFile returns empty for valid card document', function (assert) {
    let errors = parseJsonFile(
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
    let errors = parseJsonFile('test.json', '{broken}');

    assert.ok(errors.length > 0);
    assert.ok(errors[0].message.includes('Invalid JSON'));
  });

  test('parseJsonFile catches missing adoptsFrom.module', function (assert) {
    let errors = parseJsonFile(
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
    let errors = parseJsonFile('test.json', '"just a string"');

    assert.ok(errors.length > 0);
    assert.ok(errors[0].message.includes('JSON object'));
  });

  test('validateCardDocumentStructure catches missing meta', function (assert) {
    let errors = validateCardDocumentStructure('test.json', {
      data: { type: 'card' } as Record<string, unknown>,
    });

    assert.ok(errors.length > 0);
    assert.ok(errors[0].message.includes('"data.meta" object'));
  });
});
