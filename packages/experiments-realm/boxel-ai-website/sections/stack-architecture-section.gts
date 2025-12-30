import {
  Component,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { FeatureTileField } from '../fields/feature-tile-field';
import { Section, SectionHeader } from '../components/section';
import { SectionCard } from './section-card';

export class StackArchitectureSection extends SectionCard {
  static displayName = 'Stack Architecture';

  @field headline = contains(StringField);
  @field subheadline = contains(StringField);
  @field tiles = containsMany(FeatureTileField);

  /** Template Features:
   * 2×2 tile grid (or horizontal scroll variant)
   * Each tile has inline diagram visualization
   * Accent glow on hover
   * Bullet points with colored dots
   */

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <Section>
        <SectionHeader
          @headline={{@model.headline}}
          @subheadline={{@model.subheadline}}
          @label={{@model.headerLabel}}
        />
        {{#if @model.tiles.length}}
          <@fields.tiles class='section-grid' @format='fitted' />
        {{/if}}
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
