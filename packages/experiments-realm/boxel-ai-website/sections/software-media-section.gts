import {
  Component,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { Section, SectionHeader } from '../components/section';
import { FlowTabField } from '../fields/flow-step-field';
import { SectionCard } from './section-card';

export class SoftwareMediaSection extends SectionCard {
  static displayName = 'Software as Media';

  @field headline = contains(StringField);
  @field subheadline = contains(StringField);
  @field tabs = containsMany(FlowTabField);

  /** Template Features:
   * Video player with play button overlay
   * Optional scroll-scrub interaction
   * Progress bar
   * Info overlay at bottom
   */

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <Section>
        <SectionHeader
          @headline={{@model.headline}}
          @subheadline={{@model.subheadline}}
          @label={{@model.headerLabel}}
        />

        {{#if @model.tabs.length}}
          <@fields.tabs class='section-grid' @format='fitted' />
        {{/if}}
      </Section>

      <style scoped>
        .section-grid {
          margin-top: 3rem;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(16.875rem, 1fr));
          gap: 2rem;
        }
        .section-grid :deep(.compound-field) {
          height: 100%;
        }
      </style>
    </template>
  };
}
