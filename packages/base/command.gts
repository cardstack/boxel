import {
  CardDef,
  Component,
  FieldDef,
  StringField,
  contains,
  containsMany,
  field,
  linksTo,
  linksToMany,
} from './card-api';
import CodeRefField, { AbsoluteCodeRefField } from './code-ref';
import BooleanField from './boolean';
import MarkdownField from './markdown';
import NumberField from './number';
import ResponseField from './response-field';
import RealmField from './realm';
import { Skill } from './skill';
import { Spec } from './spec';
import {
  JsonField,
  QueryField,
  SearchCardsByQueryInput,
  SearchCardsByTypeAndTitleInput,
  SearchCardsResult,
  SearchCardSummaryField,
} from './commands/search-card-result';
import { eq, gt } from '@cardstack/boxel-ui/helpers';

export type ToolCallStatus = 'applied' | 'ready' | 'applying';
// Pre-rename spelling; new code imports `ToolCallStatus`.
export type CommandStatus = ToolCallStatus;

export class ApplyMarkdownEditInput extends CardDef {
  @field cardId = contains(StringField);
  @field fieldPath = contains(StringField);
  @field markdownDiff = contains(StringField); // The replacement/result text
  @field instructions = contains(StringField);
  @field currentContent = contains(StringField); // Optional focused section to transform
}

export class SaveCardInput extends CardDef {
  @field card = linksTo(CardDef);
  @field realm = contains(StringField);
  @field localDir = contains(StringField);
}

export class CopyCardToRealmInput extends CardDef {
  @field sourceCard = linksTo(CardDef);
  @field targetRealm = contains(StringField);
  @field localDir = contains(StringField);
}

export class CopyCardToStackInput extends CardDef {
  @field sourceCard = linksTo(CardDef);
  @field targetStackIndex = contains(NumberField);
  @field localDir = contains(StringField);
}

export class CopyCardResult extends CardDef {
  @field newCardId = contains(StringField);
}

export class CopySourceInput extends CardDef {
  @field originSourceIdentifier = contains(StringField);
  @field destinationSourceIdentifier = contains(StringField);
}

export class CopySourceResult extends CardDef {
  @field identifier = contains(StringField);
}

export class CopyFileToRealmInput extends CardDef {
  @field sourceFileIdentifier = contains(StringField);
  @field targetRealm = contains(StringField);
}

export class CopyFileToRealmResult extends CardDef {
  @field newFileIdentifier = contains(StringField);
}

export class PatchCardInput extends CardDef {
  @field cardId = contains(StringField);
  @field patch = contains(JsonField);
  @field roomId = contains(StringField);
}

export class CardIdCard extends CardDef {
  @field cardId = contains(StringField);
}

export class CardTypeSchemaInput extends CardDef {
  @field codeRef = contains(CodeRefField);
}

export class GetUserSystemCardResult extends CardDef {
  @field cardId = contains(StringField);
  @field isDefault = contains(BooleanField);
}

export class ShowCardInput extends CardDef {
  @field cardId = contains(StringField);
  @field format = contains(StringField);
}

export class PatchThemeInput extends CardDef {
  @field cardId = contains(StringField);
  @field skillCard = linksTo(Skill);
}

export class CopyAndEditInput extends CardDef {
  @field card = linksTo(CardDef);
}

export class FileIdentifierCard extends CardDef {
  @field fileIdentifier = contains(StringField);
}

export class RealmIdentifierCard extends CardDef {
  @field realmIdentifier = contains(StringField);
}

export class InvalidateRealmIdentifiersInput extends RealmIdentifierCard {
  @field resourceIdentifiers = containsMany(StringField);
}

export class ReadTextFileInput extends CardDef {
  @field realm = contains(StringField);
  @field path = contains(StringField);
}

export class ReadSourceInput extends CardDef {
  @field realm = contains(StringField);
  @field path = contains(StringField);
}

export class FileContents extends CardDef {
  @field content = contains(StringField);
}

export class SwitchSubmodeInput extends CardDef {
  @field submode = contains(StringField);
  @field codePath = contains(StringField);
  @field createFile = contains(BooleanField);
}

