import {
  CardDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class BrandVoiceSkill extends CardDef {
  static displayName = 'Brand Voice Skill';

  @field skillName = contains(StringField);
  @field description = contains(StringField);
  @field toneGuidelines = containsMany(StringField);
}
