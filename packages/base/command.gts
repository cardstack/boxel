import {
  CommandEvent,
  CommandResultEvent,
  MatrixEvent as DiscreteMatrixEvent,
} from './room';
import { FieldDef, StringField, contains, field, primitive } from './card-api';

type JSONValue = string | number | boolean | null | JSONObject | [JSONValue];

type JSONObject = { [x: string]: JSONValue };

type CommandObject = JSONObject;

class CommandObjectField extends FieldDef {
  static [primitive]: CommandObject;
}

type CommandStatus = 'applied' | 'ready';

class CommandStatusField extends FieldDef {
  static [primitive]: CommandStatus;
}

// Subclass, add a validator that checks the fields required?
export class CommandField extends FieldDef {
  @field name = contains(StringField);
  @field payload = contains(CommandObjectField);
  @field eventId = contains(StringField);
  @field status = contains(CommandStatusField);
}

export function isCommandEvent(
  event: DiscreteMatrixEvent,
): event is CommandEvent {
  return (
    event.type === 'm.room.message' &&
    typeof event.content === 'object' &&
    event.content.msgtype === 'org.boxel.command' &&
    event.content.format === 'org.matrix.custom.html' &&
    typeof event.content.data === 'object' &&
    typeof event.content.data.toolCall === 'object'
  );
}

export function isCommandResultEvent(
  event: DiscreteMatrixEvent,
): event is CommandResultEvent {
  return (
    event.type === 'm.room.message' &&
    typeof event.content === 'object' &&
    event.content.msgtype === 'org.boxel.commandResult'
  );
}
