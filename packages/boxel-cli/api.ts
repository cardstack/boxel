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
export {
  listStoredProfiles,
  createStoredProfileBrowserLogin,
  type StoredProfileSummary,
  type StoredProfileBrowserLogin,
} from './src/lib/desktop-profiles.ts';

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
} from './src/lib/test-engine.ts';

export {
  BoxelRuntimeClient,
  type LocalStackStatus,
  type LocalStackDoctor,
} from './src/lib/boxel-runtime-client.ts';
