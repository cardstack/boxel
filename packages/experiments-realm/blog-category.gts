import {
  contains,
  field,
  Component,
  CardDef,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { BlogApp as BlogAppCard } from './blog-app';
import { htmlSafe } from '@ember/template';

function htmlSafeColor(color?: string) {
  return htmlSafe(`background-color: ${color || ''}`);
}

export const categoryStyle = (category: Partial<BlogCategory>) => {
  if (!category) {
    return;
  }
  return htmlSafe(`
    background-color: ${category.backgroundColor || '#FFFFFF'};
    color: ${category.textColor || '#000000'};
  `);
};

let BlogCategoryTemplate = class Embedded extends Component<
  typeof BlogCategory
> {
  <template>
    <style scoped>
      .blog-category {
        height: 100%;
        padding: var(--boxel-sp);
      }
      .category-name {
        padding: var(--boxel-sp-xxs);
        color: white;
        border-radius: var(--boxel-border-radius-sm);
        font-weight: bold;
        display: inline-block;
      }
      .category-label {
        color: var(--boxel-400);
        margin-top: var(--boxel-sp-sm);
      }
      .category-full-name {
        font-size: var(--boxel-font-size);
        font-weight: bold;
      }
      .category-description {
        margin-top: var(--boxel-sp-sm);
        color: var(--boxel-400);
      }
    </style>
    <div class='blog-category'>
      {{! template-lint-disable no-inline-styles }}
      <div class='category-name' style={{categoryStyle @model}}>
        <@fields.shortName />
      </div>
      <div class='category-label'>
        Category
      </div>
      <div class='category-full-name'>
        <@fields.longName />
      </div>
      <div class='category-description'><@fields.description /></div>
    </div>
  </template>
};

export class BlogCategory extends CardDef {
  static displayName = 'Blog Category';

  @field longName = contains(StringField);
  @field shortName = contains(StringField);
  @field slug = contains(StringField);
  @field backgroundColor = contains(StringField);
  @field textColor = contains(StringField);
  @field description = contains(StringField);
  @field blog = linksTo(BlogAppCard, { isUsed: true });

  static embedded = BlogCategoryTemplate;
  static isolated = BlogCategoryTemplate;
  static atom = class Atom extends Component<typeof this> {
    <template>
      <style scoped>
        .circle {
          width: 0.7rem;
          height: 0.7rem;
          border-radius: 50%;
          display: inline-block;
          margin-right: var(--boxel-sp-xxs);
        }
        .category-atom {
          display: inline-flex;
          align-items: center;
        }
      </style>
      <div class='category-atom'>
        {{! template-lint-disable no-inline-styles }}
        <div class='circle' style={{htmlSafeColor @model.backgroundColor}} />
        <@fields.longName />
      </div>
    </template>
  };

  static fitted = class FittedTemplate extends Component<typeof BlogCategory> {
    <template>
      <style scoped>
        .blog-category {
          height: 100%;
          padding: var(--boxel-sp-xs);
        }
        .category-name {
          padding: var(--boxel-sp-xxs);
          color: white;
          border-radius: var(--boxel-border-radius-sm);
          font-weight: bold;
          display: inline-block;
        }
        .category-label {
          color: var(--boxel-400);
          margin-top: var(--boxel-sp-sm);
        }
        .category-full-name {
          font-size: var(--boxel-font-size);
          font-weight: bold;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .category-description {
          margin-top: var(--boxel-sp-sm);
          color: var(--boxel-400);
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 3;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        @container fitted-card ((aspect-ratio <= 0.92) and (height <= 182px)) {
          .category-description {
            display: none;
          }
        }
        @container fitted-card (height <= 30px) {
          .blog-category {
            padding: var(--boxel-sp-xxs);
          }
          .category-name {
            padding: 0 var(--boxel-sp-xxs);
            border-radius: var(--boxel-border-radius-xs);
          }
        }
        @container fitted-card ((height > 30px) and (height <= 60px)) {
          .blog-category {
            padding: var(--boxel-sp-xxs);
            display: flex;
          }
          .category-name {
            padding: 0 var(--boxel-sp-xxs);
            border-radius: var(--boxel-border-radius-xs);
            display: flex;
            align-items: center;
            height: 32px;
            margin: auto 0;
            margin-right: var(--boxel-sp-xs);
          }
          .category-full-name {
            margin: auto 0;
          }
          .category-label {
            display: none;
          }
          .category-description {
            display: none;
          }
        }
        @container fitted-card ((aspect-ratio > 4) and (height <= 60px)) {
          .category-label {
            display: none;
          }

          .category-description {
            display: none;
          }
        }
        @container fitted-card ( (height <= 120px)) {
          .category-label {
            display: none;
          }

          .category-full-name {
            display: none;
          }
        }
      </style>
      <div class='blog-category'>
        {{! template-lint-disable no-inline-styles }}
        <div class='category-name' style={{categoryStyle @model}}>
          <@fields.shortName />
        </div>
        <div class='category-label'>
          Category
        </div>
        <div class='category-full-name'>
          <@fields.longName />
        </div>
        <div class='category-description'><@fields.description /></div>
      </div>
    </template>
  };
}