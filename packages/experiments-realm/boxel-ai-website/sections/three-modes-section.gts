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

import { Section, SectionHeader } from '../components/section';
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
  @field accentColor = contains(ColorField);
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
      <Section>
        <SectionHeader
          @headline={{@model.headline}}
          @subheadline={{@model.subheadline}}
          @label={{@model.headerLabel}}
        />
      </Section>
    </template>
  };
}
