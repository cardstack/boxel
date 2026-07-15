// Pattern example: recursive FieldDef with lazy self-reference.
import {
  CardDef,
  Component,
  FieldDef,
  contains,
  containsMany,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import TextAreaField from 'https://cardstack.com/base/text-area';
import NumberField from 'https://cardstack.com/base/number';

export class CommentThread extends FieldDef {
  static displayName = 'Comment Thread';

  @field author = contains(StringField);
  @field body = contains(TextAreaField);
  @field depth = contains(NumberField);

  // The lazy arrow is the point of the pattern.
  @field replies = containsMany(() => CommentThread);

  static embedded = class Embedded extends Component<typeof this> {
    get shouldRenderReplies() {
      let depth = this.args.model.depth ?? 0;
      let count = this.args.model.replies?.length ?? 0;
      return count > 0 && depth < 6;
    }

    <template>
      <article class='comment'>
        <header>
          <strong>{{if @model.author @model.author 'Anonymous'}}</strong>
        </header>
        <p>{{@model.body}}</p>

        {{#if this.shouldRenderReplies}}
          <div class='replies'>
            <@fields.replies @format='embedded' />
          </div>
        {{/if}}
      </article>

      <style scoped>
        .comment {
          border-left: 2px solid var(--border, #d8dee7);
          padding-left: 0.75rem;
          margin-block: 0.5rem;
        }

        .comment p {
          margin: 0.35rem 0 0;
          line-height: 1.45;
        }

        .replies :deep(.containsMany-field) {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          margin-top: 0.5rem;
        }
      </style>
    </template>
  };
}

export class Discussion extends CardDef {
  static displayName = 'Discussion';
  static prefersWideFormat = true;

  @field title = contains(StringField);
  @field comments = containsMany(CommentThread);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Discussion) {
      return this.cardInfo?.name ?? this.title ?? 'Discussion';
    },
  });

  static isolated = class Isolated extends Component<typeof Discussion> {
    <template>
      <section class='discussion'>
        <h1>{{@model.cardTitle}}</h1>
        <@fields.comments @format='embedded' />
      </section>

      <style scoped>
        .discussion {
          background: var(--background, #fff);
          color: var(--foreground, #17202a);
          padding: 1.5rem;
        }
      </style>
    </template>
  };
}
