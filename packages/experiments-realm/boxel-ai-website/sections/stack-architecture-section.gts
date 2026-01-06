import {
  Component,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { FeatureTileField } from '../fields/feature-tile-field';
import {
  Section,
  SectionBullet,
  SectionCardComponent,
} from '../components/section';
import { DiagramBox } from '../components/diagram-box';
import { SectionCard } from './section-card';

export class StackArchitectureSection extends SectionCard {
  static displayName = 'Stack Architecture';

  @field headline = contains(StringField);
  @field subheadline = contains(StringField);
  @field bullets = containsMany(StringField);
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
        <SectionCardComponent
          @badgeLabel='Diagram'
          @title='One File. Full Stack.'
          @text='Five traditional layers—frontend, backend, API, database, orchestration—compressed into TypeScript + JSON.'
        >
          <DiagramBox @highlightOnHover={{true}}>.gts — TypeScript Definitions</DiagramBox>
          <DiagramBox @highlightOnHover={{true}}>.json — Data Instances</DiagramBox>
          <DiagramBox class='diagram-plain'>↓ AI reads one file ↓</DiagramBox>
        </SectionCardComponent>

        <s.Header
          @headline={{@model.headline}}
          @subheadline={{@model.subheadline}}
          @label={{@model.headerLabel}}
        >
          {{#if @model.bullets.length}}
            <SectionBullet
              @bullets={{@model.bullets}}
              @accentColor='var(--primary)'
            />
          {{/if}}
        </s.Header>

        {{#if @model.tiles.length}}
          <s.Grid>
            <@fields.tiles />
          </s.Grid>
        {{/if}}
      </Section>

      <style scoped>
        .diagram-plain {
          color: var(--secondary);
          font-weight: 500;
          background: none;
          border: none;
        }
      </style>
    </template>
  };
}
