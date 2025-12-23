import { tracked } from '@glimmer/tracking';
import {
  contains,
  containsMany,
  field,
  Component,
  type BaseDefComponent,
} from './card-api';
import StringField from './string';
import TextAreaField from './text-area';
import StructuredTheme from './structured-theme';
import UrlField from './url';
import {
  ThemeVisualizer,
  ThemeDashboard,
  CssFieldEditor,
  ResetButton,
  SimpleNavBar,
} from './default-templates/theme-dashboard';

import { BoxelTag, GridContainer } from '@cardstack/boxel-ui/components';

class Isolated extends Component<typeof StyleReference> {
  @tracked private isDarkMode = false;

  private toggleDarkMode = () => {
    this.isDarkMode = !this.isDarkMode;
  };

  <template>
    <ThemeDashboard
      class='style-reference'
      style={{if this.isDarkMode @model.darkModeStyles}}
      @isDarkMode={{this.isDarkMode}}
    >
      <:header>
        <header class='style-header'>
          <h1><@fields.title /></h1>
          <p class='style-header-description'>
            <@fields.description />
          </p>
        </header>
      </:header>
      <:navBar>
        <SimpleNavBar @items={{@model.guideSections}} />
      </:navBar>
      <:default>
        <ThemeVisualizer
          class='style-ref-section'
          @toggleDarkMode={{this.toggleDarkMode}}
          @isDarkMode={{this.isDarkMode}}
        >
          <:colorPalette>
            <@fields.rootVariables />
          </:colorPalette>
          <:typography>
            <@fields.typography />
          </:typography>
        </ThemeVisualizer>

        <GridContainer class='style-ref-grid'>
          {{#if @model.visualDNA.length}}
            <section class='visual-dna'>
              <h2>Visual DNA</h2>
              <div class='visual-dna'>
                <@fields.visualDNA />
              </div>
            </section>
          {{/if}}

          {{#if @model.inspirations.length}}
            <section class='inspirations'>
              <h2>Inspirations</h2>
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
            </section>
          {{/if}}

          {{#if @model.wallpaperImages.length}}
            <section class='wallpapers'>
              <h2>Wallpaper Gallery</h2>
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
            </section>
          {{/if}}

          <section id='import-css'>
            <h2>Import Custom CSS</h2>
            <CssFieldEditor @setCss={{@model.setCss}} />
          </section>

          <section id='view-code'>
            <h2>Generated CSS Variables</h2>
            <@fields.cssVariables />
          </section>

          <section>
            <h2>Reset CSS</h2>
            <ResetButton @reset={{@model.resetCss}} />
          </section>
        </GridContainer>
      </:default>
    </ThemeDashboard>
    <style scoped>
      h1 {
        margin-bottom: var(--boxel-sp-lg);
      }
      h2 {
        margin-bottom: var(--boxel-sp-lg);
        border-bottom: 1px solid var(--dsr-border);
      }
      ul {
        list-style: none;
        margin-block: 0;
        padding-inline-start: 0;
      }
      section {
        scroll-margin-top: var(--boxel-sp-2xl);
      }
      .style-reference {
        max-width: 50rem;
        margin: 0 auto;
      }
      .style-header {
        padding-block: var(--boxel-sp-4xl);
        padding-inline: var(--boxel-sp-2xl);
        border-bottom: 1px solid var(--dsr-border);
        text-align: center;
        text-wrap: pretty;
      }
      .style-header-description {
        max-width: 37.5rem;
        margin: 0 auto;
        color: var(--muted-foreground);
      }
      .style-ref-grid {
        gap: var(--boxel-sp-4xl);
        padding-top: var(--boxel-sp-4xl);
        padding-inline: var(--boxel-sp-2xl);
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
