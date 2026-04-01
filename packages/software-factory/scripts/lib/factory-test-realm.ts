/**
 * Factory test realm management — barrel re-export.
 *
 * Split into cohesive modules:
 * - test-run-types.ts — shared type definitions
 * - test-run-parsing.ts — result parsing and formatting
 * - test-run-cards.ts — TestRun card lifecycle (create, complete, build)
 * - test-run-execution.ts — orchestration, resume logic, test artifacts realm
 */

// Types
export type {
  CreateTestRunOptions,
  ExecuteTestRunOptions,
  RunRealmTestsFailure,
  RunRealmTestsOutput,
  SpecResultData,
  TestResultEntryData,
  TestRunAttributes,
  TestRunHandle,
  TestRunRealmOptions,
} from './test-run-types';

// Parsing
export {
  formatTestResultSummary,
  parseRunRealmTestsOutput,
  parseToolResultOutput,
} from './test-run-parsing';

// Card lifecycle
export {
  buildTestRunCardDocument,
  completeTestRun,
  createTestRun,
} from './test-run-cards';

// Execution & resume
export {
  ensureTestArtifactsRealm,
  executeTestRunFromRealm,
  resolveTestRun,
} from './test-run-execution';
