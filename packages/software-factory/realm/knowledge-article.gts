import { tracked } from '@glimmer/tracking';

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

import {
  Accordion,
  FieldContainer,
  FittedCard,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import BookOpen from '@cardstack/boxel-icons/book-open';

import { AgentProfile } from './agent-profile.gts';

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

class KnowledgeArticleEdit extends Component<typeof KnowledgeArticle> {
  @tracked contentOpen = true;
  @tracked metaOpen = true;

  toggleContent = () => {
    this.contentOpen = !this.contentOpen;
  };
  toggleMeta = () => {
    this.metaOpen = !this.metaOpen;
  };

  <template>
    <div class='ka-edit'>
      <div class='edit-section-body edit-identity'>
        <FieldContainer @label='Title' @tag='label' @vertical={{true}}>
          <@fields.articleTitle />
        </FieldContainer>
        <FieldContainer @label='Type' @tag='label' @vertical={{true}}>
          <@fields.articleType />
        </FieldContainer>
      </div>

      <Accordion class='edit-accordion' @displayContainer={{false}} as |A|>
        <A.Item
          @id='content'
          @isOpen={{this.contentOpen}}
          @onClick={{this.toggleContent}}
        >
          <:title>Content</:title>
          <:content>
            <div class='edit-section-body'>
              <FieldContainer
                @label='Article Body'
                @tag='label'
                @vertical={{true}}
              >
                <div class='markdown-field-shell'>
                  {{#unless @model.content}}
                    <p class='empty-markdown-prompt'>
                      Write the article content here. Markdown is supported.
                    </p>
                  {{/unless}}
                  <@fields.content />
                </div>
              </FieldContainer>
            </div>
          </:content>
        </A.Item>

        <A.Item
          @id='meta'
          @isOpen={{this.metaOpen}}
          @onClick={{this.toggleMeta}}
        >
          <:title>Metadata</:title>
          <:content>
            <div class='edit-section-body'>
              <FieldContainer @label='Tags' @tag='label' @vertical={{true}}>
                <@fields.tags />
              </FieldContainer>
              <div class='field-row'>
                <FieldContainer @label='Last Updated By' @vertical={{true}}>
                  <@fields.lastUpdatedBy />
                </FieldContainer>
                <FieldContainer
                  @label='Updated At'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.updatedAt />
                </FieldContainer>
              </div>
            </div>
          </:content>
        </A.Item>
      </Accordion>
    </div>
    <style scoped>
      .ka-edit {
        container-type: inline-size;
      }
      .edit-accordion {
        --boxel-accordion-title-font-size: 0.8125rem;
        --boxel-accordion-title-font-weight: 600;
        --boxel-accordion-trigger-padding-inline: var(--boxel-sp);
        --boxel-accordion-trigger-padding-block: var(--boxel-sp-xs);
        overflow: hidden;
      }
      .edit-accordion :deep(.boxel-accordion-item-trigger) {
        background: var(--muted, var(--boxel-100));
      }
      .edit-section-body {
        display: grid;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-lg);
      }
      .field-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp);
      }
      .markdown-field-shell {
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .empty-markdown-prompt {
        margin: 0;
        font-size: 0.75rem;
        line-height: 1.4;
        color: var(--muted-foreground, var(--boxel-500));
      }
      @container (width < 480px) {
        .edit-section-body {
          padding: var(--boxel-sp);
        }
        .field-row {
          grid-template-columns: 1fr;
          gap: var(--boxel-sp-xs);
        }
      }
    </style>
  </template>
}

export class KnowledgeArticle extends CardDef {
  static displayName = 'Knowledge Article';
  static icon = BookOpen;

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

  static edit = KnowledgeArticleEdit;

  static fitted = class Fitted extends Component<typeof KnowledgeArticle> {
    <template>
      <div class='knowledge-fitted' data-type={{@model.articleType}}>
        <FittedCard>
          <:eyebrow>
            <span class='ka-badge'>
              <BookOpen width='12' height='12' aria-hidden='true' />
              {{#if @model.articleType}}
                <@fields.articleType @format='atom' />
              {{else}}
                Article
              {{/if}}
            </span>
          </:eyebrow>
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
      </div>
      <style scoped>
        .knowledge-fitted {
          --ka-accent: var(--muted-foreground, var(--boxel-500));
          display: contents;
        }
        .knowledge-fitted[data-type='architecture'] {
          --ka-accent: oklch(52% 0.22 264);
        }
        .knowledge-fitted[data-type='decision'] {
          --ka-accent: oklch(48% 0.22 298);
        }
        .knowledge-fitted[data-type='runbook'] {
          --ka-accent: oklch(42% 0.14 145);
        }
        .knowledge-fitted[data-type='context'] {
          --ka-accent: oklch(50% 0.1 220);
        }
        .knowledge-fitted[data-type='api'] {
          --ka-accent: oklch(58% 0.18 50);
        }
        .knowledge-fitted[data-type='onboarding'] {
          --ka-accent: oklch(52% 0.16 185);
        }
        .ka-badge {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          border-radius: 9999px;
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--ka-accent);
          white-space: nowrap;
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
      <div class='knowledge-isolated' data-type={{@model.articleType}}>
        <header class='ka-header'>
          <div class='ka-eyebrow'>
            <BookOpen
              class='ka-eyebrow-icon'
              width='14'
              height='14'
              aria-hidden='true'
            />
            <span>
              {{#if @model.articleType}}
                <@fields.articleType @format='atom' />
              {{else}}
                Article
              {{/if}}
            </span>
          </div>
          <h1 class='ka-title'>{{if
              @model.articleTitle
              @model.articleTitle
              'Untitled Article'
            }}</h1>
          <div class='ka-meta-row'>
            {{#if @model.tags.length}}
              <div class='ka-tags'>
                {{#each @model.tags as |tag|}}
                  <span class='ka-tag'>{{tag}}</span>
                {{/each}}
              </div>
            {{/if}}
            <div class='ka-byline'>
              {{#if @model.lastUpdatedBy}}
                <span class='ka-by-label'>Updated by</span>
                <span class='ka-author'><@fields.lastUpdatedBy
                    @format='atom'
                  /></span>
              {{/if}}
              {{#if @model.updatedAt}}
                <span class='ka-date'><@fields.updatedAt
                    @format='atom'
                  /></span>
              {{/if}}
            </div>
          </div>
        </header>
        {{#if @model.content}}
          <div class='ka-content'>
            <@fields.content />
          </div>
        {{else}}
          <p class='ka-empty'>No content yet.</p>
        {{/if}}
      </div>
      <style scoped>
        .knowledge-isolated {
          --ka-accent: var(--muted-foreground, var(--boxel-500));
          height: 100%;
          overflow-y: auto;
          width: 100%;
          max-width: 1440px;
          margin: 0 auto;
          padding: var(--boxel-sp-xl) var(--boxel-sp-xl) var(--boxel-sp-2xl);
          box-sizing: border-box;
        }
        .knowledge-isolated[data-type='architecture'] {
          --ka-accent: oklch(52% 0.22 264);
        }
        .knowledge-isolated[data-type='decision'] {
          --ka-accent: oklch(48% 0.22 298);
        }
        .knowledge-isolated[data-type='runbook'] {
          --ka-accent: oklch(42% 0.14 145);
        }
        .knowledge-isolated[data-type='context'] {
          --ka-accent: oklch(50% 0.1 220);
        }
        .knowledge-isolated[data-type='api'] {
          --ka-accent: oklch(58% 0.18 50);
        }
        .knowledge-isolated[data-type='onboarding'] {
          --ka-accent: oklch(52% 0.16 185);
        }
        .ka-header {
          max-width: 52rem;
          border-bottom: 1px solid var(--border, var(--boxel-200));
          padding-bottom: var(--boxel-sp-lg);
          margin-bottom: var(--boxel-sp-xl);
        }
        .ka-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          padding: 0.2em 0.65em;
          border-radius: 9999px;
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--ka-accent);
          background: color-mix(in oklch, var(--ka-accent) 12%, transparent);
          border: 1px solid
            color-mix(in oklch, var(--ka-accent) 28%, transparent);
          margin-bottom: var(--boxel-sp-sm);
        }
        .ka-eyebrow-icon {
          flex-shrink: 0;
          margin-top: 0.1em;
        }
        .ka-title {
          font-size: 2rem;
          font-weight: 700;
          line-height: 1.25;
          margin: 0 0 var(--boxel-sp);
          letter-spacing: -0.01em;
        }
        .ka-meta-row {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: var(--boxel-sp-sm);
        }
        .ka-tags {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-4xs);
        }
        .ka-tag {
          display: inline-flex;
          align-items: center;
          padding: 0.2em 0.6em;
          border-radius: 9999px;
          font-size: var(--boxel-font-size-xs);
          font-weight: 500;
          background: color-mix(
            in oklch,
            var(--muted-foreground, var(--boxel-400)) 12%,
            transparent
          );
          color: var(--muted-foreground, var(--boxel-500));
          border: 1px solid
            color-mix(
              in oklch,
              var(--muted-foreground, var(--boxel-400)) 25%,
              transparent
            );
        }
        .ka-byline {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-500));
          margin-left: auto;
        }
        .ka-by-label {
          opacity: 0.7;
        }
        .ka-author,
        .ka-date {
          display: flex;
          align-items: center;
        }
        .ka-content {
          max-width: 52rem;
          line-height: 1.75;
          font-size: 1rem;
        }
        .ka-empty {
          max-width: 52rem;
          color: var(--muted-foreground, var(--boxel-400));
          font-style: italic;
        }
      </style>
    </template>
  };
}
