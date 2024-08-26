import StringCard from 'https://cardstack.com/base/string';
import MarkdownCard from 'https://cardstack.com/base/markdown';
import {
  CardDef,
  field,
  contains,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import { Author } from './author';

class FittedTemplate extends Component<typeof BlogPost> {
  <template>
    <div class='fitted-template'>
      {{#if @model}}
        <div class='header'>
          <h3 class='title' data-test-blog-post-title>{{@model.title}}</h3>
          <span class='author' data-test-blog-post-title>By
            {{@model.authorBio.firstName}}
            {{@model.authorBio.lastName}}</span>
        </div>
        <div class='content'>
          <p class='body' data-test-blog-post-body>{{@model.body}}</p>
        </div>
      {{else}}
        {{! empty links-to field }}
        <div data-test-empty-field class='empty-field'></div>
      {{/if}}
    </div>
    <style>
      .fitted-template {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 10px;
      }
      .header {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--boxel-sp-xs);
        width: 100%;
      }
      .header > * {
        overflow: hidden;
        text-overflow: ellipsis;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        text-align: center;
        margin: 0;
        width: 100%;
      }
      .author {
        font: 500 var(--boxel-font-xs);
        color: var(--boxel-450);
        line-height: 1.27;
        letter-spacing: 0.11px;
        white-space: nowrap;
      }
      .content {
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 6;
        width: 100%;
      }

      /* Aspect Ratio <= 1.0 */
      @container fitted-card (aspect-ratio <= 1.0) and ((width < 180px) and (height < 200px)) {
        .content {
          -webkit-line-clamp: 4;
        }
      }
      @container fitted-card (aspect-ratio <= 1.0) and ((width < 150px) and (height < 150px)) {
        .title {
          font: 700 var(--boxel-font-xs);
          line-height: 1.27;
          letter-spacing: 0.11px;
        }
        .author {
          font: 700 var(--boxel-font-xs);
          margin: 0;
        }
        .content {
          -webkit-line-clamp: 3;
        }
        .body {
          font: 500 var(--boxel-font-xs);
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and ((width < 120px) and (height < 120px)) {
        .fitted-template {
          justify-content: center;
        }
        .content {
          display: none;
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and ((width < 120px) and (height > 200px)) {
        .content {
          -webkit-line-clamp: 8;
        }
      }
      /* 1.0 < Aspect Ratio <= 2.0 */
      @container fitted-card (1.0 < aspect-ratio <= 2.0) and (width > 200px) and (height >= 180px) {
        .content {
          -webkit-line-clamp: 3;
        }
      }
      @container fitted-card (1.0 < aspect-ratio <= 2.0) and (width < 200px) {
        .title {
          font: 700 var(--boxel-font-xs);
          line-height: 1.27;
          letter-spacing: 0.11px;
        }
        .author {
          font: 700 var(--boxel-font-xs);
          margin: 0;
        }
        .content {
          display: none;
        }
      }

      /* Aspect Ratio < 2.0 */
      @container fitted-card (2.0 < aspect-ratio) {
        .fitted-template {
          justify-content: center;
          padding: 0 5px;
        }
        .header {
          height: 100%;
          justify-content: center;
        }
        .content {
          display: none;
        }
      }
      @container fitted-card (2.0 < aspect-ratio) and (height <= 58px) {
        .title {
          font: 700 var(--boxel-font-xs);
          line-height: 1.27;
          letter-spacing: 0.11px;
        }
        .author {
          font: 700 var(--boxel-font-xs);
        }
      }
      @container fitted-card (2.0 < aspect-ratio) and (height <= 30px) {
        .author {
          display: none;
        }
      }
    </style>
  </template>
}

export class BlogPost extends CardDef {
  static displayName = 'Blog Post';
  @field title = contains(StringCard);
  @field slug = contains(StringCard);
  @field body = contains(MarkdownCard);
  @field authorBio = linksTo(Author);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.title /> by <@fields.authorBio />
    </template>
  };
  static fitted = FittedTemplate;
}
