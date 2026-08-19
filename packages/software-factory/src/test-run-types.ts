import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import type { ResolvedCodeRef } from '@cardstack/runtime-common';
import type { ValidationRunCache } from './validation-run-cache.ts';

// ---------------------------------------------------------------------------
// TestRun Card Types
// ---------------------------------------------------------------------------

/** Realm connection options for TestRun card operations. */
export interface TestRunRealmOptions {
  targetRealm: string;
  /** URL to the test-results module in the source realm. Required, never inferred. */
  testResultsModuleUrl: string;
  client: BoxelCLIClient;
  /** Local workspace directory — TestRun cards are written here. */
  workspaceDir: string;
}

/** Additional options for creating a new TestRun card. */
export interface CreateTestRunOptions {
  sequenceNumber?: number;
  issueURL?: string;
  projectCardUrl?: string;
  moduleRef?: ResolvedCodeRef;
}

/** The primary return type from test execution — the card ID + status signal. */
export interface TestRunHandle {
  testRunId: string;
  status: 'running' | 'passed' | 'failed' | 'error';
  errorMessage?: string;
  /** The sequence number assigned to this TestRun. */
  sequenceNumber?: number;
}

/**
 * Serialized attributes for a TestRun card. Maps directly to the
 * TestRun card definition in test-results.gts.
 *
 * Note: `passedCount` and `failedCount` are computed fields on the card
 * (derived from `moduleResults[].results`), but are included here for
 * convenience when building card documents and in test assertions.
 */
export interface TestRunAttributes {
  sequenceNumber?: number;
  runAt?: string;
  completedAt?: string;
  status: 'running' | 'passed' | 'failed' | 'error';
  passedCount: number;
  failedCount: number;
  skippedCount?: number;
  durationMs?: number;
  errorMessage?: string;
  moduleResults: TestModuleResultData[];
}

/** Shape of a single test result entry within a TestRun card. */
export interface TestResultEntryData {
  testName: string;
  status: 'pending' | 'passed' | 'failed' | 'error' | 'skipped';
  message?: string;
  stackTrace?: string;
  durationMs?: number;
}

/** Shape of a test module result group within a TestRun card. */
export interface TestModuleResultData {
  moduleRef?: ResolvedCodeRef;
  results: TestResultEntryData[];
}

// ---------------------------------------------------------------------------
// QUnit Result Types (collected via browser-side QUnit.on callbacks)
// ---------------------------------------------------------------------------

export interface QunitTestResult {
  name: string;
  module: string;
  status: 'passed' | 'failed' | 'skipped' | 'todo';
  runtime: number;
  errors: { message: string; stack?: string }[];
}

export interface QunitRunSummary {
  status: 'passed' | 'failed';
  testCounts: {
    passed: number;
    failed: number;
    skipped: number;
    todo: number;
    total: number;
  };
  runtime: number;
}

export interface QunitResults {
  tests: QunitTestResult[];
  runEnd: QunitRunSummary | null;
}

// ---------------------------------------------------------------------------
// Execution Options
// ---------------------------------------------------------------------------

export interface RunTestsInMemoryOptions {
  targetRealm: string;
  client: BoxelCLIClient;
  /** URL of the host app served by the compat proxy (typically the realm server URL). */
  hostAppUrl: string;
  /** Path to the host app's dist directory. Defaults to packages/host/dist. */
  hostDistDir?: string;
  /** Log browser console output for debugging. */
  debug?: boolean;
  /** Memoizes the QUnit browser run per workspace fingerprint. */
  cache?: ValidationRunCache;
}

export interface RunTestsFailure {
  testName: string;
  module: string;
  message: string;
  stackTrace?: string;
}

export interface RunTestsResult {
  status: 'passed' | 'failed' | 'error';
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  durationMs: number;
  /** Realm-relative `.test.gts` paths discovered before the run. */
  testFiles: string[];
  failures: RunTestsFailure[];
  /** Set only when `status === 'error'`. */
  errorMessage?: string;
}

export interface ExecuteTestRunOptions {
  targetRealm: string;
  testResultsModuleUrl: string;
  slug: string;
  testNames: string[];
  client: BoxelCLIClient;
  /** Local workspace directory — TestRun cards are written here. */
  workspaceDir: string;
  forceNew?: boolean;
  issueURL?: string;
  /** URL to the Project card — used for TestRun relationship. */
  projectCardUrl?: string;
  /** Realm server URL. Required — never inferred from targetRealm. */
  realmServerUrl: string;
  /** URL of the host app served by the compat proxy (e.g., the realm server URL). */
  hostAppUrl: string;
  /** Path to the host app's dist directory. Defaults to packages/host/dist. */
  hostDistDir?: string;
  /** Log browser console output for debugging. */
  debug?: boolean;
  /** Memoizes the QUnit browser run per workspace fingerprint. */
  cache?: ValidationRunCache;
  /**
   * Floor for the next sequence number. When the realm search index is stale
   * (hasn't indexed the most recent TestRun yet), getNextSequenceNumber may
   * return a number that was already used. Passing the last-used sequence
   * number here guarantees the new TestRun gets at least lastSequenceNumber + 1.
   */
  lastSequenceNumber?: number;
  /**
   * When provided, use this value directly as the sequence number instead of
   * computing one via getNextValidationSequenceNumber. Used by the validation
   * pipeline to ensure all steps in an iteration share the same sequence number.
   */
  iteration?: number;
}