export class PersistModuleInspectorViewInput extends CardDef {
  @field codePath = contains(StringField);
  @field moduleInspectorView = contains(StringField); // 'schema' | 'spec' | 'preview'
}

export class SwitchSubmodeResult extends CardDef {
  @field codePath = contains(StringField);
}

export class WriteTextFileInput extends CardDef {
  @field content = contains(StringField);
  @field realm = contains(StringField);
  @field path = contains(StringField);
  @field overwrite = contains(BooleanField);
  @field useNonConflictingFilename = contains(BooleanField);
}

export class MigrateSkillInput extends CardDef {
  // The realm to migrate: legacy `Skill` cards are read from it and the
  // resulting `skills/<name>/SKILL.md` files are written back into it.
  @field realm = contains(StringField);
  // Overwrite an existing `SKILL.md` at the target path. When false (default),
  // a skill whose target already exists is left untouched and reported as
  // skipped.
  @field overwrite = contains(BooleanField);
}

export class MigrateSkillResult extends CardDef {
  // Absolute URLs of the `SKILL.md` files written by this run.
  @field migratedFiles = containsMany(StringField);
  // Ids of legacy `Skill` cards skipped because their target `SKILL.md`
  // already exists and `overwrite` was not set.
  @field skippedSkillIds = containsMany(StringField);
  // Ids of skills skipped because they had no instructions to write — e.g. a
  // markdown-backed skill whose linked instructions did not resolve. Reported
  // rather than written out as an empty `SKILL.md`.
  @field emptySkillIds = containsMany(StringField);
}

export class WriteBinaryFileInput extends CardDef {
  @field path = contains(StringField);
  @field realm = contains(StringField);
  @field base64Content = contains(StringField);
  @field contentType = contains(StringField);
  @field useNonConflictingFilename = contains(BooleanField);
}

export class WriteBinaryFileResult extends CardDef {
  @field fileIdentifier = contains(StringField);
}

export class ReadBinaryFileInput extends CardDef {
  @field fileIdentifier = contains(StringField);
}

export class ReadBinaryFileResult extends CardDef {
  @field base64Content = contains(StringField);
  @field contentType = contains(StringField);
}

export class GenerateThumbnailInput extends CardDef {
  @field prompt = contains(StringField);
  @field sourceImageUrl = contains(StringField);
  @field targetRealmIdentifier = contains(StringField);
  @field targetPath = contains(StringField); // optional: subfolder within realm, e.g. "thumbnails"
  @field targetCardId = contains(StringField);
  @field cardName = contains(StringField); // card name for filename generation
  @field llmModel = contains(StringField);
}

export class GenerateThumbnailOutput extends CardDef {
  @field imageDefIdentifier = contains(StringField);
}

export class ScreenshotCardInput extends CardDef {
  @field card = linksTo(CardDef);
  @field format = contains(StringField); // 'isolated' | 'embedded'
}

export class ScreenshotCardOutput extends CardDef {
  @field imageDefUrl = contains(StringField);
}

export class CreateInstanceInput extends CardDef {
  @field codeRef = contains(CodeRefField);
  @field realm = contains(StringField);
}

export class CreateInstancesInput extends CardDef {
  @field codeRef = contains(CodeRefField);
  @field realm = contains(StringField);
  @field count = contains(NumberField);
  @field exampleCard = linksTo(CardDef);
}

export class AskAiForCardJsonInput extends CreateInstancesInput {
  @field prompt = contains(MarkdownField);
  @field llmModel = contains(StringField);
  @field skillCardIds = containsMany(StringField);
}

export class AskAiForCardJsonResult extends CardDef {
  @field payload = contains(JsonField);
  @field rawOutput = contains(StringField);
}

export class CreateInstanceResult extends CardDef {
  @field createdCard = linksTo(CardDef);
}

export class GenerateThemeExampleInput extends CardDef {
  @field codeRef = contains(CodeRefField);
  @field realm = contains(StringField);
  @field prompt = contains(MarkdownField);
  @field llmModel = contains(StringField);
  @field skillCardIds = containsMany(StringField);
  @field skillCard = linksTo(Skill);
  @field localDir = contains(StringField);
}

