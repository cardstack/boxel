import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
} from '../card-api';
import enumField from '../enum';
import StringField from '../string';
import DateTimeField from '../datetime';
import MarkdownField from '../markdown';

import { AgentProfile } from './agent-profile';

const knowledgeTypeFields = [
  { value: 'architecture', label: 'Architecture' },
  { value: 'decision', label: 'Decision (ADR)' },
  { value: 'runbook', label: 'Runbook' },
  { value: 'context', label: 'Context' },
  { value: 'api', label: 'API Reference' },
  { value: 'onboarding', label: 'Onboarding' },
];

export class KnowledgeArticle extends CardDef {
  static displayName = 'Knowledge Article';

  @field title = contains(StringField);
  @field articleType = contains(
    enumField(StringField, { options: knowledgeTypeFields }),
  );
  @field content = contains(MarkdownField);
  @field tags = containsMany(StringField);
  @field lastUpdatedBy = linksTo(() => AgentProfile);
  @field updatedAt = contains(DateTimeField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: KnowledgeArticle) {
      return this.cardInfo.name?.trim()?.length
        ? this.cardInfo.name
        : (this.title ?? 'Untitled Article');
    },
  });

  static fitted = class Fitted extends Component<typeof KnowledgeArticle> {
    <template>
      <div class='knowledge-card compact'>
        <div class='kicker'>
          {{#if @model.articleType}}
            <@fields.articleType @format='atom' />
          {{else}}
            Article
          {{/if}}
        </div>
        <strong><@fields.cardTitle /></strong>
      </div>
      <style scoped>
        .knowledge-card {
          display: grid;
          gap: 0.25rem;
        }
        .compact {
          padding: 0.75rem;
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
          <div class='kicker'>
            {{#if @model.articleType}}
              <@fields.articleType @format='atom' />
            {{else}}
              Article
            {{/if}}
          </div>
          <h1><@fields.cardTitle /></h1>
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
