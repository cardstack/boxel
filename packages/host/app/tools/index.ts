import type { VirtualNetwork } from '@cardstack/runtime-common';

import * as AddFieldToCardDefinitionToolModule from './add-field-to-card-definition';
import * as UseAiAssistantToolModule from './ai-assistant';
import * as ApplyMarkdownEditToolModule from './apply-markdown-edit';
import * as ApplySearchReplaceBlockToolModule from './apply-search-replace-block';
import * as AskAiToolModule from './ask-ai';
import * as AuthedFetchToolModule from './authed-fetch';
import * as CreateListingPRRequestToolModule from './bot-requests/create-listing-pr-request';
import * as SendBotTriggerEventToolModule from './bot-requests/send-bot-trigger-event';
import * as CanReadRealmToolModule from './can-read-realm';
import * as CancelIndexingJobToolModule from './cancel-indexing-job';
import * as CheckCorrectnessToolModule from './check-correctness';
import * as CheckDomainAvailabilityToolModule from './check-domain-availability';
import * as CopyAndEditToolModule from './copy-and-edit';
import * as CopyCardToRealmModule from './copy-card';
import * as CopyCardAsMarkdownToolModule from './copy-card-as-markdown';
import * as CopyCardToStackToolModule from './copy-card-to-stack';
import * as CopyFileToRealmToolModule from './copy-file-to-realm';
import * as CopySourceToolModule from './copy-source';
import * as CreateAIAssistantRoomCommandModule from './create-ai-assistant-room';
import * as CreateAndOpenSubmissionWorkflowCard from './create-and-open-submission-workflow-card';
import * as CreateSpecToolModule from './create-specs';
import * as CreateSubmissionWorkflowToolModule from './create-submission-workflow';
import * as EvaluateModuleToolModule from './evaluate-module';
import * as ExecuteAtomicOperationsToolModule from './execute-atomic-operations';
import * as FetchCardJsonToolModule from './fetch-card-json';
import * as FullReindexRealmToolModule from './full-reindex-realm';
import * as GenerateExampleCardsToolModule from './generate-example-cards';
import * as GenerateReadmeSpecToolModule from './generate-readme-spec';
import * as GenerateThemeExampleToolModule from './generate-theme-example';
import * as GenerateThumbnailToolModule from './generate-thumbnail';
import * as GetAllRealmMetasToolModule from './get-all-realm-metas';
import * as GetAvailableRealmIdentifiersToolModule from './get-available-realm-identifiers';
import * as GetCardToolModule from './get-card';
import * as GetCardTypeSchemaToolModule from './get-card-type-schema';
import * as GetCatalogRealmIdentifiersToolModule from './get-catalog-realm-identifiers';
import * as GetDefaultWritableRealmToolModule from './get-default-writable-realm';
import * as GetEventsFromRoomToolModule from './get-events-from-room';
import * as GetPublishedRealmsToolModule from './get-published-realms';
import * as GetRealmOfResourceIdentifierToolModule from './get-realm-of-resource-identifier';
import * as GetUserSystemCardToolModule from './get-user-system-card';
import * as InstantiateCardToolModule from './instantiate-card';
import * as InvalidateRealmIdentifiersToolModule from './invalidate-realm-identifiers';
import * as InviteUserToRoomToolModule from './invite-user-to-room';
import * as LintAndFixToolModule from './lint-and-fix';
import * as ListingBuildCommandModule from './listing-action-build';
import * as MigrateSkillToolModule from './migrate-skill';
import * as OneShotLlmRequestToolModule from './one-shot-llm-request';
import * as OpenAiAssistantRoomToolModule from './open-ai-assistant-room';
import * as OpenCreateListingModalToolModule from './open-create-listing-modal';
import * as OpenInInteractModeModule from './open-in-interact-mode';
import * as OpenWorkspaceToolModule from './open-workspace';
import * as PatchCardInstanceToolModule from './patch-card-instance';
import * as PatchCodeToolModule from './patch-code';
import * as PatchFieldsToolModule from './patch-fields';
import * as PatchThemeToolModule from './patch-theme';
import * as PersistModuleInspectorViewToolModule from './persist-module-inspector-view';
import * as PopulateWithSampleDataToolModule from './populate-with-sample-data';
import * as PreviewFormatToolModule from './preview-format';
import * as PublishRealmToolModule from './publish-realm';
import * as ReadBinaryFileToolModule from './read-binary-file';
import * as ReadCardForAiAssistantCommandModule from './read-card-for-ai-assistant';
import * as ReadFileForAiAssistantCommandModule from './read-file-for-ai-assistant';
import * as ReadSourceToolModule from './read-source';
import * as ReadTextFileToolModule from './read-text-file';
import * as RegisterBotToolModule from './register-bot';
import * as ReindexRealmToolModule from './reindex-realm';
import * as RetrySubmissionWorkflowToolModule from './retry-submission-workflow';
import * as SanitizeModuleListToolModule from './sanitize-module-list';
import * as SaveCardToolModule from './save-card';
import * as ScreenshotCardToolModule from './screenshot-card';
import * as SearchAndChooseToolModule from './search-and-choose';
import * as SearchCardsCommandModule from './search-cards';
import * as SearchGoogleImagesToolModule from './search-google-images';
import * as SendAiAssistantMessageModule from './send-ai-assistant-message';
import * as SendRequestViaProxyToolModule from './send-request-via-proxy';
import * as SerializeCardToolModule from './serialize-card';
import * as SetActiveLlmModule from './set-active-llm';
import * as SetUserSystemCardToolModule from './set-user-system-card';
import * as ShowCardToolModule from './show-card';
import * as ShowFileToolModule from './show-file';
import * as StoreAddToolModule from './store-add';
import * as SummarizeSessionToolModule from './summarize-session';
import * as SwitchSubmodeToolModule from './switch-submode';
import * as SyncOpenRouterModelsToolModule from './sync-openrouter-models';
import * as TransformCardsToolModule from './transform-cards';
import * as UnpublishRealmToolModule from './unpublish-realm';
import * as UnregisterBotToolModule from './unregister-bot';
import * as UpdateCodePathWithSelectionToolModule from './update-code-path-with-selection';
import * as UpdatePlaygroundSelectionToolModule from './update-playground-selection';
import * as UpdateRoomSkillsToolModule from './update-room-skills';
import * as CommandUtilsModule from './utils';
import * as ValidateRealmToolModule from './validate-realm';
import * as WriteBinaryFileToolModule from './write-binary-file';
import * as WriteTextFileToolModule from './write-text-file';

