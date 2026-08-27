import { tracked } from '@glimmer/tracking';
import { get } from '@ember/object';
import StyleReference from './style-reference';
import {
  GUIDE_SECTIONS,
  orderEditSections,
  withPreviewNavSection,
} from './structured-theme';
import { ThemeTypographyField } from './structured-theme-variables';
import { contains, field, Component, type BaseDefComponent } from './card-api';
import MarkdownField from './markdown';

import {
  ThemeDashboard,
  ThemeDashboardEmptyState,
  ThemeDashboardHeader,
  NavSection,
  ThemeVisualizer,
  ThemeImporter,
  CardContainerCss,
  ResetButton,
} from './default-templates/theme-dashboard';

import { GridContainer, FieldContainer } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

export const STYLE_GUIDE_SECTIONS = [
  {
    id: 'context',
    navTitle: 'Context',
    title: 'Historical Context & Philosophy',
    fieldName: 'historicalContext',
  },
  {
    id: 'visual-dna',
    navTitle: 'Visual DNA',
    title: 'Visual DNA',
  },
  {
    id: 'composition',
    navTitle: 'Composition',
    title: 'Spatial & Compositional Rules',
    fieldName: 'compositionRules',
  },
  {
    id: 'motion',
    navTitle: 'Motion',
    title: 'Motion & Interaction Language',
    fieldName: 'motionLanguage',
  },
  {
    id: 'components',
    navTitle: 'Components',
    title: 'Component Vocabulary',
    fieldName: 'componentVocabulary',
  },
  {
    id: 'voice',
    navTitle: 'Voice',
    title: 'Content & Voice Principles',
    fieldName: 'contentVoice',
  },
  {
    id: 'technical',
    navTitle: 'Technical',
    title: 'Technical Specifications',
    fieldName: 'technicalSpecs',
  },
  {
    id: 'applications',
    navTitle: 'Applications',
    title: 'Application Scenarios',
    fieldName: 'applicationScenarios',
  },
  {
    id: 'quality',
    navTitle: 'Quality',
    title: 'Quality Standards',
    fieldName: 'qualityStandards',
  },
  {
    id: 'mindset',
    navTitle: 'Design Mindset',
    title: 'Design Mindset',
    fieldName: 'designMindset',
  },
  {
    id: 'inspirations',
    navTitle: 'Inspirations',
    title: 'Key Inspirations',
    fieldName: 'inspirations',
  },
];

class Isolated extends Component<typeof DetailedStyleReference> {
  // Edit extends this template with the field editors swapped in
  protected editMode = false;

  @tracked private isDarkMode = false;

  private toggleDarkMode = () => {
    this.isDarkMode = !this.isDarkMode;
  };

  private get hasThemeCss() {
    return Boolean(this.args.model?.cssVariables);
  }

  private get showVisualizer() {
    return this.editMode || this.hasThemeCss;
  }

  // A theme-less isolated view shows the dashboard empty state instead of
  // any sections; importing happens in edit mode.
  private get showEmptyState() {
    return !this.editMode && !this.hasThemeCss;
  }

  private get sectionsWithContent() {
    let sections = this.args.model?.guideSections;
    // the Card Container CSS reference is display-only, so it stays out of
    // the editor; every other field is editable whether or not it has content
    if (this.editMode) {
      return orderEditSections(
        sections?.filter((section) => section.id !== 'card-container-css') ??
          [],
        this.hasThemeCss,
      );
    }
    return sections?.filter((section) => {
      if (!this.hasThemeCss) {
        return false;
      }

      // the importer is an editing tool, so the isolated view leaves it out
      if (section.id === 'import-css') {
        return false;
      }

      if (section.id === 'view-code' || section.id === 'card-container-css') {
        return true;
      }

      if (section.id === 'visual-dna') {
        return this.hasVisualDNAContent;
      }

      if (!section.fieldName) {
        return false;
      }

      let content = get(this.args.model ?? {}, section.fieldName);

      if (Array.isArray(content)) {
        return content.length > 0;
      }

      if (typeof content === 'string') {
        return content.trim().length > 0;
      }

      return Boolean(content);
    });
  }

  private get hasVisualDNAContent() {
    let model = this.args.model;
    if (!model) {
      return false;
    }

    return Boolean(
      model.colorPalette ||
      model.typographySystem ||
      model.geometricLanguage ||
      model.materialVocabulary ||
      model.wallpaperImages?.length,
    );
  }

  private get navSections() {
    return withPreviewNavSection(
      this.sectionsWithContent ?? [],
      this.hasThemeCss,
    );
  }

