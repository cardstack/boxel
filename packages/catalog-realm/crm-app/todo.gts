import {
  CardDef,
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';
import MarkdownField from 'https://cardstack.com/base/markdown';

export class Todo extends CardDef {
  static displayName = 'Todo';
  @field name = contains(StringField);
  @field details = contains(MarkdownField);
}
