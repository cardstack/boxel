/**
 * Factory test realm management — barrel re-export.
 *
 * Split into cohesive modules:
 * - test-run-types.ts — shared type definitions
 * - test-run-parsing.ts — result parsing and formatting
 * - test-run-cards.ts — TestRun card lifecycle (create, complete, build)
 * - test-run-execution.ts — orchestration, resume logic
 */

// Types
export type {
  CreateTestRunOptions,
  ExecuteTestRunOptions,
  QunitResults,
  QunitRunSummary,
  QunitTestResult,
  RunTestsFailure,
  RunTestsInMemoryOptions,
  RunTestsResult,
  TestModuleResultData,
  TestResultEntryData,
  TestRunAttributes,
  TestRunHandle,
  TestRunRealmOptions,
} from './test-run-types';

// Parsing
export { formatTestResultSummary, parseQunitResults } from './test-run-parsing';

// Card lifecycle
export {
  buildTestRunCardDocument,
  completeTestRun,
  createTestRun,
} from './test-run-cards';

// Execution & resume
export {
  executeTestRunFromRealm,
  resolveTestRun,
  runTestsInMemory,
} from './test-run-execution';
