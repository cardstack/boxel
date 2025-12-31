import {
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import ColorField from 'https://cardstack.com/base/color';
import enumField from 'https://cardstack.com/base/enum';

import { Section, SectionBullet } from '../components/section';
import { FeatureTileField } from '../fields/feature-tile-field';
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
  @field accentColor = contains(ColorField);
}

export class SkillsSection extends SectionCard {
  static displayName = 'Skills Section';

  @field headline = contains(StringField);
  @field subheadline = contains(StringField);
  @field bullets = containsMany(StringField);
  @field skills = containsMany(SkillItemField);
  @field skillFlow = contains(FeatureTileField);
  @field models = contains(FeatureTileField);
  @field footerNote = contains(StringField);

  /** Template Features:
   * Two-column layout: body + evolution diagram / skills grid
   * 2×3 skill card grid
   * Skill type color coding
   * "Prompt to Skill" evolution diagram
   */

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <Section as |s|>
        <@fields.skillFlow />
        <s.Header
          @headline={{@model.headline}}
          @subheadline={{@model.subheadline}}
          @label={{@model.headerLabel}}
        >
          <SectionBullet
            @bullets={{@model.bullets}}
            @accentColor='var(--secondary)'
          />
        </s.Header>
        <s.Row>
          <@fields.models />
        </s.Row>
      </Section>
    </template>
  };
}
