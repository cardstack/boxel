import { CardDef, StringField, contains, field, primitive } from './card-api';

export type CommandStatus = 'applied' | 'ready';

class CommandStatusField extends StringField {
  static [primitive]: CommandStatus;
}

export class CommandCard extends CardDef {
  @field toolCallId = contains(StringField);
  @field name = contains(StringField);
  @field payload = contains(StringField); //arguments of toolCall. Its not called arguments due to lint
  @field eventId = contains(StringField);
  @field status = contains(CommandStatusField);
  @field commandResultId = contains(StringField);
}
