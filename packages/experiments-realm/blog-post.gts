import DatetimeField from 'https://cardstack.com/base/datetime';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import {
  CardDef,
  field,
  contains,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import { formatDatetime, toISOString } from './blog-app';
import { Author } from './author';
import { htmlSafe } from '@ember/template';
import CalendarCog from '@cardstack/boxel-icons/calendar-cog';
import FileStack from '@cardstack/boxel-icons/file-stack';

class FittedTemplate extends Component<typeof BlogPost> {
  private get authorName() {
    let author = this.args.model.authorBio;
    if (author?.firstName || author?.lastName) {
      let fullName = `${this.args.model.authorBio?.firstName} ${this.args.model.authorBio?.lastName}`;
      return fullName.trim();
    }
    return undefined;
  }

  private get pubDate() {
    if (this.args.model.status === 'Published' && this.args.model.publishDate) {
      return formatDatetime(this.args.model.publishDate, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    }
    return undefined;
  }

  private backgroundURL(backgroundURL: string | null | undefined) {
    if (!backgroundURL) {
      return;
    }
    return htmlSafe(`background-image: url(${backgroundURL});`);
  }

  <template>
    <article class='fitted-blog-post'>
      <div class='thumbnail' style={{this.backgroundURL @model.thumbnailURL}} />
      <h3 class='title'>{{if @model.title @model.title 'Untitled Post'}}</h3>
      <p class='description'>{{@model.description}}</p>
      <div class='byline'>{{this.authorName}}</div>
      {{#if this.pubDate}}
        {{#if @model.publishDate}}
          <time class='date' timestamp={{toISOString @model.publishDate}}>
            {{this.pubDate}}
          </time>
        {{/if}}
      {{/if}}
    </article>
    <style scoped>
      .fitted-blog-post {
        width: 100%;
        height: 100%;
        display: grid;
        overflow: hidden;
      }
      .thumbnail {
        grid-area: img;
        background-color: var(--boxel-200);
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;
      }
      .title {
        grid-area: title;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        overflow: hidden;
        margin: 0;
        font: 700 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-sm);
      }
      .description {
        grid-area: desc;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 4;
        overflow: hidden;
        margin: 0;
        font: var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
      }
      .byline {
        grid-area: byline;
        align-self: end;
        text-wrap: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }
      .date {
        grid-area: date;
        align-self: end;
        text-wrap: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }
      .byline,
      .date {
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
      }

      @container fitted-card ((450px < width) and (height > 224px)) {
        .fitted-blog-post {
          grid-template:
            'img title title' max-content
            'img desc desc' max-content
            'img byline date' 1fr / 40% 1fr 1fr;
          gap: var(--boxel-sp-xs);
          padding-right: var(--boxel-sp-xl);
        }
        .thumbnail {
          margin-right: var(--boxel-sp-lg);
        }
        .title {
          margin-top: var(--boxel-sp-lg);
          font: 700 var(--boxel-font-lg);
          line-height: 1.4;
          letter-spacing: var(--boxel-lsp-xs);
        }
        .description {
          font: var(--boxel-font);
          letter-spacing: var(--boxel-lsp-xs);
        }
        .byline,
        .date {
          margin-bottom: var(--boxel-sp-lg);
          font: 500 var(--boxel-font-sm);
          letter-spacing: var(--boxel-lsp-xs);
        }
        .date {
          justify-self: end;
        }
      }

      @container fitted-card ((349px < width <= 450px) and (height > 224px)) {
        .fitted-blog-post {
          grid-template:
            'img title title' max-content
            'img desc desc' max-content
            'img byline date' 1fr / 45% 1fr;
          gap: var(--boxel-sp-4xs) var(--boxel-sp-xs);
          padding-right: var(--boxel-sp-xs);
        }
        .title {
          margin-top: var(--boxel-sp-xs);
          font: 700 var(--boxel-font);
        }
        .description {
          font: var(--boxel-font-sm);
        }
        .byline,
        .date {
          margin-bottom: var(--boxel-sp-xs);
        }
        .date {
          justify-self: end;
        }
      }

      @container fitted-card ((185px < width <= 349px) and (height > 224px) ) {
        .fitted-blog-post {
          grid-template:
            'img img' 100px
            'title title' max-content
            'desc desc' max-content
            'byline date' 1fr / 1fr;
          gap: var(--boxel-sp-xxxs);
        }
        .fitted-blog-post > *:not(.thumbnail) {
          padding: 0 var(--boxel-sp-xs);
        }
        .title {
          font: 700 var(--boxel-font);
        }
        .description {
          -webkit-line-clamp: 3;
          font: var(--boxel-font-sm);
        }
        .byline,
        .date {
          margin-bottom: var(--boxel-sp-xs);
        }
        .date {
          justify-self: end;
        }
      }

      @container fitted-card ((width <= 185px) and (height > 224px) ) {
        .fitted-blog-post {
          grid-template:
            'img' 92px
            'title' max-content
            'desc' max-content
            'byline' 1fr
            'date' max-content / 1fr;
          gap: var(--boxel-sp-xxxs);
        }
        .fitted-blog-post > *:not(.thumbnail) {
          padding: 0 var(--boxel-sp-xs);
        }
        .description {
          -webkit-line-clamp: 3;
        }
        .byline {
          align-self: start;
          text-wrap: pretty;
        }
        .date {
          margin-bottom: var(--boxel-sp-xs);
        }
      }

      /* Selected view: Strip */
      @container fitted-card ((width = 300px) and (height = 115px) ) {
        .fitted-blog-post {
          grid-template:
            'img title' max-content
            'img byline' 1fr
            'img date' max-content / 78px 1fr;
          gap: var(--boxel-sp-xxxs);
        }
        .fitted-blog-post > *:not(.thumbnail) {
          padding: 0 var(--boxel-sp-xs);
        }
        .title {
          margin-top: var(--boxel-sp-xs);
        }
        .description {
          display: none;
        }
        .byline {
          align-self: start;
        }
        .date {
          margin-bottom: var(--boxel-sp-xs);
        }
      }

      /* Selected view: Grid */
      @container fitted-card ((width = 164px) and (height = 224px)) {
        .fitted-blog-post {
          grid-template:
            'img' 92px
            'title' max-content
            'byline' 1fr
            'date' max-content / 1fr;
          gap: var(--boxel-sp-xxxs);
        }
        .fitted-blog-post > *:not(.thumbnail) {
          padding: 0 var(--boxel-sp-xs);
        }
        .description {
          display: none;
        }
        .byline {
          align-self: start;
        }
        .date {
          margin-bottom: var(--boxel-sp-xs);
        }
      }
    </style>
  </template>
}

class Status extends StringField {
  static displayName = 'Status';
  static icon = CalendarCog;
}

export class BlogPost extends CardDef {
  static displayName = 'Blog Post';
  static icon = FileStack;
  @field title = contains(StringField);
  @field slug = contains(StringField);
  @field body = contains(MarkdownField);
  @field authorBio = linksTo(Author);
  @field publishDate = contains(DatetimeField);
  @field status = contains(Status, {
    computeVia: function (this: BlogPost) {
      if (!this.publishDate) {
        return 'Draft';
      }
      if (Date.now() >= Date.parse(String(this.publishDate))) {
        return 'Published';
      }
      return 'Scheduled';
    },
  });
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.title /> by <@fields.authorBio />
    </template>
  };
  static fitted = FittedTemplate;
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article>
        <header>
          <h1><@fields.title /></h1>
          <p class='description'><@fields.description /></p>
          <@fields.authorBio class='byline' />
        </header>
        <@fields.body />
      </article>
      <style scoped>
        article {
          padding: var(--boxel-sp) var(--boxel-sp-xl);
        }
        h1 {
          margin-top: 0;
          font: 600 var(--boxel-font-xl);
        }
        img {
          max-width: 100%;
        }
        .description {
          font: var(--boxel-font);
        }
        .byline {
          max-width: 300px;
        }
      </style>
    </template>
  };
}
