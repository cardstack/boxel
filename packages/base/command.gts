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

export type CommandStatus = 'applied' | 'ready' | 'applying';

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
  @field fromRealmUrl = contains(StringField);
  @field toRealmUrl = contains(StringField);
}

export class CopySourceResult extends CardDef {
  @field url = contains(StringField);
}

export class PatchCardInput extends CardDef {
  @field cardId = contains(StringField);
  @field patch = contains(JsonField);
  @field roomId = contains(StringField);
}

export class CardIdCard extends CardDef {
  @field cardId = contains(StringField);
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

export class FileUrlCard extends CardDef {
  @field fileUrl = contains(StringField);
}

export class RealmUrlCard extends CardDef {
  @field realmUrl = contains(StringField);
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

export class SwitchSubmodeResult extends CardDef {
  @field codePath = contains(StringField);
  @field requestedCodePath = contains(StringField);
}

export class WriteTextFileInput extends CardDef {
  @field content = contains(StringField);
  @field realm = contains(StringField);
  @field path = contains(StringField);
  @field overwrite = contains(BooleanField);
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
}

export class PatchCodeResultField extends FieldDef {
  @field status = contains(StringField); // 'applied', 'failed'
  @field failureReason = contains(StringField); // only present if status is 'failed'
}

export class PatchCodeCommandResult extends CardDef {
  @field patchedContent = contains(StringField);
  @field finalFileUrl = contains(StringField);
  @field results = containsMany(PatchCodeResultField);
}

export class PatchCodeInput extends CardDef {
  @field fileUrl = contains(StringField);
  @field codeBlocks = containsMany(StringField);
  @field roomId = contains(StringField);
}

export class CheckCorrectnessInput extends CardDef {
  @field targetType = contains(StringField);
  @field targetRef = contains(StringField);
  @field roomId = contains(StringField);
}

export class CorrectnessResultCard extends CardDef {
  @field correct = contains(BooleanField);
  @field errors = containsMany(StringField);
  @field warnings = containsMany(StringField);
}

export class CreateAIAssistantRoomInput extends CardDef {
  @field name = contains(StringField);
  @field enabledSkills = linksToMany(Skill);
  @field disabledSkills = linksToMany(Skill);
  @field llmMode = contains(StringField); // 'gpt-4o' or 'gpt-4o-mini'
}

export class CreateAIAssistantRoomResult extends CardDef {
  @field roomId = contains(StringField);
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
  @field attachedFileURLs = containsMany(StringField);
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
  @field attachedFileURLs = containsMany(StringField);
  @field realmUrl = contains(StringField);
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

export class CreateListingPRInput extends CardDef {
  @field roomId = contains(StringField);
  @field realm = contains(RealmField);
  @field listing = linksTo(CardDef);
}

export class CreateListingPRResult extends CardDef {
  @field snapshotId = contains(StringField);
  @field branch = contains(StringField);
  @field fileCount = contains(NumberField);
  @field prUrl = contains(StringField);
  @field prNumber = contains(NumberField);
}

export class ListingCreateInput extends CardDef {
  @field openCardId = contains(StringField);
  @field targetRealm = contains(StringField);
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
  @field url = contains(StringField);
}

export class GetAllRealmMetasResult extends CardDef {
  @field results = containsMany(RealmMetaField);
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
  @field attachedFileURLs = containsMany(StringField);
}

export class OneShotLLMRequestResult extends CardDef {
  @field output = contains(StringField);
}

// Select up to N cards of a given type using an LLM heuristic
export class SearchAndChooseInput extends CardDef {
  @field codeRef = contains(CodeRefField); // module + name of card type to search instances of
  @field max = contains(NumberField); // optional, default 2
  @field additionalSystemPrompt = contains(StringField); // optional extra hard rules
  @field llmModel = contains(StringField); // optional model override
}

export class SearchAndChooseResult extends CardDef {
  @field selectedIds = containsMany(StringField);
  @field selectedCards = linksToMany(CardDef);
}
