import type { TestResult } from './factory-agent';
import type {
  QunitResults,
  TestModuleResultData,
  TestResultEntryData,
  TestRunAttributes,
} from './test-run-types';

/**
 * Convert QUnit test results (collected via QUnit.on callbacks in the browser)
 * into `TestRunAttributes` — the serialized form of a TestRun card.
 */
export function parseQunitResults(results: QunitResults): TestRunAttributes {
  if (!results.runEnd) {
    return {
      status: 'error',
      passedCount: 0,
      failedCount: 0,
      errorMessage: 'QUnit did not complete — runEnd event was not received',
      moduleResults: [],
    };
  }

  // Group tests by QUnit module name
  let moduleMap = new Map<string, TestResultEntryData[]>();
  for (let test of results.tests) {
    let moduleName = test.module || 'default';
    if (!moduleMap.has(moduleName)) {
      moduleMap.set(moduleName, []);
    }

    // Map QUnit statuses to terminal states. Skipped/todo are not failures
    // and must not be 'pending' (which means "not yet executed" and would
    // confuse resume logic and isComplete checks).
    let status: TestResultEntryData['status'] =
      test.status === 'failed' ? 'failed' : 'passed';

    let entry: TestResultEntryData = {
      testName: test.name,
      status,
      durationMs: test.runtime,
    };

    if (test.status === 'failed' && test.errors.length > 0) {
      let error = test.errors[0];
      entry.message = error.message;
      if (error.stack) {
        entry.stackTrace = error.stack.slice(0, 500);
      }
    }

    moduleMap.get(moduleName)!.push(entry);
  }

  let moduleResults: TestModuleResultData[] = [];
  for (let [moduleName, testResults] of moduleMap) {
    moduleResults.push({
      moduleRef: { module: moduleName, name: 'default' },
      results: testResults,
    });
  }

  let allResults = moduleResults.flatMap((mr) => mr.results);
  let passedCount = allResults.filter((r) => r.status === 'passed').length;
  let failedCount = allResults.filter(
    (r) => r.status === 'failed' || r.status === 'error',
  ).length;

  let hasFailures = failedCount > 0;
  let status: TestRunAttributes['status'] = hasFailures ? 'failed' : 'passed';

  // If no tests ran at all, mark as error
  if (results.tests.length === 0) {
    status = 'error';
  }

  return {
    status,
    passedCount,
    failedCount,
    durationMs: results.runEnd.runtime,
    moduleResults,
  };
}

/**
 * Format a `TestResult` into a human-readable summary for agent prompts.
 */
export function formatTestResultSummary(result: TestResult): string {
  let lines: string[] = [
    `Status: ${result.status}`,
    `Passed: ${result.passedCount}, Failed: ${result.failedCount}`,
    `Duration: ${result.durationMs}ms`,
  ];

  if (result.failures.length > 0) {
    lines.push('', 'Failures:');
    for (let failure of result.failures) {
      lines.push(`  - ${failure.testName}`);
      lines.push(`    Error: ${failure.error}`);
      if (failure.stackTrace) {
        let truncated = failure.stackTrace.slice(0, 500);
        lines.push(`    Stack: ${truncated}`);
      }
    }
  }

  return lines.join('\n');
}
