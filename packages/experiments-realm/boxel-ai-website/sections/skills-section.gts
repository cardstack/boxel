import {
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import ColorField from 'https://cardstack.com/base/color';
import enumField from 'https://cardstack.com/base/enum';

import {
  Section,
  SectionBullet,
  SectionCardComponent,
} from '../components/section';
import { SkillFlowStep } from '../components/skill-flow-step';
import { ModelsField } from '../fields/models-field';
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
  @field isHighlighted = contains(BooleanField);
  @field accentColor = contains(ColorField);

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <SkillFlowStep
        class='skill-flow-step-fitted'
        @icon={{@model.skillIcon}}
        @title={{@model.skillName}}
        @description={{@model.skillDescription}}
        @accentColor={{if @model.isHighlighted @model.accentColor}}
      />

      <style scoped>
        .skill-flow-step-fitted {
          min-width: 6.25rem; /* 100px */
          min-height: 8.625rem; /* 138px */
        }
      </style>
    </template>
  };
}

export class SkillsSection extends SectionCard {
  static displayName = 'Skills Section';

  @field headline = contains(StringField);
  @field subheadline = contains(StringField);
  @field bullets = containsMany(StringField);
  @field skills = containsMany(SkillItemField);
  @field models = contains(ModelsField);
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
        <SectionCardComponent
          @badgeLabel='Skill Flow'
          @title='From Prompt to Skill'
          @text='Prompts become skills. Skills become capabilities. Capabilities compound across every conversation.'
        >
          <:before>
            <s.Grid @gridColWidth='6.25rem' @gridGap='0.75rem'>
              <@fields.skills class='skill-flow-grid' @format='fitted' />
            </s.Grid>
          </:before>
        </SectionCardComponent>

        <s.Header
          @headline={{@model.headline}}
          @subheadline={{@model.subheadline}}
          @label={{@model.headerLabel}}
        >
          <SectionBullet
            @bullets={{@model.bullets}}
            @accentColor='var(--brand-secondary)'
          />
        </s.Header>

        <s.Row>
          <@fields.models />
        </s.Row>
      </Section>
    </template>
  };
}
