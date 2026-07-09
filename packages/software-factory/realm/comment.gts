import { FieldDef, Component, field, contains } from '@cardstack/base/card-api';
import MarkdownField from '@cardstack/base/markdown';
import StringField from '@cardstack/base/string';
import DateTimeField from '@cardstack/base/datetime';
import { FieldContainer } from '@cardstack/boxel-ui/components';

export class Comment extends FieldDef {
  static displayName = 'Comment';
  @field body = contains(MarkdownField);
  @field author = contains(StringField);
  @field datetime = contains(DateTimeField);
  @field title = contains(StringField, {
    computeVia: function (this: Comment) {
      return this.author?.trim() ?? 'Anonymous';
    },
  });

  static edit = class Edit extends Component<typeof Comment> {
    get initials(): string {
      let author = this.args.model.author;
      if (!author) return '?';
      return author
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w: string) => w[0]?.toUpperCase() ?? '')
        .join('');
    }

    <template>
      <div class='comment-edit-container'>
        <div class='comment-edit'>
          <div
            class='comment-edit-avatar'
            aria-hidden='true'
          >{{this.initials}}</div>
          <div class='comment-edit-fields'>
            <div class='comment-edit-meta'>
              <FieldContainer @label='Author' @tag='label' @vertical={{true}}>
                <@fields.author />
              </FieldContainer>
              <FieldContainer @label='Date' @tag='label' @vertical={{true}}>
                <@fields.datetime />
              </FieldContainer>
            </div>
            <FieldContainer @label='Comment' @tag='label' @vertical={{true}}>
              <@fields.body />
            </FieldContainer>
          </div>
        </div>
      </div>
      <style scoped>
        .comment-edit-container {
          container-type: inline-size;
        }
        .comment-edit {
          display: grid;
          grid-template-columns: 2rem 1fr;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-sm) 0;
        }
        .comment-edit-avatar {
          width: 2rem;
          height: 2rem;
          border-radius: 50%;
          border: 1px solid rgba(0 0 0 / 0.1);
          background: color-mix(
            in oklch,
            var(--muted, var(--boxel-100)) 20%,
            transparent
          );
          color: var(--muted-foreground, var(--boxel-400));
          font-size: 0.6875rem;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          margin-top: 0.25rem;
          user-select: none;
        }
        .comment-edit-fields {
          display: grid;
          gap: var(--boxel-sp-xs);
          min-width: 0;
        }
        .comment-edit-meta {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp-xs);
        }
        @container (width < 300px) {
          .comment-edit {
            grid-template-columns: 1fr;
            padding: 0;
          }
          .comment-edit-meta {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Comment> {
    get initials(): string {
      let author = this.args.model.author;
      if (!author) return '?';
      return author
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w: string) => w[0]?.toUpperCase() ?? '')
        .join('');
    }

    <template>
      <article class='comment'>
        <div class='comment-avatar' aria-hidden='true'>{{this.initials}}</div>
        <div class='comment-content'>
          <header class='comment-header'>
            <span class='comment-author'><@fields.title /></span>
            {{#if @model.datetime}}
              <span class='comment-date'><@fields.datetime /></span>
            {{/if}}
          </header>
          <div class='comment-body'>
            <@fields.body />
          </div>
        </div>
      </article>
      <style scoped>
        .comment {
          display: grid;
          grid-template-columns: 2rem 1fr;
          gap: var(--boxel-sp-xs);
        }
        .comment-avatar {
          width: 2rem;
          height: 2rem;
          border-radius: 50%;
          border: 1px solid rgba(0 0 0 / 0.1);
          background: color-mix(
            in oklch,
            var(--muted, var(--boxel-100)) 20%,
            transparent
          );
          color: var(--muted-foreground, var(--boxel-400));
          font-size: 0.6875rem;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          margin-top: 0.1rem;
          user-select: none;
        }
        .comment-content {
          display: grid;
          gap: var(--boxel-sp-6xs);
          min-width: 0;
        }
        .comment-header {
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          flex-wrap: wrap;
        }
        .comment-author {
          font-size: 0.8125rem;
          font-weight: 600;
        }
        .comment-date {
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-400));
        }
        .comment-body {
          font-size: 0.875rem;
          line-height: 1.6;
          color: var(--foreground, var(--boxel-dark));
        }
        .comment-body :deep(p:first-child) {
          margin-top: 0;
        }
        .comment-body :deep(p:last-child) {
          margin-bottom: 0;
        }
      </style>
    </template>
  };
}
