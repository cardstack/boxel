import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action, get } from '@ember/object';
import StyleReference from './style-reference';
import { ThemeTypographyField } from './structured-theme-variables';
import { applyCssRulesToField, CSS_PLACEHOLDER } from './structured-theme';
import { contains, field, Component, type BaseDefComponent } from './card-api';
import MarkdownField from './markdown';

import Moon from '@cardstack/boxel-icons/moon';
import Sun from '@cardstack/boxel-icons/sun';
import ChevronCompactRight from '@cardstack/boxel-icons/chevron-compact-right';
import ChevronCompactLeft from '@cardstack/boxel-icons/chevron-compact-left';

import {
  Button,
  CardContainer,
  Swatch,
  FieldContainer,
  BoxelInput,
} from '@cardstack/boxel-ui/components';
import {
  cn,
  parseCssGroups,
  eq,
  extractCssVariables,
  sanitizeHtmlSafe,
} from '@cardstack/boxel-ui/helpers';

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
  {
    id: 'import-css',
    navTitle: 'Import CSS',
    title: 'Import Custom CSS',
    alwaysInclude: true,
  },
  {
    id: 'css-variables',
    navTitle: 'Generated CSS',
    title: 'Generated CSS Variables',
    fieldName: 'cssVariables',
    alwaysInclude: true,
  },
];

