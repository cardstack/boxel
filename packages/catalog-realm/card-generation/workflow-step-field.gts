import {
  CardDef,
  FieldDef,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import CodeRefField from 'https://cardstack.com/base/code-ref';

export class WorkflowStepField extends FieldDef {
  @field stepId = contains(StringField);
  @field label = contains(StringField);
  @field description = contains(StringField);
  @field commandRef = contains(CodeRefField); // Reference to the command class
  @field format = contains(StringField); // Stores format as string since Format is a type
  @field input = linksTo(CardDef);
  @field output = linksTo(CardDef);
  @field codeRef = contains(CodeRefField);
  @field targetRealm = contains(StringField);

  static displayName = 'Workflow Step';
}
