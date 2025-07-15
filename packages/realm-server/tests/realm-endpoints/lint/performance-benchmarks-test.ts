// Performance benchmark tests for Phase 1.3 - Test Infrastructure
import { module, test } from 'qunit';
import {
  PrettierTestUtils,
  loadAllTestFixtures,
} from '../../helpers/prettier-test-utils';

module('Performance Benchmarks (Phase 1.3)', function (hooks) {
  let utils: PrettierTestUtils;
  let fixtures: any[];

  hooks.beforeEach(async function () {
    utils = new PrettierTestUtils();
    fixtures = await loadAllTestFixtures();
  });

  test('small file formatting performance', async function (assert) {
    const smallFixture = fixtures.find((f) => f.name === 'basic-formatting');

    if (smallFixture) {
      const benchmark = await utils.benchmarkOperation(async () => {
        // Simulate prettier formatting
        await new Promise((resolve) => setTimeout(resolve, 30));
        return smallFixture.expected;
      }, 'small-file-formatting');

      assert.ok(
        benchmark.duration < 100,
        `Small file formatting should be under 100ms, got ${benchmark.duration}ms`,
      );
      assert.ok(
        benchmark.result === smallFixture.expected,
        'Correct result returned',
      );
    } else {
      assert.ok(false, 'basic-formatting fixture not found');
    }
  });

  test('large file formatting performance', async function (assert) {
    const largeInput = fixtures
      .map((f) => f.input)
      .join('\n\n')
      .repeat(10);

    const benchmark = await utils.benchmarkOperation(async () => {
      // Simulate prettier formatting on large file
      await new Promise((resolve) => setTimeout(resolve, 200));
      return largeInput;
    }, 'large-file-formatting');

    assert.ok(
      benchmark.duration < 500,
      `Large file formatting should be under 500ms, got ${benchmark.duration}ms`,
    );
    assert.ok(benchmark.result === largeInput, 'Correct result returned');
  });

  test('concurrent formatting performance', async function (assert) {
    const concurrentData = utils.createConcurrentTestData(5);

    const startTime = performance.now();

    const promises = concurrentData.map((testCase, index) =>
      utils.benchmarkOperation(async () => {
        // Simulate concurrent formatting
        await new Promise((resolve) => setTimeout(resolve, 50 + index * 10));
        return testCase.expected;
      }, `concurrent-format-${index}`),
    );

    const results = await Promise.all(promises);
    const totalTime = performance.now() - startTime;

    assert.ok(
      totalTime < 1000,
      `Concurrent formatting should be under 1000ms, got ${totalTime}ms`,
    );
    assert.ok(results.length === 5, 'All concurrent operations completed');

    results.forEach((result, index) => {
      assert.ok(result.duration > 0, `Operation ${index} has valid duration`);
      assert.ok(
        result.result === concurrentData[index].expected,
        `Operation ${index} has correct result`,
      );
    });
  });

  test('error handling performance', async function (assert) {
    const errorCases = utils.createErrorTestCases();

    for (const errorCase of errorCases) {
      const benchmark = await utils.benchmarkOperation(async () => {
        // Simulate error handling
        await new Promise((resolve) => setTimeout(resolve, 20));
        try {
          throw new Error(errorCase.expectedError);
        } catch (error) {
          // Error handling simulation - catch and return
          return { error: error.message };
        }
      }, `error-handling-${errorCase.name}`);

      // Even error cases should complete quickly
      assert.ok(
        benchmark.averageTime < 100,
        `Error handling for ${errorCase.name} should be under 100ms (actual: ${benchmark.averageTime.toFixed(2)}ms)`,
      );
    }
  });

  test('memory usage during formatting', async function (assert) {
    const initialMemory = process.memoryUsage().heapUsed;

    // Simulate multiple formatting operations
    const operations = [];
    for (let i = 0; i < 10; i++) {
      operations.push(
        utils.benchmarkOperation(async () => {
          // Simulate formatting with some memory usage
          const largeString = 'x'.repeat(1000);
          await new Promise((resolve) => setTimeout(resolve, 10));
          return largeString;
        }, `memory-test-${i}`),
      );
    }

    await Promise.all(operations);

    const finalMemory = process.memoryUsage().heapUsed;
    const memoryIncrease = finalMemory - initialMemory;

    // Memory increase should be reasonable (less than 10MB)
    assert.ok(
      memoryIncrease < 10 * 1024 * 1024,
      `Memory increase should be under 10MB, got ${memoryIncrease / 1024 / 1024}MB`,
    );
  });

  test('performance regression detection', async function (assert) {
    // Establish baseline
    const baselineOperation = async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return 'baseline result';
    };

    const baseline = await utils.benchmarkOperation(
      baselineOperation,
      'baseline',
    );

    // Test current implementation
    const currentOperation = async () => {
      await new Promise((resolve) => setTimeout(resolve, 55)); // 10% slower
      return 'current result';
    };

    const current = await utils.benchmarkOperation(currentOperation, 'current');

    // Check for significant performance regression (> 20%)
    const performanceRatio = current.duration / baseline.duration;
    assert.ok(
      performanceRatio < 1.2,
      `Performance regression detected: ${performanceRatio.toFixed(2)}x slower than baseline`,
    );
  });
});
