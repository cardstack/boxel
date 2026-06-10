import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import MarkdownField from 'https://cardstack.com/base/markdown';
import StringField from 'https://cardstack.com/base/string';
import DateTimeField from 'https://cardstack.com/base/datetime';
import enumField from 'https://cardstack.com/base/enum';

import { FittedCard } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import BookOpen from '@cardstack/boxel-icons/book-open';

import { AgentProfile } from './agent-profile';

export const KnowledgeTypeField = enumField(StringField, {
  options: [
    { value: 'architecture', label: 'Architecture' },
    { value: 'decision', label: 'Decision (ADR)' },
    { value: 'runbook', label: 'Runbook' },
    { value: 'context', label: 'Context' },
    { value: 'api', label: 'API Reference' },
    { value: 'onboarding', label: 'Onboarding' },
  ],
});

export class KnowledgeArticle extends CardDef {
  static displayName = 'Knowledge Article';

  @field articleTitle = contains(StringField);
  @field articleType = contains(KnowledgeTypeField);
  @field content = contains(MarkdownField);
  @field tags = containsMany(StringField);
  @field lastUpdatedBy = linksTo(() => AgentProfile);
  @field updatedAt = contains(DateTimeField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: KnowledgeArticle) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : (this.articleTitle ?? 'Untitled Article');
    },
  });

  static fitted = class Fitted extends Component<typeof KnowledgeArticle> {
    <template>
      <FittedCard class='knowledge-fitted'>
        <:eyebrow><BookOpen width='16' height='16' aria-hidden='true' />{{if
            @model.articleType
            @model.articleType
            'Article'
          }}</:eyebrow>
        <:title><@fields.cardTitle /></:title>
        <:subtitle>{{#if @model.tags.length}}<span
              class='tag-count'
            >{{@model.tags.length}}
              {{if
                (eq @model.tags.length 1)
                'tag'
                'tags'
              }}</span>{{/if}}</:subtitle>
        <:footer>{{#if @model.updatedAt}}<span
              class='updated-at'
            ><@fields.updatedAt @format='atom' /></span>{{/if}}</:footer>
      </FittedCard>
      <style scoped>
        .knowledge-fitted :deep(.fc-eyebrow) {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
        }
        .tag-count {
          font-size: var(--boxel-font-size-xs);
          line-height: 1.2;
          color: var(--muted-foreground);
        }
        .updated-at {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground);
          margin-left: auto;
        }
        @container fitted-card (width < 250px) {
          .tag-count,
          .updated-at {
            display: none;
          }
        }
      </style>
    </template>
  };

  static embedded = this.fitted;

  static isolated = class Isolated extends Component<typeof KnowledgeArticle> {
    <template>
      <article class='surface'>
        <header>
          <div class='kicker'>{{if
              @model.articleType
              @model.articleType
              'article'
            }}</div>
          <h1>{{if
              @model.articleTitle
              @model.articleTitle
              'Untitled Article'
            }}</h1>
        </header>
        {{#if @model.tags.length}}
          <section>
            <h2>Tags</h2>
            <ul>
              {{#each @model.tags as |tag|}}
                <li>{{tag}}</li>
              {{/each}}
            </ul>
          </section>
        {{/if}}
        {{#if @model.content}}
          <section>
            <h2>Content</h2>
            <@fields.content />
          </section>
        {{/if}}
      </article>
      <style scoped>
        .surface {
          padding: 1.5rem;
          display: grid;
          gap: 1rem;
        }
        .kicker {
          font-size: 0.75rem;
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
      </style>
    </template>
  };
}
