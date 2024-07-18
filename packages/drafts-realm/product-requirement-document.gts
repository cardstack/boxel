import {
  CardDef,
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';

export class ProductRequirementDocument extends CardDef {
  static displayName = 'ProductRequirementDocument';
  @field appType = contains(StringField);
  @field domain = contains(StringField);
  @field customRequirements = contains(StringField);
}