export class GenerateListingExampleInput extends CardDef {
  @field listing = linksTo(CardDef);
  @field realm = contains(StringField);
  @field referenceExample = linksTo(CardDef);
}
export class UpdateCodePathWithSelectionInput extends CardDef {
  @field codeRef = contains(CodeRefField);
  @field localName = contains(StringField);
  @field fieldName = contains(StringField);
}

export class UpdatePlaygroundSelectionInput extends CardDef {
  @field moduleId = contains(StringField);
  @field cardId = contains(StringField);
  @field format = contains(StringField);
  @field fieldIndex = contains(NumberField);
}

export class ApplySearchReplaceBlockInput extends CardDef {
  @field fileContent = contains(StringField);
  @field codeBlock = contains(StringField);
}

export class ApplySearchReplaceBlockResult extends CardDef {
  @field resultContent = contains(StringField);
}

export class LintAndFixInput extends CardDef {
  @field fileContent = contains(StringField);
  @field realm = contains(StringField);
  @field filename = contains(StringField);
}

export class LintAndFixResult extends CardDef {
  @field output = contains(StringField);
  @field lintIssues = containsMany(StringField); // all remaining issues (errors + warnings)
  @field lintErrors = containsMany(StringField); // severity 2 only (unfixable errors)
  @field lintWarnings = containsMany(StringField); // severity 1 only
}

export class PatchCodeResultField extends FieldDef {
  @field status = contains(StringField); // 'applied', 'failed'
  @field failureReason = contains(StringField); // only present if status is 'failed'
}

export class PatchCodeCommandResult extends CardDef {
  @field patchedContent = contains(StringField);
  @field finalFileIdentifier = contains(StringField);
  @field lintIssues = containsMany(StringField);
  @field results = containsMany(PatchCodeResultField);
}

export class PatchCodeInput extends CardDef {
  @field fileIdentifier = contains(StringField);
  @field codeBlocks = containsMany(StringField);
  @field roomId = contains(StringField);
}

export class CheckCorrectnessInput extends CardDef {
  @field targetType = contains(StringField);
  @field targetRef = contains(StringField);
  @field roomId = contains(StringField);
  @field lintIssues = containsMany(StringField);
}

export class CorrectnessResultCard extends CardDef {
  @field correct = contains(BooleanField);
  @field errors = containsMany(StringField);
  @field warnings = containsMany(StringField);
}

export class CreateAIAssistantRoomInput extends CardDef {
  @field name = contains(StringField);
  // Legacy: skills passed as loaded `Skill` cards. Retained for back-compat.
  @field enabledSkills = linksToMany(Skill);
  @field disabledSkills = linksToMany(Skill);
  // Skills passed by id (kind-agnostic): each id may name a `.md` skill file
  // (`boxel.kind: skill`) or a legacy `Skill` card. Resolved via
  // `loadSkillSource` at room creation. Preferred over the card fields above.
  @field enabledSkillIds = containsMany(StringField);
  @field disabledSkillIds = containsMany(StringField);
  @field llmMode = contains(StringField); // 'gpt-4o' or 'gpt-4o-mini'
}

export class CreateAIAssistantRoomResult extends CardDef {
  @field roomId = contains(StringField);
}

export class InviteUserToRoomInput extends CardDef {
  @field roomId = contains(StringField);
  @field userId = contains(StringField);
}

export class RegisterBotInput extends CardDef {
  @field username = contains(StringField);
}

export class RegisterBotResult extends CardDef {
  @field botRegistrationId = contains(StringField);
}

export class UnregisterBotInput extends CardDef {
  @field botRegistrationId = contains(StringField);
}

export class SetActiveLLMInput extends CardDef {
  @field roomId = contains(StringField);
  @field model = contains(StringField);
  @field mode = contains(StringField); // 'act' or 'ask'
}

export class AddSkillsToRoomInput extends CardDef {
  @field roomId = contains(StringField);
  @field skills = linksToMany(Skill);
}

export class UpdateSkillActivationInput extends CardDef {
  @field roomId = contains(StringField);
  @field skillCardId = contains(StringField);
  @field isActive = contains(BooleanField);
}

export class UpdateRoomSkillsInput extends CardDef {
  @field roomId = contains(StringField);
  @field skillCardIdsToActivate = containsMany(StringField);
  @field skillCardIdsToDeactivate = containsMany(StringField);
}

