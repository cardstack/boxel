import type { VirtualNetwork } from '@cardstack/runtime-common';

import * as AddFieldToCardDefinitionCommandModule from './add-field-to-card-definition';
import * as UseAiAssistantCommandModule from './ai-assistant';
import * as ApplyMarkdownEditCommandModule from './apply-markdown-edit';
import * as ApplySearchReplaceBlockCommandModule from './apply-search-replace-block';
import * as AskAiCommandModule from './ask-ai';
import * as AuthedFetchCommandModule from './authed-fetch';
import * as CreateListingPRRequestCommandModule from './bot-requests/create-listing-pr-request';
import * as SendBotTriggerEventCommandModule from './bot-requests/send-bot-trigger-event';
import * as CanReadRealmCommandModule from './can-read-realm';
import * as CancelIndexingJobCommandModule from './cancel-indexing-job';
import * as CheckCorrectnessCommandModule from './check-correctness';
import * as CheckDomainAvailabilityCommandModule from './check-domain-availability';
import * as CopyAndEditCommandModule from './copy-and-edit';
import * as CopyCardToRealmModule from './copy-card';
import * as CopyCardAsMarkdownCommandModule from './copy-card-as-markdown';
import * as CopyCardToStackCommandModule from './copy-card-to-stack';
import * as CopyFileToRealmCommandModule from './copy-file-to-realm';
import * as CopySourceCommandModule from './copy-source';
import * as CreateAIAssistantRoomCommandModule from './create-ai-assistant-room';
import * as CreateAndOpenSubmissionWorkflowCard from './create-and-open-submission-workflow-card';
import * as CreateSpecCommandModule from './create-specs';
import * as CreateSubmissionWorkflowCommandModule from './create-submission-workflow';
import * as EvaluateModuleCommandModule from './evaluate-module';
import * as ExecuteAtomicOperationsCommandModule from './execute-atomic-operations';
import * as FetchCardJsonCommandModule from './fetch-card-json';
import * as FullReindexRealmCommandModule from './full-reindex-realm';
import * as GenerateExampleCardsCommandModule from './generate-example-cards';
import * as GenerateReadmeSpecCommandModule from './generate-readme-spec';
import * as GenerateThemeExampleCommandModule from './generate-theme-example';
import * as GenerateThumbnailCommandModule from './generate-thumbnail';
import * as GetAllRealmMetasCommandModule from './get-all-realm-metas';
import * as GetAvailableRealmIdentifiersCommandModule from './get-available-realm-identifiers';
import * as GetCardCommandModule from './get-card';
import * as GetCardTypeSchemaCommandModule from './get-card-type-schema';
import * as GetCatalogRealmIdentifiersCommandModule from './get-catalog-realm-identifiers';
import * as GetDefaultWritableRealmCommandModule from './get-default-writable-realm';
import * as GetEventsFromRoomCommandModule from './get-events-from-room';
import * as GetPublishedRealmsCommandModule from './get-published-realms';
import * as GetRealmOfResourceIdentifierCommandModule from './get-realm-of-resource-identifier';
import * as GetUserSystemCardCommandModule from './get-user-system-card';
import * as InstantiateCardCommandModule from './instantiate-card';
import * as InvalidateRealmIdentifiersCommandModule from './invalidate-realm-identifiers';
import * as InviteUserToRoomCommandModule from './invite-user-to-room';
import * as LintAndFixCommandModule from './lint-and-fix';
import * as ListingBuildCommandModule from './listing-action-build';
import * as MigrateSkillCommandModule from './migrate-skill';
import * as OneShotLlmRequestCommandModule from './one-shot-llm-request';
import * as OpenAiAssistantRoomCommandModule from './open-ai-assistant-room';
import * as OpenCreateListingModalCommandModule from './open-create-listing-modal';
import * as OpenInInteractModeModule from './open-in-interact-mode';
import * as OpenWorkspaceCommandModule from './open-workspace';
import * as PatchCardInstanceCommandModule from './patch-card-instance';
import * as PatchCodeCommandModule from './patch-code';
import * as PatchFieldsCommandModule from './patch-fields';
import * as PatchThemeCommandModule from './patch-theme';
import * as PersistModuleInspectorViewCommandModule from './persist-module-inspector-view';
import * as PopulateWithSampleDataCommandModule from './populate-with-sample-data';
import * as PreviewFormatCommandModule from './preview-format';
import * as PublishRealmCommandModule from './publish-realm';
import * as ReadBinaryFileCommandModule from './read-binary-file';
import * as ReadCardForAiAssistantCommandModule from './read-card-for-ai-assistant';
import * as ReadFileForAiAssistantCommandModule from './read-file-for-ai-assistant';
import * as ReadSourceCommandModule from './read-source';
import * as ReadTextFileCommandModule from './read-text-file';
import * as RegisterBotCommandModule from './register-bot';
import * as ReindexRealmCommandModule from './reindex-realm';
import * as RetrySubmissionWorkflowCommandModule from './retry-submission-workflow';
import * as SanitizeModuleListCommandModule from './sanitize-module-list';
import * as SaveCardCommandModule from './save-card';
import * as ScreenshotCardCommandModule from './screenshot-card';
import * as SearchAndChooseCommandModule from './search-and-choose';
import * as SearchCardsCommandModule from './search-cards';
import * as SearchGoogleImagesCommandModule from './search-google-images';
import * as SendAiAssistantMessageModule from './send-ai-assistant-message';
import * as SendRequestViaProxyCommandModule from './send-request-via-proxy';
import * as SerializeCardCommandModule from './serialize-card';
import * as SetActiveLlmModule from './set-active-llm';
import * as SetUserSystemCardCommandModule from './set-user-system-card';
import * as ShowCardCommandModule from './show-card';
import * as ShowFileCommandModule from './show-file';
import * as StoreAddCommandModule from './store-add';
import * as SummarizeSessionCommandModule from './summarize-session';
import * as SwitchSubmodeCommandModule from './switch-submode';
import * as SyncOpenRouterModelsCommandModule from './sync-openrouter-models';
import * as TransformCardsCommandModule from './transform-cards';
import * as UnpublishRealmCommandModule from './unpublish-realm';
import * as UnregisterBotCommandModule from './unregister-bot';
import * as UpdateCodePathWithSelectionCommandModule from './update-code-path-with-selection';
import * as UpdatePlaygroundSelectionCommandModule from './update-playground-selection';
import * as UpdateRoomSkillsCommandModule from './update-room-skills';
import * as CommandUtilsModule from './utils';
import * as ValidateRealmCommandModule from './validate-realm';
import * as WriteBinaryFileCommandModule from './write-binary-file';
import * as WriteTextFileCommandModule from './write-text-file';

