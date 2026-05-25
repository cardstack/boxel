import {
  FieldDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import MarkdownField from 'https://cardstack.com/base/markdown';
import StringField from 'https://cardstack.com/base/string';
import DateTimeField from 'https://cardstack.com/base/datetime';

export class Comment extends FieldDef {
  static displayName = 'Comment';
  @field body = contains(MarkdownField);
  @field author = contains(StringField);
  @field datetime = contains(DateTimeField);

  static embedded = class Embedded extends Component<typeof Comment> {
    <template>
      <div class='comment'>
        <div class='comment-header'>
          <span class='comment-author'>{{@model.author}}</span>
          {{#if @model.datetime}}
            <span class='comment-date'><@fields.datetime /></span>
          {{/if}}
        </div>
        <div class='comment-body'>
          <@fields.body />
        </div>
      </div>
      <style scoped>
        .comment {
          padding: 12px 0;
          border-bottom: 1px solid var(--boxel-200);
        }
        .comment:last-child {
          border-bottom: none;
        }
        .comment-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;
        }
        .comment-author {
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
        }
        .comment-date {
          color: var(--boxel-400);
          font-size: var(--boxel-font-size-xs);
        }
        .comment-body {
          font-size: var(--boxel-font-size-sm);
        }
      </style>
    </template>
  };
}