export class UseAiAssistantInput extends CardDef {
  @field roomId = contains(StringField); // pass 'new' or leave blank to create a new room
  @field roomName = contains(StringField); // only used when creating a new room
  @field llmModel = contains(StringField);
  @field llmMode = contains(StringField); // act vs ask
  @field openRoom = contains(BooleanField);
  @field skillCards = linksToMany(Skill);
  @field skillCardIds = containsMany(StringField);
  @field attachedCards = linksToMany(CardDef);
  @field attachedCardIds = containsMany(StringField);
  @field attachedFileIdentifiers = containsMany(StringField);
  @field prompt = contains(StringField);
  @field clientGeneratedId = contains(StringField);
  @field openCardIds = containsMany(StringField);
  @field requireCommandCall = contains(BooleanField); // optional: require AI to execute commands
}

export class SendAiAssistantMessageInput extends CardDef {
  @field roomId = contains(StringField);
  @field prompt = contains(StringField);
  @field clientGeneratedId = contains(StringField);
  @field attachedCards = linksToMany(CardDef);
  @field attachedFileIdentifiers = containsMany(StringField);
  @field realmIdentifier = contains(StringField);
  @field openCardIds = containsMany(StringField);
  @field requireCommandCall = contains(BooleanField);
}

export class SendAiAssistantMessageResult extends CardDef {
  @field roomId = contains(StringField);
  @field eventId = contains(StringField);
}

export class OpenAiAssistantRoomInput extends CardDef {
  @field roomId = contains(StringField);
}

export class AddFieldToCardDefinitionInput extends CardDef {
  @field realm = contains(StringField);
  @field path = contains(StringField);
  @field cardDefinitionToModify = contains(CodeRefField);
  @field fieldName = contains(StringField);
  @field module = contains(StringField);
  @field fieldType = contains(StringField); // 'contains' or 'containsMany'
  @field fieldRef = contains(CodeRefField);
  @field fieldDefinitionType = contains(StringField); // 'card' or 'field'
  @field incomingRelativeTo = contains(StringField); // can be undefined when you know the url is not going to be relative
  @field outgoingRelativeTo = contains(StringField); // can be undefined when you know url is not going to be relative
  @field outgoingRealmURL = contains(StringField); // should be provided when the other 2 params are provided
  @field addFieldAtIndex = contains(NumberField); // if provided, the field will be added at the specified index in the card's possibleFields map
  @field computedFieldFunctionSourceCode = contains(StringField); // if provided, the field will be added as a computed field
}

export class ListingActionInput extends CardDef {
  @field realm = contains(StringField);
  @field actionType = contains(StringField);
  @field listing = linksTo(CardDef);
  @field attachedCard = linksTo(CardDef);
}

export class ListingBuildInput extends CardDef {
  @field realm = contains(StringField);
  @field listing = linksTo(CardDef);
}

export class ListingInstallInput extends CardDef {
  @field realm = contains(StringField);
  @field listing = linksTo(CardDef);
}

export class ListingInstallResult extends CardDef {
  @field exampleCardId = contains(StringField);
  @field skillCardId = contains(StringField);
  @field selectedCodeRef = contains(CodeRefField);
}

export class CreateListingPRRequestInput extends CardDef {
  @field realm = contains(RealmField);
  @field listingId = contains(StringField);
  @field listingName = contains(StringField);
}

export class RetrySubmissionWorkflowInput extends CardDef {
  @field workflowCardId = contains(StringField);
}

export class ListingCreateInput extends CardDef {
  @field openCardIds = containsMany(StringField);
  @field codeRef = contains(CodeRefField);
  @field targetRealm = contains(RealmField);
}

export class ListingCreateResult extends CardDef {
  @field listing = linksTo(CardDef);
}

export class ListingUpdateSpecsInput extends CardDef {
  @field listing = linksTo(CardDef);
}

export class ListingUpdateSpecsResult extends CardDef {
  @field listing = linksTo(CardDef);
  @field specs = linksToMany(Spec);
}

export class VisitCardsInput extends CardDef {
  @field query = contains(QueryField);
  @field commandRef = contains(CodeRefField);
}

