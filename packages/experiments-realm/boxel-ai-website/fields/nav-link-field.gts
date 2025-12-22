import {
  FieldDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';

export class NavLinkField extends FieldDef {
  static displayName = 'Nav Link';

  @field linkText = contains(StringField);
  @field linkUrl = contains(UrlField);
}