  <template>
    <ThemeDashboard
      @themeCss={{@model.cssVariables}}
      @themeId={{@model.id}}
      @sections={{this.navSections}}
      @isDarkMode={{this.isDarkMode}}
      @toggleDarkMode={{unless this.showEmptyState this.toggleDarkMode}}
    >
      <:header>
        <ThemeDashboardHeader
          class='dsr-header'
          @title={{@model.cardTitle}}
          @description={{@model.cardDescription}}
          @version={{@model.version}}
          @model={{@model}}
          @fields={{@fields}}
          @mode={{if this.editMode 'edit' 'isolated'}}
        />
      </:header>
      <:default>
        {{#if this.showEmptyState}}
          <ThemeDashboardEmptyState />
        {{else}}
          <GridContainer class='dsr-grid'>
            {{#if this.showVisualizer}}
              <ThemeVisualizer
                id='preview'
                @isDarkMode={{this.isDarkMode}}
                @fontStack={{@model.fontStacksFor this.isDarkMode}}
                @cssImports={{@model.cssImports}}
                @editMode={{this.editMode}}
              >
                <:colorPalette>
                  {{#if this.isDarkMode}}
                    <@fields.darkModeVariables />
                  {{else}}
                    <@fields.rootVariables />
                  {{/if}}
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
            {{/if}}

            {{#each this.sectionsWithContent as |section|}}
              <NavSection @id={{section.id}} @title={{section.title}}>
                {{#if (eq section.id 'visual-dna')}}
                  <div class='dsr-section-content'>
                    {{#if this.editMode}}
                      <div class='dsr-subsection'>
                        <h3 class='dsr-subsection-title'>Color Palette</h3>
                        <@fields.colorPalette />
                      </div>
                      <div class='dsr-subsection'>
                        <h3 class='dsr-subsection-title'>Typography System</h3>
                        <@fields.typographySystem />
                      </div>
                      <div class='dsr-subsection'>
                        <h3 class='dsr-subsection-title'>Geometric Language</h3>
                        <@fields.geometricLanguage />
                      </div>
                      <div class='dsr-subsection'>
                        <h3 class='dsr-subsection-title'>Material Vocabulary</h3>
                        <@fields.materialVocabulary />
                      </div>
                      <div class='dsr-subsection'>
                        <h3 class='dsr-subsection-title'>Visual References</h3>
                        <@fields.wallpaperImages />
                      </div>
                    {{else}}
                      {{#if @model.colorPalette}}
                        <div class='dsr-subsection'>
                          <h3 class='dsr-subsection-title'>Color Palette</h3>
                          <div class='dsr-content-prose'>
                            <@fields.colorPalette />
                          </div>
                        </div>
                      {{/if}}

                      {{#if @model.typographySystem}}
                        <div class='dsr-subsection'>
                          <h3 class='dsr-subsection-title'>Typography System</h3>
                          <div class='dsr-content-prose'>
                            <@fields.typographySystem />
                          </div>
                        </div>
                      {{/if}}

                      {{#if @model.geometricLanguage}}
                        <div class='dsr-subsection'>
                          <h3 class='dsr-subsection-title'>Geometric Language</h3>
                          <div class='dsr-content-prose'>
                            <@fields.geometricLanguage />
                          </div>
                        </div>
                      {{/if}}

                      {{#if @model.materialVocabulary}}
                        <div class='dsr-subsection'>
                          <h3 class='dsr-subsection-title'>Material Vocabulary</h3>
                          <div class='dsr-content-prose'>
                            <@fields.materialVocabulary />
                          </div>
                        </div>
                      {{/if}}

                      {{#if @model.wallpaperImages.length}}
                        <div class='dsr-subsection'>
                          <h3 class='dsr-subsection-title'>Visual References</h3>
                          <div class='dsr-image-gallery'>
                            {{#each @model.wallpaperImages as |imageUrl|}}
                              <figure class='dsr-gallery-item'>
                                <img
                                  src='{{imageUrl}}'
                                  alt='Style reference'
                                  class='dsr-gallery-image'
                                />
                              </figure>
                            {{/each}}
                          </div>
                        </div>
                      {{/if}}
                    {{/if}}
                  </div>
                {{else if (eq section.id 'card-container-css')}}
                  {{#if @model.cssVariables}}
                    <CardContainerCss @cssVariables={{@model.cssVariables}} />
                  {{/if}}
                {{else if (eq section.id 'import-css')}}
                  {{! the cardInfo editor in the header owns the name and
                    description, so the importer only handles CSS here }}
                  <ThemeImporter @setCss={{@model.setCss}} />
                {{else if (eq section.id 'inspirations')}}
                  {{#if this.editMode}}
                    <@fields.inspirations />
                  {{else}}
                    <div class='dsr-inspiration-tags'>
                      {{#each @model.inspirations as |inspiration|}}
                        <span class='dsr-inspiration-tag'>{{inspiration}}</span>
                      {{/each}}
                    </div>
                  {{/if}}
                {{else if section.fieldName}}
                  {{#let (get @fields section.fieldName) as |FieldContent|}}
                    <div class='dsr-content-prose'>
                      {{! @glint-ignore }}
                      <FieldContent />
                    </div>
                  {{/let}}
                {{/if}}
              </NavSection>
            {{/each}}
            {{#if this.editMode}}
              <GridContainer>
                <h2>Reset CSS</h2>
                <div>
                  <ResetButton @reset={{@model.resetCss}} />
                </div>
              </GridContainer>
            {{/if}}
          </GridContainer>
        {{/if}}
      </:default>
    </ThemeDashboard>

    <style scoped>
      .dsr-grid {
        gap: calc(var(--boxel-sp) * 2);
      }

      /* Subsections */
      .dsr-subsection {
        margin-bottom: calc(var(--boxel-sp) * 2.5);
      }
      .dsr-subsection:last-child {
        margin-bottom: 0;
      }
      .dsr-subsection-title {
        margin-bottom: var(--boxel-sp);
        color: var(--muted-foreground);
      }

      /* Markdown */
      .dsr-content-prose :deep(h2),
      .dsr-content-prose :deep(h3) {
        margin-top: 0;
      }

      /* Image Gallery */
      .dsr-image-gallery {
        display: grid;
        /* min() lets the column shrink instead of overflowing a narrow card */
        grid-template-columns: repeat(
          auto-fill,
          minmax(min(17.5rem, 100%), 1fr)
        );
        gap: calc(var(--boxel-sp) * 1.5);
        margin-top: calc(var(--boxel-sp) * 1.5);
      }
      .dsr-gallery-item {
        margin: 0;
        aspect-ratio: 16 / 10;
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
        background-color: var(--card);
        color: var(--card-foreground);
        border: 1px solid var(--border);
      }
      .dsr-gallery-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform var(--boxel-transition);
      }
      .dsr-gallery-item:hover .dsr-gallery-image {
        transform: scale(1.05);
      }

      /* Inspirations */
      .dsr-inspiration-tags {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--boxel-sp) * 0.5);
      }
      .dsr-inspiration-tag {
        display: inline-block;
        padding: calc(var(--boxel-sp) * 0.375) calc(var(--boxel-sp) * 0.75);
        background-color: var(--card);
        color: var(--card-foreground);
        border: 1px solid var(--border);
        border-radius: calc(var(--boxel-border-radius) * 0.5);
        font-size: var(--boxel-font-size-xs);
        font-weight: 500;
      }
      .dsr-inspiration-tag:hover {
        border-color: var(--foreground);
      }

      /* Responsive */
      @media (max-width: 768px) {
        .dsr-image-gallery {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}

// Same dashboard layout as Isolated; fields render as editors, the css
// imports field appears under Font Imports, and the component samples and
// Card Container CSS sections are dropped.
class Edit extends Isolated {
  protected editMode = true;
}

export default class DetailedStyleReference extends StyleReference {
  static displayName = 'Detailed Style Reference';

  @field historicalContext = contains(MarkdownField, {
    description:
      'Narrative of the style’s origins, philosophy, and constraints.',
  });

  @field colorPalette = contains(MarkdownField, {
    description: 'Markdown section for describing key style colors and use.',
  });

  @field typography = contains(ThemeTypographyField, {
    description:
      'Structured typography token values rendered in the theme visualizer.',
  });

  @field typographySystem = contains(MarkdownField, {
    description:
      'Markdown notes covering headline/body fonts, weights, and pairings based on TypographyVarField.',
  });

  @field geometricLanguage = contains(MarkdownField, {
    description:
      'Defines motifs, shapes, and layout proportions used in visuals.',
  });

  @field materialVocabulary = contains(MarkdownField, {
    description:
      'Specifies textures, patterns, and physical metaphors informing the system.',
  });

  @field compositionRules = contains(MarkdownField, {
    description: 'Guidance on spacing, grids, and compositional hierarchy.',
  });

  @field motionLanguage = contains(MarkdownField, {
    description: 'Principles for animation timing, easing, and choreography.',
  });

  @field componentVocabulary = contains(MarkdownField, {
    description:
      'Detailed component patterns and states that make up the UI kit.',
  });

  @field contentVoice = contains(MarkdownField, {
    description: 'Writing guidelines, tone, and messaging points.',
  });

  @field technicalSpecs = contains(MarkdownField, {
    description:
      'Implementation details such as breakpoints, accessibility, and asset requirements.',
  });

  @field applicationScenarios = contains(MarkdownField, {
    description:
      'Use cases or mock scenarios showing the system applied in context.',
  });

  @field qualityStandards = contains(MarkdownField, {
    description: 'Checklists or metrics used to validate execution quality.',
  });

  @field designMindset = contains(MarkdownField, {
    description:
      'Core principles or mindset reminders for designers and collaborators.',
  });

  guideSections = [...STYLE_GUIDE_SECTIONS, ...GUIDE_SECTIONS];

  static isolated: BaseDefComponent = Isolated;
  static edit: BaseDefComponent = Edit;
}