export class EvaluateModuleInput extends CardDef {
  @field moduleIdentifier = contains(StringField);
  @field realmIdentifier = contains(StringField);
}

export class EvaluateModuleResult extends CardDef {
  @field passed = contains(BooleanField);
  @field error = contains(StringField);
  @field stackTrace = contains(StringField);
  @field deps = containsMany(StringField);
}

export class InstantiateCardInput extends CardDef {
  @field moduleIdentifier = contains(StringField);
  @field cardName = contains(StringField);
  @field realmIdentifier = contains(StringField);
  @field instanceData = contains(StringField);
}

export class InstantiateCardResult extends CardDef {
  @field passed = contains(BooleanField);
  @field error = contains(StringField);
  @field stackTrace = contains(StringField);
}

export class JsonCard extends CardDef {
  @field json = contains(JsonField);
}

export class FileForAttachmentCard extends CardDef {
  @field fileForAttachment = contains(JsonField);
}

export class CardForAttachmentCard extends CardDef {
  @field cardForAttachment = contains(JsonField);
}

export class GetEventsFromRoomInput extends CardDef {
  @field roomId = contains(StringField);
  @field sinceEventId = contains(StringField);
}

export class GetEventsFromRoomResult extends CardDef {
  @field matrixEvents = containsMany(JsonField);
}

export class SendBotTriggerEventInput extends CardDef {
  @field roomId = contains(StringField);
  @field type = contains(StringField);
  @field input = contains(JsonField);
  @field realm = contains(StringField);
}

export class PreviewFormatInput extends CardDef {
  @field cardId = contains(StringField);
  @field format = contains(StringField);
  @field modulePath = contains(StringField);
}

export class SendRequestViaProxyInput extends CardDef {
  @field url = contains(StringField);
  @field method = contains(StringField);
  @field requestBody = contains(StringField);
  @field headers = contains(JsonField); // optional
  @field multipart = contains(BooleanField); // optional
}

export class SendRequestViaProxyResult extends CardDef {
  @field response = contains(ResponseField);
}

export class SummarizeSessionInput extends CardDef {
  @field roomId = contains(StringField);
}

export class SummarizeSessionResult extends CardDef {
  @field summary = contains(StringField);
}

export class AskAiInput extends CardDef {
  @field prompt = contains(StringField);
  @field llmMode = contains(StringField); // 'ask' or 'act'
}

export class AskAiOutput extends CardDef {
  @field response = contains(StringField);
}

export {
  SearchCardsByQueryInput,
  SearchCardsByTypeAndTitleInput,
  SearchCardsResult,
  SearchCardSummaryField,
};

export class RealmInfoField extends FieldDef {
  @field name = contains(StringField);
  @field backgroundURL = contains(StringField);
  @field iconURL = contains(StringField);
  @field showAsCatalog = contains(BooleanField);
  @field visibility = contains(StringField);
  @field realmUserId = contains(StringField);
  @field publishable = contains(BooleanField);
  @field isIndexing = contains(BooleanField);
  @field isPublic = contains(BooleanField);
}

export class RealmMetaField extends FieldDef {
  @field info = contains(RealmInfoField);
  @field canWrite = contains(BooleanField);
  @field realmIdentifier = contains(StringField);
}

export class GetAllRealmMetasResult extends CardDef {
  @field results = containsMany(RealmMetaField);
}

export class GetAvailableRealmIdentifiersResult extends CardDef {
  @field realmIdentifiers = containsMany(StringField);
}

export class GetCatalogRealmIdentifiersResult extends CardDef {
  @field realmIdentifiers = containsMany(StringField);
}

export class FetchCardJsonInput extends CardDef {
  @field cardIdentifier = contains(StringField);
}

export class FetchCardJsonResult extends CardDef {
  @field document = contains(JsonField);
}

export class ExecuteAtomicOperationsInput extends CardDef {
  @field realmIdentifier = contains(StringField);
  @field operations = containsMany(JsonField);
}

export class ExecuteAtomicOperationsResult extends CardDef {
  @field results = containsMany(JsonField);
}

// A publish destination for a realm. 'type' is 'subdirectory' (a Boxel Space
// under the user's space domain, where 'name' is the realm-name path segment)
// or 'custom' (a claimed custom domain, where 'name' is the full hostname).
export class PublishTarget extends FieldDef {
  @field type = contains(StringField);
  @field name = contains(StringField);
}

