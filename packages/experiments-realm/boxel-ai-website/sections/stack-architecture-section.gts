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
import { Section, SectionHeader } from '../components/section';
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
      <Section class='section-layout'>
        {{#if @model.diagram}}
          <@fields.diagram />
        {{/if}}
        <SectionHeader
          class={{cn layout-row=(not @model.diagram)}}
          @headline={{@model.headline}}
          @subheadline={{@model.subheadline}}
          @label={{@model.headerLabel}}
        >
          {{#if @model.body.length}}
            <@fields.body />
          {{/if}}
        </SectionHeader>

        {{#if @model.tiles.length}}
          <@fields.tiles class='layout-row section-grid' @format='fitted' />
        {{/if}}
      </Section>

      <style scoped>
        .section-layout {
          --card-width: 16.875rem;
          display: grid;
          grid-template-columns: repeat(
            auto-fit,
            minmax(var(--card-width), 1fr)
          );
          gap: 3rem 4rem;
        }
        .layout-row {
          grid-column: -1 / 1;
        }
        .section-layout :deep(blockquote) {
          border-right: none;
          border-left: 2px solid var(--primary, var(--boxel-highlight));
        }
        .section-layout :deep(blockquote p) {
          margin: 0;
          padding-left: var(--boxel-sp);
          color: var(--muted-foreground);
          font-family: var(--boxel-caption-font-family);
          font-size: 0.8rem;
          font-style: normal;
          line-height: 1.8;
        }
        .section-grid {
          display: grid;
          grid-template-columns: repeat(
            auto-fit,
            minmax(var(--card-width), 1fr)
          );
          gap: 2rem;
        }
        .section-grid :deep(.compound-field) {
          height: 100%;
        }
      </style>
    </template>
  };
}
