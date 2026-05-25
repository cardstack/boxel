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
      <div class='knowledge-card compact'>
        <div class='kicker'>{{if
            @model.articleType
            @model.articleType
            'article'
          }}</div>
        <strong>{{if
            @model.articleTitle
            @model.articleTitle
            'Untitled Article'
          }}</strong>
      </div>
      <style scoped>
        .knowledge-card {
          display: grid;
          gap: 0.25rem;
        }
        .compact {
          padding: 0.75rem;
          border: 1px solid var(--border);
          border-radius: 0.5rem;
          background: var(--card);
        }
        .kicker {
          font-size: 0.75rem;
          text-transform: uppercase;
          color: var(--muted-foreground);
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
