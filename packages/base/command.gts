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
import { SkillCard } from './skill-card';
import { JsonField } from './command-result';
import { SearchCardsResult } from './command-result';

export type CommandStatus = 'applied' | 'ready' | 'applying';

export class SaveCardInput extends CardDef {
  @field realm = contains(StringField);
  @field card = linksTo(CardDef);
}

export class CopyCardInput extends CardDef {
  @field sourceCard = linksTo(CardDef);
  @field targetRealmUrl = contains(StringField);
  @field targetStackIndex = contains(NumberField);
}

export class CopyCardResult extends CardDef {
  @field newCard = linksTo(CardDef);
}

export class PatchCardInput extends CardDef {
  @field cardId = contains(StringField);
  @field patch = contains(JsonField);
}

export class ShowCardInput extends CardDef {
  @field cardToShow = linksTo(CardDef);
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

export class CreateAIAssistantRoomInput extends CardDef {
  @field name = contains(StringField);
}

export class CreateAIAssistantRoomResult extends CardDef {
  @field roomId = contains(StringField);
}

export class AddSkillsToRoomInput extends CardDef {
  @field roomId = contains(StringField);
  @field skills = linksToMany(SkillCard);
}

export class UpdateSkillActivationInput extends CardDef {
  @field roomId = contains(StringField);
  @field skillEventId = contains(StringField);
  @field isActive = contains(BooleanField);
}

export class SendAiAssistantMessageInput extends CardDef {
  @field roomId = contains(StringField);
  @field prompt = contains(StringField);
  @field clientGeneratedId = contains(StringField);
  @field attachedCards = linksToMany(CardDef);
  @field requireCommandCall = contains(BooleanField);
  // This is a bit of a "fake" field in that it would not serialize properly.
  // It works OK for the purposes of transient input to SendAiAssistantMessageCommand.
  // The typescript type here is intended to be { command: Command<any, any, any>; autoExecute: boolean }[]
  @field commands = containsMany(JsonField);
}

export class SendAiAssistantMessageResult extends CardDef {
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

export class LegacyGenerateAppModuleResult extends CardDef {
  @field moduleId = contains(StringField);
  @field source = contains(StringField);
}

export class OpenAiAssistantRoomInput extends CardDef {
  @field roomId = contains(StringField);
}

export { SearchCardsResult };
