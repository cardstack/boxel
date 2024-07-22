import {
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  linksToMany,
  StringField,
} from 'https://cardstack.com/base/card-api';
import { SkillCard } from 'https://cardstack.com/base/skill-card';

export class ProductRequirementDocument extends CardDef {
  static displayName = 'ProductRequirementDocument';
  @field appType = contains(StringField);
  @field domain = contains(StringField);
  @field customRequirements = contains(StringField);
}