import type HostBaseTool from '../lib/host-base-tool';

// Registers a host tool module under its `@cardstack/boxel-host/tools/*`
// specifier and the pre-rename `@cardstack/boxel-host/commands/*` spelling.
// The legacy alias stays for as long as content referencing it exists: skill
// frontmatter codeRefs and room-state tool definitions persisted before the
// command → tool rename resolve through it. functionName hashing already
// canonicalizes the two spellings to one name (see moduleForFunctionNameHash).
function shimHostToolModule(
  virtualNetwork: VirtualNetwork,
  name: string,
  module: object,
) {
  virtualNetwork.shimModule(`@cardstack/boxel-host/tools/${name}`, module);
  virtualNetwork.shimModule(`@cardstack/boxel-host/commands/${name}`, module);
}

export function shimHostTools(virtualNetwork: VirtualNetwork) {
  shimHostToolModule(
    virtualNetwork,
    'add-field-to-card-definition',
    AddFieldToCardDefinitionToolModule,
  );
  shimHostToolModule(virtualNetwork, 'ask-ai', AskAiToolModule);
  shimHostToolModule(virtualNetwork, 'authed-fetch', AuthedFetchToolModule);
  shimHostToolModule(
    virtualNetwork,
    'apply-markdown-edit',
    ApplyMarkdownEditToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'apply-search-replace-block',
    ApplySearchReplaceBlockToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'copy-card-as-markdown',
    CopyCardAsMarkdownToolModule,
  );
  shimHostToolModule(virtualNetwork, 'copy-card', CopyCardToRealmModule);
  shimHostToolModule(
    virtualNetwork,
    'copy-card-to-stack',
    CopyCardToStackToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'copy-file-to-realm',
    CopyFileToRealmToolModule,
  );
  shimHostToolModule(virtualNetwork, 'copy-source', CopySourceToolModule);
  shimHostToolModule(virtualNetwork, 'copy-and-edit', CopyAndEditToolModule);
  shimHostToolModule(
    virtualNetwork,
    'create-ai-assistant-room',
    CreateAIAssistantRoomCommandModule,
  );
  shimHostToolModule(virtualNetwork, 'create-specs', CreateSpecToolModule);
  shimHostToolModule(
    virtualNetwork,
    'check-correctness',
    CheckCorrectnessToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'check-domain-availability',
    CheckDomainAvailabilityToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'evaluate-module',
    EvaluateModuleToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'instantiate-card',
    InstantiateCardToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'cancel-indexing-job',
    CancelIndexingJobToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'generate-theme-example',
    GenerateThemeExampleToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'execute-atomic-operations',
    ExecuteAtomicOperationsToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'fetch-card-json',
    FetchCardJsonToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'full-reindex-realm',
    FullReindexRealmToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'get-events-from-room',
    GetEventsFromRoomToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'get-published-realms',
    GetPublishedRealmsToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'invite-user-to-room',
    InviteUserToRoomToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'invalidate-realm-identifiers',
    InvalidateRealmIdentifiersToolModule,
  );
  shimHostToolModule(virtualNetwork, 'lint-and-fix', LintAndFixToolModule);
  shimHostToolModule(
    virtualNetwork,
    'listing-action-build',
    ListingBuildCommandModule,
  );
  shimHostToolModule(virtualNetwork, 'migrate-skill', MigrateSkillToolModule);
  shimHostToolModule(
    virtualNetwork,
    'create-listing-pr-request',
    CreateListingPRRequestToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'open-in-interact-mode',
    OpenInInteractModeModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'patch-card-instance',
    PatchCardInstanceToolModule,
  );
  shimHostToolModule(virtualNetwork, 'patch-code', PatchCodeToolModule);
  shimHostToolModule(virtualNetwork, 'patch-fields', PatchFieldsToolModule);
  shimHostToolModule(virtualNetwork, 'patch-theme', PatchThemeToolModule);
  shimHostToolModule(
    virtualNetwork,
    'persist-module-inspector-view',
    PersistModuleInspectorViewToolModule,
  );
  shimHostToolModule(virtualNetwork, 'preview-format', PreviewFormatToolModule);
  shimHostToolModule(virtualNetwork, 'publish-realm', PublishRealmToolModule);
  shimHostToolModule(
    virtualNetwork,
    'read-binary-file',
    ReadBinaryFileToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'read-card-for-ai-assistant',
    ReadCardForAiAssistantCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'read-file-for-ai-assistant',
    ReadFileForAiAssistantCommandModule,
  );
  shimHostToolModule(virtualNetwork, 'read-source', ReadSourceToolModule);
  shimHostToolModule(virtualNetwork, 'read-text-file', ReadTextFileToolModule);
  shimHostToolModule(virtualNetwork, 'reindex-realm', ReindexRealmToolModule);
  shimHostToolModule(virtualNetwork, 'register-bot', RegisterBotToolModule);
  shimHostToolModule(virtualNetwork, 'save-card', SaveCardToolModule);
  shimHostToolModule(virtualNetwork, 'serialize-card', SerializeCardToolModule);
  shimHostToolModule(virtualNetwork, 'search-cards', SearchCardsCommandModule);
  shimHostToolModule(
    virtualNetwork,
    'search-and-choose',
    SearchAndChooseToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'open-ai-assistant-room',
    OpenAiAssistantRoomToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'open-create-listing-modal',
    OpenCreateListingModalToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'create-and-open-submission-workflow-card',
    CreateAndOpenSubmissionWorkflowCard,
  );
  shimHostToolModule(
    virtualNetwork,
    'create-submission-workflow',
    CreateSubmissionWorkflowToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'retry-submission-workflow',
    RetrySubmissionWorkflowToolModule,
  );
  shimHostToolModule(virtualNetwork, 'open-workspace', OpenWorkspaceToolModule);
  shimHostToolModule(
    virtualNetwork,
    'send-ai-assistant-message',
    SendAiAssistantMessageModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'send-bot-trigger-event',
    SendBotTriggerEventToolModule,
  );
  shimHostToolModule(virtualNetwork, 'set-active-llm', SetActiveLlmModule);
  shimHostToolModule(virtualNetwork, 'show-card', ShowCardToolModule);
  shimHostToolModule(virtualNetwork, 'show-file', ShowFileToolModule);
  shimHostToolModule(virtualNetwork, 'switch-submode', SwitchSubmodeToolModule);
  shimHostToolModule(
    virtualNetwork,
    'transform-cards',
    TransformCardsToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'unpublish-realm',
    UnpublishRealmToolModule,
  );
  shimHostToolModule(virtualNetwork, 'unregister-bot', UnregisterBotToolModule);
  shimHostToolModule(
    virtualNetwork,
    'update-code-path-with-selection',
    UpdateCodePathWithSelectionToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'update-playground-selection',
    UpdatePlaygroundSelectionToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'update-room-skills',
    UpdateRoomSkillsToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'send-request-via-proxy',
    SendRequestViaProxyToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'summarize-session',
    SummarizeSessionToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'sync-openrouter-models',
    SyncOpenRouterModelsToolModule,
  );
  shimHostToolModule(virtualNetwork, 'ai-assistant', UseAiAssistantToolModule);
  shimHostToolModule(virtualNetwork, 'utils', CommandUtilsModule);
  shimHostToolModule(
    virtualNetwork,
    'write-binary-file',
    WriteBinaryFileToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'write-text-file',
    WriteTextFileToolModule,
  );
  shimHostToolModule(virtualNetwork, 'ai-assistant', UseAiAssistantToolModule);
  shimHostToolModule(
    virtualNetwork,
    'generate-example-cards',
    GenerateExampleCardsToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'generate-readme-spec',
    GenerateReadmeSpecToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'generate-thumbnail',
    GenerateThumbnailToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'screenshot-card',
    ScreenshotCardToolModule,
  );
  shimHostToolModule(virtualNetwork, 'get-card', GetCardToolModule);
  shimHostToolModule(
    virtualNetwork,
    'get-card-type-schema',
    GetCardTypeSchemaToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'get-all-realm-metas',
    GetAllRealmMetasToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'get-available-realm-identifiers',
    GetAvailableRealmIdentifiersToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'get-catalog-realm-identifiers',
    GetCatalogRealmIdentifiersToolModule,
  );
  shimHostToolModule(virtualNetwork, 'can-read-realm', CanReadRealmToolModule);
  shimHostToolModule(
    virtualNetwork,
    'get-default-writable-realm',
    GetDefaultWritableRealmToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'get-realm-of-resource-identifier',
    GetRealmOfResourceIdentifierToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'sanitize-module-list',
    SanitizeModuleListToolModule,
  );
  shimHostToolModule(virtualNetwork, 'store-add', StoreAddToolModule);
  shimHostToolModule(virtualNetwork, 'validate-realm', ValidateRealmToolModule);
  shimHostToolModule(
    virtualNetwork,
    'get-user-system-card',
    GetUserSystemCardToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'search-google-images',
    SearchGoogleImagesToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'one-shot-llm-request',
    OneShotLlmRequestToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'populate-with-sample-data',
    PopulateWithSampleDataToolModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'set-user-system-card',
    SetUserSystemCardToolModule,
  );
}

