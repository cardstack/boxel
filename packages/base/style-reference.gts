import { contains, containsMany, field, Component } from './card-api';
import StringField from './string';
import TextAreaField from './text-area';
import StructuredTheme from './structured-theme';
import UrlField from './url';
import { type BaseDefComponent } from './card-api';

import { BoxelTag } from '@cardstack/boxel-ui/components';

class Isolated extends Component<typeof StyleReference> {
  <template>
    <article class='style-reference'>
      <header class='style-header'>
        <h1><@fields.title /></h1>
        <p class='visual-dna'><@fields.description /></p>
      </header>
      <section class='inspirations'>
        <h2>Inspirations</h2>
        {{#if @model.inspirations.length}}
          <ul class='inspiration-list'>
            {{#each @model.inspirations as |inspiration|}}
              <BoxelTag
                class='inspiration-tag'
                @ellipsize={{true}}
                @htmlTag='li'
                @name={{inspiration}}
              />
            {{/each}}
          </ul>
        {{else}}
          N/A
        {{/if}}
      </section>
      <section class='wallpapers'>
        <h2>Wallpaper Images</h2>
        {{#if @model.wallpaperImages.length}}
          <div class='image-grid'>
            {{#each @model.wallpaperImages as |imageUrl|}}
              <div class='image-container'>
                <img
                  src='{{imageUrl}}'
                  alt='Style reference wallpaper'
                  class='wallpaper-image'
                />
              </div>
            {{/each}}
          </div>
        {{else}}
          N/A
        {{/if}}
      </section>
    </article>

    <style scoped>
      h1 {
        margin-top: 0;
        margin-bottom: var(--boxel-sp-lg);
        font-size: var(--typescale-h1, var(--boxel-font-size-xl));
        font-weight: 600;
      }
      h2 {
        margin-top: 0;
        margin-bottom: var(--boxel-sp);
        font-size: var(--boxel-font-size-md);
        font-weight: 500;
      }
      ul {
        list-style: none;
        margin-block: 0;
        padding-inline-start: 0;
      }
      .style-reference {
        height: 100%;
        max-width: 800px;
        margin: 0 auto;
        padding: var(--boxel-sp-xl);
        font-family: var(--font-sans);
        letter-spacing: var(--tracking-normal);
        line-height: var(--lineheight-base);
        background-color: var(--background);
        color: var(--foreground);
      }
      .style-reference > * + * {
        margin-top: var(--boxel-sp-xxxl);
      }
      .style-header {
        text-align: center;
      }
      .visual-dna {
        font-size: var(--boxel-font-size-md);
        color: var(--muted-foreground);
        max-width: 600px;
        margin: 0 auto;
      }
      .inspiration-list {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
      }
      .inspiration-tag {
        padding-inline: var(--boxel-sp-sm);
        background-color: var(--muted);
        border-radius: var(--radius);
        color: var(--muted-foreground);
        border: 1px solid var(--muted);
        font-size: var(--boxel-font-size);
        font-family: inherit;
      }
      .image-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: var(--boxel-sp-xl);
      }
      .image-container {
        aspect-ratio: 16/9;
        border-radius: var(--radius, var(--boxel-border-radius-sm));
        overflow: hidden;
        box-shadow: var(--shadow, 0 4px 6px -1px rgba(0, 0, 0, 0.1));
      }
      .wallpaper-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform 0.3s ease;
      }
      .wallpaper-image:hover {
        transform: scale(1.05);
      }
    </style>
  </template>
}

export default class StyleReference extends StructuredTheme {
  static displayName = 'Style Reference';

  @field styleName = contains(StringField);
  @field inspirations = containsMany(StringField);
  @field visualDNA = contains(TextAreaField);
  @field wallpaperImages = containsMany(UrlField);

  @field themeName = contains(StringField, {
    computeVia: function (this: StyleReference) {
      return this.title;
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: StyleReference) {
      return this.cardInfo?.title ?? this.styleName ?? 'Untitled Style';
    },
  });

  @field description = contains(StringField, {
    computeVia: function (this: StyleReference) {
      return this.cardInfo?.description ?? this.visualDNA;
    },
  });

  @field thumbnailURL = contains(StringField, {
    computeVia: function (this: StyleReference) {
      return this.cardInfo?.thumbnailURL ?? this.wallpaperImages?.[0];
    },
  });

  static isolated: BaseDefComponent = Isolated;
}
