import {
  CardDef,
  Component,
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

class CommandObjectFieldTemplate extends Component<typeof CommandObjectField> {
  <template>
    <pre>{{this.stringValue}}</pre>
    <style>
      pre {
        margin: 0;
        white-space: pre-wrap;
      }
    </style>
  </template>

  get stringValue() {
    return JSON.stringify(this.args.model, null, 2);
  }
}

export class CommandObjectField extends FieldDef {
  static [primitive]: Record<string, any>;
  static [queryableValue](value: Record<string, any> | undefined) {
    return Boolean(value) && typeof value === 'object'
      ? JSON.stringify(value)
      : undefined;
  }
  static edit = CommandObjectFieldTemplate;
  static embedded = CommandObjectFieldTemplate;
}

export class CommandCard extends CardDef {
  @field toolCallId = contains(StringField);
  @field name = contains(StringField);
  @field payload = contains(CommandObjectField); //arguments of toolCall. Its not called arguments due to lint
  @field eventId = contains(StringField);
  @field status = contains(CommandStatusField);
}
