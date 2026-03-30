import type { TestResult } from './factory-agent';
import type {
  RunRealmTestsOutput,
  TestResultEntryData,
  TestRunAttributes,
} from './test-run-types';

/**
 * Convert the raw JSON output from `run-realm-tests` into `TestRunAttributes`
 * — the serialized form of a TestRun card.
 */
export function parseRunRealmTestsOutput(
  output: RunRealmTestsOutput,
  durationMs: number,
): TestRunAttributes {
  let expected = output.expected ?? 0;
  let unexpected = output.unexpected ?? 0;
  let rawFailures = output.failures ?? [];

  let results: TestResultEntryData[] = rawFailures.map((f) => {
    let { message, stackTrace } = splitErrorAndStack(f.error);
    return {
      testName: f.title,
      status: 'failed' as const,
      message,
      ...(stackTrace ? { stackTrace: stackTrace.slice(0, 500) } : {}),
    };
  });

  let status: TestRunAttributes['status'] =
    unexpected > 0 || results.length > 0 ? 'failed' : 'passed';

  if (expected === 0 && unexpected === 0 && rawFailures.length === 0) {
    status = 'error';
  }

  return {
    status,
    passedCount: expected,
    failedCount: unexpected,
    durationMs,
    results,
  };
}

/**
 * Parse a `ToolResult.output` from the `run-realm-tests` script tool.
 * Returns `TestRunAttributes` — the serialized form of a TestRun card.
 */
export function parseToolResultOutput(
  toolOutput: unknown,
  durationMs: number,
): TestRunAttributes {
  if (
    toolOutput &&
    typeof toolOutput === 'object' &&
    !Array.isArray(toolOutput)
  ) {
    if ('error' in toolOutput) {
      let errorMsg =
        typeof (toolOutput as Record<string, unknown>).error === 'string'
          ? ((toolOutput as Record<string, unknown>).error as string)
          : JSON.stringify(toolOutput);
      return {
        status: 'error',
        passedCount: 0,
        failedCount: 0,
        durationMs,
        errorMessage: errorMsg,
        results: [
          { testName: '(test harness)', status: 'error', message: errorMsg },
        ],
      };
    }

    if ('raw' in toolOutput) {
      let raw = String((toolOutput as Record<string, unknown>).raw);
      let msg = `Unparseable output: ${raw.slice(0, 500)}`;
      return {
        status: 'error',
        passedCount: 0,
        failedCount: 0,
        durationMs,
        errorMessage: msg,
        results: [
          { testName: '(test harness)', status: 'error', message: msg },
        ],
      };
    }

    return parseRunRealmTestsOutput(
      toolOutput as RunRealmTestsOutput,
      durationMs,
    );
  }

  let msg = `Unexpected tool output type: ${typeof toolOutput}`;
  return {
    status: 'error',
    passedCount: 0,
    failedCount: 0,
    durationMs,
    errorMessage: msg,
    results: [{ testName: '(test harness)', status: 'error', message: msg }],
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

/**
 * Split a combined error string into message and optional stack trace.
 */
function splitErrorAndStack(error: string): {
  message: string;
  stackTrace?: string;
} {
  let atIndex = error.search(/\n\s+at /);
  if (atIndex === -1) {
    return { message: error.trim() };
  }
  return {
    message: error.slice(0, atIndex).trim(),
    stackTrace: error.slice(atIndex + 1).trim(),
  };
}
