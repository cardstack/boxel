import {
  CardDef,
  Component,
  FieldDef,
  StringField,
  contains,
  field,
  linksTo,
  primitive,
  queryableValue,
} from './card-api';
import CodeRefField from './code-ref';

export type CommandStatus = 'applied' | 'ready';

class CommandStatusField extends StringField {
  static [primitive]: CommandStatus;
}

class CommandObjectFieldTemplate extends Component<typeof CommandObjectField> {
  <template>
    <pre>{{this.stringValue}}</pre>
    <style scoped>
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

export class SaveCardInput extends CardDef {
  @field realm = contains(StringField);
  @field card = linksTo(CardDef);
}

class JsonField extends FieldDef {
  static [primitive]: Record<string, any>;
}

export class PatchCardInput extends CardDef {
  @field cardId = contains(StringField);
  @field patch = contains(JsonField); //TODO: JSONField ?
}

export class ShowCardInput extends CardDef {
  @field cardToShow = linksTo(CardDef);
  @field placement = contains(StringField); // TODO: nicer if enum, likely need to specify stackIndex too?
}

export class SwitchSubmodeInput extends CardDef {
  @field submode = contains(StringField);
}

export class CreateModuleInput extends CardDef {
  @field code = contains(StringField);
  @field realm = contains(StringField);
  @field modulePath = contains(StringField);
}

export class ModuleCard extends CardDef {
  @field module = contains(CodeRefField);
}

export class CreateInstanceInput extends CardDef {
  @field module = contains(CodeRefField);
  @field realm = contains(StringField);
}