import type HostBaseCommand from '../lib/host-base-command';

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
    AddFieldToCardDefinitionCommandModule,
  );
  shimHostToolModule(virtualNetwork, 'ask-ai', AskAiCommandModule);
  shimHostToolModule(virtualNetwork, 'authed-fetch', AuthedFetchCommandModule);
  shimHostToolModule(
    virtualNetwork,
    'apply-markdown-edit',
    ApplyMarkdownEditCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'apply-search-replace-block',
    ApplySearchReplaceBlockCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'copy-card-as-markdown',
    CopyCardAsMarkdownCommandModule,
  );
  shimHostToolModule(virtualNetwork, 'copy-card', CopyCardToRealmModule);
  shimHostToolModule(
    virtualNetwork,
    'copy-card-to-stack',
    CopyCardToStackCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'copy-file-to-realm',
    CopyFileToRealmCommandModule,
  );
  shimHostToolModule(virtualNetwork, 'copy-source', CopySourceCommandModule);
  shimHostToolModule(virtualNetwork, 'copy-and-edit', CopyAndEditCommandModule);
  shimHostToolModule(
    virtualNetwork,
    'create-ai-assistant-room',
    CreateAIAssistantRoomCommandModule,
  );
  shimHostToolModule(virtualNetwork, 'create-specs', CreateSpecCommandModule);
  shimHostToolModule(
    virtualNetwork,
    'check-correctness',
    CheckCorrectnessCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'check-domain-availability',
    CheckDomainAvailabilityCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'evaluate-module',
    EvaluateModuleCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'instantiate-card',
    InstantiateCardCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'cancel-indexing-job',
    CancelIndexingJobCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'generate-theme-example',
    GenerateThemeExampleCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'execute-atomic-operations',
    ExecuteAtomicOperationsCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'fetch-card-json',
    FetchCardJsonCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'full-reindex-realm',
    FullReindexRealmCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'get-events-from-room',
    GetEventsFromRoomCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'get-published-realms',
    GetPublishedRealmsCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'invite-user-to-room',
    InviteUserToRoomCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'invalidate-realm-identifiers',
    InvalidateRealmIdentifiersCommandModule,
  );
  shimHostToolModule(virtualNetwork, 'lint-and-fix', LintAndFixCommandModule);
  shimHostToolModule(
    virtualNetwork,
    'listing-action-build',
    ListingBuildCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'migrate-skill',
    MigrateSkillCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'create-listing-pr-request',
    CreateListingPRRequestCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'open-in-interact-mode',
    OpenInInteractModeModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'patch-card-instance',
    PatchCardInstanceCommandModule,
  );
  shimHostToolModule(virtualNetwork, 'patch-code', PatchCodeCommandModule);
  shimHostToolModule(virtualNetwork, 'patch-fields', PatchFieldsCommandModule);
  shimHostToolModule(virtualNetwork, 'patch-theme', PatchThemeCommandModule);
  shimHostToolModule(
    virtualNetwork,
    'persist-module-inspector-view',
    PersistModuleInspectorViewCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'preview-format',
    PreviewFormatCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'publish-realm',
    PublishRealmCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'read-binary-file',
    ReadBinaryFileCommandModule,
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
  shimHostToolModule(virtualNetwork, 'read-source', ReadSourceCommandModule);
  shimHostToolModule(
    virtualNetwork,
    'read-text-file',
    ReadTextFileCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'reindex-realm',
    ReindexRealmCommandModule,
  );
  shimHostToolModule(virtualNetwork, 'register-bot', RegisterBotCommandModule);
  shimHostToolModule(virtualNetwork, 'save-card', SaveCardCommandModule);
  shimHostToolModule(
    virtualNetwork,
    'serialize-card',
    SerializeCardCommandModule,
  );
  shimHostToolModule(virtualNetwork, 'search-cards', SearchCardsCommandModule);
  shimHostToolModule(
    virtualNetwork,
    'search-and-choose',
    SearchAndChooseCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'open-ai-assistant-room',
    OpenAiAssistantRoomCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'open-create-listing-modal',
    OpenCreateListingModalCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'create-and-open-submission-workflow-card',
    CreateAndOpenSubmissionWorkflowCard,
  );
  shimHostToolModule(
    virtualNetwork,
    'create-submission-workflow',
    CreateSubmissionWorkflowCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'retry-submission-workflow',
    RetrySubmissionWorkflowCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'open-workspace',
    OpenWorkspaceCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'send-ai-assistant-message',
    SendAiAssistantMessageModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'send-bot-trigger-event',
    SendBotTriggerEventCommandModule,
  );
  shimHostToolModule(virtualNetwork, 'set-active-llm', SetActiveLlmModule);
  shimHostToolModule(virtualNetwork, 'show-card', ShowCardCommandModule);
  shimHostToolModule(virtualNetwork, 'show-file', ShowFileCommandModule);
  shimHostToolModule(
    virtualNetwork,
    'switch-submode',
    SwitchSubmodeCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'transform-cards',
    TransformCardsCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'unpublish-realm',
    UnpublishRealmCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'unregister-bot',
    UnregisterBotCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'update-code-path-with-selection',
    UpdateCodePathWithSelectionCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'update-playground-selection',
    UpdatePlaygroundSelectionCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'update-room-skills',
    UpdateRoomSkillsCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'send-request-via-proxy',
    SendRequestViaProxyCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'summarize-session',
    SummarizeSessionCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'sync-openrouter-models',
    SyncOpenRouterModelsCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'ai-assistant',
    UseAiAssistantCommandModule,
  );
  shimHostToolModule(virtualNetwork, 'utils', CommandUtilsModule);
  shimHostToolModule(
    virtualNetwork,
    'write-binary-file',
    WriteBinaryFileCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'write-text-file',
    WriteTextFileCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'ai-assistant',
    UseAiAssistantCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'generate-example-cards',
    GenerateExampleCardsCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'generate-readme-spec',
    GenerateReadmeSpecCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'generate-thumbnail',
    GenerateThumbnailCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'screenshot-card',
    ScreenshotCardCommandModule,
  );
  shimHostToolModule(virtualNetwork, 'get-card', GetCardCommandModule);
  shimHostToolModule(
    virtualNetwork,
    'get-card-type-schema',
    GetCardTypeSchemaCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'get-all-realm-metas',
    GetAllRealmMetasCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'get-available-realm-identifiers',
    GetAvailableRealmIdentifiersCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'get-catalog-realm-identifiers',
    GetCatalogRealmIdentifiersCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'can-read-realm',
    CanReadRealmCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'get-default-writable-realm',
    GetDefaultWritableRealmCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'get-realm-of-resource-identifier',
    GetRealmOfResourceIdentifierCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'sanitize-module-list',
    SanitizeModuleListCommandModule,
  );
  shimHostToolModule(virtualNetwork, 'store-add', StoreAddCommandModule);
  shimHostToolModule(
    virtualNetwork,
    'validate-realm',
    ValidateRealmCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'get-user-system-card',
    GetUserSystemCardCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'search-google-images',
    SearchGoogleImagesCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'one-shot-llm-request',
    OneShotLlmRequestCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'populate-with-sample-data',
    PopulateWithSampleDataCommandModule,
  );
  shimHostToolModule(
    virtualNetwork,
    'set-user-system-card',
    SetUserSystemCardCommandModule,
  );
}

