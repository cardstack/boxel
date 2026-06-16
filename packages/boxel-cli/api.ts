export {
  BoxelCLIClient,
  type CreateRealmOptions,
  type CreateRealmResult,
  type PullOptions,
  type PullResult,
  type ReadResult,
  type ReadTranspiledResult,
  type WriteResult,
  type DeleteResult,
  type SearchResult,
  type ListFilesResult,
  type RunCommandResult,
  type LintMessage,
  type LintResult,
  type WaitForReadyResult,
  type WaitForFileOptions,
  type AtomicResult,
  type CancelIndexingResult,
} from './src/lib/boxel-cli-client.ts';

export {
  resetProfileManager,
  setProfileManager,
} from './src/lib/profile-manager.ts';

export { setQuiet, isQuiet } from './src/lib/cli-log.ts';

export {
  runRealmQunit,
  runTestsForRealm,
  type RunRealmQunitOptions,
  type RunTestsOptions,
  type RunTestsResult,
  type TestFailure,
  type QunitResults,
  type QunitTestResult,
  type QunitRunSummary,
} from './src/commands/test.ts';
