// Pattern example: recursive FieldDef with lazy self-reference.
import {
  CardDef,
  Component,
  FieldDef,
  contains,
  containsMany,
  field,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import TextAreaField from '@cardstack/base/text-area';
import NumberField from '@cardstack/base/number';

export class CommentThread extends FieldDef {
  static displayName = 'Comment Thread';

  @field authorName = contains(StringField);
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
          <strong>{{if @model.authorName.length @model.authorName 'Anonymous'}}</strong>
        </header>
        <p>{{@model.body}}</p>

        {{#if this.shouldRenderReplies}}
          <@fields.replies @format='embedded' class='replies' />
        {{/if}}
      </article>

      <style scoped>
        .comment {
          border-left: 2px solid var(--border);
          padding-left: 0.75rem;
          margin-block: 0.5rem;
        }

        .comment p {
          margin: 0.35rem 0 0;
          line-height: 1.45;
        }

        /* Lands on the plural wrapper via ...attributes; the host already
           lays it out as a grid, so only gap and offset need setting. */
        .replies {
          gap: 0;
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
        <h1><@fields.cardTitle /></h1>
        <@fields.comments @format='embedded' />
      </section>

      <style scoped>
        .discussion {
          padding: 1.5rem;
        }
      </style>
    </template>
  };
}
