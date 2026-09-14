export { lowerOperationDeclarations } from './lowering.ts';
export type { LoweringContext } from './lowering.ts';
export {
  canonicalizeTarget,
  localPathFor,
  instanceTargetURL,
  newOperationScope,
  pathsFor,
  resolveOperation,
  runOperation,
} from './dispatch.ts';
export type {
  CanonicalizeOptions,
  OperationCore,
  OperationDefinitionLookup,
  OperationIndexQueryEngine,
  OperationScope,
  OperationStoredFile,
  OperationStoredFileMeta,
  RunOperationOptions,
} from './dispatch.ts';
export { readOperation } from './read.ts';
export { commitBatch } from './coordinator.ts';
export type {
  BatchCore,
  BatchEntryResult,
  CommitBatchOptions,
} from './coordinator.ts';
export { stageCreate, stageDelete, stageUpdate } from './executors.ts';
export type {
  BatchDocument,
  BatchEntry,
  CreateEntry,
  DeleteEntry,
  LidIndex,
  StagedChange,
  StagedIdentity,
  StagedWrite,
  StagingContext,
  StoredFile,
  UpdateEntry,
} from './executors.ts';
export { readSourceOperation } from './read-source.ts';
export { lowerQueryOperation } from './query.ts';
export type { QueryInvocation } from './query.ts';
export {
  DEFINITION_FREE_BASE_OPERATIONS,
  OperationFailure,
  isDefinitionFreeBaseOperation,
  isDocumentResult,
  isHeadResult,
  isIdentityResult,
  isOperationFailure,
  isSourceResult,
} from './types.ts';
export type {
  BaseOperation,
  LowerOperationDeclarationsResult,
  OperationDefinition,
  OperationDocumentResult,
  OperationError,
  OperationErrorCode,
  OperationHeadResult,
  OperationIdentityResult,
  OperationLoweringIssue,
  OperationLoweringIssueCode,
  OperationParamDefinition,
  OperationProgram,
  OperationRequest,
  OperationResult,
  OperationSourceBody,
  OperationSourceResult,
  OperationTarget,
  OperationTemplate,
} from './types.ts';