export class PublishRealmInput extends CardDef {
  @field realmURL = contains(StringField);
  @field targets = containsMany(PublishTarget);
  // Pre-resolved published-realm URLs. The publish UI builds these with live
  // Matrix state, so it passes them directly instead of typed targets; they are
  // merged with any resolved 'targets'. Provide at least one of the two.
  @field publishedRealmURLs = containsMany(StringField);
  // Bypass the pre-publish publishability gate (private-dependency and
  // error-document violations). Defaults to false.
  @field force = contains(BooleanField);
}

// Per-target outcome. The command resolves once the publish request is
// accepted (the realm-server reindex then runs in the background), so 'status'
// is 'published' (request accepted) or 'error'.
export class PublishTargetResult extends FieldDef {
  @field publishedRealmURL = contains(StringField);
  @field status = contains(StringField);
  @field error = contains(StringField);
}

export class PublishRealmResult extends CardDef {
  @field results = containsMany(PublishTargetResult);
}

export class UnpublishRealmInput extends CardDef {
  @field realmURL = contains(StringField);
  // Supply either a typed target or a fully-resolved publishedRealmURL.
  @field target = contains(PublishTarget);
  @field publishedRealmURL = contains(StringField);
}

// 'status' is 'unpublished' or 'error'.
export class UnpublishRealmResult extends CardDef {
  @field publishedRealmURL = contains(StringField);
  @field status = contains(StringField);
  @field error = contains(StringField);
}

export class GetPublishedRealmsInput extends CardDef {
  @field realmURL = contains(StringField);
}

// One published destination for a source realm. lastPublishedAt mirrors the
// realm-server value: epoch milliseconds rendered as a string (Date.now()
// .toString()); absent when the realm has never been published.
export class PublishedRealmInfo extends FieldDef {
  @field publishedRealmURL = contains(StringField);
  @field lastPublishedAt = contains(StringField);
}

export class GetPublishedRealmsResult extends CardDef {
  @field results = containsMany(PublishedRealmInfo);
}

// 'type' is 'subdirectory' | 'custom'; 'name' matches PublishTarget.name.
export class CheckDomainAvailabilityInput extends CardDef {
  @field type = contains(StringField);
  @field name = contains(StringField);
  @field realmURL = contains(StringField);
}

export class CheckDomainAvailabilityResult extends CardDef {
  @field available = contains(BooleanField);
  @field publishedRealmURL = contains(StringField);
  @field reason = contains(StringField);
}

export class StoreAddInput extends CardDef {
  @field document = contains(JsonField);
  @field realm = contains(StringField);
}

export class GetRealmOfResourceIdentifierInput extends CardDef {
  @field resourceIdentifier = contains(StringField);
}

export class GetRealmOfResourceIdentifierResult extends CardDef {
  @field realmIdentifier = contains(StringField); // empty string if not found
}

export class CanReadRealmInput extends CardDef {
  @field realmIdentifier = contains(StringField);
}

export class CanReadRealmResult extends CardDef {
  @field canRead = contains(BooleanField);
}

export class AuthedFetchInput extends CardDef {
  @field url = contains(StringField);
  @field method = contains(StringField);
  @field acceptHeader = contains(StringField);
}

export class AuthedFetchResult extends CardDef {
  @field ok = contains(BooleanField);
  @field status = contains(NumberField);
  @field body = contains(JsonField);
}

export class GetDefaultWritableRealmResult extends CardDef {
  @field realmIdentifier = contains(StringField); // empty string if no writable realm found
}

export class ValidateRealmInput extends CardDef {
  @field realmIdentifier = contains(StringField);
}

export class ValidateRealmResult extends CardDef {
  @field realmIdentifier = contains(StringField); // normalized with trailing slash
}

export class SanitizeModuleListInput extends CardDef {
  @field moduleIdentifiers = containsMany(StringField);
}

export class SanitizeModuleListResult extends CardDef {
  @field moduleIdentifiers = containsMany(StringField);
}

