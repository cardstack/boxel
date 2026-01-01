import {
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

import { or } from '@cardstack/boxel-ui/helpers';

import {
  Section,
  SectionBullet,
  SectionCardComponent,
} from '../components/section';
import { SectionCard } from './section-card';

class SellableTypeField extends FieldDef {
  static displayName = 'Sellable Type';

  @field typeIcon = contains(StringField);
  @field typeLabel = contains(StringField);
  @field typeDescription = contains(StringField);
  @field accentColor = contains(StringField);
}

class PublishingStepField extends FieldDef {
  static displayName = 'Publishing Step';

  @field stepIcon = contains(StringField);
  @field stepLabel = contains(StringField);
  @field stepDescription = contains(StringField);
}

export class BuilderEconomySection extends SectionCard {
  static displayName = 'Builder Economy Section';

  @field headline = contains(StringField);
  @field subheadline = contains(StringField);
  @field oldWayHeadline = contains(StringField);
  @field oldWayBody = contains(StringField);
  @field newWayHeadline = contains(StringField);
  @field newWayBody = contains(StringField);
  @field newWayBullets = containsMany(StringField);
  @field generateCostNote = contains(StringField);
  @field generateCostRange = contains(StringField);
  @field remixCostNote = contains(StringField);
  @field remixCostRange = contains(StringField);
  @field sellableTypes = containsMany(SellableTypeField);
  @field publishingSteps = containsMany(PublishingStepField);
  @field footerHeadline = contains(StringField);
  @field footerBody = contains(StringField);

  /** Template Features:
   * Two-column: old way vs new way text + cost comparison card
   * Cost comparison with red/green styling
   * Two-way economy card with sellable types + publishing flow
   */

  static isolated = class Isolated extends Component<typeof this> {
    private get generateCopy() {
      return this.args.model?.generateCostNote || this.args.model?.oldWayBody;
    }

    private get remixCopy() {
      return this.args.model?.remixCostNote || this.args.model?.newWayBody;
    }

    <template>
      <Section as |s|>
        <s.Header
          class='section-layout-row'
          @headline={{@model.headline}}
          @subheadline={{@model.subheadline}}
          @label={{@model.headerLabel}}
        />

        <s.Row>
          <div class='builder-grid'>
            <div class='builder-copy'>
              {{#if @model.oldWayHeadline}}
                <h3 class='builder-title'>{{@model.oldWayHeadline}}</h3>
              {{/if}}
              {{#if @model.oldWayBody}}
                <p class='builder-text'>{{@model.oldWayBody}}</p>
              {{/if}}

              {{#if @model.newWayHeadline}}
                <h3 class='builder-title spaced'>{{@model.newWayHeadline}}</h3>
              {{/if}}
              {{#if @model.newWayBody}}
                <p class='builder-text'>{{@model.newWayBody}}</p>
              {{/if}}

              {{#if @model.newWayBullets.length}}
                <SectionBullet
                  @bullets={{@model.newWayBullets}}
                  @accentColor='var(--cardstack-purple)'
                />
              {{/if}}
            </div>

            <SectionCardComponent
              class='comparison-card'
              @badgeLabel='Comparison'
              @title={{@model.footerHeadline}}
              @text={{@model.footerBody}}
            >
              <:before>
                {{#if (or @model.generateCostRange this.generateCopy)}}
                  <div class='comparison-block comparison-block--old'>
                    <div class='comparison-heading'>
                      <span class='comparison-label'>❌ Generate from Scratch</span>
                      {{#if @model.generateCostRange}}
                        <span
                          class='comparison-cost'
                        >{{@model.generateCostRange}}</span>
                      {{/if}}
                    </div>
                    {{#if this.generateCopy}}
                      <p class='comparison-copy'>
                        {{this.generateCopy}}
                      </p>
                    {{/if}}
                  </div>
                {{/if}}

                {{#if (or @model.remixCostRange this.remixCopy)}}
                  <div class='comparison-block comparison-block--new'>
                    <div class='comparison-heading'>
                      <span class='comparison-label'>✅ Remix from Catalog</span>
                      {{#if @model.remixCostRange}}
                        <span
                          class='comparison-cost'
                        >{{@model.remixCostRange}}</span>
                      {{/if}}
                    </div>
                    {{#if this.remixCopy}}
                      <p class='comparison-copy'>
                        {{this.remixCopy}}
                      </p>
                    {{/if}}
                  </div>
                {{/if}}
              </:before>
            </SectionCardComponent>
          </div>
        </s.Row>
      </Section>

      <style scoped>
        .builder-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
          gap: 2rem;
          align-items: start;
        }
        .builder-copy {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .builder-title {
          margin: 0;
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--foreground, var(--boxel-slate));
        }
        .builder-title.spaced {
          margin-top: 0.5rem;
        }
        .builder-text {
          margin: 0;
          color: var(--muted-foreground, var(--text-muted));
          line-height: 1.6;
        }
        .comparison-card {
          padding-top: 3rem;
        }
        .comparison-block {
          border-radius: 0.5rem;
          padding: 1.25rem;
          margin-bottom: 1rem;
          border: 1px solid var(--border, var(--boxel-border-color));
        }
        .comparison-block:last-child {
          margin-bottom: 1.25rem;
        }
        .comparison-block--old {
          background: rgba(255, 100, 100, 0.1);
          border-color: rgba(255, 100, 100, 0.3);
        }
        .comparison-block--new {
          background: rgba(0, 255, 186, 0.1);
          border-color: var(--boxel-teal, #00ffba);
        }
        .comparison-heading {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
        }
        .comparison-label {
          font-weight: 700;
        }
        .comparison-cost {
          font-family: var(--font-mono, var(--boxel-monospace-font-family));
          color: var(--foreground, var(--boxel-slate));
        }
        .comparison-copy {
          margin: 0;
          font-size: 0.9rem;
          color: var(--muted-foreground, var(--text-muted));
        }
      </style>
    </template>
  };
}
