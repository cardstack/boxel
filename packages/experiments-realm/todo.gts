import {
  CardDef,
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';
import TextAreaCard from 'https://cardstack.com/base/text-area';

export class Todo extends CardDef {
  static displayName = 'Todo';
  @field taskName = contains(StringField);
  @field taskDetail = contains(TextAreaCard);
}
