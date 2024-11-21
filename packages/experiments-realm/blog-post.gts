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

const setBackgroundImage = (backgroundURL: string | null | undefined) => {
  if (!backgroundURL) {
    return;
  }
  return htmlSafe(`background-image: url(${backgroundURL});`);
};

class EmbeddedTemplate extends Component<typeof BlogPost> {
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

  <template>
    <article class='embedded-blog-post'>
      <div class='thumbnail' style={{setBackgroundImage @model.thumbnailURL}} />
      <h3 class='title'>{{if @model.title @model.title 'Untitled Post'}}</h3>
      <p class='description'>{{@model.description}}</p>
      <@fields.authorBio
        class='byline'
        @format='atom'
        @displayContainer={{false}}
      />
      {{#if this.pubDate}}
        {{#if @model.publishDate}}
          <time class='date' timestamp={{toISOString @model.publishDate}}>
            {{this.pubDate}}
          </time>
        {{/if}}
      {{/if}}
    </article>
    <style scoped>
      .embedded-blog-post {
        width: 100%;
        height: 100%;
        display: grid;
        grid-template:
          'img title title' max-content
          'img desc desc' max-content
          'img byline date' 1fr / 40% 1fr 1fr;
        gap: var(--boxel-sp-xs);
        padding-right: var(--boxel-sp-xl);
        overflow: hidden;
      }
      .thumbnail {
        grid-area: img;
        background-color: var(--boxel-200);
        background-position: center;
        background-size: cover;
        background-repeat: no-repeat;
        margin-right: var(--boxel-sp-lg);
      }
      .title {
        grid-area: title;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        overflow: hidden;
        margin: var(--boxel-sp-lg) 0 0;
        font: 700 var(--boxel-font-lg);
        line-height: 1.4;
        letter-spacing: var(--boxel-lsp-xs);
      }
      .description {
        grid-area: desc;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 4;
        overflow: hidden;
        margin: 0;
        font: var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .byline {
        grid-area: byline;
        align-self: end;
        width: auto;
        height: auto;
        text-wrap: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }
      .date {
        grid-area: date;
        align-self: end;
        justify-self: end;
        text-wrap: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }
      .byline,
      .date {
        margin-bottom: var(--boxel-sp-lg);
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
    </style>
  </template>
}

class FittedTemplate extends Component<typeof BlogPost> {
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

  <template>
    <article class='fitted-blog-post'>
      <div class='thumbnail' style={{setBackgroundImage @model.thumbnailURL}} />
      <div class='content'>
        <h3 class='title'>{{if @model.title @model.title 'Untitled Post'}}</h3>
        <p class='description'>{{@model.description}}</p>
        <span class='byline'>{{@model.authorBio.title}}</span>
        {{#if this.pubDate}}
          {{#if @model.publishDate}}
            <time class='date' timestamp={{toISOString @model.publishDate}}>
              {{this.pubDate}}
            </time>
          {{/if}}
        {{/if}}
      </div>
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
      .content {
        grid-area: content;
        gap: var(--boxel-sp-xxxs);
        padding: var(--boxel-sp-xs);
      }
      .title {
        grid-area: title;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
        margin: 0;

        font: 700 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-sm);
        line-height: 1.3;
      }
      .description {
        grid-area: desc;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        overflow: hidden;
        margin: 0;
        font: var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
      }
      .byline {
        grid-area: byline;
        display: inline-block;
        text-wrap: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }
      .date {
        grid-area: date;
        text-wrap: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }
      .byline,
      .date {
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
      }

      @container fitted-card (aspect-ratio = 1.0) {
        .fitted-blog-post {
          grid-template:
            'img' 42%
            'content' 1fr / 1fr;
        }
        .content {
          display: grid;
          grid-template:
            'title title' max-content
            'desc desc' max-content
            'byline date' 1fr / auto auto;
        }
        .byline,
        .date {
          align-self: end;
        }
        .date {
          justify-self: end;
        }
      }

      @container fitted-card (aspect-ratio < 1.0) and (224px <= height < 226px) {
        .fitted-blog-post {
          grid-template:
            'img' 92px
            'content' 1fr / 1fr;
        }
        .content {
          display: grid;
          grid-template:
            'title' max-content
            'byline' max-content
            'date' 1fr / 1fr;
        }
        .description {
          display: none;
        }
        .date {
          align-self: end;
        }
      }

      @container fitted-card (aspect-ratio < 1.0) and (180px <= height < 224px) {
        .fitted-blog-post {
          grid-template:
            'img' 92px
            'content' 1fr / 1fr;
        }
        .content {
          display: grid;
          grid-template:
            'title' max-content
            'date' 1fr / 1fr;
        }
        .title {
          -webkit-line-clamp: 3;
        }
        .description,
        .byline {
          display: none;
        }
        .date {
          align-self: end;
        }
      }

      @container fitted-card ((aspect-ratio < 1.0) and (height < 180px) ) {
        .title {
          font: 700 var(--boxel-font-xs);
          line-height: 1.27;
        }
      }

      @container fitted-card (aspect-ratio < 1.0) and (148px <= height < 180px) {
        .fitted-blog-post {
          grid-template:
            'img' 80px
            'content' 1fr / 1fr;
        }
        .content {
          display: grid;
          grid-template:
            'title' max-content
            'date' 1fr / 1fr;
        }
        .title {
          -webkit-line-clamp: 2;
        }
        .description,
        .byline {
          display: none;
        }
        .date {
          align-self: end;
        }
      }

      @container fitted-card (aspect-ratio < 1.0) and (128px <= height < 148px) {
        .fitted-blog-post {
          grid-template:
            'img' 68px
            'content' 1fr / 1fr;
        }
        .content {
          display: block;
        }
        .title {
          -webkit-line-clamp: 3;
        }
        .description,
        .byline,
        .date {
          display: none;
        }
      }

      @container fitted-card (aspect-ratio < 1.0) and (118px <= height < 128px) {
        .fitted-blog-post {
          grid-template:
            'img' 57px
            'content' 1fr / 1fr;
        }
        .title {
          -webkit-line-clamp: 3;
        }
        .description,
        .byline,
        .date {
          display: none;
        }
      }

      @container fitted-card (aspect-ratio < 1.0) and (400px <= height) {
        .fitted-blog-post {
          grid-template:
            'img' 56%
            'content' 1fr / 1fr;
        }
        .content {
          display: grid;
          grid-template:
            'title' max-content
            'byline' max-content
            'desc' max-content
            'date' 1fr / 1fr;
        }
        .title {
          font: 700 var(--boxel-font-xs);
          line-height: 1.27;
        }
        .description {
          -webkit-line-clamp: 5;
          margin-top: var(--boxel-sp-xxxs);
        }
        .date {
          align-self: end;
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
  static embedded = EmbeddedTemplate;
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
