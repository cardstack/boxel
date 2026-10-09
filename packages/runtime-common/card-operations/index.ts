export {
  AnonymousRequest,
  type ActingUserFailure,
  type ActingUserResolution,
  type ActingUserResolver,
} from './anonymous-request.ts';
export {
  ANONYMOUS_ACTOR,
  blocklistCloses,
  settleTraffic,
  type CompiledGrantExpression,
  type GrantRateLimit,
  type GrantTraffic,
} from './grant-expressions.ts';
export { lowerOperationDeclarations } from './lowering.ts';
export {
  noteRealmIndexMoved,
  opensToAnonymous,
  RealmPolicyCache,
  realmPolicyRef,
} from './policy.ts';
export type {
  CompiledAnonymousGrant,
  CompiledOperationGrant,
  CompiledPolicyPredicate,
  CompiledPolicyRule,
  CompiledRealmPolicy,
  PolicyCompileEnvironment,
  RealmPolicyCacheEnvironment,
} from './policy.ts';
export type { LoweringContext } from './lowering.ts';
export {
  actingUserResolver,
  dischargePendingDecision,
  notPermitted,
  pendingWriteFor,
  pendingWriteHolds,
  policyGateStats,
} from './gate.ts';
export { checkCapabilities, parseCapabilityChecks } from './capabilities.ts';
export type { CapabilityCaller } from './capabilities.ts';
export { CAPABILITY_CHECK_CAP } from './capability-wire.ts';
export type { CapabilityAnswer, CapabilityCheck } from './capability-wire.ts';
export {
  policyQueryScope,
  principalQueryScope,
  withoutMisreadings,
  RealmAuthorityPolicyScopeError,
  searchPrincipal,
} from './policy-query.ts';
export type { PolicyQueryScope, SearchPrincipal } from './policy-query.ts';
export type {
  GateDecision,
  GrantedDecision,
  LockedGrant,
  MatchedGrant,
  OperationPolicyAccess,
  PendingDecision,
  PendingWrite,
  PolicyGateStats,
  StoredCardCheck,
} from './gate.ts';
export {
  assertParamsSupplied,
  canonicalizeTarget,
  localPathFor,
  instanceTargetURL,
  newOperationScope,
  scopeCallerFor,
  pathsFor,
  readPlan,
  htmlDeclarationOf,
  resolveFacadeWrite,
  resolveGatedOperation,
  resolveOperation,
  runOperation,
} from './dispatch.ts';
export type {
  CanonicalizeOptions,
  CoarseDeclined,
  GatedOperation,
  OperationCore,
  OperationDefinitionLookup,
  OperationIndexQueryEngine,
  OperationScope,
  ScopeCaller,
  ScopeInvocation,
  OperationStoredFile,
  OperationStoredFileMeta,
  HtmlDeclarationAnswer,
  ReadPlan,
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
  AdmissionSubject,
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
  emitCapabilityCheck,
  emitOperationPerf,
  INTERNAL_ROUTE,
  emitPolicyCompile,
  emitPolicyDecision,
  emitPolicySearchScope,
  emitPolicySnapshotRead,
  setCapabilityCheckSink,
  setOperationPerfSink,
  setPolicyCompileSink,
  setPolicyDecisionSink,
  setPolicySearchScopeSink,
  setPolicySnapshotReadSink,
} from './telemetry.ts';
export type {
  CapabilityCheckEvent,
  OperationDiagnostics,
  OperationMissingRead,
  OperationMissingReason,
  OperationOutcome,
  OperationPerfEvent,
  OperationReadLayer,
  PolicyCompileEvent,
  PolicyDecisionEvent,
  PolicyDecisionReason,
  PolicyRoute,
  PolicySearchScopeEvent,
  PolicySnapshotReadEvent,
  PolicyTransport,
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
  pendingWriteOf,
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
export {
  isNamedQueryPayload,
  namedQueryInvocation,
  namedQueryRendering,
  namedQueryStats,
  resolveNamedQuery,
  searchInvocation,
} from './named-query.ts';
export type {
  NamedQueryContext,
  NamedQueryStats,
  ResolvedNamedQuery,
  SearchInvocation,
} from './named-query.ts';
export type {
  QueryDefinition,
  QueryInvocation,
  QueryLoweringContext,
  QueryLoweringSink,
} from './query.ts';
export {
  DEFINITION_FREE_BASE_OPERATIONS,
  EXPLAIN_CAP,
  OperationFailure,
  isDefinitionFreeBaseOperation,
  isDocumentResult,
  isExplainListingResult,
  isExplainResult,
  isValidateResult,
  isHeadResult,
  isIdentityResult,
  effectiveLinkStrategy,
  isHtmlDeclaration,
  isLinkStrategy,
  isOperationFailure,
  isSourceResult,
  isWrite,
  linkStrategyOf,
  readLinkStrategyOf,
  refusalForNonReader,
  refusalSeenBy,
  unshareableFormatsOf,
  AUTHENTICATION_REQUIRED,
} from './types.ts';
export type {
  BaseOperation,
  EntryPosition,
  LowerOperationDeclarationsResult,
  OperationDefinition,
  ExplainedGrant,
  ExplainedGrantOutcome,
  ExplainedIndexLag,
  ExplainedRule,
  ExplainedSearch,
  OperationDocumentResult,
  OperationError,
  OperationErrorCode,
  OperationExplainListingResult,
  OperationExplainResult,
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
  PolicyExplanation,
  PolicyExplanationDecision,
  PolicyExplanationListing,
  PolicyExplanationReason,
  OperationValidateResult,
  PolicyValidation,
  ValidatedGrant,
  ValidatedGrantInertia,
  ValidatedPolicyIssue,
  ValidatedRule,
} from './types.ts';
