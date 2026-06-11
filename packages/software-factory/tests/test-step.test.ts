import { module, test } from 'qunit';

import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import type { ValidationStepResult } from '../src/factory-agent/index.ts';

import {
  TestValidationStep,
  type TestValidationStepConfig,
  type TestValidationDetails,
} from '../src/validators/test-step.ts';

import type {
  TestRunHandle,
  ExecuteTestRunOptions,
} from '../src/test-run-types.ts';
import { createMockClient } from './helpers/mock-client.ts';
import { createTestWorkspace } from './helpers/workspace-fixture.ts';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeConfig(
  overrides: Partial<TestValidationStepConfig> = {},
): TestValidationStepConfig {
  return {
    client: createMockClient(),
    realmServerUrl: 'https://example.test/',
    hostAppUrl: 'https://example.test/',
    testResultsModuleUrl: 'https://example.test/test-results',
    workspaceDir: createTestWorkspace().dir,
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

function makeExecuteTestRun(
  handle: TestRunHandle,
): (options: ExecuteTestRunOptions) => Promise<TestRunHandle> {
  return async () => handle;
}

function makeExecuteTestRunThrows(
  errorMessage: string,
): (options: ExecuteTestRunOptions) => Promise<TestRunHandle> {
  return async () => {
    throw new Error(errorMessage);
  };
}

function makeTestRunCardDocument(
  attrs: Record<string, unknown>,
): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes: attrs,
      meta: {
        adoptsFrom: { module: 'test-results', name: 'TestRun' },
      },
    },
  } as LooseSingleCardDocument;
}

function makeReadCard(document: LooseSingleCardDocument): (
  realmUrl: string,
  path: string,
) => Promise<{
  ok: boolean;
  document?: LooseSingleCardDocument;
  error?: string;
}> {
  return async () => ({ ok: true, document });
}

