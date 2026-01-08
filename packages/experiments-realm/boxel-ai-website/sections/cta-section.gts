import {
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';

import { Cta } from '../components/cta';
import { Section } from '../components/section';
import { SectionCard } from './section-card';

class ActionItemField extends FieldDef {
  static displayName = 'Action Item';

  @field actionName = contains(StringField);
  @field actionDescription = contains(StringField);
  @field actionIcon = contains(StringField);
  @field accentColor = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='cta-action'>
        <h4><@fields.actionName /></h4>
        <p><@fields.actionDescription /></p>
      </div>

      <style scoped>
        .cta-action {
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          padding: 0;
          text-align: start;
        }
        h4 {
          color: var(--secondary);
        }
        p {
          font-size: 0.85rem;
          line-height: var(--boxel-caption-line-height);
          color: var(--muted-foreground);
        }
      </style>
    </template>
  };
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
      <Section class='cta-section' as |s|>
        <s.Header
          class='section-layout-row'
          @headline={{@model.headline}}
          @subheadline={{@model.subheadline}}
          @label={{@model.headerLabel}}
        />

        {{#if @model.actions.length}}
          <s.Grid @gridColWidth='12rem' @gridGap='1.5rem'>
            <@fields.actions class='cta-grid' />
          </s.Grid>
        {{/if}}

        <s.Row class='cta-actions'>
          {{#if @model.primaryCtaText}}
            <Cta
              @variant='primary'
              @href={{@model.primaryCtaUrl}}
            >{{@model.primaryCtaText}}</Cta>
          {{/if}}
          {{#if @model.secondaryCtaText}}
            <Cta
              @href={{@model.secondaryCtaUrl}}
            >{{@model.secondaryCtaText}}</Cta>
          {{/if}}
        </s.Row>
      </Section>

      <style scoped>
        .cta-section {
          text-align: center;
        }
        .cta-section :deep(.section-subtitle) {
          max-width: 37.5rem;
          margin-inline: auto;
        }
        .cta-grid {
          max-width: 56.25rem; /* 900px */
          margin-inline: auto;
        }
        .cta-actions {
          display: flex;
          gap: 1.25rem;
          justify-content: center;
          align-items: center;
        }
      </style>
    </template>
  };
}
