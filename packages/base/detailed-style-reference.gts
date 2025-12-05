import GlimmerComponent from '@glimmer/component';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action, get } from '@ember/object';
import StyleReference from './style-reference';
import { ThemeHeader } from './structured-theme';
import { ThemeTypographyField } from './structured-theme-variables';
import { contains, field, Component } from './card-api';
import MarkdownField from './markdown';

import ChevronCompactRight from '@cardstack/boxel-icons/chevron-compact-right';
import ChevronCompactLeft from '@cardstack/boxel-icons/chevron-compact-left';

import { Button, CardContainer, Swatch } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

class NavSection extends GlimmerComponent<{
  Args: {
    id: string;
    number?: string;
    title?: string;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}> {
  <template>
    <section id={{@id}} class='dsr-section' ...attributes>
      <header class='section-header'>
        {{#if @number}}
          <span class='section-number'>{{@number}}</span>
        {{else}}
          <span class='section-number' aria-hidden='true' />
        {{/if}}
        <h2 class='section-title'>{{@title}}</h2>
        <a
          class='back-to-top'
          href='#top'
          aria-label='Back to top'
          {{on 'click' this.scrollToTop}}
        >Back to top</a>
      </header>
      <div class='section-content'>
        {{yield}}
      </div>
    </section>
    <style scoped>
      .dsr-section {
        margin-bottom: calc(var(--dsr-spacing-unit) * 4);
        scroll-margin-top: calc(var(--dsr-spacing-unit) * 6);
        counter-increment: section;
      }

      .dsr-section:last-of-type {
        margin-bottom: calc(var(--dsr-spacing-unit) * 2);
      }

      /* Section Headers */
      .section-header {
        display: flex;
        align-items: baseline;
        gap: calc(var(--dsr-spacing-unit) * 1);
        margin-bottom: calc(var(--dsr-spacing-unit) * 2);
        padding-bottom: calc(var(--dsr-spacing-unit) * 1);
        border-bottom: 2px solid var(--dsr-border);
      }

      .section-number {
        display: inline-block;
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--dsr-accent);
        font-variant-numeric: tabular-nums;
        min-width: 2rem;
      }

      .section-number:empty::before {
        display: inline-block;
        content: counter(section, decimal-leading-zero);
      }

      .section-title {
        font-size: 1.75rem;
        font-weight: 700;
        margin: 0;
        letter-spacing: -0.01em;
        line-height: 1.2;
      }

      .back-to-top {
        margin-left: auto;
        font-size: var(--boxel-font-size-xs);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        text-decoration: none;
        color: var(--dsr-secondary);
        border: 1px solid transparent;
        border-radius: calc(var(--dsr-radius) * 0.4);
        padding: calc(var(--dsr-spacing-unit) * 0.2)
          calc(var(--dsr-spacing-unit) * 0.5);
        transition:
          color 0.2s ease,
          border-color 0.2s ease;
      }

      .back-to-top:hover,
      .back-to-top:focus-visible {
        color: var(--dsr-accent);
        border-color: var(--dsr-border);
        outline: none;
      }

      @media (max-width: 768px) {
        .section-header {
          flex-direction: column;
          align-items: flex-start;
          gap: calc(var(--dsr-spacing-unit) * 0.5);
        }

        .section-title {
          font-size: 1.5rem;
        }

        .back-to-top {
          margin-left: 0;
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
        background: var(--dsr-background);
        border-bottom: 1px solid var(--dsr-border);
        z-index: 10;
        backdrop-filter: blur(8px);
        display: flex;
        align-items: stretch;
        padding-inline: var(--dsr-spacing-unit);
      }

      .nav-grid {
        display: flex;
        gap: calc(var(--dsr-spacing-unit) * 0.5);
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
        color: var(--dsr-secondary);
        text-decoration: none;
        white-space: nowrap;
        padding: calc(var(--dsr-spacing-unit) * 0.5)
          calc(var(--dsr-spacing-unit) * 0.75);
        border: none;
        border-radius: calc(var(--dsr-radius) * 0.5);
      }

      .nav-item:hover {
        color: var(--dsr-accent);
        background: color-mix(in srgb, var(--dsr-accent) 5%, transparent);
      }

      .nav-scroll {
        border: none;
        background: none;
        color: var(--dsr-secondary);
        width: 2.25rem;
        height: 5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition:
          color 0.2s ease,
          box-shadow 0.2s ease,
          transform 0.2s ease;
        opacity: 0.5;
        padding: 0;
      }

      .nav-scroll:hover,
      .nav-scroll:focus-visible {
        color: var(--dsr-accent);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        outline: none;
      }

      .nav-scroll--left {
        order: -1;
      }

      .nav-scroll--right {
        order: 1;
      }

      .nav-container {
        position: relative;
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
        background: linear-gradient(
          to right,
          var(--dsr-background),
          transparent
        );
      }

      .nav-container::after {
        right: 0;
        background: linear-gradient(
          to left,
          var(--dsr-background),
          transparent
        );
      }

      @media (max-width: 768px) {
        .dsr-nav {
          padding: var(--dsr-spacing-unit);
        }

        .nav-grid {
          gap: var(--dsr-spacing-unit);
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
  @action
  private scrollTo(direction: 'left' | 'right', event: Event) {
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
  }
}

class ThemeDashboard extends GlimmerComponent<{
  Args: {
    description?: string;
    sections?: { id: string; navTitle: string; title: string }[];
    title?: string;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}> {
  <template>
    <article id='top' class='detailed-style-reference' ...attributes>
      <ThemeHeader @title={{@title}} @description={{@description}} />

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
      /* Root Variables */
      .detailed-style-reference {
        --dsr-primary: var(--foreground, #1a1a1a);
        --dsr-secondary: var(--muted-foreground, #666);
        --dsr-accent: var(--accent, #0066cc);
        --dsr-background: var(--background, #ffffff);
        --dsr-surface: var(--card, #f8f9fa);
        --dsr-border: var(--border, #e0e0e0);
        --dsr-spacing-unit: var(--boxel-sp, 1rem);
        --dsr-radius: var(--radius, 8px);
      }

      /* Layout Structure */
      .detailed-style-reference {
        min-height: 100vh;
        background: var(--dsr-background);
        color: var(--dsr-primary);
        font-family: var(
          --font-sans,
          -apple-system,
          BlinkMacSystemFont,
          'Segoe UI',
          sans-serif
        );
        line-height: 1.6;
        overflow-y: auto;
      }

      /* Content */
      .dsr-content {
        max-width: 56rem;
        margin: 0 auto;
        padding: calc(var(--dsr-spacing-unit) * 3)
          calc(var(--dsr-spacing-unit) * 2);
        counter-reset: section;
      }

      /* Footer */
      .dsr-footer {
        border-top: 1px solid var(--dsr-border);
        margin-top: calc(var(--dsr-spacing-unit) * 4);
        padding: calc(var(--dsr-spacing-unit) * 2);
        background: var(--dsr-surface);
      }
      .footer-content {
        max-width: 56rem;
        margin: 0 auto;
        text-align: center;
      }
      .footer-text {
        font-size: 0.875rem;
        color: var(--dsr-secondary);
        font-style: italic;
        margin: 0;
        text-wrap: pretty;
      }

      /* Responsive */
      @media (max-width: 768px) {
        .dsr-content {
          padding: calc(var(--dsr-spacing-unit) * 2) var(--dsr-spacing-unit);
        }
      }
    </style>
  </template>
}

class Isolated extends Component<typeof DetailedStyleReference> {
  private get colorSystem() {
    return [
      {
        name: 'Background',
        value: 'var(--background)',
      },
      {
        name: 'Foreground',
        value: 'var(--foreground)',
      },
      {
        name: 'Primary',
        value: 'var(--primary)',
      },
      {
        name: 'Secondary',
        value: 'var(--secondary)',
      },
      {
        name: 'Accent',
        value: 'var(--accent)',
      },
      {
        name: 'Muted',
        value: 'var(--muted)',
      },
    ];
  }

  private get chartColors() {
    return [
      'var(--chart-1)',
      'var(--chart-2)',
      'var(--chart-3)',
      'var(--chart-4)',
      'var(--chart-5)',
    ];
  }

  private sections = [
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

  private get sectionsWithContent() {
    return this.sections.filter((section) => {
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
      @title={{@model.title}}
      @description={{@model.description}}
      @sections={{this.sectionsWithContent}}
    >
      {{! Theme Visualizer Section }}
      <section class='dsr-section theme-visualizer-section'>
        <div class='section-header'>
          <h2 class='section-title'>Theme Visualizer</h2>
        </div>

        <div class='theme-preview'>
          <div class='preview-container'>
            {{! Color Swatches }}
            <div class='color-section'>
              <h3 class='preview-subtitle'>Color System</h3>
              <div class='color-grid'>
                {{#each this.colorSystem as |color|}}
                  <Swatch
                    class='color-swatch'
                    @label={{color.name}}
                    @color={{color.value}}
                  />
                {{/each}}
              </div>
            </div>

            {{! Typography Showcase }}
            <div class='typography-section'>
              <h3 class='preview-subtitle'>Typography</h3>
              <@fields.typography />
            </div>

            {{! Component Samples }}
            <div class='components-section'>
              <h3 class='preview-subtitle'>Components</h3>
              <div class='component-samples'>
                <Button
                  @kind='primary'
                  @size='touch'
                  @rectangular={{true}}
                >Primary Action</Button>
                <Button
                  @kind='secondary'
                  @size='touch'
                  @rectangular={{true}}
                >Secondary Action</Button>

                <CardContainer @displayBoundaries={{true}} class='sample-card'>
                  <h3 class='card-title'>Sample Card</h3>
                  <p>
                    Card component showcasing background, borders, and shadows
                    from the theme system.
                  </p>
                </CardContainer>
              </div>
            </div>

            {{! Chart Colors }}
            <div class='charts-section'>
              <h3 class='preview-subtitle'>Chart Colors</h3>
              <div class='chart-swatches'>
                {{#each this.chartColors as |color|}}
                  <Swatch
                    class='chart-swatch'
                    @hideLabel={{true}}
                    @color={{color}}
                  />
                {{/each}}
              </div>
            </div>

            {{! Shadow Scale }}
            <div class='shadows-section'>
              <h3 class='preview-subtitle'>Shadow Scale</h3>
              <div class='shadow-samples'>
                <div class='shadow-box sm-shadow'>SM</div>
                <div class='shadow-box md-shadow'>MD</div>
                <div class='shadow-box lg-shadow'>LG</div>
                <div class='shadow-box xl-shadow'>XL</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {{#each this.sectionsWithContent as |section|}}
        <NavSection @id={{section.id}} @title={{section.title}}>
          {{#if (eq section.id 'visual-dna')}}
            <div class='section-content'>
              {{#if @model.colorPalette}}
                <div class='subsection'>
                  <h3 class='subsection-title'>Color Palette</h3>
                  <div class='content-prose'>
                    <@fields.colorPalette />
                  </div>
                </div>
              {{/if}}

              {{#if @model.typographySystem}}
                <div class='subsection'>
                  <h3 class='subsection-title'>Typography System</h3>
                  <div class='content-prose'>
                    <@fields.typographySystem />
                  </div>
                </div>
              {{/if}}

              {{#if @model.geometricLanguage}}
                <div class='subsection'>
                  <h3 class='subsection-title'>Geometric Language</h3>
                  <div class='content-prose'>
                    <@fields.geometricLanguage />
                  </div>
                </div>
              {{/if}}

              {{#if @model.materialVocabulary}}
                <div class='subsection'>
                  <h3 class='subsection-title'>Material Vocabulary</h3>
                  <div class='content-prose'>
                    <@fields.materialVocabulary />
                  </div>
                </div>
              {{/if}}

              {{#if @model.wallpaperImages.length}}
                <div class='subsection'>
                  <h3 class='subsection-title'>Visual References</h3>
                  <div class='image-gallery'>
                    {{#each @model.wallpaperImages as |imageUrl|}}
                      <figure class='gallery-item'>
                        <img
                          src='{{imageUrl}}'
                          alt='Style reference'
                          class='gallery-image'
                        />
                      </figure>
                    {{/each}}
                  </div>
                </div>
              {{/if}}
            </div>
          {{else if (eq section.id 'inspirations')}}
            <div class='inspiration-tags'>
              {{#each @model.inspirations as |inspiration|}}
                <span class='inspiration-tag'>{{inspiration}}</span>
              {{/each}}
            </div>
          {{else if section.fieldName}}
            {{#let (get @fields section.fieldName) as |FieldContent|}}
              <div class='content-prose'>
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
        margin-bottom: calc(var(--dsr-spacing-unit) * 4);
        scroll-margin-top: calc(var(--dsr-spacing-unit) * 6);
      }

      /* Subsections */
      .subsection {
        margin-bottom: calc(var(--dsr-spacing-unit) * 2.5);
      }

      .subsection:last-child {
        margin-bottom: 0;
      }

      .subsection-title {
        margin: 0 0 calc(var(--dsr-spacing-unit) * 1) 0;
        color: var(--dsr-primary);
      }

      /* Content Typography */
      .content-prose {
        font-size: 0.9375rem;
        line-height: 1.7;
        color: var(--dsr-primary);
      }

      .content-prose :deep(h1),
      .content-prose :deep(h2),
      .content-prose :deep(h3),
      .content-prose :deep(h4) {
        font-weight: 600;
        line-height: 1.3;
        margin-top: calc(var(--dsr-spacing-unit) * 1.5);
        margin-bottom: calc(var(--dsr-spacing-unit) * 0.75);
      }

      .content-prose :deep(h1) {
        font-size: 1.5rem;
      }

      .content-prose :deep(h2) {
        font-size: 1.25rem;
      }

      .content-prose :deep(h3) {
        font-size: 1.0625rem;
      }

      .content-prose :deep(h4) {
        font-size: 0.9375rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--dsr-secondary);
      }

      .content-prose :deep(p) {
        margin: 0 0 calc(var(--dsr-spacing-unit) * 1) 0;
      }

      .content-prose :deep(ul),
      .content-prose :deep(ol) {
        margin: 0 0 calc(var(--dsr-spacing-unit) * 1) 0;
        padding-left: calc(var(--dsr-spacing-unit) * 1.5);
      }

      .content-prose :deep(li) {
        margin-bottom: calc(var(--dsr-spacing-unit) * 0.5);
      }

      .content-prose :deep(strong) {
        font-weight: 600;
        color: var(--dsr-primary);
      }

      .content-prose :deep(em) {
        font-style: italic;
        color: var(--dsr-secondary);
      }

      .content-prose :deep(code) {
        font-family: var(--font-mono, 'Monaco', 'Courier New', monospace);
        font-size: 0.875em;
        background: var(--dsr-surface);
        padding: 0.125rem 0.375rem;
        border-radius: calc(var(--dsr-radius) * 0.375);
        border: 1px solid var(--dsr-border);
      }

      .content-prose :deep(pre) {
        background: var(--dsr-surface);
        padding: calc(var(--dsr-spacing-unit) * 1);
        border-radius: var(--dsr-radius);
        overflow-x: auto;
        border: 1px solid var(--dsr-border);
        margin: calc(var(--dsr-spacing-unit) * 1.5) 0;
      }

      .content-prose :deep(pre code) {
        background: none;
        padding: 0;
        border: none;
      }

      .content-prose :deep(blockquote) {
        border-left: 3px solid var(--dsr-accent);
        padding-left: calc(var(--dsr-spacing-unit) * 1);
        margin: calc(var(--dsr-spacing-unit) * 1.5) 0;
        font-style: italic;
        color: var(--dsr-secondary);
      }

      /* Technical Content */
      .technical-content :deep(pre) {
        background: #1e1e1e;
        color: #d4d4d4;
        border: none;
      }

      .technical-content :deep(code) {
        color: #d4d4d4;
      }

      /* Image Gallery */
      .image-gallery {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: calc(var(--dsr-spacing-unit) * 1.5);
        margin-top: calc(var(--dsr-spacing-unit) * 1.5);
      }

      .gallery-item {
        margin: 0;
        aspect-ratio: 16 / 10;
        border-radius: var(--dsr-radius);
        overflow: hidden;
        background: var(--dsr-surface);
        border: 1px solid var(--dsr-border);
      }

      .gallery-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform 0.3s ease;
      }

      .gallery-item:hover .gallery-image {
        transform: scale(1.05);
      }

      /* Inspirations */
      .inspirations-section {
        background: var(--dsr-surface);
        border-radius: var(--dsr-radius);
        padding: calc(var(--dsr-spacing-unit) * 2);
        border: 1px solid var(--dsr-border);
      }

      .inspiration-tags {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--dsr-spacing-unit) * 0.5);
      }

      .inspiration-tag {
        display: inline-block;
        padding: calc(var(--dsr-spacing-unit) * 0.375)
          calc(var(--dsr-spacing-unit) * 0.75);
        background: var(--dsr-background);
        border: 1px solid var(--dsr-border);
        border-radius: calc(var(--dsr-radius) * 0.5);
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--dsr-secondary);
      }

      .inspiration-tag:hover {
        border-color: var(--dsr-accent);
        color: var(--dsr-accent);
      }

      /* Theme Visualizer */
      .theme-visualizer-section {
        background: var(--dsr-surface);
        border-radius: var(--dsr-radius);
        padding: calc(var(--dsr-spacing-unit) * 2);
        border: 1px solid var(--dsr-border);
      }

      .theme-visualizer-section .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 2px solid var(--dsr-border);
        margin-bottom: calc(var(--dsr-spacing-unit) * 2);
        padding-bottom: calc(var(--dsr-spacing-unit) * 1);
      }

      .theme-preview {
        padding: calc(var(--dsr-spacing-unit) * 2);
        background: var(--background);
        color: var(--foreground);
        border-radius: var(--dsr-radius);
        border: 2px solid var(--border);
      }

      .preview-container {
        display: flex;
        flex-direction: column;
        gap: calc(var(--dsr-spacing-unit) * 4);
      }

      .preview-subtitle {
        border-bottom: var(--boxel-border);
        margin-bottom: calc(var(--dsr-spacing-unit) * 2);
      }

      /* Color Swatches */
      .color-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: calc(var(--dsr-spacing-unit) * 1);
      }

      .color-swatch {
        --swatch-height: 3.75rem;
        display: flex;
        flex-direction: column;
        gap: calc(var(--dsr-spacing-unit) * 0.5);
        color: var(--muted-foreground);
        font-size: var(--boxel-caption-font-size);
        text-align: center;
      }

      .color-swatch :deep(.boxel-swatch-preview) {
        order: -1;
        box-shadow: var(--shadow-sm);
      }

      /* Component Samples */
      .component-samples {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--dsr-spacing-unit) * 1);
        align-items: flex-start;
      }

      .sample-card {
        flex: 1 1 300px;
        padding: calc(var(--dsr-spacing-unit) * 1.5);
        background: var(--card, var(--boxel-light));
        color: var(--card-foreground, var(--boxel-dark));
      }

      .card-title {
        margin-bottom: var(--dsr-spacing-unit);
      }

      /* Chart Swatches */
      .chart-swatches {
        display: flex;
        gap: calc(var(--dsr-spacing-unit) * 0.5);
        flex-wrap: wrap;
      }

      .chart-swatch {
        --swatch-height: 5rem;
        flex: 1;
        transition: transform 0.2s ease;
      }

      .chart-swatch:hover {
        transform: translateY(-4px);
      }

      /* Shadow Samples */
      .shadow-samples {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
        gap: calc(var(--dsr-spacing-unit) * 2);
      }

      .shadow-box {
        height: 5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--card, var(--boxel-light));
        color: var(--card-foreground, var(--boxel-dark));
        border: 1px solid var(--border, var(--boxel-border-color));
        border-radius: var(--boxel-radius);
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
        .dsr-content {
          padding: calc(var(--dsr-spacing-unit) * 2) var(--dsr-spacing-unit);
        }

        .section-header {
          flex-direction: column;
          align-items: flex-start;
          gap: calc(var(--dsr-spacing-unit) * 0.5);
        }

        .section-title {
          font-size: 1.5rem;
        }

        .image-gallery {
          grid-template-columns: 1fr;
        }

        .theme-visualizer-section .section-header {
          flex-direction: column;
          align-items: stretch;
        }

        .color-grid {
          grid-template-columns: repeat(2, 1fr);
        }

        .shadow-samples {
          grid-template-columns: repeat(2, 1fr);
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

  static isolated = Isolated;
}
