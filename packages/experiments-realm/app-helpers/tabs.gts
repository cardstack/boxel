import {
  FieldDef,
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';
import BooleanField from 'https://cardstack.com/base/boolean';
import CodeRefField from 'https://cardstack.com/base/code-ref';

export class Tab extends FieldDef {
  @field displayName = contains(StringField);
  @field tabId = contains(StringField);
  @field ref = contains(CodeRefField);
  @field isTable = contains(BooleanField);
}
