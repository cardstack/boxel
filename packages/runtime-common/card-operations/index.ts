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
export { readOperation, erroredTargetRow } from './read.ts';
export type { ErroredTargetRow } from './read.ts';
export { commitBatch, STAGING_WIDTH } from './coordinator.ts';
export type {
  BatchCore,
  BatchEntryResult,
  BatchGroup,
  BatchNode,
  CommitBatchOptions,
} from './coordinator.ts';
export {
  stageAppendContainsMany,
  stageAppendLine,
  stageCreate,
  stageDelete,
  stageTransform,
  stageUpdate,
} from './executors.ts';
export type {
  AppendContainsManyEntry,
  AppendLineEntry,
  BatchDocument,
  BatchEntry,
  CreateEntry,
  DeleteEntry,
  IndexedCardValues,
  LidIndex,
  SourceBytes,
  StagedAppend,
  StagedChange,
  StagedContent,
  StagedIdentity,
  StagedWrite,
  StagingContext,
  StoredFile,
  StoredMeta,
  TransformEntry,
  UpdateEntry,
} from './executors.ts';
export {
  OPERATIONS_CHANNEL,
  emitOperationPerf,
  setOperationPerfSink,
} from './telemetry.ts';
export type {
  OperationDiagnostics,
  OperationMissingRead,
  OperationMissingReason,
  OperationOutcome,
  OperationPerfEvent,
  OperationReadLayer,
} from './telemetry.ts';
export {
  MalformedCardSourceError,
  appendMembers,
  indentsFor,
  renderMember,
  renderValue,
  scanCardSource,
} from './json-splice.ts';
export type { CardSourceLayout, StoredContainer } from './json-splice.ts';
export { readSourceOperation } from './read-source.ts';
export {
  assertTravelsInEnvelope,
  atEntry,
  batchEntryFor,
  carriesOperationsExt,
  errorsDocument,
  invocationsIn,
  isGroup,
  needsActor,
  paramsFor,
  parseOperationsEnvelope,
  readResult,
  resultsTree,
  stagedTree,
  targetFor,
  writeResult,
} from './envelope.ts';
export type {
  EnvelopeEntry,
  EnvelopeGroup,
  EnvelopeNode,
  EnvelopeResult,
  EnvelopeResults,
  ParseEnvelopeOptions,
  QueryTarget,
  ResolvedEnvelopeEntry,
} from './envelope.ts';
export { resolveQueryTargets } from './find-targets.ts';
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
  isWrite,
} from './types.ts';
export type {
  BaseOperation,
  EntryPosition,
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
