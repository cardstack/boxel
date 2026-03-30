import type { ResolvedCodeRef } from '@cardstack/runtime-common';

// ---------------------------------------------------------------------------
// Realm Test Output Types
// ---------------------------------------------------------------------------

/**
 * Shape of the JSON summary emitted by `scripts/run-realm-tests.ts`.
 */
export interface RunRealmTestsOutput {
  sourceRealmPath?: string;
  sourceRealmUrl?: string;
  scratchPath?: string;
  scratchRealmUrl?: string;
  specFiles?: string[];
  copiedFixtures?: string[];
  expected?: number;
  unexpected?: number;
  skipped?: number;
  failures?: RunRealmTestsFailure[];
}

export interface RunRealmTestsFailure {
  title: string;
  outcome: string;
  error: string;
}

// ---------------------------------------------------------------------------
// TestRun Card Types
// ---------------------------------------------------------------------------

/** Realm connection options for TestRun card operations. */
export interface TestRunRealmOptions {
  testRealmUrl: string;
  /** URL to the test-results module in the source realm. Required, never inferred. */
  testResultsModuleUrl: string;
  authorization?: string;
  fetch?: typeof globalThis.fetch;
}

/** Additional options for creating a new TestRun card. */
export interface CreateTestRunOptions {
  sequenceNumber?: number;
  ticketURL?: string;
  specRef?: ResolvedCodeRef;
}

/** The primary return type from test execution — the card ID + status signal. */
export interface TestRunHandle {
  testRunId: string;
  status: 'running' | 'passed' | 'failed' | 'error';
  errorMessage?: string;
}

/**
 * Serialized attributes for a TestRun card. Maps directly to the
 * TestRun card definition in test-results.gts.
 *
 * Note: `passedCount` and `failedCount` are computed fields on the card
 * (derived from `results`), but are included here for convenience when
 * building card documents and in test assertions.
 */
export interface TestRunAttributes {
  sequenceNumber?: number;
  runAt?: string;
  completedAt?: string;
  status: 'running' | 'passed' | 'failed' | 'error';
  passedCount: number;
  failedCount: number;
  durationMs?: number;
  errorMessage?: string;
  results: TestResultEntryData[];
}

/** Shape of a single test result entry within a TestRun card. */
export interface TestResultEntryData {
  testName: string;
  status: 'pending' | 'passed' | 'failed' | 'error';
  message?: string;
  stackTrace?: string;
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Execution Options
// ---------------------------------------------------------------------------

export interface ExecuteTestRunOptions {
  targetRealmUrl: string;
  testResultsModuleUrl: string;
  slug: string;
  specPaths: string[];
  testNames: string[];
  authorization?: string;
  fetch?: typeof globalThis.fetch;
  forceNew?: boolean;
  ticketURL?: string;
  specRef?: ResolvedCodeRef;
  /** URL to the Project card — used to read/write testArtifactsRealmUrl. */
  projectCardUrl?: string;
  /** Explicit test realm URL. If not set, derived from Project card. */
  testRealmUrl?: string;
  /** Matrix auth for realm creation (required when projectCardUrl is set). */
  matrixAuth?: {
    userId: string;
    accessToken: string;
    matrixUrl: string;
  };
  /** Server-level JWT for obtaining realm-scoped auth for test artifacts realm. */
  serverToken?: string;
}
