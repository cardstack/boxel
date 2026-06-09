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
import * as GetRealmOfResourceIdentifierCommandModule from './get-realm-of-resource-identifier';
import * as GetUserSystemCardCommandModule from './get-user-system-card';
import * as InstantiateCardCommandModule from './instantiate-card';
import * as InvalidateRealmIdentifiersCommandModule from './invalidate-realm-identifiers';
import * as InviteUserToRoomCommandModule from './invite-user-to-room';
import * as LintAndFixCommandModule from './lint-and-fix';
import * as ListingBuildCommandModule from './listing-action-build';
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

export function shimHostCommands(virtualNetwork: VirtualNetwork) {
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/add-field-to-card-definition',
    AddFieldToCardDefinitionCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/ask-ai',
    AskAiCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/authed-fetch',
    AuthedFetchCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/apply-markdown-edit',
    ApplyMarkdownEditCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/apply-search-replace-block',
    ApplySearchReplaceBlockCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/copy-card-as-markdown',
    CopyCardAsMarkdownCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/copy-card',
    CopyCardToRealmModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/copy-card-to-stack',
    CopyCardToStackCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/copy-file-to-realm',
    CopyFileToRealmCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/copy-source',
    CopySourceCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/copy-and-edit',
    CopyAndEditCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/create-ai-assistant-room',
    CreateAIAssistantRoomCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/create-specs',
    CreateSpecCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/check-correctness',
    CheckCorrectnessCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/evaluate-module',
    EvaluateModuleCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/instantiate-card',
    InstantiateCardCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/cancel-indexing-job',
    CancelIndexingJobCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/generate-theme-example',
    GenerateThemeExampleCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/execute-atomic-operations',
    ExecuteAtomicOperationsCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/fetch-card-json',
    FetchCardJsonCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/full-reindex-realm',
    FullReindexRealmCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/get-events-from-room',
    GetEventsFromRoomCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/invite-user-to-room',
    InviteUserToRoomCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/invalidate-realm-identifiers',
    InvalidateRealmIdentifiersCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/lint-and-fix',
    LintAndFixCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/listing-action-build',
    ListingBuildCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/create-listing-pr-request',
    CreateListingPRRequestCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/open-in-interact-mode',
    OpenInInteractModeModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/patch-card-instance',
    PatchCardInstanceCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/patch-code',
    PatchCodeCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/patch-fields',
    PatchFieldsCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/patch-theme',
    PatchThemeCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/persist-module-inspector-view',
    PersistModuleInspectorViewCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/preview-format',
    PreviewFormatCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/publish-realm',
    PublishRealmCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/read-binary-file',
    ReadBinaryFileCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/read-card-for-ai-assistant',
    ReadCardForAiAssistantCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/read-file-for-ai-assistant',
    ReadFileForAiAssistantCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/read-source',
    ReadSourceCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/read-text-file',
    ReadTextFileCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/reindex-realm',
    ReindexRealmCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/register-bot',
    RegisterBotCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/save-card',
    SaveCardCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/serialize-card',
    SerializeCardCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/search-cards',
    SearchCardsCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/search-and-choose',
    SearchAndChooseCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/open-ai-assistant-room',
    OpenAiAssistantRoomCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/open-create-listing-modal',
    OpenCreateListingModalCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/create-and-open-submission-workflow-card',
    CreateAndOpenSubmissionWorkflowCard,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/create-submission-workflow',
    CreateSubmissionWorkflowCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/retry-submission-workflow',
    RetrySubmissionWorkflowCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/open-workspace',
    OpenWorkspaceCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/send-ai-assistant-message',
    SendAiAssistantMessageModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/send-bot-trigger-event',
    SendBotTriggerEventCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/set-active-llm',
    SetActiveLlmModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/show-card',
    ShowCardCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/show-file',
    ShowFileCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/switch-submode',
    SwitchSubmodeCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/transform-cards',
    TransformCardsCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/unpublish-realm',
    UnpublishRealmCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/unregister-bot',
    UnregisterBotCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/update-code-path-with-selection',
    UpdateCodePathWithSelectionCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/update-playground-selection',
    UpdatePlaygroundSelectionCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/update-room-skills',
    UpdateRoomSkillsCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/send-request-via-proxy',
    SendRequestViaProxyCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/summarize-session',
    SummarizeSessionCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/sync-openrouter-models',
    SyncOpenRouterModelsCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/ai-assistant',
    UseAiAssistantCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/utils',
    CommandUtilsModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/write-binary-file',
    WriteBinaryFileCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/write-text-file',
    WriteTextFileCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/ai-assistant',
    UseAiAssistantCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/generate-example-cards',
    GenerateExampleCardsCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/generate-readme-spec',
    GenerateReadmeSpecCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/generate-thumbnail',
    GenerateThumbnailCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/screenshot-card',
    ScreenshotCardCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/get-card',
    GetCardCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/get-card-type-schema',
    GetCardTypeSchemaCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/get-all-realm-metas',
    GetAllRealmMetasCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/get-available-realm-identifiers',
    GetAvailableRealmIdentifiersCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/get-catalog-realm-identifiers',
    GetCatalogRealmIdentifiersCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/can-read-realm',
    CanReadRealmCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/get-default-writable-realm',
    GetDefaultWritableRealmCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/get-realm-of-resource-identifier',
    GetRealmOfResourceIdentifierCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/sanitize-module-list',
    SanitizeModuleListCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/store-add',
    StoreAddCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/validate-realm',
    ValidateRealmCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/get-user-system-card',
    GetUserSystemCardCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/search-google-images',
    SearchGoogleImagesCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/one-shot-llm-request',
    OneShotLlmRequestCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/populate-with-sample-data',
    PopulateWithSampleDataCommandModule,
  );
  virtualNetwork.shimModule(
    '@cardstack/boxel-host/commands/set-user-system-card',
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
  EvaluateModuleCommandModule.default,
  InstantiateCardCommandModule.default,
  UpdateCodePathWithSelectionCommandModule.default,
  UpdatePlaygroundSelectionCommandModule.default,
  UpdateRoomSkillsCommandModule.default,
  UseAiAssistantCommandModule.default,
  ValidateRealmCommandModule.default,
  WriteBinaryFileCommandModule.default,
  WriteTextFileCommandModule.default,
];
