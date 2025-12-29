import {
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import ColorField from 'https://cardstack.com/base/color';
import URLField from 'https://cardstack.com/base/url';

import {
  Section,
  SectionHeader,
  SectionCardComponent,
} from '../components/section';
import { SectionCard } from './section-card';

class ModeCardField extends FieldDef {
  static displayName = 'Mode Card';

  @field modeNumber = contains(StringField);
  @field modeLabel = contains(StringField);
  @field headline = contains(StringField);
  @field subheadline = contains(StringField);
  @field body = contains(StringField);
  @field screenshotUrl = contains(URLField);
  @field linkText = contains(StringField);
  @field linkUrl = contains(URLField);
  @field linkColor = contains(ColorField);
  @field accentColor = contains(ColorField);

  static embedded = class Embedded extends Component<typeof this> {
    private get badgeLabel() {
      return [this.args.model?.modeLabel, this.args.model?.modeNumber]
        .map((l) => l?.trim())
        .filter(Boolean)
        .join(' ');
    }

    <template>
      <SectionCardComponent
        @accentColor={{@model.accentColor}}
        @badgeLabel={{this.badgeLabel}}
        @title={{@model.headline}}
        @text={{@model.subheadline}}
        @linkText={{@model.linkText}}
        @linkUrl={{@model.linkUrl}}
        @linkColor={{@model.linkColor}}
      />
    </template>
  };

  static fitted = this.embedded;
}

export class ThreeModesSection extends SectionCard {
  static displayName = 'Three Modes';

  @field headline = contains(StringField);
  @field subheadline = contains(StringField);
  @field modes = containsMany(ModeCardField);

  /** Template Features:
   * Three expandable cards
   * Hover to expand with screenshot reveal
   * Color-coded mode indicators
   * Staggered grid layout
   * */

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <Section class='section-isolated'>
        <SectionHeader
          @headline={{@model.headline}}
          @subheadline={{@model.subheadline}}
          @label={{@model.headerLabel}}
        />
        <@fields.modes class='section-grid' @format='fitted' />
      </Section>
      <style scoped>
        .section-grid {
          margin-top: 3rem;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 2rem;
        }
        .section-grid :deep(.compound-field) {
          height: 100%;
        }
      </style>
    </template>
  };
}