// Note - this is used for the tests
export const HostCommandClasses: (typeof HostBaseCommand<any, any>)[] = [
  AddFieldToCardDefinitionCommandModule.default,
  ApplySearchReplaceBlockCommandModule.default,
  ApplyMarkdownEditCommandModule.default,
  AskAiCommandModule.default,
  CopyCardAsMarkdownCommandModule.default,
  CopyCardToRealmModule.default,
  CopyCardToStackCommandModule.default,
  CopyFileToRealmCommandModule.default,
  CopySourceCommandModule.default,
  AuthedFetchCommandModule.default,
  CanReadRealmCommandModule.default,
  CreateAIAssistantRoomCommandModule.default,
  CopyAndEditCommandModule.default,
  CreateSpecCommandModule.default,
  ExecuteAtomicOperationsCommandModule.default,
  FetchCardJsonCommandModule.default,
  FullReindexRealmCommandModule.default,
  GenerateExampleCardsCommandModule.default,
  GenerateReadmeSpecCommandModule.default,
  GenerateThumbnailCommandModule.default,
  ScreenshotCardCommandModule.default,
  GetAllRealmMetasCommandModule.default,
  GetAvailableRealmIdentifiersCommandModule.default,
  GetDefaultWritableRealmCommandModule.default,
  GetCatalogRealmIdentifiersCommandModule.default,
  GetCardCommandModule.default,
  GetRealmOfResourceIdentifierCommandModule.default,
  GetCardTypeSchemaCommandModule.default,
  GetUserSystemCardCommandModule.default,
  GetEventsFromRoomCommandModule.default,
  GetPublishedRealmsCommandModule.default,
  InviteUserToRoomCommandModule.default,
  InvalidateRealmIdentifiersCommandModule.default,
  LintAndFixCommandModule.default,
  ListingBuildCommandModule.default,
  CreateListingPRRequestCommandModule.default,
  OneShotLlmRequestCommandModule.default,
  OpenAiAssistantRoomCommandModule.default,
  OpenCreateListingModalCommandModule.default,
  CreateAndOpenSubmissionWorkflowCard.default,
  CreateSubmissionWorkflowCommandModule.default,
  RetrySubmissionWorkflowCommandModule.default,
  OpenInInteractModeModule.default,
  OpenWorkspaceCommandModule.default,
  GenerateThemeExampleCommandModule.default,
  PatchCodeCommandModule.default,
  PatchFieldsCommandModule.default,
  PatchThemeCommandModule.default,
  PersistModuleInspectorViewCommandModule.default,
  PopulateWithSampleDataCommandModule.default,
  PreviewFormatCommandModule.default,
  PublishRealmCommandModule.default,
  ReadBinaryFileCommandModule.default,
  ReadCardForAiAssistantCommandModule.default,
  ReadFileForAiAssistantCommandModule.default,
  ReadSourceCommandModule.default,
  ReadTextFileCommandModule.default,
  RegisterBotCommandModule.default,
  ReindexRealmCommandModule.default,
  SaveCardCommandModule.default,
  SanitizeModuleListCommandModule.default,
  StoreAddCommandModule.default,
  SerializeCardCommandModule.default,
  SearchAndChooseCommandModule.default,
  SearchCardsCommandModule.SearchCardsByQueryCommand,
  SearchCardsCommandModule.SearchCardsByTypeAndTitleCommand,
  SearchGoogleImagesCommandModule.default,
  SendAiAssistantMessageModule.default,
  SendBotTriggerEventCommandModule.default,
  SendRequestViaProxyCommandModule.default,
  SetActiveLlmModule.default,
  SetUserSystemCardCommandModule.default,
  ShowCardCommandModule.default,
  ShowFileCommandModule.default,
  SummarizeSessionCommandModule.default,
  SwitchSubmodeCommandModule.default,
  SyncOpenRouterModelsCommandModule.default,
  TransformCardsCommandModule.default,
  UnpublishRealmCommandModule.default,
  UnregisterBotCommandModule.default,
  CancelIndexingJobCommandModule.default,
  CheckCorrectnessCommandModule.default,
  CheckDomainAvailabilityCommandModule.default,
  EvaluateModuleCommandModule.default,
  InstantiateCardCommandModule.default,
  UpdateCodePathWithSelectionCommandModule.default,
  UpdatePlaygroundSelectionCommandModule.default,
  UpdateRoomSkillsCommandModule.default,
  UseAiAssistantCommandModule.default,
  ValidateRealmCommandModule.default,
  MigrateSkillCommandModule.default,
  WriteBinaryFileCommandModule.default,
  WriteTextFileCommandModule.default,
];
