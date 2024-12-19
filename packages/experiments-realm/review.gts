import {
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import { setBackgroundImage } from './components/layout';
import { formatDatetime } from './blog-app';
import { BlogPost } from './blog-post';
import { RatingsSummary } from './ratings-summary';

// @ts-expect-error using own template
export class Review extends BlogPost {
  static displayName = 'Review';
  @field rating = contains(RatingsSummary);
  @field userRating = contains(RatingsSummary);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <article class='embedded-review'>
        <div
          class='thumbnail'
          style={{setBackgroundImage @model.thumbnailURL}}
        />
        <div class='content'>
          <div class='meta'>
            {{! TODO: replace with category field }}
            <span class='category'>Movie Review</span>
            {{#if @model.rating}}
              <@fields.rating class='rating-info' @format='atom' />
            {{/if}}
          </div>
          <h3 class='title'><@fields.title /></h3>
          <p class='description'>{{@model.description}}</p>
          <div class='info'>
            {{#if @model.formattedAuthors}}
              <div class='byline'>{{@model.formattedAuthors}}</div>
            {{/if}}
            {{#if @model.datePublishedIsoTimestamp}}
              <time class='date' timestamp={{@model.datePublishedIsoTimestamp}}>
                {{@model.formattedDatePublished}}
              </time>
            {{/if}}
          </div>
        </div>
      </article>
      <style scoped>
        .embedded-review {
          width: 100%;
          height: 100%;
          display: grid;
          grid-template: 'img content' 1fr / minmax(120px, 40%) 1fr;
          gap: var(--boxel-sp-xs);
          overflow: hidden;
          text-wrap: pretty;
        }
        .thumbnail {
          grid-area: img;
          background-color: var(--boxel-200);
          background-position: center;
          background-repeat: no-repeat;
          background-size: cover;
        }
        .content {
          grid-area: content;
          display: grid;
          grid-template-rows: repeat(3, max-content) 1fr;
          gap: var(--boxel-sp-xs);
          max-width: 100%;
          padding: var(--boxel-sp-xs);
          overflow: hidden;
        }
        .meta {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp-xxxs);
          overflow: hidden;
        }
        .category {
          background-color: var(--boxel-yellow);
          padding: 0 var(--boxel-sp-4xs);
          border-radius: 3px;
          font: 500 var(--boxel-font-xs);
          letter-spacing: var(--boxel-lsp-sm);
        }
        .title {
          margin: 0;
          font: 700 var(--boxel-font-sm);
          letter-spacing: var(--boxel-lsp-xs);
        }
        .description {
          overflow: hidden;
          margin: 0;
          font: var(--boxel-font-xs);
          letter-spacing: var(--boxel-lsp-xs);
        }
        .info {
          align-self: end;
        }
        .byline,
        .date {
          text-wrap: nowrap;
          text-overflow: ellipsis;
          overflow: hidden;
          font: 500 var(--boxel-font-xs);
          letter-spacing: var(--boxel-lsp-sm);
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article>
        {{#if @model.blog}}
          <@fields.blog
            class='blog'
            @format='fitted'
            @displayContainer={{false}}
          />
        {{/if}}
        <@fields.featuredImage class='featured-image' />
        <div class='content'>
          <div class='rating-group'>
            {{! TODO: replace with category field }}
            <span class='category'>Movie Review</span>
            <@fields.rating class='rating' />
          </div>
          <h1><@fields.title /></h1>
          {{#if @model.description}}
            <p class='description'>
              <@fields.description />
            </p>
          {{/if}}
          <ul class='info'>
            {{#if @model.formattedAuthors}}
              <li class='byline'>
                {{@model.formattedAuthors}}
              </li>
            {{/if}}
            {{#if @model.datePublishedIsoTimestamp}}
              <li class='pub-date'>
                Published on
                <time timestamp={{@model.datePublishedIsoTimestamp}}>
                  {{this.formattedDatePublished}}
                </time>
              </li>
            {{/if}}
          </ul>
          <hr />
          <@fields.body />
          <div class='rate'>
            Rate this movie
            <@fields.userRating class='user-rating' />
          </div>
          <hr />
          {{#if @model.authors}}
            <@fields.authors @format='embedded' />
          {{/if}}
        </div>
      </article>
      <style scoped>
        @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400..700;1,400..700&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap');
        article {
          --markdown-font-size: 1rem;
          --markdown-font-family: var(--blog-post-font-family, 'Lora', serif);
          --markdown-heading-font-family: var(
            --blog-post-heading-font-family,
            'Playfair Display',
            serif
          );
          --banner-height: 70px;
          position: relative;
          height: max-content;
          min-height: 100%;
          background-color: #fcf9f2;
          font-family: var(--blog-post-font-family, 'Lora', serif);
        }
        .blog.fitted-format {
          position: absolute;
          top: 0;
          min-height: var(--banner-height);
          background-color: rgba(0 0 0 / 70%);
          color: var(--boxel-light);
          border-radius: 0;
        }
        .blog :deep(.fitted-blog) {
          display: grid;
          grid-template-columns: max-content 1fr;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp) var(--boxel-sp-lg);
        }
        .featured-image {
          min-height: var(--banner-height);
        }
        .content {
          width: 80%;
          margin: auto;
          padding: var(--boxel-sp-xl) var(--boxel-sp-lg);
        }
        .content > * + * {
          margin-top: var(--boxel-sp-xl);
        }
        .rating-group {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp-sm);
        }
        .category {
          background-color: var(--boxel-yellow);
          padding: 0 var(--boxel-sp-xs);
          border-radius: 5px;
          font: 500 var(--boxel-font-sm);
          letter-spacing: var(--boxel-lsp-xs);
        }
        .rating {
          display: inline-block;
          background-color: var(--boxel-dark);
          border-radius: 5px;
          color: var(--boxel-yellow);
          padding: var(--boxel-sp-6xs) var(--boxel-sp-xs);
          height: 20px;
          font: 600 var(--boxel-font-sm);
          letter-spacing: var(--boxel-font-xs);
        }
        h1,
        h2,
        h3,
        h4,
        h5,
        h6 {
          font-family: var(
            --blog-post-heading-font-family,
            'Playfair Display',
            serif
          );
        }
        h1 {
          font-size: 2.5rem;
          font-weight: 600;
          line-height: 1.25;
          letter-spacing: normal;
        }
        .description {
          font-size: 1.25rem;
          font-style: italic;
        }
        .info {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          flex-wrap: wrap;
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .info > li + li {
          border-left: 1px solid black;
          padding-left: var(--boxel-sp-xs);
        }
        .byline {
          display: inline-flex;
          align-items: center;
          gap: 0 var(--boxel-sp-xxxs);
          font-weight: 600;
        }
        .author {
          display: contents; /* workaround for removing block-levelness of atom format */
        }
        .rate {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          font-size: var(--boxel-font-size-small);
          font-weight: 600;
        }
        .user-rating {
          display: contents;
        }
        .user-rating :deep(.rating) {
          display: none;
        }
      </style>
    </template>

    private get formattedDatePublished() {
      if (
        this.args.model.status === 'Published' &&
        this.args.model.publishDate
      ) {
        return formatDatetime(this.args.model.publishDate, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
      }
      return undefined;
    }
  };
}