// Note - this is used for the tests
export const HostToolClasses: (typeof HostBaseTool<any, any>)[] = [
  AddFieldToCardDefinitionToolModule.default,
  ApplySearchReplaceBlockToolModule.default,
  ApplyMarkdownEditToolModule.default,
  AskAiToolModule.default,
  CopyCardAsMarkdownToolModule.default,
  CopyCardToRealmModule.default,
  CopyCardToStackToolModule.default,
  CopyFileToRealmToolModule.default,
  CopySourceToolModule.default,
  AuthedFetchToolModule.default,
  CanReadRealmToolModule.default,
  CreateAIAssistantRoomCommandModule.default,
  CopyAndEditToolModule.default,
  CreateSpecToolModule.default,
  ExecuteAtomicOperationsToolModule.default,
  FetchCardJsonToolModule.default,
  FullReindexRealmToolModule.default,
  GenerateExampleCardsToolModule.default,
  GenerateReadmeSpecToolModule.default,
  GenerateThumbnailToolModule.default,
  ScreenshotCardToolModule.default,
  GetAllRealmMetasToolModule.default,
  GetAvailableRealmIdentifiersToolModule.default,
  GetDefaultWritableRealmToolModule.default,
  GetCatalogRealmIdentifiersToolModule.default,
  GetCardToolModule.default,
  GetRealmOfResourceIdentifierToolModule.default,
  GetCardTypeSchemaToolModule.default,
  GetUserSystemCardToolModule.default,
  GetEventsFromRoomToolModule.default,
  GetPublishedRealmsToolModule.default,
  InviteUserToRoomToolModule.default,
  InvalidateRealmIdentifiersToolModule.default,
  LintAndFixToolModule.default,
  ListingBuildCommandModule.default,
  CreateListingPRRequestToolModule.default,
  OneShotLlmRequestToolModule.default,
  OpenAiAssistantRoomToolModule.default,
  OpenCreateListingModalToolModule.default,
  CreateAndOpenSubmissionWorkflowCard.default,
  CreateSubmissionWorkflowToolModule.default,
  RetrySubmissionWorkflowToolModule.default,
  OpenInInteractModeModule.default,
  OpenWorkspaceToolModule.default,
  GenerateThemeExampleToolModule.default,
  PatchCodeToolModule.default,
  PatchFieldsToolModule.default,
  PatchThemeToolModule.default,
  PersistModuleInspectorViewToolModule.default,
  PopulateWithSampleDataToolModule.default,
  PreviewFormatToolModule.default,
  PublishRealmToolModule.default,
  ReadBinaryFileToolModule.default,
  ReadCardForAiAssistantCommandModule.default,
  ReadFileForAiAssistantCommandModule.default,
  ReadSourceToolModule.default,
  ReadTextFileToolModule.default,
  RegisterBotToolModule.default,
  ReindexRealmToolModule.default,
  SaveCardToolModule.default,
  SanitizeModuleListToolModule.default,
  StoreAddToolModule.default,
  SerializeCardToolModule.default,
  SearchAndChooseToolModule.default,
  SearchCardsCommandModule.SearchCardsByQueryTool,
  SearchCardsCommandModule.SearchCardsByTypeAndTitleTool,
  SearchGoogleImagesToolModule.default,
  SendAiAssistantMessageModule.default,
  SendBotTriggerEventToolModule.default,
  SendRequestViaProxyToolModule.default,
  SetActiveLlmModule.default,
  SetUserSystemCardToolModule.default,
  ShowCardToolModule.default,
  ShowFileToolModule.default,
  SummarizeSessionToolModule.default,
  SwitchSubmodeToolModule.default,
  SyncOpenRouterModelsToolModule.default,
  TransformCardsToolModule.default,
  UnpublishRealmToolModule.default,
  UnregisterBotToolModule.default,
  CancelIndexingJobToolModule.default,
  CheckCorrectnessToolModule.default,
  CheckDomainAvailabilityToolModule.default,
  EvaluateModuleToolModule.default,
  InstantiateCardToolModule.default,
  UpdateCodePathWithSelectionToolModule.default,
  UpdatePlaygroundSelectionToolModule.default,
  UpdateRoomSkillsToolModule.default,
  UseAiAssistantToolModule.default,
  ValidateRealmToolModule.default,
  MigrateSkillToolModule.default,
  WriteBinaryFileToolModule.default,
  WriteTextFileToolModule.default,
];
