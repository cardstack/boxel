import { module, test } from 'qunit';

import type {
  ValidationStep,
  ValidationStepResult,
  ValidationResults,
} from '../src/factory-agent';

import {
  ValidationPipeline,
  createDefaultPipeline,
  type ValidationStepRunner,
} from '../src/issue-loop';

import { NoOpStepRunner } from '../src/validators/noop-step';
import { InstantiateValidationStep } from '../src/validators/instantiate-step';
import { createMockClient } from './helpers/mock-client';
import { createTestWorkspace } from './helpers/workspace-fixture';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

class MockStepRunner implements ValidationStepRunner {
  readonly step: ValidationStep;
  private result: ValidationStepResult;
  runCount = 0;

  constructor(step: ValidationStep, result: Partial<ValidationStepResult>) {
    this.step = step;
    this.result = {
      step,
      passed: true,
      errors: [],
      ...result,
    };
  }

  async run(_targetRealm: string): Promise<ValidationStepResult> {
    this.runCount++;
    return this.result;
  }

  formatForContext(result: ValidationStepResult): string {
    if (result.passed) {
      return '';
    }
    let errors = result.errors.map((e) => `- ${e.message}`).join('\n');
    return `## ${result.step}: FAILED\n${errors}`;
  }
}

class ThrowingStepRunner implements ValidationStepRunner {
  readonly step: ValidationStep;
  private errorMessage: string;
  runCount = 0;

  constructor(step: ValidationStep, errorMessage: string) {
    this.step = step;
    this.errorMessage = errorMessage;
  }

  async run(_targetRealm: string): Promise<ValidationStepResult> {
    this.runCount++;
    throw new Error(this.errorMessage);
  }

