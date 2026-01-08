import { tracked } from '@glimmer/tracking';
import { get } from '@ember/object';
import StyleReference from './style-reference';
import { GUIDE_SECTIONS } from './structured-theme';
import { ThemeTypographyField } from './structured-theme-variables';
import { contains, field, Component, type BaseDefComponent } from './card-api';
import MarkdownField from './markdown';
import {
  ThemeDashboard,
  NavSection,
  ThemeVisualizer,
  CssFieldEditor,
  ResetButton,
} from './default-templates/theme-dashboard';

import { GridContainer } from '@cardstack/boxel-ui/components';
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
  @tracked private isDarkMode = false;

  private toggleDarkMode = () => {
    this.isDarkMode = !this.isDarkMode;
  };

  private get sectionsWithContent() {
    let sections = this.args.model?.guideSections;
    return sections?.filter((section) => {
      if (section.id === 'import-css' || section.id === 'view-code') {
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

  <template>
    <ThemeDashboard
      style={{if this.isDarkMode @model.darkModeStyles}}
      @title={{@model.title}}
      @description={{@model.description}}
      @sections={{this.sectionsWithContent}}
      @isDarkMode={{this.isDarkMode}}
    >
      <GridContainer class='dsr-grid'>
        <ThemeVisualizer
          @toggleDarkMode={{this.toggleDarkMode}}
          @isDarkMode={{this.isDarkMode}}
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
        </ThemeVisualizer>

        {{#each this.sectionsWithContent as |section|}}
          <NavSection @id={{section.id}} @title={{section.title}}>
            {{#if (eq section.id 'visual-dna')}}
              <div class='dsr-section-content'>
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
              </div>
            {{else if (eq section.id 'import-css')}}
              <CssFieldEditor @setCss={{@model.setCss}} />
            {{else if (eq section.id 'inspirations')}}
              <div class='dsr-inspiration-tags'>
                {{#each @model.inspirations as |inspiration|}}
                  <span class='dsr-inspiration-tag'>{{inspiration}}</span>
                {{/each}}
              </div>
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
        <GridContainer>
          <h2>Reset CSS</h2>
          <div>
            <ResetButton @reset={{@model.resetCss}} />
          </div>
        </GridContainer>
      </GridContainer>
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
        color: var(--dsr-muted-fg);
      }

      /* Markdown */
      .dsr-content-prose :deep(h2),
      .dsr-content-prose :deep(h3) {
        margin-top: 0;
      }

      /* Image Gallery */
      .dsr-image-gallery {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(17.5rem, 1fr));
        gap: calc(var(--boxel-sp) * 1.5);
        margin-top: calc(var(--boxel-sp) * 1.5);
      }
      .dsr-gallery-item {
        margin: 0;
        aspect-ratio: 16 / 10;
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
        background-color: var(--dsr-card);
        color: var(--dsr-card-fg);
        border: 1px solid var(--dsr-border);
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
      .dsr-inspirations-section {
        background-color: var(--dsr-card);
        color: var(--dsr-card-fg);
        border-radius: var(--boxel-border-radius);
        padding: calc(var(--boxel-sp) * 2);
        border: 1px solid var(--dsr-border);
      }
      .dsr-inspiration-tags {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--boxel-sp) * 0.5);
      }
      .dsr-inspiration-tag {
        display: inline-block;
        padding: calc(var(--boxel-sp) * 0.375) calc(var(--boxel-sp) * 0.75);
        background-color: var(--dsr-card);
        color: var(--dsr-card-fg);
        border: 1px solid var(--dsr-border);
        border-radius: calc(var(--boxel-border-radius) * 0.5);
        font-size: var(--boxel-font-size-xs);
        font-weight: 500;
      }
      .dsr-inspiration-tag:hover {
        border-color: var(--dsr-fg);
      }

      /* Color Swatches */
      .dsr-color-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
        gap: var(--boxel-sp);
      }
      .dsr-color-swatch {
        --swatch-height: 3.75rem;
        display: flex;
        flex-direction: column;
        gap: calc(var(--boxel-sp) * 0.5);
        font-size: var(--boxel-font-size-xs);
        text-align: center;
      }
      .dsr-color-swatch :deep(.boxel-swatch-preview) {
        order: -1;
        box-shadow: var(--shadow-sm);
      }

      /* Chart Swatches */
      .dsr-chart-swatches {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
        gap: calc(var(--boxel-sp) * 0.5);
        flex-wrap: wrap;
      }
      .dsr-chart-swatch {
        --swatch-height: 5rem;
        flex: 1;
        transition: transform var(--boxel-transition);
      }
      .dsr-chart-swatch:hover {
        transform: translateY(-4px);
      }

      /* Shadow Samples */
      .dsr-shadow-samples {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(5rem, 1fr));
        gap: calc(var(--boxel-sp) * 2);
      }
      .dsr-shadow-box {
        height: 5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: var(--dsr-card);
        color: var(--dsr-card-fg);
        border: 1px solid var(--dsr-border);
        border-radius: var(--boxel-border-radius);
      }
      .sm-shadow {
        box-shadow: var(--shadow-sm);
      }
      .md-shadow {
        box-shadow: var(--shadow-md);
      }
      .lg-shadow {
        box-shadow: var(--shadow-lg);
      }
      .xl-shadow {
        box-shadow: var(--shadow-xl);
      }

      /* Responsive */
      @media (max-width: 768px) {
        .dsr-image-gallery {
          grid-template-columns: 1fr;
        }
        .dsr-color-grid {
          grid-template-columns: repeat(2, 1fr);
        }
        .dsr-shadow-samples {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      @media (max-width: 400px) {
        .dsr-theme-visualizer-header {
          flex-direction: column;
          align-items: stretch;
        }
      }
    </style>
  </template>
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
}
