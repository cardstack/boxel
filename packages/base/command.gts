import { contains, field, primitive, FieldDef } from './card-api';
import StringField from './string';

type JSONValue = string | number | boolean | null | JSONObject | [JSONValue];

type JSONObject = { [x: string]: JSONValue };

export type PatchObject = { patch: { attributes: JSONObject }; id: string };

class PatchObjectField extends FieldDef {
  static [primitive]: PatchObject;
}

class CommandType extends FieldDef {
  static [primitive]: 'patchCard';
}

type CommandStatus = 'applied' | 'ready';

class CommandStatusField extends FieldDef {
  static [primitive]: CommandStatus;
}

// Subclass, add a validator that checks the fields required?
export class PatchField extends FieldDef {
  @field commandType = contains(CommandType);
  @field payload = contains(PatchObjectField);
  @field eventId = contains(StringField);
  @field status = contains(CommandStatusField);
}
