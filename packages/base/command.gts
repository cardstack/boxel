import { contains, field, primitive, FieldDef, Component } from './card-api';

import StringField from './string';

class CommandObjectField extends FieldDef {
  //this is probably wrong
  static [primitive]: Object;
}

type CommandTypeValue = string;

class CommandType extends FieldDef {
  static [primitive]: CommandTypeValue;
}

type CommandStatus = 'applied' | 'ready';

class CommandStatusField extends FieldDef {
  static [primitive]: CommandStatus;
}

class CommandResultObjectField extends FieldDef {
  static [primitive]: Object; //TODO: keeping types opened

  static embedded = class Embedded extends Component<typeof this> {
    get arrs() {
      return this.args.model as any[];
    }
    <template>
      {{#each this.arrs as |id i|}}
        <div>
          {{i}}.
          {{id}}
        </div>
      {{/each}}
    </template>
  };
}

export class CommandField extends FieldDef {
  @field eventId = contains(StringField);
  @field commandType = contains(CommandType);
  @field payload = contains(CommandObjectField); //args returned by open ai
  @field status = contains(CommandStatusField);
  @field result = contains(CommandResultObjectField);
}

export interface CommandMessageContent {
  'm.relates_to'?: {
    rel_type: string;
    event_id: string;
  };
  msgtype: 'org.boxel.command';
  format: 'org.matrix.custom.html';
  body: string;
  formatted_body: string;
  data: {
    command: any; //type CommandPayload: PatchCardPayload | SearchCardPayload;
  };
}
