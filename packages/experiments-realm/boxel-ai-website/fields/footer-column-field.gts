import {
  FieldDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { NavLinkField } from './nav-link-field';

export class FooterColumnField extends FieldDef {
  static displayName = 'Footer Column';

  @field columnTitle = contains(StringField);
  @field links = containsMany(NavLinkField);
}
