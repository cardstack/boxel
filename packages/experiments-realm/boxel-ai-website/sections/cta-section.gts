import {
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';

import { Section, SectionHeader } from '../components/section';
import { SectionCard } from './section-card';

class ActionItemField extends FieldDef {
  static displayName = 'Action Item';

  @field actionName = contains(StringField);
  @field actionDescription = contains(StringField);
  @field actionIcon = contains(StringField);
  @field accentColor = contains(StringField);
}

export class CtaSection extends SectionCard {
  static displayName = 'CTA Section';

  @field headline = contains(StringField);
  @field subheadline = contains(StringField);
  @field actions = containsMany(ActionItemField);
  @field primaryCtaText = contains(StringField);
  @field primaryCtaUrl = contains(UrlField);
  @field secondaryCtaText = contains(StringField);
  @field secondaryCtaUrl = contains(UrlField);

  /** Template Features:
   * Centered layout
   * 2×2 action card grid
   * Gradient headline
   * Floating card decorations
   */

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
