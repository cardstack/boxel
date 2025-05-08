import {
  CardDef,
  Component,
  StringField,
  contains,
  containsMany,
  field,
  linksTo,
  linksToMany,
} from './card-api';
import CodeRefField from './code-ref';
import BooleanField from './boolean';
import NumberField from './number';
import { Skill } from './skill';
import {
  JsonField,
  SearchCardsByQueryInput,
  SearchCardsByTypeAndTitleInput,
  SearchCardsResult,
} from './commands/search-card-result';

export type CommandStatus = 'applied' | 'ready' | 'applying';

export class SaveCardInput extends CardDef {
  @field realm = contains(StringField);
  @field card = linksTo(CardDef);
}

export class CopyCardInput extends CardDef {
  @field sourceCard = linksTo(CardDef);
  @field targetUrl = contains(StringField);
  @field targetStackIndex = contains(NumberField);
  @field realm = contains(StringField);
  @field codeRef = contains(CodeRefField);
}

export class CopyCardResult extends CardDef {
  @field newCardId = contains(StringField);
}

export class CopySourceInput extends CardDef {
  @field fromRealmUrl = contains(StringField);
  @field toRealmUrl = contains(StringField);
}

export class PatchCardInput extends CardDef {
  @field cardId = contains(StringField);
  @field patch = contains(JsonField);
}

export class ShowCardInput extends CardDef {
  @field cardIdToShow = contains(StringField);
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
}

export class LintAndFixResult extends CardDef {
  @field output = contains(StringField);
  @field fixed = contains(BooleanField);
  @field messages = containsMany(JsonField);
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
  @field openCardIds = containsMany(StringField);
  @field requireCommandCall = contains(BooleanField);
  // This is a bit of a "fake" field in that it would not serialize properly.
  // It works OK for the purposes of transient input to SendAiAssistantMessageCommand.
  // The typescript type here is intended to be { command: Command<any, any, any>; autoExecute: boolean }[]
  @field commands = containsMany(JsonField);
}

export class SendAiAssistantMessageResult extends CardDef {
  @field roomId = contains(StringField);
  @field eventId = contains(StringField);
}

export class GetBoxelUIStateResult extends CardDef {
  @field submode = contains(StringField);
  //TODO expand this to include more of the UI state:
  // - open cards
  // - current room ID
  static embedded = class Embedded extends Component<
    typeof GetBoxelUIStateResult
  > {
    <template>
      <div>
        <h2>Boxel UI State</h2>
        <div>Submode: {{@model.submode}}</div>
      </div>
    </template>
  };
}

export class OpenAiAssistantRoomInput extends CardDef {
  @field roomId = contains(StringField);
}

export class RemixInput extends CardDef {
  @field realm = contains(StringField);
  @field listing = linksTo(CardDef);
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

export {
  SearchCardsByQueryInput,
  SearchCardsByTypeAndTitleInput,
  SearchCardsResult,
};
