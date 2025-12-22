import {
  // Component,
  FieldDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import enumField from 'https://cardstack.com/base/enum';

import { SectionCard } from './section-card';

class SkillItemField extends FieldDef {
  static displayName = 'Skill Item';

  @field skillIcon = contains(StringField);
  @field skillName = contains(StringField);
  @field skillType = contains(
    enumField(StringField, { options: ['vertical', 'domain', 'behavior'] }),
  );
  @field skillDescription = contains(StringField);
  @field skillSections = containsMany(StringField);
  @field accentColor = contains(StringField);
}

export class SkillsSection extends SectionCard {
  static displayName = 'Skills Section';

  @field sectionNumber = contains(StringField);
  @field sectionLabel = contains(StringField);
  @field headline = contains(StringField);
  @field body = contains(StringField);
  @field bullets = containsMany(StringField);
  @field skills = containsMany(SkillItemField);
  @field footerNote = contains(StringField);

  /** Template Features:
   * Two-column layout: body + evolution diagram / skills grid
   * 2×3 skill card grid
   * Skill type color coding
   * "Prompt to Skill" evolution diagram
   */
}
