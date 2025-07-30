import {
  CardDef,
  FieldDef,
  StringField,
  contains,
  containsMany,
  field,
  linksTo,
  linksToMany,
  primitive,
} from './card-api';
import CodeRefField from './code-ref';
import BooleanField from './boolean';
import NumberField from './number';
import { Skill } from './skill';
import {
  JsonField,
  QueryField,
  SearchCardsByQueryInput,
  SearchCardsByTypeAndTitleInput,
  SearchCardsResult,
} from './commands/search-card-result';
import { SerializedFileDef } from './file-api';

export class FileDefField extends FieldDef {
  static [primitive]: SerializedFileDef;
}

export type CommandStatus = 'applied' | 'ready' | 'applying';

export class SaveCardInput extends CardDef {
  @field card = linksTo(CardDef);
  @field realm = contains(StringField);
  @field localDir = contains(StringField);
}

export class CopyCardInput extends CardDef {
  @field sourceCard = linksTo(CardDef);
  @field targetStackIndex = contains(NumberField);
  @field realm = contains(StringField);
  @field localDir = contains(StringField);
  @field codeRef = contains(CodeRefField);
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
}

export class CardIdCard extends CardDef {
  @field cardId = contains(StringField);
}

export class ShowCardInput extends CardDef {
  @field cardId = contains(StringField);
  @field format = contains(StringField);
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

export class FileContents extends CardDef {
  @field content = contains(StringField);
}

export class SwitchSubmodeInput extends CardDef {
  @field submode = contains(StringField);
  @field codePath = contains(StringField);
}

export class WriteTextFileInput extends CardDef {
  @field content = contains(StringField);
  @field realm = contains(StringField);
  @field path = contains(StringField);
  @field overwrite = contains(BooleanField);
}

export class CreateInstanceInput extends CardDef {
  @field module = contains(CodeRefField);
  @field realm = contains(StringField);
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
}

export class CreateAIAssistantRoomInput extends CardDef {
  @field name = contains(StringField);
  @field defaultSkills = linksToMany(Skill);
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

export class ListingCreateInput extends CardDef {
  @field openCardId = contains(StringField);
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

export {
  SearchCardsByQueryInput,
  SearchCardsByTypeAndTitleInput,
  SearchCardsResult,
};
