import {
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class Report extends CardDef {
  static displayName = 'Report';

  @field reportTitle = contains(StringField);
  @field summary = contains(StringField);
  @field period = contains(StringField);
}
