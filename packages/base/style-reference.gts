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
  ThemeDashboardEmptyState,
  ThemeDashboardHeader,
  ThemeImporter,
  CardContainerCss,
  ResetButton,
} from './default-templates/theme-dashboard';

import {
  BoxelTag,
  FieldContainer,
  GridContainer,
} from '@cardstack/boxel-ui/components';

class Isolated extends Component<typeof StyleReference> {
  // Edit extends this template with the field editors swapped in
  protected editMode = false;

  @tracked private isDarkMode = false;

  private toggleDarkMode = () => {
    this.isDarkMode = !this.isDarkMode;
  };

  private get hasThemeCss() {
    return Boolean(this.args.model?.cssVariables);
  }

  // A theme-less isolated view shows the dashboard empty state instead of
  // any sections; every field stays reachable in edit mode.
  private get showEmptyState() {
    return !this.editMode && !this.hasThemeCss;
  }

  private contentSections = [
    { id: 'visual-dna', navTitle: 'Visual DNA', title: 'Visual DNA' },
    { id: 'inspirations', navTitle: 'Inspirations', title: 'Inspirations' },
    { id: 'wallpapers', navTitle: 'Wallpapers', title: 'Wallpaper Gallery' },
  ];

  private get visibleSections() {
    let guideSections = this.args.model?.guideSections ?? [];
    // every field stays editable in edit mode, theme or content or not;
    // the Card Container CSS reference is display-only and stays out of
    // the editor
    if (this.editMode) {
      return [
        ...this.contentSections,
        ...guideSections.filter(
          (section) => section.id !== 'card-container-css',
        ),
      ];
    }
    if (!this.hasThemeCss) {
      return [];
    }
    let model = this.args.model;
    let contentSections = this.contentSections.filter((section) => {
      if (section.id === 'visual-dna') {
        return Boolean(model?.visualDNA?.length);
      }
      if (section.id === 'inspirations') {
        return Boolean(model?.inspirations?.length);
      }
      return Boolean(model?.wallpaperImages?.length);
    });
    // the importer is an editing tool, so the isolated view leaves it out
    return [
      ...contentSections,
      ...guideSections.filter((section) => section.id !== 'import-css'),
    ];
  }

  <template>
    <ThemeDashboard
      class='style-reference'
      @themeCss={{@model.cssVariables}}
      @themeId={{@model.id}}
      @isDarkMode={{this.isDarkMode}}
      @sections={{this.visibleSections}}
    >
      <:header>
        {{#if this.editMode}}
          <ThemeDashboardHeader
            @title={{@model.cardTitle}}
            @description={{@model.cardDescription}}
            @model={{@model}}
            @fields={{@fields}}
            @mode='edit'
            @metaLabel='Style Reference'
          />
        {{else}}
          <header class='style-header'>
            <h1><@fields.cardTitle /></h1>
            <p class='style-header-description'>
              <@fields.cardDescription />
            </p>
          </header>
        {{/if}}
      </:header>
      <:default>
        {{#if this.showEmptyState}}
          <ThemeDashboardEmptyState />
        {{else}}
          <ThemeVisualizer
            class='style-ref-section'
            @toggleDarkMode={{this.toggleDarkMode}}
            @isDarkMode={{this.isDarkMode}}
            @fontStack={{@model.fontStacksFor this.isDarkMode}}
            @cssImports={{@model.cssImports}}
            @editMode={{this.editMode}}
          >
            <:colorPalette>
              <@fields.rootVariables />
            </:colorPalette>
            <:typography>
              <@fields.typography />
            </:typography>
            <:cssImports>
              <FieldContainer
                @label='CSS Imports'
                @tag='label'
                @vertical={{true}}
              >
                <@fields.customCssImports />
              </FieldContainer>
            </:cssImports>
          </ThemeVisualizer>

          <GridContainer class='style-ref-grid'>
            {{#if this.editMode}}
              <section id='visual-dna' class='visual-dna'>
                <h2>Visual DNA</h2>
                <@fields.visualDNA />
              </section>

              <section id='inspirations' class='inspirations'>
                <h2>Inspirations</h2>
                <@fields.inspirations />
              </section>

              <section id='wallpapers' class='wallpapers'>
                <h2>Wallpaper Gallery</h2>
                <@fields.wallpaperImages />
              </section>
            {{else}}
              {{#if @model.visualDNA.length}}
                <section id='visual-dna' class='visual-dna'>
                  <h2>Visual DNA</h2>
                  <div class='visual-dna'>
                    <@fields.visualDNA />
                  </div>
                </section>
              {{/if}}

              {{#if @model.inspirations.length}}
                <section id='inspirations' class='inspirations'>
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
                <section id='wallpapers' class='wallpapers'>
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

              {{#if @model.cssVariables}}
                <section id='card-container-css'>
                  <h2>Card Container Computed Styles</h2>
                  <CardContainerCss @cssVariables={{@model.cssVariables}} />
                </section>
              {{/if}}
            {{/if}}

            {{#if this.editMode}}
              <section id='import-css'>
                <h2>Import CSS Variables</h2>
                {{! the cardInfo editor in the header owns the name and
                  description, so the importer only handles CSS here }}
                <ThemeImporter @setCss={{@model.setCss}} />
              </section>
            {{/if}}

            <section id='view-code'>
              <h2>Generated CSS Variables</h2>
              <@fields.cssVariables />
            </section>

            {{#if this.editMode}}
              <section>
                <h2>Reset CSS</h2>
                <div>
                  <ResetButton @reset={{@model.resetCss}} />
                </div>
              </section>
            {{/if}}
          </GridContainer>
        {{/if}}
      </:default>
    </ThemeDashboard>
    <style scoped>
      h1 {
        margin-bottom: var(--boxel-sp-lg);
        color: var(--foreground);
      }
      h2 {
        margin-bottom: var(--boxel-sp-lg);
        border-bottom: 1px solid var(--border);
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
        background-color: var(--muted);
        color: var(--muted-foreground);
        border-bottom: 1px solid var(--border);
        text-align: center;
        text-wrap: pretty;
      }
      .style-header-description {
        max-width: 37.5rem;
        margin: 0 auto;
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
        border-radius: var(--boxel-border-radius-sm);
        overflow: hidden;
        box-shadow: var(--shadow);
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

class Edit extends Isolated {
  protected editMode = true;
}

export default class StyleReference extends StructuredTheme {
  static displayName = 'Style Reference';

  @field styleName = contains(StringField);
  @field inspirations = containsMany(StringField);
  @field visualDNA = contains(TextAreaField);
  @field wallpaperImages = containsMany(UrlField);

  @field themeName = contains(StringField, {
    computeVia: function (this: StyleReference) {
      return this.cardTitle;
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: StyleReference) {
      return this.cardInfo?.name ?? this.styleName ?? 'Untitled Theme';
    },
  });

  @field cardDescription = contains(StringField, {
    computeVia: function (this: StyleReference) {
      return this.cardInfo?.summary ?? this.visualDNA;
    },
  });

  @field cardThumbnailURL = contains(StringField, {
    computeVia: function (this: StyleReference) {
      return this.cardInfo?.cardThumbnailURL ?? this.wallpaperImages?.[0];
    },
  });

  static isolated: BaseDefComponent = Isolated;
  static edit: BaseDefComponent = Edit;
}
