import {
  Component,
  FieldDef,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';

import { Button, CardContainer } from '@cardstack/boxel-ui/components';
import { cssVar } from '@cardstack/boxel-ui/helpers';

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
      <CardContainer
        class='cta-action'
        style={{cssVar accent-color=@model.accentColor}}
      >
        {{#if @model.actionName}}
          <h4 class='cta-action-title'>{{@model.actionName}}</h4>
        {{/if}}
        {{#if @model.actionDescription}}
          <p class='cta-action-body'>{{@model.actionDescription}}</p>
        {{/if}}
      </CardContainer>

      <style scoped>
        .cta-action {
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          border-color: var(--accent-color, var(--border));
          background: var(--card, var(--boxel-light));
          text-align: left;
        }
        .cta-action-title {
          margin: 0;
          color: var(--cardstack-purple, var(--secondary));
          font-weight: 700;
        }
        .cta-action-body {
          margin: 0;
          color: var(--muted-foreground, var(--text-muted));
          font-size: 0.95rem;
          line-height: 1.6;
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
          <div class='section-layout-row'>
            <@fields.actions class='cta-grid' />
          </div>
        {{/if}}

        <div class='cta-actions section-layout-row'>
          {{#if @model.primaryCtaText}}
            <Button
              class='cta-primary'
              @as='anchor'
              @href={{@model.primaryCtaUrl}}
              @kind='primary'
              @size='touch'
            >
              {{@model.primaryCtaText}}
            </Button>
          {{/if}}

          {{#if @model.secondaryCtaText}}
            <Button
              class='cta-secondary'
              @as='anchor'
              @href={{@model.secondaryCtaUrl}}
              @kind='muted'
              @size='touch'
            >
              {{@model.secondaryCtaText}}
            </Button>
          {{/if}}
        </div>
      </Section>

      <style scoped>
        .cta-section {
          text-align: center;
        }
        .cta-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
          gap: 1.5rem;
          margin: 2rem auto 2.5rem;
          max-width: 56.25rem; /* 900px */
        }
        .cta-actions {
          display: flex;
          gap: 1.25rem;
          justify-content: center;
          align-items: center;
        }
        .cta-primary {
          padding-inline: 2.5rem;
          font-size: 1.1rem;
          font-weight: 700;
        }
        .cta-secondary {
          padding-inline: 2rem;
          font-size: 1.1rem;
        }
      </style>
    </template>
  };
}
