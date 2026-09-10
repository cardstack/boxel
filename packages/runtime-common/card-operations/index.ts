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
  OperationCore,
  OperationDefinitionLookup,
  OperationIndexQueryEngine,
  OperationScope,
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
export { lowerQueryOperation } from './query.ts';
export type { QueryInvocation } from './query.ts';
export {
  OperationFailure,
  isDocumentResult,
  isHeadResult,
  isIdentityResult,
  isOperationFailure,
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
  OperationTarget,
  OperationTemplate,
} from './types.ts';