function makeReadCardError(error: string): (
  realmUrl: string,
  path: string,
) => Promise<{
  ok: boolean;
  document?: LooseSingleCardDocument;
  error?: string;
}> {
  return async () => ({ ok: false, error });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

module('TestValidationStep', function () {
  test('no .test.gts files returns passed', async function (assert) {
    let step = new TestValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames([
          'hello.gts',
          'Cards/my-card.json',
          'index.json',
        ]),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.true(result.passed);
    assert.strictEqual(result.step, 'test');
    assert.strictEqual(result.errors.length, 0);
    assert.deepEqual(result.files, []);
  });

  test('tests exist and pass — returns passed with details', async function (assert) {
    let testRunDoc = makeTestRunCardDocument({
      status: 'passed',
      passedCount: 3,
      failedCount: 0,
      durationMs: 1500,
      moduleResults: [
        {
          moduleRef: { module: 'hello.test.gts', name: 'default' },
          results: [
            { testName: 'renders greeting', status: 'passed', durationMs: 500 },
            { testName: 'shows title', status: 'passed', durationMs: 500 },
            { testName: 'has style', status: 'passed', durationMs: 500 },
          ],
        },
      ],
    });

    let step = new TestValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames(['hello.gts', 'hello.test.gts']),
        executeTestRun: makeExecuteTestRun({
          testRunId: 'Validations/test_validation-1',
          status: 'passed',
          sequenceNumber: 1,
        }),
        readCard: makeReadCard(testRunDoc),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.true(result.passed);
    assert.strictEqual(result.step, 'test');
    assert.deepEqual(result.files, ['hello.test.gts']);
    assert.ok(result.details, 'has details');

    let details = result.details as unknown as TestValidationDetails;
    assert.strictEqual(details.testRunId, 'Validations/test_validation-1');
    assert.strictEqual(details.passedCount, 3);
    assert.strictEqual(details.failedCount, 0);
    assert.strictEqual(details.failures.length, 0);
  });

  test('tests exist and fail — returns failed with detailed failures', async function (assert) {
    let testRunDoc = makeTestRunCardDocument({
      status: 'failed',
      passedCount: 1,
      failedCount: 1,
      durationMs: 2000,
      moduleResults: [
        {
          moduleRef: { module: 'hello.test.gts', name: 'default' },
          results: [
            { testName: 'renders greeting', status: 'passed', durationMs: 500 },
            {
              testName: 'shows author',
              status: 'failed',
              message: "Expected 'Alice' but got ''",
              stackTrace: 'at hello.test.gts:15:5',
              durationMs: 500,
            },
          ],
        },
      ],
    });

    let step = new TestValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames(['hello.test.gts']),
        executeTestRun: makeExecuteTestRun({
          testRunId: 'Validations/test_validation-1',
          status: 'failed',
          sequenceNumber: 1,
        }),
        readCard: makeReadCard(testRunDoc),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed);
    assert.strictEqual(result.step, 'test');
    assert.ok(result.errors.length > 0, 'has errors');
    assert.ok(result.details, 'has details');

    let details = result.details as unknown as TestValidationDetails;
    assert.strictEqual(details.passedCount, 1);
    assert.strictEqual(details.failedCount, 1);
    assert.strictEqual(details.failures.length, 1);
    assert.strictEqual(details.failures[0].testName, 'shows author');
    assert.ok(details.failures[0].message.includes("Expected 'Alice'"));
  });

  test('executeTestRun throws — returns failed with error message', async function (assert) {
    let step = new TestValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames(['hello.test.gts']),
        executeTestRun: makeExecuteTestRunThrows('Browser launch failed'),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed);
    assert.strictEqual(result.errors.length, 1);
    assert.ok(result.errors[0].message.includes('Browser launch failed'));
  });

  test('fetchFilenames fails — returns failed with error', async function (assert) {
    let step = new TestValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenamesError('Network timeout'),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed);
    assert.ok(result.errors[0].message.includes('Network timeout'));
  });

  test('sequence number tracked across calls', async function (assert) {
    let capturedOptions: ExecuteTestRunOptions[] = [];

    let step = new TestValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames(['hello.test.gts']),
        executeTestRun: async (options) => {
          capturedOptions.push(options);
          return {
            testRunId: `Validations/test_validation-${capturedOptions.length}`,
            status: 'passed' as const,
            sequenceNumber: capturedOptions.length,
          };
        },
        readCard: makeReadCard(
          makeTestRunCardDocument({
            status: 'passed',
            passedCount: 1,
            failedCount: 0,
            moduleResults: [],
          }),
        ),
      }),
    );

    await step.run('https://example.test/realm/');
    await step.run('https://example.test/realm/');

    assert.strictEqual(capturedOptions[0].lastSequenceNumber, 0);
    assert.strictEqual(capturedOptions[1].lastSequenceNumber, 1);
  });

  test('readCard failure falls back to handle-only result', async function (assert) {
    let step = new TestValidationStep(
      makeConfig({
        fetchFilenames: makeFetchFilenames(['hello.test.gts']),
        executeTestRun: makeExecuteTestRun({
          testRunId: 'Validations/test_validation-1',
          status: 'failed',
          errorMessage: '2 tests failed',
          sequenceNumber: 1,
        }),
        readCard: makeReadCardError('fetch failed'),
      }),
    );

    let result = await step.run('https://example.test/realm/');

    assert.false(result.passed);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors[0].message.includes('2 tests failed'));
    assert.notOk(result.details, 'no details when card read fails');
  });

  test('formatForContext with passing result and details', function (assert) {
    let step = new TestValidationStep(makeConfig());

    let result: ValidationStepResult = {
      step: 'test',
      passed: true,
      errors: [],
      details: {
        testRunId: 'Validations/test_validation-1',
        passedCount: 5,
        failedCount: 0,
        skippedCount: 0,
        durationMs: 1000,
        failures: [],
      },
    };

    let formatted = step.formatForContext(result);
    assert.ok(formatted.includes('PASSED'));
    assert.ok(formatted.includes('5'));
    assert.notOk(
      formatted.includes('skipped'),
      'no skipped note when skippedCount is 0',
    );
  });

  test('formatForContext with passing result includes skipped note', function (assert) {
    let step = new TestValidationStep(makeConfig());

    let result: ValidationStepResult = {
      step: 'test',
      passed: true,
      errors: [],
      details: {
        testRunId: 'Validations/test_validation-1',
        passedCount: 3,
        failedCount: 0,
        skippedCount: 2,
        durationMs: 800,
        failures: [],
      },
    };

    let formatted = step.formatForContext(result);
    assert.ok(formatted.includes('PASSED'));
    assert.ok(formatted.includes('3'));
    assert.ok(formatted.includes('2 skipped'), 'includes skipped count');
  });

  test('formatForContext with failing result and detailed failures', function (assert) {
    let step = new TestValidationStep(makeConfig());

    let result: ValidationStepResult = {
      step: 'test',
      passed: false,
      errors: [{ message: 'shows author: Expected Alice but got empty' }],
      details: {
        testRunId: 'Validations/test_validation-1',
        passedCount: 2,
        failedCount: 1,
        skippedCount: 0,
        durationMs: 1500,
        failures: [
          {
            testName: 'shows author',
            module: 'hello.test.gts',
            message: "Expected 'Alice' but got ''",
          },
        ],
      },
    };

    let formatted = step.formatForContext(result);
    assert.ok(formatted.includes('FAILED'));
    assert.ok(formatted.includes('2 passed'));
    assert.ok(formatted.includes('1 failed'));
    assert.ok(formatted.includes('shows author'));
    assert.ok(formatted.includes("Expected 'Alice'"));
  });

  test('formatForContext with failing result includes skipped note', function (assert) {
    let step = new TestValidationStep(makeConfig());

    let result: ValidationStepResult = {
      step: 'test',
      passed: false,
      errors: [{ message: 'shows author: Expected Alice but got empty' }],
      details: {
        testRunId: 'Validations/test_validation-1',
        passedCount: 2,
        failedCount: 1,
        skippedCount: 3,
        durationMs: 1500,
        failures: [
          {
            testName: 'shows author',
            module: 'hello.test.gts',
            message: "Expected 'Alice' but got ''",
          },
        ],
      },
    };

    let formatted = step.formatForContext(result);
    assert.ok(formatted.includes('FAILED'));
    assert.ok(formatted.includes('3 skipped'), 'includes skipped count');
  });

  test('formatForContext without details falls back to errors', function (assert) {
    let step = new TestValidationStep(makeConfig());

    let result: ValidationStepResult = {
      step: 'test',
      passed: false,
      errors: [{ message: 'Browser launch failed' }],
    };

    let formatted = step.formatForContext(result);
    assert.ok(formatted.includes('FAILED'));
    assert.ok(formatted.includes('Browser launch failed'));
  });

  test('issueId is used for slug derivation', async function (assert) {
    let capturedOptions: ExecuteTestRunOptions | undefined;

    let step = new TestValidationStep(
      makeConfig({
        issueId: 'Issues/sticky-note-define-core',
        fetchFilenames: makeFetchFilenames(['hello.test.gts']),
        executeTestRun: async (options) => {
          capturedOptions = options;
          return {
            testRunId: 'Validations/test_sticky-note-define-core-1',
            status: 'passed' as const,
            sequenceNumber: 1,
          };
        },
        readCard: makeReadCard(
          makeTestRunCardDocument({
            status: 'passed',
            passedCount: 1,
            failedCount: 0,
            moduleResults: [],
          }),
        ),
      }),
    );

    await step.run('https://example.test/realm/');

    assert.strictEqual(capturedOptions?.slug, 'sticky-note-define-core');
  });
});
