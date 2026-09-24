export { lowerOperationDeclarations } from './lowering.ts';
export {
  noteRealmIndexMoved,
  RealmPolicyCache,
  realmPolicyRef,
} from './policy.ts';
export type {
  CompiledOperationGrant,
  CompiledPolicyPredicate,
  CompiledPolicyRule,
  CompiledRealmPolicy,
  PolicyCompileEnvironment,
  RealmPolicyCacheEnvironment,
} from './policy.ts';
export type { LoweringContext } from './lowering.ts';
export { notPermitted, policyGateStats } from './gate.ts';
export type {
  GateDecision,
  MatchedGrant,
  OperationPolicyAccess,
  PolicyGateStats,
} from './gate.ts';
export {
  assertParamsSupplied,
  canonicalizeTarget,
  localPathFor,
  instanceTargetURL,
  newOperationScope,
  scopeCallerFor,
  pathsFor,
  readShape,
  resolveGatedOperation,
  resolveOperation,
  runOperation,
} from './dispatch.ts';
export type {
  CanonicalizeOptions,
  GatedOperation,
  OperationCore,
  OperationDefinitionLookup,
  OperationIndexQueryEngine,
  OperationScope,
  ScopeCaller,
  ScopeInvocation,
  OperationStoredFile,
  OperationStoredFileMeta,
  ReadShape,
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
  entryWithPayload,
  errorsDocument,
  invocationsIn,
  isGroup,
  needsActor,
  paramsFor,
  parseOperationsEnvelope,
  projectedResult,
  readResult,
  resultsTree,
  stagedTree,
  stageWriteEntry,
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
export {
  hasTransforms,
  runInputTransform,
  runOutputTransform,
} from './transforms.ts';
export type {
  BxlTransformModule,
  TransformContext,
  TransformProgramError,
} from './transforms.ts';
export { lowerQueryOperation, lowerQueryTemplate } from './query.ts';
export type {
  QueryDefinition,
  QueryInvocation,
  QueryLoweringContext,
  QueryLoweringSink,
} from './query.ts';
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
  OperationRowHeaders,
  OperationSourceBody,
  OperationSourceResult,
  OperationTarget,
  OperationTemplate,
} from './types.ts';
