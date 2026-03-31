import type { TestResult } from './factory-agent';
import type {
  RunRealmTestsOutput,
  SpecResultData,
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
  // Support both the legacy run-realm-tests format (top-level expected/unexpected)
  // and Playwright JSON reporter format (stats.expected/unexpected + suites).
  let playwrightReport = output as unknown as PlaywrightJsonReport;
  let expected = output.expected ?? playwrightReport.stats?.expected ?? 0;
  let unexpected = output.unexpected ?? playwrightReport.stats?.unexpected ?? 0;
  let rawFailures = output.failures ?? [];

  // Extract failures from Playwright suites if no legacy failures present.
  if (rawFailures.length === 0 && playwrightReport.suites) {
    rawFailures = extractPlaywrightFailures(playwrightReport.suites);
  }

  // Build results from ALL tests (passing + failing), not just failures.
  let specResults: SpecResultData[];
  if (playwrightReport.suites) {
    specResults = extractGroupedPlaywrightResults(playwrightReport.suites);
  } else {
    let results: TestResultEntryData[] = rawFailures.map((f) => {
      let { message, stackTrace } = splitErrorAndStack(f.error);
      return {
        testName: f.title,
        status: 'failed' as const,
        message,
        ...(stackTrace ? { stackTrace: stackTrace.slice(0, 500) } : {}),
      };
    });
    specResults = results.length > 0 ? [{ results }] : [];
  }

  let allResults = specResults.flatMap((sr) => sr.results);
  let hasFailures =
    unexpected > 0 ||
    allResults.some((r) => r.status === 'failed' || r.status === 'error');
  let status: TestRunAttributes['status'] = hasFailures ? 'failed' : 'passed';

  // If no tests ran at all, check for Playwright-level errors (e.g. module not found).
  if (expected === 0 && unexpected === 0 && rawFailures.length === 0) {
    let reportErrors = playwrightReport.errors ?? [];
    if (reportErrors.length > 0) {
      let errorMessage = reportErrors
        .map((e) => e.message ?? '')
        .filter(Boolean)
        .join('\n')
        .slice(0, 1000);
      return {
        status: 'error',
        passedCount: 0,
        failedCount: 0,
        durationMs,
        errorMessage: errorMessage || 'No tests found',
        specResults: [],
      };
    }
    status = 'error';
  }

  // When results include both passing and failing entries (Playwright format),
  // derive counts from results to match the card's computed fields.
  // For legacy format (failures only), use the stats counts.
  let hasPassingResults = allResults.some((r) => r.status === 'passed');
  let passedCount = hasPassingResults
    ? allResults.filter((r) => r.status === 'passed').length
    : expected;
  let failedCount = hasPassingResults
    ? allResults.filter((r) => r.status === 'failed' || r.status === 'error')
        .length
    : unexpected;

  return {
    status,
    passedCount,
    failedCount,
    durationMs,
    specResults,
  };
}

// Playwright JSON reporter types (subset)
interface PlaywrightJsonReport {
  stats?: { expected?: number; unexpected?: number };
  suites?: PlaywrightSuite[];
  errors?: { message?: string }[];
}

interface PlaywrightSuite {
  title?: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightSpec {
  title?: string;
  ok?: boolean;
  tests?: {
    results?: {
      status?: string;
      duration?: number;
      errors?: { message?: string }[];
    }[];
  }[];
}

function extractPlaywrightFailures(
  suites: PlaywrightSuite[],
): { title: string; outcome: string; error: string }[] {
  let failures: { title: string; outcome: string; error: string }[] = [];
  for (let suite of suites) {
    if (suite.suites) {
      failures.push(...extractPlaywrightFailures(suite.suites));
    }
    for (let spec of suite.specs ?? []) {
      if (spec.ok === false) {
        let errorMsg =
          spec.tests?.[0]?.results?.[0]?.errors?.[0]?.message ??
          'Unknown failure';
        failures.push({
          title: spec.title ?? 'unknown',
          outcome: 'unexpected',
          error: errorMsg,
        });
      }
    }
  }
  return failures;
}

function extractResultsFromSuite(
  suite: PlaywrightSuite,
): TestResultEntryData[] {
  let results: TestResultEntryData[] = [];
  if (suite.suites) {
    for (let nested of suite.suites) {
      results.push(...extractResultsFromSuite(nested));
    }
  }
  for (let spec of suite.specs ?? []) {
    let testResult = spec.tests?.[0]?.results?.[0];
    let status: TestResultEntryData['status'] = spec.ok ? 'passed' : 'failed';
    let entry: TestResultEntryData = {
      testName: spec.title ?? 'unknown',
      status,
      durationMs: testResult?.duration,
    };
    if (!spec.ok && testResult?.errors?.[0]?.message) {
      let { message, stackTrace } = splitErrorAndStack(
        testResult.errors[0].message,
      );
      entry.message = message;
      if (stackTrace) {
        entry.stackTrace = stackTrace.slice(0, 500);
      }
    }
    results.push(entry);
  }
  return results;
}

function extractGroupedPlaywrightResults(
  suites: PlaywrightSuite[],
): SpecResultData[] {
  return suites.map((suite) => ({
    specRef: { module: suite.title ?? 'default', name: 'default' },
    results: extractResultsFromSuite(suite),
  }));
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
        specResults: [
          {
            results: [
              {
                testName: '(test harness)',
                status: 'error',
                message: errorMsg,
              },
            ],
          },
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
        specResults: [
          {
            results: [
              { testName: '(test harness)', status: 'error', message: msg },
            ],
          },
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
    specResults: [
      {
        results: [
          { testName: '(test harness)', status: 'error', message: msg },
        ],
      },
    ],
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
