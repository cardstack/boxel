import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import { gt } from '@cardstack/boxel-ui/helpers';
import { ImageDef } from 'https://cardstack.com/base/image-file-def';

/**
 * Playground card for demonstrating ImageDef capabilities.
 *
 * This card shows how ImageDef (and its subclasses):
 * - Automatically extracts image dimensions (width, height)
 * - Renders images in different formats (isolated, embedded, atom, fitted)
 * - Works with linksTo and linksToMany fields
 */
export class ImageDefPlayground extends CardDef {
  static displayName = 'Image Def Playground';

  @field title = contains(StringField);
  @field description = contains(StringField);

  // Single image link (accepts any ImageDef)
  @field featuredImage = linksTo(ImageDef);

  // Multiple image links
  @field gallery = linksToMany(ImageDef);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='image-def-playground'>
        <header>
          <h1>{{@model.title}}</h1>
          {{#if @model.description}}
            <p class='description'>{{@model.description}}</p>
          {{/if}}
        </header>

        <section class='featured'>
          <h2>Featured Image (Isolated Format)</h2>
          {{#if @model.featuredImage}}
            <div class='featured-image'>
              <@fields.featuredImage @format='isolated' />
            </div>
            <div class='dimensions-display'>
              <strong>Dimensions:</strong>
              {{@model.featuredImage.width}}
              ×
              {{@model.featuredImage.height}}px
            </div>
          {{else}}
            <p class='empty-state'>No featured image linked</p>
          {{/if}}
        </section>

        <section class='formats'>
          <h2>Format Comparison</h2>
          {{#if @model.featuredImage}}
            <div class='format-grid'>
              <div class='format-item'>
                <h3>Embedded</h3>
                <div class='format-preview'>
                  <@fields.featuredImage @format='embedded' />
                </div>
              </div>

              <div class='format-item'>
                <h3>Atom</h3>
                <div class='format-preview atom-preview'>
                  <@fields.featuredImage @format='atom' />
                </div>
              </div>

              <div class='format-item'>
                <h3>Fitted</h3>
                <div class='format-preview fitted-preview'>
                  <@fields.featuredImage @format='fitted' />
                </div>
              </div>
            </div>
          {{else}}
            <p class='empty-state'>Link a featured image to see format
              comparison</p>
          {{/if}}
        </section>

        <section class='gallery-section'>
          <h2>Gallery ({{@model.gallery.length}} images)</h2>
          {{#if (gt @model.gallery.length 0)}}
            <div class='gallery-grid'>
              {{#each @model.gallery as |image|}}
                <div class='gallery-item'>
                  <img src={{image.url}} alt={{image.name}} />
                  <div class='gallery-item-info'>
                    <span class='name'>{{image.name}}</span>
                    <span class='dims'>{{image.width}} × {{image.height}}</span>
                  </div>
                </div>
              {{/each}}
            </div>
          {{else}}
            <p class='empty-state'>No gallery images linked</p>
          {{/if}}
        </section>
      </article>

      <style scoped>
        .image-def-playground {
          padding: var(--boxel-sp-lg);
          font-family: var(--boxel-font-family);
          max-width: 800px;
        }

        header {
          margin-bottom: var(--boxel-sp-xl);
        }

        h1 {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: var(--boxel-font-xl);
          color: var(--boxel-dark);
        }

        h2 {
          font-size: var(--boxel-font-lg);
          margin: 0 0 var(--boxel-sp);
          color: var(--boxel-dark);
          border-bottom: 1px solid var(--boxel-200);
          padding-bottom: var(--boxel-sp-xs);
        }

        h3 {
          font-size: var(--boxel-font-sm);
          margin: 0 0 var(--boxel-sp-xs);
          color: var(--boxel-500);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .description {
          margin: 0;
          color: var(--boxel-500);
          font-size: var(--boxel-font-med);
        }

        section {
          margin-bottom: var(--boxel-sp-xl);
        }

        .featured-image {
          background: var(--boxel-100);
          padding: var(--boxel-sp);
          border-radius: var(--boxel-radius);
          margin-bottom: var(--boxel-sp);
        }

        .dimensions-display {
          font-size: var(--boxel-font-sm);
          color: var(--boxel-600);
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          background: var(--boxel-highlight-hover);
          border-radius: var(--boxel-radius-sm);
          display: inline-block;
        }

        .format-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: var(--boxel-sp);
        }

        .format-item {
          background: var(--boxel-100);
          padding: var(--boxel-sp);
          border-radius: var(--boxel-radius);
        }

        .format-preview {
          background: white;
          border: 1px solid var(--boxel-200);
          border-radius: var(--boxel-radius-sm);
          overflow: hidden;
        }

        .atom-preview {
          padding: var(--boxel-sp-sm);
        }

        .fitted-preview {
          height: 150px;
        }

        .gallery-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: var(--boxel-sp);
        }

        .gallery-item {
          background: var(--boxel-100);
          border-radius: var(--boxel-radius);
          overflow: hidden;
        }

        .gallery-item img {
          width: 100%;
          height: 150px;
          object-fit: cover;
          display: block;
        }

        .gallery-item-info {
          padding: var(--boxel-sp-sm);
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .gallery-item-info .name {
          font-size: var(--boxel-font-sm);
          font-weight: 500;
          color: var(--boxel-dark);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .gallery-item-info .dims {
          font-size: var(--boxel-font-xs);
          color: var(--boxel-500);
        }

        .empty-state {
          color: var(--boxel-400);
          font-style: italic;
          margin: 0;
          padding: var(--boxel-sp);
          background: var(--boxel-100);
          border-radius: var(--boxel-radius-sm);
          text-align: center;
        }
      </style>
    </template>
  };
}
