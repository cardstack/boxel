import {
  CardDef,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import MarkdownField from '@cardstack/base/markdown';

export class Todo extends CardDef {
  static displayName = 'Todo';
  @field name = contains(StringField);
  @field details = contains(MarkdownField);
}
