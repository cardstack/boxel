import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import DateTimeField from 'https://cardstack.com/base/datetime';
import MarkdownField from 'https://cardstack.com/base/markdown';
import enumField from 'https://cardstack.com/base/enum';
import MessageSquareIcon from '@cardstack/boxel-icons/message-square';
import { MatrixConcept } from './matrix-concept';
import { Teammate } from './teammate';

const VerdictField = enumField(StringField, {
  options: ['approve', 'needs work', 'comment'],
  displayName: 'Verdict',
});

function verdictClass(verdict: string | undefined): string {
  switch (verdict) {
    case 'approve':
      return 'verdict-approve';
    case 'needs work':
      return 'verdict-needs-work';
    default:
      return 'verdict-comment';
  }
}

export class ConceptReview extends CardDef {
  static displayName = 'Concept Review';
  static icon = MessageSquareIcon;

  // Thunk: matrix-concept imports this module for its review thread, so the
  // reference back must resolve lazily to keep the cycle inert.
  @field concept = linksTo(() => MatrixConcept);
  // Explicit because the team shares one realm account — the platform cannot
  // attribute the write, so the review must say who made it.
  @field reviewer = linksTo(Teammate);
  @field verdict = contains(VerdictField);
  @field body = contains(MarkdownField);
  @field createdAt = contains(DateTimeField);
  @field resolved = contains(BooleanField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ConceptReview) {
      let concept = this.concept?.concept;
      let verdict = this.verdict ?? 'comment';
      return concept ? `${verdict}: ${concept}` : `Untitled review`;
    },
  });

  static atom = class Atom extends Component<typeof ConceptReview> {
    <template>
      <span class='review-atom'>
        <span
          class='verdict {{verdictClass @model.verdict}}'
        >{{@model.verdict}}</span>
        <span class='name'>{{@model.concept.concept}}</span>
      </span>
      <style scoped>
        .review-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
        }
        .verdict {
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.4375rem;
          border-radius: 999px;
        }
        .verdict-approve {
          background: var(--state-done-bg, #dcfce7);
          color: var(--state-done-fg, #166534);
        }
        .verdict-needs-work {
          background: var(--state-blocked-bg, #fee2e2);
          color: var(--state-blocked-fg, #991b1b);
        }
        .verdict-comment {
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
        }
        .name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof ConceptReview> {
    <template>
      <div class='review-row'>
        <div class='head'>
          <span
            class='verdict {{verdictClass @model.verdict}}'
          >{{@model.verdict}}</span>
          <span class='who'>{{if
              @model.reviewer.name
              @model.reviewer.name
              'unattributed'
            }}</span>
          {{#if @model.createdAt}}
            <span class='when'><@fields.createdAt /></span>
          {{/if}}
          {{#if @model.resolved}}
            <span class='resolved'>resolved</span>
          {{/if}}
        </div>
        {{#if @model.body}}
          <div class='body'><@fields.body /></div>
        {{/if}}
      </div>
      <style scoped>
        .review-row {
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
        .verdict {
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.4375rem;
          border-radius: 999px;
        }
        .verdict-approve {
          background: var(--state-done-bg, #dcfce7);
          color: var(--state-done-fg, #166534);
        }
        .verdict-needs-work {
          background: var(--state-blocked-bg, #fee2e2);
          color: var(--state-blocked-fg, #991b1b);
        }
        .verdict-comment {
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
        }
        .who {
          font-weight: 600;
        }
        .when {
          color: var(--muted-foreground, #6b7280);
          font-size: 0.75rem;
        }
        .resolved {
          margin-left: auto;
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--muted-foreground, #6b7280);
        }
        .body {
          line-height: 1.45;
        }
        .body :deep(p) {
          margin: 0 0 0.375rem;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof ConceptReview> {
    <template>
      <article class='review-page'>
        <header class='rh'>
          <span
            class='verdict {{verdictClass @model.verdict}}'
          >{{@model.verdict}}</span>
          <div class='rh-id'>
            <p class='doc-kind'>Concept review</p>
            <h1>{{@model.concept.concept}}</h1>
            <p class='meta'>
              {{if @model.reviewer.name @model.reviewer.name 'unattributed'}}
              {{#if @model.createdAt}}· <@fields.createdAt />{{/if}}
              {{#if @model.resolved}}· resolved{{/if}}
            </p>
          </div>
        </header>
        {{#if @model.body}}
          <section class='panel'>
            <@fields.body />
          </section>
        {{/if}}
        {{#if @model.concept}}
          <section class='panel'>
            <h2>Concept</h2>
            <@fields.concept @format='embedded' />
          </section>
        {{/if}}
      </article>
      <style scoped>
        .review-page {
          max-width: 40rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .rh {
          display: flex;
          align-items: center;
          gap: 1rem;
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 1.25rem;
        }
        .verdict {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.375rem 0.75rem;
          border-radius: 999px;
          white-space: nowrap;
        }
        .verdict-approve {
          background: var(--state-done-bg, #dcfce7);
          color: var(--state-done-fg, #166534);
        }
        .verdict-needs-work {
          background: var(--state-blocked-bg, #fee2e2);
          color: var(--state-blocked-fg, #991b1b);
        }
        .verdict-comment {
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
        .meta {
          margin: 0.25rem 0 0;
          font-size: 0.8125rem;
          color: var(--muted-foreground, #6b7280);
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
