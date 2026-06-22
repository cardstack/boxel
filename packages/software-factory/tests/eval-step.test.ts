import QUnit from 'qunit';
const { module, test } = QUnit;

import type { ValidationStepResult } from '../src/factory-agent/index.ts';

import {
  EvalValidationStep,
  type EvalValidationStepConfig,
  type EvalValidationDetails,
  type EvalModuleResult,
} from '../src/validators/eval-step.ts';
import { createMockClient } from './helpers/mock-client.ts';
import { createTestWorkspace } from './helpers/workspace-fixture.ts';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeConfig(
  overrides: Partial<EvalValidationStepConfig> = {},
): EvalValidationStepConfig {
  return {
    client: createMockClient(),
    realmServerUrl: 'https://example.test/',
    evalResultsModuleUrl: 'https://example.test/eval-result',
    workspaceDir: createTestWorkspace().dir,
    // Default to a no-op sequence resolver for unit tests
    getNextSequenceNumber: async () => 1,
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

function makeEvaluateModule(
  results: Record<string, EvalModuleResult>,
): (moduleUrl: string, realmUrl: string) => Promise<EvalModuleResult> {
  return async (moduleUrl) => {
    // Match by the last segment of the module URL (without extension)
    for (let [key, value] of Object.entries(results)) {
      if (moduleUrl.includes(key)) {
        return value;
      }
    }
    return { passed: true };
  };
}

function makeEvaluateModuleThrows(
  errorMessage: string,
): (moduleUrl: string, realmUrl: string) => Promise<EvalModuleResult> {
  return async () => {
    throw new Error(errorMessage);
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

module('EvalValidationStep', function () {
  test('no evaluable files returns passed', async function (assert) {
    let step = new EvalValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([
          'Cards/my-card.json',
          'index.json',
          'realm.json',
          'hello.test.gts',
        ]),
        evaluateModuleFn: makeEvaluateModule({}),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.true(result.passed);
    assert.strictEqual(result.step, 'evaluate');
    assert.strictEqual(result.errors.length, 0);
    assert.deepEqual(result.files, []);
  });

  test('all modules pass evaluation', async function (assert) {
    let step = new EvalValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([
          'hello.gts',
          'utils.gts',
          'index.json',
        ]),
        evaluateModuleFn: makeEvaluateModule({
          hello: { passed: true },
          utils: { passed: true },
        }),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.true(result.passed);
    assert.strictEqual(result.step, 'evaluate');
    assert.deepEqual(result.files, ['hello.gts', 'utils.gts']);
    assert.ok(result.details, 'has details');

    let details = result.details as unknown as EvalValidationDetails;
    assert.strictEqual(details.modulesChecked, 2);
    assert.strictEqual(details.modulesWithErrors, 0);
    assert.strictEqual(details.modules.length, 0);
  });

  test('module with evaluation error returns failed', async function (assert) {
    let step = new EvalValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames(['hello.gts']),
        evaluateModuleFn: makeEvaluateModule({
          hello: {
            passed: false,
            error: 'Cannot find module ./does-not-exist',
            stackTrace: 'Error: Cannot find module...',
          },
        }),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed);
    assert.strictEqual(result.step, 'evaluate');
    assert.ok(result.errors.length > 0, 'has errors');
    assert.ok(result.details, 'has details');

    let details = result.details as unknown as EvalValidationDetails;
    assert.strictEqual(details.modulesChecked, 1);
    assert.strictEqual(details.modulesWithErrors, 1);
    assert.strictEqual(details.modules[0].path, 'hello.gts');
    assert.ok(details.modules[0].error.includes('Cannot find module'));
  });

  test('*.test.gts files are excluded from evaluation', async function (assert) {
    let step = new EvalValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([
          'hello.gts',
          'hello.test.gts',
          'utils.gts',
          'utils.test.gts',
          'data.json',
        ]),
        evaluateModuleFn: makeEvaluateModule({}),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.true(result.passed);
    assert.deepEqual(result.files, ['hello.gts', 'utils.gts']);
  });

  test('file discovery failure returns failed', async function (assert) {
    let step = new EvalValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenamesError('Network timeout'),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed);
    assert.ok(result.errors[0].message.includes('Network timeout'));
  });

  test('evaluateModuleFn throws returns failed with error message', async function (assert) {
    let step = new EvalValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames(['hello.gts']),
        evaluateModuleFn: makeEvaluateModuleThrows('Prerender unavailable'),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors[0].message.includes('Prerender unavailable'));
  });

  test('issueId is used for slug derivation in artifact naming', async function (assert) {
    let step = new EvalValidationStep(
      makeConfig({
        issueId: 'Issues/sticky-note-define-core',
        fetchFilenames: makeFetchFilenames(['hello.gts']),
        evaluateModuleFn: makeEvaluateModule({}),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.true(result.passed);
    let details = result.details as unknown as EvalValidationDetails;
    assert.ok(
      details.evalResultId.includes('eval_sticky-note-define-core'),
      `evalResultId "${details.evalResultId}" includes issue slug`,
    );
  });

  test('multiple failing modules all reported', async function (assert) {
    let step = new EvalValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([
          'card-a.gts',
          'card-b.gts',
          'card-c.gts',
        ]),
        evaluateModuleFn: makeEvaluateModule({
          'card-a': { passed: false, error: 'Missing import A' },
          'card-b': { passed: true },
          'card-c': { passed: false, error: 'Runtime error in C' },
        }),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed);

    let details = result.details as unknown as EvalValidationDetails;
    assert.strictEqual(details.modulesChecked, 3);
    assert.strictEqual(details.modulesWithErrors, 2);
    assert.strictEqual(details.modules.length, 2);
    assert.ok(details.modules.some((m) => m.path === 'card-a.gts'));
    assert.ok(details.modules.some((m) => m.path === 'card-c.gts'));
  });

  test('formatForContext with passing result and details', function (assert) {
    let step = new EvalValidationStep(makeConfig());

    let result: ValidationStepResult = {
      step: 'evaluate',
      passed: true,
      errors: [],
      details: {
        evalResultId: 'Validations/eval_validation-1',
        modulesChecked: 3,
        modulesWithErrors: 0,
        modules: [],
      },
    };

    let formatted = step.formatForContext(result);
    assert.ok(formatted.includes('PASSED'));
    assert.ok(formatted.includes('3'));
    assert.ok(formatted.includes('no evaluation errors'));
  });

  test('formatForContext with empty pass returns empty string', function (assert) {
    let step = new EvalValidationStep(makeConfig());

    let result: ValidationStepResult = {
      step: 'evaluate',
      passed: true,
      errors: [],
    };

    let formatted = step.formatForContext(result);
    assert.strictEqual(formatted, '');
  });

  test('formatForContext with failing result and module errors', function (assert) {
    let step = new EvalValidationStep(makeConfig());

    let result: ValidationStepResult = {
      step: 'evaluate',
      passed: false,
      errors: [{ message: 'hello.gts: Cannot find module ./missing' }],
      details: {
        evalResultId: 'Validations/eval_validation-1',
        modulesChecked: 2,
        modulesWithErrors: 1,
        modules: [
          {
            path: 'hello.gts',
            error: 'Cannot find module ./missing',
          },
        ],
      },
    };

    let formatted = step.formatForContext(result);
    assert.ok(formatted.includes('FAILED'));
    assert.ok(formatted.includes('2 module(s) checked'));
    assert.ok(formatted.includes('1 module(s) with errors'));
    assert.ok(formatted.includes('hello.gts'));
    assert.ok(formatted.includes('Cannot find module'));
  });

  test('formatForContext without details falls back to errors', function (assert) {
    let step = new EvalValidationStep(makeConfig());

    let result: ValidationStepResult = {
      step: 'evaluate',
      passed: false,
      errors: [{ message: 'Eval service failed' }],
    };

    let formatted = step.formatForContext(result);
    assert.ok(formatted.includes('FAILED'));
    assert.ok(formatted.includes('Eval service failed'));
  });
});