export class NavSection extends GlimmerComponent<{
  Args: {
    id: string;
    number?: string;
    title?: string;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}> {
  <template>
    <section id={{@id}} class='nav-section' ...attributes>
      <header class='nav-section-header'>
        {{#if @number}}
          <span class='nav-section-number'>{{@number}}</span>
        {{else}}
          <span class='nav-section-number' aria-hidden='true' />
        {{/if}}
        <h2 class='nav-section-title'>{{@title}}</h2>
        <Button
          class='nav-section-button'
          @as='anchor'
          @size='extra-small'
          href='#top'
          {{on 'click' this.scrollToTop}}
        >Back to top</Button>
      </header>
      <div class='nav-section-content'>
        {{yield}}
      </div>
    </section>
    <style scoped>
      .nav-section {
        margin-bottom: calc(var(--boxel-sp) * 4);
        scroll-margin-top: calc(var(--boxel-sp) * 6);
        counter-increment: section;
      }
      .nav-section:last-of-type {
        margin-bottom: calc(var(--boxel-sp) * 2);
      }
      /* Section Headers */
      .nav-section-header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp);
        margin-bottom: calc(var(--boxel-sp) * 2);
        padding-bottom: var(--boxel-sp);
        border-bottom: 2px solid var(--dsr-border);
      }
      .nav-section-number {
        display: inline-block;
        font-size: var(--boxel-font-size-sm);
        font-weight: 700;
        color: var(--dsr-muted-fg);
        font-variant-numeric: tabular-nums;
        min-width: 2rem;
      }
      .nav-section-number:empty::before {
        display: inline-block;
        content: counter(section, decimal-leading-zero);
      }
      .nav-section-button {
        margin-left: auto;
      }

      @media (max-width: 768px) {
        .nav-section-header {
          flex-direction: column;
          align-items: flex-start;
          gap: calc(var(--boxel-sp) * 0.5);
        }
        .nav-section-button {
          margin-left: initial;
        }
      }
    </style>
  </template>

  @action
  private scrollToTop(event: Event) {
    event.preventDefault();
    document
      .querySelector('#top')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

class NavBar extends GlimmerComponent<{
  Args: {
    sections?: { id: string; navTitle: string; title: string }[];
  };
  Element: HTMLElement;
}> {
  <template>
    <nav class='dsr-nav' ...attributes>
      <button
        type='button'
        class='nav-scroll nav-scroll--left'
        aria-label='Scroll navigation left'
        {{on 'click' (fn this.scrollTo 'left')}}
      >
        <ChevronCompactLeft />
      </button>
      <div class='nav-container'>
        <div class='nav-grid'>
          {{#each @sections as |section|}}
            <a href='#{{section.id}}' class='nav-item'>{{section.navTitle}}</a>
          {{/each}}
        </div>
      </div>
      <button
        type='button'
        class='nav-scroll nav-scroll--right'
        aria-label='Scroll navigation right'
        {{on 'click' (fn this.scrollTo 'right')}}
      >
        <ChevronCompactRight />
      </button>
    </nav>
    <style scoped>
      /* Navigation */
      .dsr-nav {
        position: sticky;
        top: 0;
        border-bottom: 1px solid var(--dsr-border);
        z-index: 10;
        backdrop-filter: blur(8px);
        display: flex;
        align-items: stretch;
        padding-inline: var(--boxel-sp);
      }
      .nav-grid {
        display: flex;
        gap: calc(var(--boxel-sp) * 0.5);
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        flex: 1;
        position: relative;
        align-items: center;
      }
      .nav-grid::-webkit-scrollbar {
        display: none;
      }
      .nav-item {
        font-size: var(--boxel-font-size-sm);
        font-weight: 500;
        color: var(--dsr-fg);
        text-decoration: none;
        white-space: nowrap;
        padding: calc(var(--boxel-sp) * 0.5) calc(var(--boxel-sp) * 0.75);
        border: none;
        border-radius: calc(var(--boxel-border-radius) * 0.5);
      }
      .nav-item:hover {
        background-color: var(--accent);
        color: var(--accent-foreground);
      }
      .nav-scroll {
        flex-shrink: 0;
        border: none;
        background: none;
        color: var(--dsr-muted-fg);
        width: 2.25rem;
        height: 5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition:
          color var(--boxel-transition),
          box-shadow var(--boxel-transition),
          transform var(--boxel-transition);
        opacity: 0.5;
        padding: 0;
      }
      .nav-scroll:hover,
      .nav-scroll:focus-visible {
        color: var(--dsr-fg);
        outline: none;
        background: color-mix(in lab, var(--dsr-fg) 10%, transparent);
      }
      .nav-scroll--left {
        order: -1;
      }
      .nav-scroll--right {
        order: 1;
      }
      .nav-container {
        position: relative;
        flex-grow: 1;
        display: flex;
        overflow: hidden;
      }
      .nav-container::before,
      .nav-container::after {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        width: 1rem;
        pointer-events: none;
        z-index: 1;
      }
      .nav-container::before {
        left: 0;
        background: linear-gradient(to right, var(--dsr-bg) 5%, transparent);
      }
      .nav-container::after {
        right: 0;
        background: linear-gradient(to left, var(--dsr-bg) 5%, transparent);
      }

      @media (max-width: 768px) {
        .dsr-nav {
          padding: var(--boxel-sp);
        }
        .nav-grid {
          gap: var(--boxel-sp);
        }
        .nav-scroll {
          display: none;
        }
        .nav-container::before,
        .nav-container::after {
          display: none;
        }
      }
    </style>
  </template>

  private scrollTo = (direction: 'left' | 'right', event: Event) => {
    event.preventDefault();
    let navContainer = (event.currentTarget as HTMLElement)
      ?.closest('.dsr-nav')
      ?.querySelector('.nav-grid') as HTMLElement | null;
    if (!navContainer) {
      return;
    }
    let offset =
      direction === 'left'
        ? -navContainer.clientWidth * 0.8
        : navContainer.clientWidth * 0.8;
    navContainer.scrollBy({ left: offset, behavior: 'smooth' });
  };
}

export class ModeToggle extends GlimmerComponent<{
  Args: {
    toggleDarkMode: () => void;
    isDarkMode: boolean;
  };
  Element: HTMLButtonElement;
}> {
  <template>
    <Button
      class='mode-toggle'
      @kind='primary'
      @size='small'
      {{on 'click' @toggleDarkMode}}
      ...attributes
    >
      {{#if @isDarkMode}}
        <Sun width='16' height='16' class='toggle-icon' role='presentation' />
        Light Mode
      {{else}}
        <Moon width='16' height='16' class='toggle-icon' role='presentation' />
        Dark Mode
      {{/if}}
    </Button>
    <style scoped>
      .mode-toggle {
        gap: var(--boxel-sp-xs);
        transition: none;
      }
      .toggle-icon {
        flex-shrink: 0;
      }
    </style>
  </template>
}

export class ThemeDashboardHeader extends GlimmerComponent<{
  Args: {
    title?: string;
    description?: string;
    isDarkMode?: boolean;
  };
  Element: HTMLElement;
  Blocks: { meta: []; default: [] };
}> {
  <template>
    <header class='theme-dashboard-header' ...attributes>
      {{#if (has-block 'meta')}}
        {{yield to='meta'}}
      {{else}}
        <div class='theme-dashboard-header-meta'>
          <span class='theme-dashboard-header-meta-label'>Style Guide</span>
          <span class='theme-dashboard-header-meta-version'>Version 1.0</span>
        </div>
      {{/if}}
      <h1 class='theme-dashboard-header-title'>{{@title}}</h1>
      {{#if @description}}
        <p class='theme-dashboard-header-tagline'>{{@description}}</p>
      {{/if}}
      {{yield}}
    </header>
    <style scoped>
      @layer baseComponent {
        .theme-dashboard-header {
          border-bottom: 1px solid var(--dsr-border);
          padding: calc(var(--boxel-sp) * 3) calc(var(--boxel-sp) * 2);
          background-color: var(--dsr-muted);
          color: var(--dsr-muted-fg);
        }
        .theme-dashboard-header-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: calc(var(--boxel-sp) * 1.5);
          font-size: var(--boxel-caption-font-size);
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-xxl);
          font-weight: 600;
        }
        .theme-dashboard-header-title {
          margin-bottom: calc(var(--boxel-sp) * 0.75);
          color: var(--dsr-fg);
        }
        .theme-dashboard-header-tagline {
          max-width: 48rem;
        }
      }
    </style>
  </template>
}

export class ThemeDashboard extends GlimmerComponent<{
  Args: {
    title?: string;
    description?: string;
    sections?: { id: string; navTitle: string; title: string }[];
    isDarkMode?: boolean;
  };
  Blocks: { default: []; header: [] };
  Element: HTMLElement;
}> {
  <template>
    <article
      id='top'
      class={{cn 'detailed-style-reference' dsr--dark=@isDarkMode}}
      ...attributes
    >
      {{#if (has-block 'header')}}
        {{yield to='header'}}
      {{else}}
        <ThemeDashboardHeader
          class='dsr-header'
          @title={{@title}}
          @description={{@description}}
          @isDarkMode={{@isDarkMode}}
        />
      {{/if}}

      {{#if @sections.length}}
        <NavBar @sections={{@sections}} />
      {{/if}}

      <div class='dsr-content'>
        {{yield}}
      </div>

      <footer class='dsr-footer'>
        <div class='footer-content'>
          <p class='footer-text'>
            This style guide is a living document. Design systems evolve with
            thoughtful iteration and disciplined execution.
          </p>
        </div>
      </footer>
    </article>

    <style scoped>
      .detailed-style-reference {
        --dsr-bg: var(--background, var(--boxel-light));
        --dsr-fg: var(--foreground, var(--boxel-700));
        --dsr-muted: var(
          --muted,
          color-mix(in oklab, var(--dsr-fg) 10%, transparent)
        );
        --dsr-muted-fg: var(
          --muted-foreground,
          color-mix(in oklab, var(--dsr-fg) 60%, transparent)
        );
        --dsr-border: var(
          --border,
          color-mix(in oklab, var(--dsr-fg) 20%, transparent)
        );
        --dsr-card: var(
          --card,
          color-mix(in oklab, var(--dsr-fg) 5%, transparent)
        );
        --dsr-card-fg: var(--card-foreground, var(--dsr-fg));

        min-height: 100vh;
        background-color: var(--dsr-bg);
        color: var(--dsr-fg);
        overflow-y: auto;
      }
      .dsr--dark {
        --dsr-bg: var(--background, var(--boxel-700));
        --dsr-fg: var(--foreground, var(--boxel-light));
      }
      .dsr--dark :deep(input),
      .dsr--dark :deep(textarea),
      .dsr--dark :deep(pre) {
        background-color: color-mix(
          in oklab,
          var(--dsr-bg),
          var(--boxel-dark) 20%
        );
        color: var(--foreground, var(--boxel-light));
      }

      .dsr-header :deep(h1) {
        font-size: var(--boxel-font-size-2xl);
      }
      .dsr-header :deep(p) {
        font-size: var(--boxel-font-size);
      }

      /* Content */
      .dsr-content {
        max-width: 56rem;
        margin: 0 auto;
        padding: calc(var(--boxel-sp) * 3) calc(var(--boxel-sp) * 2);
        counter-reset: section;
      }

      /* Footer */
      .dsr-footer {
        border-top: 1px solid var(--dsr-border);
        margin-top: calc(var(--boxel-sp) * 4);
        padding: calc(var(--boxel-sp) * 2);
        background-color: var(--dsr-muted);
        color: var(--dsr-muted-fg);
      }
      .footer-content {
        max-width: 56rem;
        margin: 0 auto;
        text-align: center;
      }
      .footer-text {
        font-style: italic;
        font-size: var(--boxel-font-size-sm);
        text-wrap: pretty;
      }

      /* Responsive */
      @media (max-width: 768px) {
        .dsr-header {
          padding: calc(var(--boxel-sp) * 2) var(--boxel-sp);
        }
        .style-title {
          font-size: clamp(1.75rem, 8vw, 2.5rem);
        }
        .dsr-content {
          padding: calc(var(--boxel-sp) * 2) var(--boxel-sp);
        }
        .theme-toggle {
          width: 100%;
          justify-content: center;
        }
      }
    </style>
  </template>
}

class Isolated extends Component<typeof DetailedStyleReference> {
  @tracked private isDarkMode = false;

  private toggleDarkMode = () => {
    this.isDarkMode = !this.isDarkMode;
  };

  private parseCss = (content: string) => {
    if (!content || !parseCssGroups) {
      return;
    }
    const groups = parseCssGroups(content);
    if (!groups?.size) {
      return;
    }
    applyCssRulesToField(this.args.model?.rootVariables, groups.get(':root'));
    applyCssRulesToField(
      this.args.model?.darkModeVariables,
      groups.get('.dark'),
    );
  };

  private get colorSystem() {
    let vars = this.isDarkMode
      ? this.args.model?.darkModeVariables
      : this.args.model?.rootVariables;
    return [
      {
        name: 'Background',
        value: vars?.background,
      },
      {
        name: 'Foreground',
        value: vars?.foreground,
      },
      {
        name: 'Primary',
        value: vars?.primary,
      },
      {
        name: 'Secondary',
        value: vars?.secondary,
      },
      {
        name: 'Accent',
        value: vars?.accent,
      },
      {
        name: 'Muted',
        value: vars?.muted,
      },
    ];
  }

  private get chartColors() {
    let vars = this.isDarkMode
      ? this.args.model?.darkModeVariables
      : this.args.model?.rootVariables;
    if (!vars) {
      return [];
    }
    return [vars.chart1, vars.chart2, vars.chart3, vars.chart4, vars.chart5];
  }

  private sections = STYLE_GUIDE_SECTIONS;

  private get sectionsWithContent() {
    return this.sections.filter((section) => {
      if (section.id === 'import-css') {
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

  private get themeStyles() {
    let css = this.args.model?.cssVariables;
    let selector = this.isDarkMode ? '.dark' : ':root';
    return sanitizeHtmlSafe(extractCssVariables(css, selector));
  }

  <template>
    <ThemeDashboard
      style={{this.themeStyles}}
      @title={{@model.title}}
      @description={{@model.description}}
      @sections={{this.sectionsWithContent}}
      @isDarkMode={{this.isDarkMode}}
    >
      {{! Theme Visualizer Section }}
      <section class='dsr-section dsr-theme-visualizer'>
        <div class='dsr-theme-visualizer-header'>
          <h2>Theme Visualizer</h2>
          <ModeToggle
            @toggleDarkMode={{this.toggleDarkMode}}
            @isDarkMode={{this.isDarkMode}}
          />
        </div>

        <div class='dsr-theme-preview'>
          <div class='dsr-preview-container'>
            {{! Color Swatches }}
            <div class='dsr-color-section'>
              <h3 class='dsr-preview-subtitle'>Color System</h3>
              <div class='dsr-color-grid'>
                {{#each this.colorSystem as |color|}}
                  <Swatch
                    class='dsr-color-swatch'
                    @label={{color.name}}
                    @color={{color.value}}
                  />
                {{/each}}
              </div>
            </div>

            {{! Typography Showcase }}
            <div class='dsr-typography-section'>
              <h3 class='dsr-preview-subtitle'>Typography</h3>
              <@fields.typography />
            </div>

            {{! Component Samples }}
            <div class='dsr-components-section'>
              <h3 class='dsr-preview-subtitle'>Components</h3>
              <div class='dsr-component-samples'>
                <Button
                  @kind='primary'
                  @size='extra-small'
                  @rectangular={{true}}
                >Primary Action</Button>
                <Button
                  @kind='secondary'
                  @size='extra-small'
                  @rectangular={{true}}
                >Secondary Action</Button>

                <CardContainer @displayBoundaries={{true}} class='sample-card'>
                  <h3 class='dsr-card-title'>Sample Card</h3>
                  <p>
                    Card component showcasing background, borders, and shadows
                    from the theme system.
                  </p>
                </CardContainer>
              </div>
            </div>

            {{! Chart Colors }}
            <div class='dsr-charts-section'>
              <h3 class='dsr-preview-subtitle'>Chart Colors</h3>
              <div class='dsr-chart-swatches'>
                {{#each this.chartColors as |color|}}
                  <Swatch
                    class='dsr-chart-swatch'
                    @hideLabel={{true}}
                    @color={{color}}
                  />
                {{/each}}
              </div>
            </div>

            {{! Shadow Scale }}
            <div class='shadows-section'>
              <h3 class='dsr-preview-subtitle'>Shadow Scale</h3>
              <div class='dsr-shadow-samples'>
                <div class='dsr-shadow-box sm-shadow'>SM</div>
                <div class='dsr-shadow-box md-shadow'>MD</div>
                <div class='dsr-shadow-box lg-shadow'>LG</div>
                <div class='dsr-shadow-box xl-shadow'>XL</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {{#each this.sectionsWithContent as |section|}}
        <NavSection @id={{section.id}} @title={{section.title}}>
          {{#if (eq section.id 'visual-dna')}}
            <div class='dsr-section-content'>
              {{#if @model.colorPalette}}
                <div class='subsection'>
                  <h3 class='subsection-title'>Color Palette</h3>
                  <div class='content-prose'>
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
            <div class='dsr-section-content'>
              <FieldContainer
                @vertical={{true}}
                @label='Paste your CSS below to customize the theme variables'
                @tag='label'
              >
                <BoxelInput
                  @type='textarea'
                  @onInput={{this.parseCss}}
                  @placeholder={{CSS_PLACEHOLDER}}
                  class='css-textarea'
                  data-test-custom-css-variables
                />
              </FieldContainer>
            </div>
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
    </ThemeDashboard>

    <style scoped>
      .dsr-section {
        margin-bottom: calc(var(--boxel-sp) * 4);
        scroll-margin-top: calc(var(--boxel-sp) * 6);
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

      /* Import Custom CSS */
      .css-textarea {
        --boxel-input-height: 19rem;
      }

      /* Theme Visualizer */
      .dsr-theme-visualizer {
        background-color: var(--dsr-card);
        color: var(--dsr-card-fg);
        border-radius: var(--boxel-border-radius);
        padding: calc(var(--boxel-sp) * 2);
        border: 1px solid var(--dsr-border);
      }
      .dsr-theme-visualizer-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: calc(var(--boxel-sp) * 2);
        padding-bottom: var(--boxel-sp);
        border-bottom: 2px solid var(--dsr-border);
      }
      .dsr-theme-preview {
        padding: calc(var(--boxel-sp) * 2);
        background: var(--dsr-bg);
        color: var(--dsr-fg);
        border-radius: var(--boxel-border-radius);
        border: 2px solid var(--dsr-border);
      }
      .dsr-preview-container {
        display: flex;
        flex-direction: column;
        gap: calc(var(--boxel-sp) * 4);
      }
      .dsr-preview-subtitle {
        border-bottom: var(--boxel-border);
        margin-bottom: calc(var(--boxel-sp) * 2);
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

      /* Component Samples */
      .dsr-component-samples {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp);
        align-items: flex-start;
      }
      .dsr-sample-card {
        flex: 1 1 18.75rem;
        padding: var(--boxel-sp);
        background-color: var(--dsr-card);
        color: var(--dsr-card-fg);
      }
      .dsr-card-title {
        margin-bottom: var(--boxel-sp);
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

  static isolated: BaseDefComponent = Isolated;
}
