import {
  Component,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';

import { not, cn } from '@cardstack/boxel-ui/helpers';

import { FeatureTileField } from '../fields/feature-tile-field';
import { Section } from '../components/section';
import { SectionCard } from './section-card';

export class StackArchitectureSection extends SectionCard {
  static displayName = 'Stack Architecture';

  @field headline = contains(StringField);
  @field subheadline = contains(StringField);
  @field body = contains(MarkdownField);
  @field diagram = contains(FeatureTileField);
  @field tiles = containsMany(FeatureTileField);

  /** Template Features:
   * 2×2 tile grid (or horizontal scroll variant)
   * Each tile has inline diagram visualization
   * Accent glow on hover
   * Bullet points with colored dots
   */

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <Section as |s|>
        {{#if @model.diagram.headline}}
          <@fields.diagram />
        {{/if}}

        <s.Header
          class={{cn section-layout-row=(not @model.diagram.headline)}}
          @headline={{@model.headline}}
          @subheadline={{@model.subheadline}}
          @label={{@model.headerLabel}}
        >
          {{#if @model.body.length}}
            <@fields.body />
          {{/if}}
        </s.Header>

        {{#if @model.tiles.length}}
          <@fields.tiles class='section-cards-grid' @format='fitted' />
        {{/if}}
      </Section>
    </template>
  };
}
