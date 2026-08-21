import {
  CardDef,
  Component,
  contains,
  field,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import enumField from 'https://cardstack.com/base/enum';
import { eq } from '@cardstack/boxel-ui/helpers';
import OctagonAlertIcon from '@cardstack/boxel-icons/octagon-alert';
import { MatrixConcept } from './matrix-concept';

const BlockerStatusField = enumField(StringField, {
  options: ['open', 'resolved'],
  displayName: 'Blocker Status',
});

export class Blocker extends CardDef {
  static displayName = 'Blocker';
  static icon = OctagonAlertIcon;

  @field blockerTitle = contains(StringField);
  @field detail = contains(MarkdownField);
  @field status = contains(BlockerStatusField);
  // Where this blocker is recorded in prose — a doc, an issue, a memory.
  @field source = contains(StringField);
  @field concepts = linksToMany(() => MatrixConcept);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Blocker) {
      return this.blockerTitle?.trim()?.length
        ? this.blockerTitle
        : 'Untitled blocker';
    },
  });

  static embedded = class Embedded extends Component<typeof Blocker> {
    <template>
      <div class='blocker-row'>
        <div class='head'>
          <span
            class='status
              {{if (eq @model.status "resolved") "st-resolved" "st-open"}}'
          >{{if @model.status @model.status 'open'}}</span>
          <span class='name'>{{@model.blockerTitle}}</span>
          {{#if @model.source}}
            <a
              class='source'
              href={{@model.source}}
              target='_blank'
              rel='noopener noreferrer'
            >source ↗</a>
          {{/if}}
        </div>
        {{#if @model.detail}}
          <div class='body'><@fields.detail /></div>
        {{/if}}
        {{#if @model.concepts.length}}
          <div class='concepts'><@fields.concepts @format='atom' /></div>
        {{/if}}
      </div>
      <style scoped>
        .blocker-row {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
          padding: 0.625rem 0.875rem;
          font-size: 0.8125rem;
        }
        .head {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        .status {
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.4375rem;
          border-radius: 999px;
        }
        .st-open {
          background: var(--state-blocked-bg, #fee2e2);
          color: var(--state-blocked-fg, #991b1b);
        }
        .st-resolved {
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
        }
        .name {
          font-weight: 600;
        }
        .source {
          margin-left: auto;
          font-size: 0.75rem;
          color: var(--tier-shared-fg, #1e40af);
          text-decoration: none;
        }
        .source:hover {
          text-decoration: underline;
        }
        .body {
          line-height: 1.45;
        }
        .body :deep(p) {
          margin: 0 0 0.375rem;
        }
        .concepts :deep(.atom-format) {
          display: inline-flex;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Blocker> {
    <template>
      <article class='blocker-page'>
        <header class='bh'>
          <span
            class='status
              {{if (eq @model.status "resolved") "st-resolved" "st-open"}}'
          >{{if @model.status @model.status 'open'}}</span>
          <div>
            <p class='doc-kind'>Known blocker</p>
            <h1>{{@model.blockerTitle}}</h1>
          </div>
        </header>
        {{#if @model.detail}}
          <section class='panel'><@fields.detail /></section>
        {{/if}}
        {{#if @model.source}}
          <section class='panel'>
            <h2>Source</h2>
            <a
              href={{@model.source}}
              target='_blank'
              rel='noopener noreferrer'
            >{{@model.source}}</a>
          </section>
        {{/if}}
        {{#if @model.concepts.length}}
          <section class='panel'>
            <h2>Affected concepts</h2>
            <@fields.concepts @format='embedded' />
          </section>
        {{/if}}
      </article>
      <style scoped>
        .blocker-page {
          max-width: 40rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .bh {
          display: flex;
          align-items: center;
          gap: 1rem;
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 1.25rem;
        }
        .status {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.375rem 0.75rem;
          border-radius: 999px;
          white-space: nowrap;
        }
        .st-open {
          background: var(--state-blocked-bg, #fee2e2);
          color: var(--state-blocked-fg, #991b1b);
        }
        .st-resolved {
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
        }
        .doc-kind {
          margin: 0 0 0.125rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--muted-foreground, #6b7280);
        }
        h1 {
          margin: 0;
          font-size: 1.625rem;
          line-height: 1.1;
          font-family: var(--font-heading, inherit);
        }
        .panel {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          padding: 1rem 1.25rem;
          background: var(--card, #ffffff);
        }
        h2 {
          margin: 0 0 0.75rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, #6b7280);
        }
      </style>
    </template>
  };
}
