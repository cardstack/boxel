import { rri } from '@cardstack/runtime-common/realm-identifiers';

import type { TestResult } from './factory-agent/index.ts';
import type {
  QunitResults,
  TestModuleResultData,
  TestResultEntryData,
  TestRunAttributes,
} from './test-run-types.ts';

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

    // Map QUnit statuses to terminal states. Skipped/todo are surfaced as
    // 'skipped' so the agent can see they weren't actually executed.
    // They must not be 'pending' (which means "not yet executed" and would
    // confuse resume logic and isComplete checks).
    let status: TestResultEntryData['status'];
    if (test.status === 'failed') {
      status = 'failed';
    } else if (test.status === 'skipped' || test.status === 'todo') {
      status = 'skipped';
    } else {
      status = 'passed';
    }

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
      moduleRef: {
        module: rri(moduleName),
        name: 'default',
      },
      results: testResults,
    });
  }

  let allResults = moduleResults.flatMap((mr) => mr.results);
  let passedCount = allResults.filter((r) => r.status === 'passed').length;
  let failedCount = allResults.filter(
    (r) => r.status === 'failed' || r.status === 'error',
  ).length;
  let skippedCount = allResults.filter((r) => r.status === 'skipped').length;

  let status: TestRunAttributes['status'];
  if (results.tests.length === 0) {
    // No tests ran at all
    status = 'error';
  } else if (failedCount > 0) {
    status = 'failed';
  } else if (passedCount === 0 && skippedCount > 0) {
    // All tests were skipped — nothing was actually verified
    status = 'failed';
  } else {
    status = 'passed';
  }

  return {
    status,
    passedCount,
    failedCount,
    skippedCount,
    durationMs: results.runEnd.runtime,
    moduleResults,
  };
}

/**
 * Format a `TestResult` into a human-readable summary for agent prompts.
 */
export function formatTestResultSummary(result: TestResult): string {
  let countLine = `Passed: ${result.passedCount}, Failed: ${result.failedCount}`;
  if (result.skippedCount && result.skippedCount > 0) {
    countLine += `, Skipped: ${result.skippedCount}`;
  }
  let lines: string[] = [
    `Status: ${result.status}`,
    countLine,
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
