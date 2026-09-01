import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import MarkdownField from '@cardstack/base/markdown';
import FileTextIcon from '@cardstack/boxel-icons/file-text';
import { Deal } from './deal';

// Proposal — a narrative sales document sent BEFORE pricing is finalized.
// Kept deliberately separate from Quote: a Proposal sells the WHY (goals,
// scope, value proposition), a Quote states the HOW MUCH. Conflating them
// forces every early-stage one-pager into a pricing document before the
// deal is even qualified for one.

export class Proposal extends CardDef {
  static displayName = 'Proposal';
  static icon = FileTextIcon;

  @field title = contains(StringField);
  @field narrative = contains(MarkdownField);
  @field deal = linksTo(Deal);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Proposal) {
      return this.title?.trim()?.length
        ? this.title
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static atom = class Atom extends Component<typeof Proposal> {
    <template>
      <span class='proposal-atom'>
        <FileTextIcon class='pa-icon' />
        <span class='pa-name'>{{@model.cardTitle}}</span>
      </span>
      <style scoped>
        .proposal-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, #111111);
        }
        .pa-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .pa-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Proposal> {
    <template>
      <div class='proposal-row'>
        <FileTextIcon class='icon' />
        <div class='info'>
          <span class='name'>{{@model.cardTitle}}</span>
          {{#if @model.deal.cardTitle}}
            <span class='meta'>For {{@model.deal.cardTitle}}</span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .proposal-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.625rem 0.875rem;
          font-size: 0.875rem;
        }
        .icon {
          width: 20px;
          height: 20px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .info {
          min-width: 0;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }
        .name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Proposal> {
    <template>
      <div class='fitted'>
        <div class='fmt badge'>
          <FileTextIcon class='doc-icon' />
          <span class='name'>{{@model.cardTitle}}</span>
        </div>
        <div class='fmt strip'>
          <FileTextIcon class='doc-icon' />
          <div class='info'>
            <span class='name'>{{@model.cardTitle}}</span>
            {{#if @model.deal.cardTitle}}
              <span class='meta'>{{@model.deal.cardTitle}}</span>
            {{/if}}
          </div>
        </div>
        <div class='fmt tile'>
          <FileTextIcon class='doc-icon' />
          <span class='name'>{{@model.cardTitle}}</span>
          {{#if @model.deal.cardTitle}}
            <span class='meta'>{{@model.deal.cardTitle}}</span>
          {{/if}}
        </div>
        <div class='fmt card'>
          <div class='col'>
            <div class='row'>
              <FileTextIcon class='doc-icon' />
              <span class='name name-lg'>{{@model.cardTitle}}</span>
            </div>
            {{#if @model.deal.cardTitle}}
              <span class='meta'>For {{@model.deal.cardTitle}}</span>
            {{/if}}
          </div>
        </div>
      </div>
      <style scoped>
        .fitted {
          width: 100%;
          height: 100%;
          color: var(--foreground, #111111);
        }
        .fmt {
          display: none;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          overflow: hidden;
        }
        .doc-icon {
          width: 20px;
          height: 20px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .name {
          font-weight: 600;
          font-size: 0.8125rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;
        }
        .name-lg {
          font-size: 0.9375rem;
        }
        .meta {
          font-size: 0.6875rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;
        }
        .row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          min-width: 0;
        }
        .col,
        .info {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          min-width: 0;
          flex: 1;
        }
        @container fitted-card (max-width: 150px) and (max-height: 169px) {
          .badge {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 0.375rem;
            padding: 0.5rem;
            text-align: center;
          }
        }
        @container fitted-card (min-width: 151px) and (max-height: 169px) {
          .strip {
            display: flex;
            align-items: center;
            gap: 0.625rem;
            padding: 0.625rem 0.75rem;
          }
        }
        @container fitted-card (max-width: 399px) and (min-height: 170px) {
          .tile {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            justify-content: center;
            gap: 0.375rem;
            padding: 0.875rem;
          }
        }
        @container fitted-card (min-width: 400px) and (min-height: 170px) {
          .card {
            display: flex;
            align-items: center;
            gap: 1rem;
            padding: 1.25rem;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Proposal> {
    <template>
      <article class='proposal-page'>
        <header class='ph'>
          <p class='doc-kind'>Proposal</p>
          <h1>{{@model.cardTitle}}</h1>
          {{#if @model.deal}}
            <div class='deal-chip'><@fields.deal @format='atom' /></div>
          {{/if}}
        </header>
        <section class='body'>
          <@fields.narrative />
        </section>
      </article>
      <style scoped>
        .proposal-page {
          max-width: 46rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .ph {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 1.25rem;
        }
        .doc-kind {
          margin: 0;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--muted-foreground, #6b7280);
        }
        h1 {
          margin: 0;
          font-size: 1.75rem;
          line-height: 1.1;
          font-family: var(--font-heading, inherit);
        }
        .deal-chip {
          margin-top: 0.25rem;
        }
        .body {
          font-size: 0.9375rem;
          line-height: 1.6;
        }
      </style>
    </template>
  };
}
