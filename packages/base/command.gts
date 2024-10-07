import {
  CardDef,
  FieldDef,
  StringField,
  contains,
  field,
  primitive,
  queryableValue,
} from './card-api';

export type CommandStatus = 'applied' | 'ready';

class CommandStatusField extends StringField {
  static [primitive]: CommandStatus;
}

export class CommandObjectField extends FieldDef {
  static [primitive]: Record<string, any>;
  static [queryableValue](value: Record<string, any> | undefined) {
    return Boolean(value) && typeof value === 'object'
      ? JSON.stringify(value)
      : undefined;
  }
}

export class CommandCard extends CardDef {
  @field toolCallId = contains(StringField);
  @field name = contains(StringField);
  @field payload = contains(CommandObjectField); //arguments of toolCall. Its not called arguments due to lint
  @field eventId = contains(StringField);
  @field status = contains(CommandStatusField);
}