export class SearchGoogleImagesInput extends CardDef {
  @field query = contains(StringField);
  @field maxResults = contains(NumberField); // optional, default 10
  @field startIndex = contains(NumberField); // optional, default 1, for pagination
}

export class SearchGoogleImagesResult extends CardDef {
  @field images = containsMany(JsonField);
  @field totalResults = contains(NumberField);
  @field searchTime = contains(NumberField);
  @field formattedTotalResults = contains(StringField);
  @field formattedSearchTime = contains(StringField);
  @field hasNextPage = contains(BooleanField);
  @field nextPageStartIndex = contains(NumberField);
  @field currentStartIndex = contains(NumberField);
}

export class CreateSpecsInput extends CardDef {
  @field codeRef = contains(CodeRefField);
  @field module = contains(StringField);
  @field targetRealm = contains(StringField);
  @field autoGenerateReadme = contains(BooleanField);
}

export class CreateSpecsResult extends CardDef {
  @field newSpecs = linksToMany(Spec);
  @field specs = linksToMany(Spec);
}

export class PatchFieldsInput extends CardDef {
  static displayName = 'Patch Fields Input';

  @field cardId = contains(StringField);
  @field fieldUpdates = contains(JsonField); // Dynamic field mapping as JSON object
}

export class PatchFieldsOutput extends CardDef {
  static displayName = 'Patch Fields Result';

  @field success = contains(BooleanField);
  @field updatedFields = containsMany(StringField); // Array of successfully updated field paths
  @field errors = contains(JsonField); // Field path to error message mapping

  static embedded = class Embedded extends Component<typeof PatchFieldsOutput> {
    get updatedFieldsCount(): number {
      return this.args.model.updatedFields?.length ?? 0;
    }
    get commaSepUpdatedFields(): string {
      return (this.args.model.updatedFields ?? []).join(', ');
    }
    get commaSepErrors(): string {
      let errors = this.args.model.errors ?? {};
      return Object.entries(errors)
        .map(([field, message]) => `${field}: ${message}`)
        .join('; ');
    }
    <template>
      <div class='wrapper'>
        {{#if (gt this.updatedFieldsCount 0)}}
          Updated
          {{this.updatedFieldsCount}}
          field{{unless (eq this.updatedFieldsCount 1) 's'}}:
          {{this.commaSepUpdatedFields}}.
          {{#if @model.errors.length}}
            Errors:
            {{this.commaSepErrors}}.
          {{/if}}
        {{else}}
          No fields were updated. Errors:
          {{this.commaSepErrors}}.
        {{/if}}
      </div>
      <style scoped>
        .wrapper {
          padding: var(--boxel-sp-sm);
        }
      </style>
    </template>
  };
}

export class GenerateReadmeSpecResult extends CardDef {
  @field readme = contains(MarkdownField);
}

export class GenerateReadmeSpecInput extends CardDef {
  @field spec = linksTo(Spec);
}

export class OneShotLLMRequestInput extends CardDef {
  @field codeRef = contains(AbsoluteCodeRefField);
  @field userPrompt = contains(StringField);
  @field systemPrompt = contains(StringField);
  @field llmModel = contains(StringField);
  @field skillCardIds = containsMany(StringField);
  @field attachedFileIdentifiers = containsMany(StringField);
}

export class OneShotLLMRequestResult extends CardDef {
  @field output = contains(StringField);
}

// Select up to N cards of a given type using an LLM heuristic
export class SearchAndChooseInput extends CardDef {
  @field candidateTypeCodeRef = contains(CodeRefField); // module + name of card type whose instances should be searched as candidates
  @field sourceContextCodeRef = contains(AbsoluteCodeRefField); // optional module + name whose source should guide selection
  @field max = contains(NumberField); // optional, default 2
  @field additionalSystemPrompt = contains(StringField); // optional extra hard rules
  @field llmModel = contains(StringField); // optional model override
}

export class SearchAndChooseResult extends CardDef {
  @field selectedIds = containsMany(StringField);
  @field selectedCards = linksToMany(CardDef);
}

export class SyncOpenRouterModelsResult extends CardDef {
  @field modelsProcessed = contains(NumberField);
  @field totalModels = contains(NumberField);
  @field status = contains(StringField);
  @field errors = contains(StringField);
}