  formatForContext(_result: ValidationStepResult): string {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

module('ValidationPipeline', function () {
  test('empty pipeline returns passed with no steps', async function (assert) {
    let pipeline = new ValidationPipeline([]);
    let results = await pipeline.validate('https://example.test/realm/');

    assert.true(results.passed);
    assert.strictEqual(results.steps.length, 0);
  });

  test('all passing steps returns passed', async function (assert) {
    let pipeline = new ValidationPipeline([
      new MockStepRunner('parse', { passed: true }),
      new MockStepRunner('lint', { passed: true }),
      new MockStepRunner('test', { passed: true }),
    ]);

    let results = await pipeline.validate('https://example.test/realm/');

    assert.true(results.passed);
    assert.strictEqual(results.steps.length, 3);
    assert.true(results.steps.every((s) => s.passed));
  });

  test('one failing step makes overall result failed', async function (assert) {
    let pipeline = new ValidationPipeline([
      new MockStepRunner('parse', { passed: true }),
      new MockStepRunner('lint', {
        passed: false,
        errors: [{ message: 'lint violation' }],
      }),
      new MockStepRunner('test', { passed: true }),
    ]);

    let results = await pipeline.validate('https://example.test/realm/');

    assert.false(results.passed);
    assert.strictEqual(results.steps.length, 3);

    let lintStep = results.steps.find((s) => s.step === 'lint');
    assert.false(lintStep?.passed);
    assert.strictEqual(lintStep?.errors.length, 1);
    assert.strictEqual(lintStep?.errors[0].message, 'lint violation');
  });

  test('multiple failing steps all reported', async function (assert) {
    let pipeline = new ValidationPipeline([
      new MockStepRunner('parse', {
        passed: false,
        errors: [{ message: 'syntax error' }],
      }),
      new MockStepRunner('lint', {
        passed: false,
        errors: [{ message: 'lint error' }],
      }),
      new MockStepRunner('test', {
        passed: false,
        errors: [{ message: 'test failure' }],
      }),
    ]);

    let results = await pipeline.validate('https://example.test/realm/');

    assert.false(results.passed);
    assert.strictEqual(results.steps.filter((s) => !s.passed).length, 3);
  });

  test('steps run concurrently (all runners invoked)', async function (assert) {
    let runners = [
      new MockStepRunner('parse', { passed: true }),
      new MockStepRunner('lint', { passed: true }),
      new MockStepRunner('evaluate', { passed: true }),
      new MockStepRunner('instantiate', { passed: true }),
      new MockStepRunner('test', { passed: true }),
    ];

    let pipeline = new ValidationPipeline(runners);
    await pipeline.validate('https://example.test/realm/');

    for (let runner of runners) {
      assert.strictEqual(runner.runCount, 1, `${runner.step} should run once`);
    }
  });

  test('exception in one step does not prevent others', async function (assert) {
    let goodStep = new MockStepRunner('parse', { passed: true });
    let throwingStep = new ThrowingStepRunner('lint', 'kaboom');
    let anotherGoodStep = new MockStepRunner('test', { passed: true });

    let pipeline = new ValidationPipeline([
      goodStep,
      throwingStep,
      anotherGoodStep,
    ]);

    let results = await pipeline.validate('https://example.test/realm/');

    assert.false(results.passed);
    assert.strictEqual(results.steps.length, 3);

    // Good steps still ran
    assert.strictEqual(goodStep.runCount, 1);
    assert.strictEqual(anotherGoodStep.runCount, 1);
    assert.strictEqual(throwingStep.runCount, 1);

    // Throwing step captured as failed
    let lintStep = results.steps.find((s) => s.step === 'lint');
    assert.false(lintStep?.passed);
    assert.strictEqual(lintStep?.errors.length, 1);
    assert.strictEqual(lintStep?.errors[0].message, 'kaboom');

    // Good steps passed
    assert.true(results.steps.find((s) => s.step === 'parse')?.passed);
    assert.true(results.steps.find((s) => s.step === 'test')?.passed);
  });

  test('exception captured as failed step result with error message', async function (assert) {
    let pipeline = new ValidationPipeline([
      new ThrowingStepRunner('evaluate', 'module load failed'),
    ]);

    let results = await pipeline.validate('https://example.test/realm/');

    assert.false(results.passed);
    assert.strictEqual(results.steps[0].step, 'evaluate');
    assert.false(results.steps[0].passed);
    assert.strictEqual(
      results.steps[0].errors[0].message,
      'module load failed',
    );
  });

  test('createDefaultPipeline creates 5 steps in correct order', async function (assert) {
    let pipeline = createDefaultPipeline({
      client: createMockClient(),
      realmServerUrl: 'https://example.test/',
      hostAppUrl: 'https://example.test/',
      testResultsModuleUrl: 'https://example.test/test-results',
      lintResultsModuleUrl: 'https://example.test/lint-result',
      evalResultsModuleUrl: 'https://example.test/eval-result',
      instantiateResultsModuleUrl: 'https://example.test/instantiate-result',
      parseResultsModuleUrl: 'https://example.test/parse-result',
      workspaceDir: createTestWorkspace().dir,
      // Inject a fetchFilenames that returns no files so the test, lint,
      // eval, and parse steps return "nothing to validate" without hitting a real realm
      fetchFilenames: async () => ({ filenames: [] }),
      // Inject a searchSpecsFn that returns no specs so the instantiate
      // step returns "nothing to validate" without hitting a real realm
      searchSpecsFn: async () => ({ specs: [] }),
      // Inject a parseSearchSpecsFn that returns no specs so the parse step's
      // JSON validation returns "nothing to validate" without hitting a real realm
      parseSearchSpecsFn: async () => ({ specs: [] }),
    });

    // Verify step count and order by running validate and inspecting results
    let results = await pipeline.validate('https://example.test/realm/');

    assert.strictEqual(results.steps.length, 5, 'has 5 steps');
    assert.strictEqual(results.steps[0].step, 'parse', 'step 1 is parse');
    assert.strictEqual(results.steps[1].step, 'lint', 'step 2 is lint');
    assert.strictEqual(results.steps[2].step, 'evaluate', 'step 3 is evaluate');
    assert.strictEqual(
      results.steps[3].step,
      'instantiate',
      'step 4 is instantiate',
    );
    assert.strictEqual(results.steps[4].step, 'test', 'step 5 is test');
    assert.true(results.passed, 'all steps pass (NoOp + no test files)');
  });

  test('formatForContext returns simple message when all pass', function (assert) {
    let pipeline = new ValidationPipeline([
      new MockStepRunner('parse', { passed: true }),
    ]);

    let results: ValidationResults = {
      passed: true,
      steps: [{ step: 'parse', passed: true, errors: [] }],
    };

    let formatted = pipeline.formatForContext(results);
    assert.strictEqual(formatted, 'All validation steps passed.');
  });

  test('formatForContext includes failure details from runners', function (assert) {
    let runner = new MockStepRunner('lint', {
      passed: false,
      errors: [{ message: 'unexpected semicolon' }],
    });

    let pipeline = new ValidationPipeline([runner]);

    let results: ValidationResults = {
      passed: false,
      steps: [
        {
          step: 'lint',
          passed: false,
          errors: [{ message: 'unexpected semicolon' }],
        },
      ],
    };

    let formatted = pipeline.formatForContext(results);
    assert.ok(formatted.includes('FAILED'), 'includes FAILED');
    assert.ok(
      formatted.includes('unexpected semicolon'),
      'includes error message',
    );
  });
});

module('NoOpStepRunner', function () {
  test('always returns passed with empty errors', async function (assert) {
    let runner = new NoOpStepRunner('parse');
    let result = await runner.run('https://example.test/realm/');

    assert.strictEqual(result.step, 'parse');
    assert.true(result.passed);
    assert.strictEqual(result.errors.length, 0);
  });

  test('formatForContext returns empty string', function (assert) {
    let runner = new NoOpStepRunner('lint');
    let result: ValidationStepResult = {
      step: 'lint',
      passed: true,
      errors: [],
    };

    assert.strictEqual(runner.formatForContext(result), '');
  });
});

module('InstantiateValidationStep', function () {
  test('passes with no artifact when no specs and no modules exist (bootstrap)', async function (assert) {
    let step = new InstantiateValidationStep({
      client: createMockClient(),
      realmServerUrl: 'https://example.test/',
      instantiateResultsModuleUrl: 'https://example.test/instantiate-result',
      workspaceDir: createTestWorkspace().dir,
      searchSpecsFn: async () => ({ specs: [] }),
      fetchFilenames: async () => ({ filenames: [] }),
      getNextSequenceNumber: async () => 1,
    });

    let result = await step.run('https://example.test/realm/');

    assert.strictEqual(result.step, 'instantiate');
    assert.true(result.passed, 'passes when nothing to validate');
    assert.strictEqual(result.errors.length, 0);
    assert.notOk(
      result.details,
      'no artifact details created for empty bootstrap case',
    );
  });

  test('fails with no artifact when modules exist but no specs found', async function (assert) {
    let step = new InstantiateValidationStep({
      client: createMockClient(),
      realmServerUrl: 'https://example.test/',
      instantiateResultsModuleUrl: 'https://example.test/instantiate-result',
      workspaceDir: createTestWorkspace().dir,
      searchSpecsFn: async () => ({ specs: [] }),
      fetchFilenames: async () => ({
        filenames: ['my-card.gts', 'my-card.test.gts'],
      }),
      getNextSequenceNumber: async () => 1,
    });

    let result = await step.run('https://example.test/realm/');

    assert.strictEqual(result.step, 'instantiate');
    assert.false(result.passed, 'fails when modules exist but no specs');
    assert.true(result.errors.length > 0, 'has error message');
    assert.true(
      result.errors[0].message.includes('no Spec cards were found'),
      'error mentions missing specs',
    );
    assert.notOk(
      result.details,
      'no artifact details — specs must exist before creating artifacts',
    );
  });

  test('test files alone do not trigger missing-spec failure', async function (assert) {
    let step = new InstantiateValidationStep({
      client: createMockClient(),
      realmServerUrl: 'https://example.test/',
      instantiateResultsModuleUrl: 'https://example.test/instantiate-result',
      workspaceDir: createTestWorkspace().dir,
      searchSpecsFn: async () => ({ specs: [] }),
      fetchFilenames: async () => ({
        filenames: ['my-card.test.gts'],
      }),
      getNextSequenceNumber: async () => 1,
    });

    let result = await step.run('https://example.test/realm/');

    assert.strictEqual(result.step, 'instantiate');
    assert.true(result.passed, 'passes when only test files exist');
  });

  test('passes with artifact when spec with no examples instantiates successfully', async function (assert) {
    // Spec has no linkedExamples — falls back to empty-data instantiation
    let step = new InstantiateValidationStep({
      client: createMockClient(),
      realmServerUrl: 'https://example.test/',
      instantiateResultsModuleUrl: 'https://example.test/instantiate-result',
      workspaceDir: createTestWorkspace().dir,
      searchSpecsFn: async () => ({
        specs: [
          {
            specId: 'Spec/my-card',
            moduleUrl: 'https://example.test/realm/my-card',
            cardName: 'MyCard',
            exampleUrls: [],
          },
        ],
      }),
      instantiateCardFn: async () => ({ passed: true }),
      getNextSequenceNumber: async () => 1,
    });

    let result = await step.run('https://example.test/realm/');

    assert.strictEqual(result.step, 'instantiate');
    assert.true(result.passed, 'passes when instantiation succeeds');
    assert.strictEqual(result.errors.length, 0);
    assert.ok(result.details, 'artifact details present when specs exist');
    let details = result.details as Record<string, unknown>;
    assert.ok(
      (details.instantiateResultId as string)?.includes('instantiate_'),
      'artifact ID present',
    );
    assert.strictEqual(details.cardsChecked, 1, '1 card checked');
    assert.strictEqual(details.cardsWithErrors, 0, '0 errors');
  });

  test('fails when empty-data instantiation fails', async function (assert) {
    // Spec has no linkedExamples — empty-data instantiation is attempted but fails
    let step = new InstantiateValidationStep({
      client: createMockClient(),
      realmServerUrl: 'https://example.test/',
      instantiateResultsModuleUrl: 'https://example.test/instantiate-result',
      workspaceDir: createTestWorkspace().dir,
      searchSpecsFn: async () => ({
        specs: [
          {
            specId: 'Spec/my-card',
            moduleUrl: 'https://example.test/realm/my-card',
            cardName: 'MyCard',
            exampleUrls: [],
          },
        ],
      }),
      instantiateCardFn: async () => ({
        passed: false,
        error: 'Expected array for field value tags',
      }),
      getNextSequenceNumber: async () => 1,
    });

    let result = await step.run('https://example.test/realm/');

    assert.strictEqual(result.step, 'instantiate');
    assert.false(result.passed, 'fails when instantiation fails');
    assert.true(result.errors.length > 0, 'has errors');
    assert.true(
      result.errors[0].message.includes('Expected array for field value'),
      'error message propagated',
    );
  });
});
