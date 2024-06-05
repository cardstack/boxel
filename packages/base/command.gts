import { contains, field, primitive, FieldDef } from './card-api';

import StringField from './string';
import { action } from '@ember/object';

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

export class CommandField extends FieldDef {
  @field eventId = contains(StringField);
  @field commandType = contains(CommandType);
  @field payload = contains(CommandObjectField); //args returned by open ai
  @field status = contains(CommandStatusField);

  //interface with the host
  protected hostCommand: any = undefined;
  get hostCommandArgs(): any {
    return;
  }
  //TODO: Running the card probably doesn't deal with this
  @action
  run() {
    return this.hostCommand(this.hostCommandArgs);
  }

  //interface with matrix

  //interface with openai
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
