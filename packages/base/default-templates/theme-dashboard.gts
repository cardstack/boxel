import { tracked } from '@glimmer/tracking';
import GlimmerComponent from '@glimmer/component';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import { modifier } from 'ember-modifier';

import ExternalLinkIcon from '@cardstack/boxel-icons/external-link';
import PaletteIcon from '@cardstack/boxel-icons/palette';
import Moon from '@cardstack/boxel-icons/moon';
import Sun from '@cardstack/boxel-icons/sun';
import ChevronCompactRight from '@cardstack/boxel-icons/chevron-compact-right';
import ChevronCompactLeft from '@cardstack/boxel-icons/chevron-compact-left';
import VersionIcon from '@cardstack/boxel-icons/book-text';

import {
  Button,
  CardContainer,
  BoxelContainer,
  FieldContainer,
  BoxelInput,
  Pill,
} from '@cardstack/boxel-ui/components';
import {
  and,
  bool,
  cn,
  eq,
  not,
  themeScope,
  themeScopedCss,
} from '@cardstack/boxel-ui/helpers';

import {
  DEFAULT_THEME_SCALE,
  FontPreviews,
} from '../structured-theme-variables';
import CardInfoTemplates from '../default-templates/card-info';

import type {
  BoxComponent,
  CardDef,
  FieldsTypeFor,
  PartialBaseInstanceType,
} from '../card-api';

function scrollToSection(sectionId: string, event: Event) {
  event.preventDefault();
  let navEl = event.currentTarget as HTMLElement;
  let card = navEl.closest('[data-theme-dashboard]');
  let section = card?.querySelector(
    `[id="${sectionId}"]`,
  ) as HTMLElement | null;
  if (!section) {
    return;
  }
  let scrollContainer = findScrollableParent(navEl);
  if (!scrollContainer) {
    return;
  }
  let stickyNavHeight = navEl.closest('nav')?.clientHeight ?? 0;
  let delta =
    section.getBoundingClientRect().top -
    scrollContainer.getBoundingClientRect().top -
    stickyNavHeight;
  scrollContainer.scrollBy({ top: delta, behavior: 'smooth' });
  // replaceState keeps the hash without polluting the host app's history
  history.replaceState(null, '', `#${sectionId}`);
}

function findScrollableParent(el: HTMLElement): HTMLElement | null {
  let parent = el.parentElement;
  while (parent && parent !== document.documentElement) {
    if (parent.scrollHeight > parent.clientHeight) {
      let { overflowY } = window.getComputedStyle(parent);
      if (overflowY === 'auto' || overflowY === 'scroll') {
        return parent;
      }
    }
    parent = parent.parentElement;
  }
  return null;
}

export interface SectionSignature {
  id: string;
  navTitle: string;
  title?: string /* long section header */;
  fieldName?: string | null /* optional field to render */;
}

export class ThemeImporter extends GlimmerComponent<{
  Args: {
    label?: string;
    placeholder?: string;
    setCss?: (content: string) => boolean | void;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}> {
  @tracked private draftCss = '';
  @tracked private error: string | undefined;

  defaultPlaceholder = `:root {
  --background: hsl(0 0% 100%);
  --foreground: oklch(0.52 0.13 144.17);
  --primary: #3e2723;
  /* ... */
}

.dark {
  --background: hsl(222.2 84% 4.9%);
  --foreground: hsl(37.50 36.36% 95.69%);
  --primary: rgb(46, 125, 50);
  /* ... */
}`;

  private get isDraftEmpty() {
    return !this.draftCss.trim().length;
  }

  private updateDraft = (value: string) => {
    this.draftCss = value;
    this.error = undefined;
  };

  private applyCss = () => {
    if (this.args.setCss?.(this.draftCss) === false) {
      this.error = 'No :root or .dark variables found in that CSS.';
    }
  };

  <template>
    <div class='css-field-editor-panel' ...attributes>
      <p class='css-field-editor-hint'>
        {{#if (has-block)}}
          {{yield}}
        {{else}}
          Paste a theme export (<a
            class='css-field-editor-hint-link'
            href='https://tweakcn.com'
            target='_blank'
            rel='noopener noreferrer'
          >tweakcn</a>,
          <a
            class='css-field-editor-hint-link'
            href='https://ui.shadcn.com/themes'
            target='_blank'
            rel='noopener noreferrer'
          >shadcn</a>, or any CSS with
          <code>:root</code>
          and
          <code>.dark</code>
          blocks). Its font families are imported alongside the variables.
        {{/if}}
      </p>
      <FieldContainer
        class='css-field-editor'
        @vertical={{true}}
        @label={{if @label.length @label 'Theme CSS'}}
        @tag='label'
      >
        <BoxelInput
          @type='textarea'
          @value={{this.draftCss}}
          @onInput={{this.updateDraft}}
          @placeholder={{if
            @placeholder.length
            @placeholder
            this.defaultPlaceholder
          }}
          class='css-textarea'
          data-test-custom-css-variables
        />
      </FieldContainer>
      {{#if this.error}}
        <p class='css-field-editor-error' role='alert'>{{this.error}}</p>
      {{/if}}
      <div class='css-field-editor-actions'>
        <Button
          @kind='primary'
          @size='small'
          @disabled={{this.isDraftEmpty}}
          {{on 'click' this.applyCss}}
          data-test-import-theme
        >
          Import Theme
        </Button>
      </div>
    </div>
    <style scoped>
      .css-field-editor-panel {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      .css-field-editor-hint {
        margin: 0;
        max-width: 45rem;
        color: var(--muted-foreground);
      }
      .css-field-editor-hint-link {
        color: inherit;
        text-decoration: underline;
      }
      .css-field-editor-hint-link:hover,
      .css-field-editor-hint-link:focus-visible {
        color: var(--primary);
      }
      .css-field-editor {
        gap: var(--boxel-sp);
      }
      .css-textarea {
        min-height: 15rem;
        font-size: var(--boxel-font-size-xs);
        font-family: var(
          --font-mono,
          var(--boxel-monospace-font-family, monospace)
        );
      }
      .css-textarea::placeholder {
        opacity: 0.5;
      }
      .css-field-editor-error {
        margin: 0;
        color: var(--destructive, var(--boxel-error-200));
      }
      .css-field-editor-actions {
        display: flex;
        justify-content: flex-end;
      }
    </style>
  </template>
}

export class CardContainerCss extends GlimmerComponent<{
  Args: {
    cssVariables: string;
  };
  Element: HTMLElement;
}> {
  @tracked private cardElement: Element | null = null;

  private captureElement = modifier((el: Element) => {
    this.cardElement = el;
    return () => {
      this.cardElement = null;
    };
  });

  private get currentScale(): string {
    void this.args.cssVariables;
    let el = this.cardElement;
    if (!el) return DEFAULT_THEME_SCALE;
    return (
      getComputedStyle(el).getPropertyValue('--theme-scale').trim() ||
      DEFAULT_THEME_SCALE
    );
  }

  private get currentFontSize(): string {
    void this.args.cssVariables;
    let el = this.cardElement;
    if (!el) return '16px';
    return (
      getComputedStyle(el).getPropertyValue('--boxel-font-size').trim() ||
      '16px'
    );
  }

  private get currentSpacing(): string {
    void this.args.cssVariables;
    let el = this.cardElement;
    if (!el) return '0.25rem';
    return getComputedStyle(el).getPropertyValue('--boxel-sp').trim() || '1rem';
  }

  private collectBoxelVars(
    prefixes: string[],
    opts?: {
      blocklist?: Set<string>;
      excludePrefixes?: string[];
      resolveValues?: boolean;
    },
  ): string {
    let el = this.cardElement;
    if (!el) {
      return '';
    }
    let style = getComputedStyle(el);
    let vars = new Map<string, string>();
    for (let sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (let rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule) {
          for (let prop of Array.from(rule.style)) {
            if (opts?.blocklist?.has(prop)) {
              continue;
            }
            if (opts?.excludePrefixes?.some((p) => prop.startsWith(p))) {
              continue;
            }
            if (prefixes.some((p) => prop.startsWith(p))) {
              vars.set(prop, rule.style.getPropertyValue(prop).trim());
            }
          }
        }
      }
    }
    let entries: Array<{ name: string; value: string; numericValue: number }> =
      [];
    if (opts?.resolveValues) {
      let probe = document.createElement('div');
      probe.style.cssText =
        'position:absolute;visibility:hidden;pointer-events:none';
      el.appendChild(probe);
      for (let [name] of vars.entries()) {
        probe.style.setProperty('width', `var(${name})`);
        let value = getComputedStyle(probe).width;
        probe.style.removeProperty('width');
        if (value) {
          let numericValue = parseFloat(value);
          let unit = value.replace(String(numericValue), '').trim();
          let rounded = parseFloat(numericValue.toFixed(2));
          entries.push({
            name,
            value: `${rounded}${unit}`,
            numericValue: rounded,
          });
        }
      }
      probe.remove();
      entries.sort((a, b) => a.numericValue - b.numericValue);
    } else {
      for (let [name] of Array.from(vars.entries()).sort()) {
        let value = style.getPropertyValue(name).trim();
        if (value) {
          entries.push({ name, value, numericValue: 0 });
        }
      }
    }
    return entries.map(({ name, value }) => `${name}: ${value};`).join('\n');
  }

  get typographyVarsString(): string {
    void this.args.cssVariables;
    return this.collectBoxelVars([
      '--boxel-body',
      '--boxel-heading',
      '--boxel-subheading',
      '--boxel-section-heading',
      '--boxel-caption',
    ]);
  }

  get spacingVarsString(): string {
    void this.args.cssVariables;
    return this.collectBoxelVars(['--boxel-sp'], {
      blocklist: new Set([
        '--boxel-spacing',
        '--boxel-sp-xxl',
        '--boxel-sp-xxs',
        '--boxel-sp-xxxl',
        '--boxel-sp-xxxs',
      ]),
      excludePrefixes: ['--boxel-spec'],
      resolveValues: true,
    });
  }

  get borderRadiusVarsString(): string {
    void this.args.cssVariables;
    return this.collectBoxelVars(['--boxel-border-radius'], {
      blocklist: new Set([
        '--boxel-border-radius-xxs',
        '--boxel-border-radius-xxl',
      ]),
      resolveValues: true,
    });
  }

  get fontSizeVarsString(): string {
    void this.args.cssVariables;
    return this.collectBoxelVars(['--boxel-font-size'], {
      resolveValues: true,
    });
  }

  get fontScaleVarsString(): string {
    void this.args.cssVariables;
    return this.collectBoxelVars(['--boxel-fs'], { resolveValues: true });
  }

  <template>
    <div {{this.captureElement}} ...attributes>
      <p class='card-container-description'>
        When a theme is set, the card container applies your theme variables to
        set its background, font color, border-radius, typography and spacing
        scale. Typography settings are optional — Boxel defaults are used when
        not overridden. All theme variables are mapped to
        <code>--boxel-*</code>
        internals with Boxel defaults as fallbacks.
      </p>
      <div class='card-container-mappings'>
        <div class='card-container-mapping-group'>
          <h4>Layout</h4>
          <dl>
            <dt><code>--background</code></dt><dd>background-color</dd>
            <dt><code>--foreground</code></dt><dd>color</dd>
            <dt><code>--border</code></dt><dd>border color (when boundaries
              shown)</dd>
            <dt><code>--radius</code></dt><dd>base border-radius (all steps,
              base default: 0.625rem [10px])</dd>
            <dt><code>--spacing * 4</code></dt><dd>base spacing (all steps, base
              default: 0.25rem * 4 = 1rem [16px])</dd>
            <dt><code>--theme-font-size</code></dt><dd>base font-size (all
              steps, default 1rem [16px])</dd>
            <dt><code>--theme-scale</code></dt><dd>type and spacing scale ratio
              (default 1.333)</dd>
            <dt><code>--font-sans</code></dt><dd>font-family (default: IBM Plex
              Sans, sans-serif)</dd>
          </dl>
        </div>
        <div class='card-container-mapping-group'>
          <h4>Layering Pairs</h4>
          <p class='card-container-mapping-note'>Use these pairs on nested
            containers to differentiate visual layers without repeating colors.</p>
          <dl>
            <dt><code>--background</code></dt><dd><code>--foreground</code></dd>
            <dt><code>--card</code></dt><dd><code>--card-foreground</code></dd>
            <dt><code>--sidebar</code></dt><dd><code
              >--sidebar-foreground</code></dd>
            <dt><code>--popover</code></dt><dd><code
              >--popover-foreground</code></dd>
          </dl>
        </div>
        <div class='card-container-mapping-group'>
          <h4>Typography <em>(optional overrides)</em></h4>
          <dl>
            <dt><code>--boxel-heading-*</code></dt><dd>h1</dd>
            <dt><code>--boxel-section-heading-*</code></dt><dd>h2</dd>
            <dt><code>--boxel-subheading-*</code></dt><dd>h3</dd>
            <dt><code>--boxel-body-*</code></dt><dd>p</dd>
            <dt><code>--boxel-caption-*</code></dt><dd>small</dd>
          </dl>
        </div>
      </div>
      <h3 class='computed-vars-heading'>Computed CSS Variables</h3>
      <div class='computed-vars-section'>
        <div class='computed-vars-group'>
          <h4>Spacing</h4>
          <p class='computed-vars-description'>Each step is scaled by
            <strong><code>--theme-scale</code></strong>
            (currently
            <strong>{{this.currentScale}}</strong>) from the base
            <strong><code>--spacing</code></strong>
            * 4 =
            <strong><code>--boxel-sp</code></strong>
            (currently
            <strong>{{this.currentSpacing}}</strong>). Steps above the base
            multiply by the ratio; steps below divide.</p>
          {{#if this.spacingVarsString}}
            <pre class='computed-vars-pre'>{{this.spacingVarsString}}</pre>
          {{/if}}
        </div>
        <div class='computed-vars-group'>
          <h4>Font Size</h4>
          <p class='computed-vars-description'><strong><code
              >--boxel-font-size</code></strong>
            is set by
            <strong><code>--theme-font-size</code></strong>
            (currently
            <strong>{{this.currentFontSize}}</strong>).</p>

          <p class='computed-vars-description'><strong><code
              >--boxel-font-size-*</code></strong>
            use fixed multipliers from that base (2xs 0.6875×, xs 0.75×, sm
            0.875×, md 1.25×, lg 1.375×, xl 2×, 2xl 2.25×).</p>
          {{#if this.fontSizeVarsString}}
            <pre class='computed-vars-pre'>{{this.fontSizeVarsString}}</pre>
          {{/if}}
          <p class='computed-vars-description'><strong><code
              >--boxel-fs</code></strong>
            aliases the base, and
            <strong><code>--boxel-fs-*</code></strong>
            use a ratio scale driven by
            <strong><code>--theme-scale</code></strong>
            (currently
            <strong>{{this.currentScale}}</strong>).</p>
          {{#if this.fontScaleVarsString}}
            <pre class='computed-vars-pre'>{{this.fontScaleVarsString}}</pre>
          {{/if}}
        </div>
        <div class='computed-vars-group'>
          <h4>Border Radius</h4>
          <p class='computed-vars-description'><strong><code
              >--boxel-border-radius</code></strong>
            equals the
            <strong><code>--radius</code></strong>
            theme variable. All other steps are derived from it by adding or
            subtracting fixed pixel offsets.</p>
          {{#if this.borderRadiusVarsString}}
            <pre class='computed-vars-pre'>{{this.borderRadiusVarsString}}</pre>
          {{/if}}
        </div>
      </div>
    </div>
    <style scoped>
      .card-container-description {
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground);
        margin-block: 0 var(--boxel-sp-lg);
      }
      .card-container-description code,
      .card-container-mappings code {
        font-family: var(
          --font-mono,
          var(--boxel-monospace-font-family, monospace)
        );
        font-size: 0.9em;
      }
      .card-container-mappings {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
        gap: var(--boxel-sp-lg);
        margin-bottom: var(--boxel-sp-lg);
      }
      .card-container-mapping-group {
        background-color: var(--card);
        color: var(--card-foreground);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp);
      }
      .card-container-mapping-group h4 {
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--muted-foreground);
        margin-bottom: var(--boxel-sp-xs);
      }
      .card-container-mapping-group dl {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--boxel-sp-4xs) var(--boxel-sp-sm);
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        align-items: baseline;
      }
      .card-container-mapping-note {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        margin-bottom: var(--boxel-sp-xs);
      }
      .card-container-mapping-group dt {
        font-weight: 500;
      }
      .card-container-mapping-group dd {
        margin: 0;
        color: var(--muted-foreground);
      }
      .computed-vars-heading {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--muted-foreground);
        margin-block: var(--boxel-sp-lg) var(--boxel-sp-sm);
        padding-top: var(--boxel-sp-lg);
        border-top: 1px solid var(--border);
      }
      .computed-vars-section {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
        gap: var(--boxel-sp-lg);
      }
      .computed-vars-group {
        background-color: var(--card);
        color: var(--card-foreground);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: var(--boxel-sp);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .computed-vars-group h4 {
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--muted-foreground);
        margin: 0;
      }
      .computed-vars-description {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground);
      }
      .computed-vars-description code {
        font-family: var(
          --font-mono,
          var(--boxel-monospace-font-family, monospace)
        );
        font-size: 0.9em;
      }
      .computed-vars-pre {
        margin: 0;
        padding: var(--boxel-sp-xs) 0 0;
        font-family: var(
          --font-mono,
          var(--boxel-monospace-font-family, monospace)
        );
        font-size: var(--boxel-font-size-xs);
        white-space: pre-wrap;
        flex: 1;
      }
    </style>
  </template>
}

export class ResetButton extends GlimmerComponent<{
  Args: {
    label?: string;
    reset?: () => void;
  };
  Element: HTMLElement;
}> {
  noop = () => {};
  <template>
    <Button
      @kind='destructive'
      {{on 'click' (if @reset @reset this.noop)}}
      data-test-reset
      ...attributes
    >
      {{if @label.length @label 'Reset All Variables'}}
    </Button>
  </template>
}

export class NavSection extends GlimmerComponent<{
  Args: {
    id: string;
    number?: string;
    title: string;
    hideSectionCounter?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}> {
  <template>
    <section
      id={{@id}}
      class={{cn 'nav-section' nav-section--hide-counter=@hideSectionCounter}}
      ...attributes
    >
      <header class='nav-section-header'>
        {{#unless @hideSectionCounter}}
          {{#if @number}}
            <span class='nav-section-number'>{{@number}}</span>
          {{else}}
            <span class='nav-section-number' aria-hidden='true' />
          {{/if}}
        {{/unless}}
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
      @layer baseComponent {
        .nav-section {
          scroll-margin-top: calc(var(--boxel-sp) * 4);
        }
        .nav-section:not(.nav-section--hide-counter) {
          counter-increment: section;
        }
        /* Section Headers */
        .nav-section-header {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp);
          padding-bottom: var(--boxel-sp);
          border-bottom: 2px solid var(--border);
        }
        .nav-section-number {
          display: inline-block;
          font-size: var(--boxel-font-size-sm);
          font-weight: 700;
          color: var(--muted-foreground);
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

        .nav-section-content {
          padding-block: calc(var(--boxel-sp) * 2);
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
      }
    </style>
  </template>

  @action
  private scrollToTop(event: Event) {
    event.preventDefault();
    let scrollContainer = findScrollableParent(
      event.currentTarget as HTMLElement,
    );
    scrollContainer?.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

export class NavBar extends GlimmerComponent<{
  Args: {
    sections?: SectionSignature[];
  };
  Element: HTMLElement;
}> {
  @tracked private canScrollLeft = false;
  @tracked private canScrollRight = false;

  private navGrid: HTMLElement | null = null;

  private get hasOverflow() {
    return this.canScrollLeft || this.canScrollRight;
  }

  private trackOverflow = modifier((el: HTMLElement) => {
    this.navGrid = el;
    let update = () => this.updateScrollState(el);
    el.addEventListener('scroll', update, { passive: true });
    let observer = new ResizeObserver(update);
    observer.observe(el);
    update();
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
      this.navGrid = null;
    };
  });

  private updateScrollState(el: HTMLElement) {
    let maxScrollLeft = el.scrollWidth - el.clientWidth;
    let scrollLeft = Math.abs(el.scrollLeft);
    this.canScrollLeft = scrollLeft > 1;
    this.canScrollRight = scrollLeft < maxScrollLeft - 1;
  }

  <template>
    <nav class='dsr-nav' aria-label='Sections' ...attributes>
      {{#if this.hasOverflow}}
        <button
          type='button'
          class='nav-scroll nav-scroll--left'
          aria-label='Scroll navigation left'
          disabled={{not this.canScrollLeft}}
          {{on 'click' (fn this.scrollTo 'left')}}
        >
          <ChevronCompactLeft />
        </button>
      {{/if}}
      <div class={{cn 'nav-container' has-overflow=this.hasOverflow}}>
        <ul class='nav-grid' {{this.trackOverflow}}>
          {{#each @sections as |section|}}
            <li>
              <Button
                @as='anchor'
                @href='#{{section.id}}'
                @kind='link-muted'
                class='nav-item'
                {{on 'click' (fn scrollToSection section.id)}}
              >{{section.navTitle}}</Button>
            </li>
          {{/each}}
        </ul>
      </div>
      {{#if this.hasOverflow}}
        <button
          type='button'
          class='nav-scroll nav-scroll--right'
          aria-label='Scroll navigation right'
          disabled={{not this.canScrollRight}}
          {{on 'click' (fn this.scrollTo 'right')}}
        >
          <ChevronCompactRight />
        </button>
      {{/if}}
    </nav>
    <style scoped>
      /* Navigation */
      .dsr-nav {
        position: sticky;
        top: 0;
        border-bottom: 1px solid var(--border);
        z-index: 10;
        background: color-mix(in oklch, var(--background) 80%, transparent);
        backdrop-filter: blur(8px);
        display: flex;
        align-items: stretch;
      }
      .nav-grid {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        gap: var(--boxel-sp-xs);
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
        white-space: nowrap;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      }
      .nav-scroll {
        flex-shrink: 0;
        border: none;
        background: none;
        color: var(--muted-foreground);
        width: 2.25rem;
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
      .nav-scroll:hover:not(:disabled),
      .nav-scroll:focus-visible {
        color: var(--foreground);
        background: color-mix(in oklch, var(--foreground) 10%, transparent);
      }
      .nav-scroll:focus-visible {
        outline: 2px solid var(--ring, var(--boxel-highlight));
      }
      .nav-scroll:disabled {
        opacity: 0.2;
        cursor: default;
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
      .nav-container.has-overflow::before,
      .nav-container.has-overflow::after {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        width: 1rem;
        pointer-events: none;
        z-index: 1;
      }
      .nav-container.has-overflow::before {
        left: 0;
        background: linear-gradient(
          to right,
          var(--background) 5%,
          transparent
        );
      }
      .nav-container.has-overflow::after {
        right: 0;
        background: linear-gradient(to left, var(--background) 5%, transparent);
      }

      @container (width <= 768px) {
        .dsr-nav {
          padding-block: var(--boxel-sp);
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
    let navGrid = this.navGrid;
    if (!navGrid) {
      return;
    }
    let offset =
      direction === 'left'
        ? -navGrid.clientWidth * 0.8
        : navGrid.clientWidth * 0.8;
    navGrid.scrollBy({ left: offset, behavior: 'smooth' });
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
      data-test-mode={{if @isDarkMode 'toggle-light' 'toggle-dark'}}
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
    mode?: 'isolated' | 'edit';
    title?: string;
    description?: string;
    metaLabel?: string;
    // the version field lives on StructuredTheme, not CardDef, and this
    // template can't import the card without a cycle
    fields?: FieldsTypeFor<CardDef> & { version: BoxComponent };
    model?: PartialBaseInstanceType<typeof CardDef>;
    version?: string;
  };
  Element: HTMLElement;
  Blocks: { meta: []; default: [] };
}> {
  // CardInfoTemplates.edit insists on a strict `CardDef` for `@model`; the
  // partial model card templates pass in only exercises the loose shape, so
  // cast here rather than in every caller
  private get cardInfoModel(): CardDef {
    return this.args.model as unknown as CardDef;
  }

  <template>
    <header
      class='theme-dashboard-header {{if @mode @mode "isolated"}}'
      ...attributes
    >
      {{#if (and (eq @mode 'edit') (bool @model) (bool @fields))}}
        <CardInfoTemplates.edit
          @fields={{@fields}}
          @model={{this.cardInfoModel}}
          @hideThemeChooser={{true}}
        />
        <FieldContainer
          class='theme-dashboard-version-edit-field'
          @icon={{VersionIcon}}
          @label='Version No'
          @tag='label'
        >
          <@fields.version />
        </FieldContainer>
      {{else}}
        {{#if (has-block 'meta')}}
          {{yield to='meta'}}
        {{else}}
          <div class='theme-dashboard-header-meta'>
            <span class='theme-dashboard-header-meta-label'>
              {{if @metaLabel @metaLabel 'Style Guide'}}
            </span>
            <span class='theme-dashboard-header-meta-version'>
              Version
              {{if @version @version '1.0'}}
            </span>
          </div>
        {{/if}}
        <h1 class='theme-dashboard-header-title'>{{@title}}</h1>
        {{#if @description}}
          <p class='theme-dashboard-header-tagline'>{{@description}}</p>
        {{/if}}
      {{/if}}
      {{yield}}
    </header>
    <style scoped>
      @layer baseComponent {
        .theme-dashboard-header {
          border-bottom: 1px solid var(--border);
          background-color: var(--muted);
          color: var(--muted-foreground);
          text-wrap: pretty;
        }
        .isolated {
          padding: calc(var(--boxel-sp) * 3) calc(var(--boxel-sp) * 2);
        }
        .edit {
          padding: var(--boxel-sp-xl);
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
          color: var(--foreground);
        }
        .theme-dashboard-header-tagline {
          max-width: 48rem;
        }
        .theme-dashboard-version-edit-field {
          margin-top: var(--boxel-sp);
        }
      }
    </style>
  </template>
}

// Shown in a dashboard's body while the card has no theme CSS yet
export class ThemeDashboardEmptyState extends GlimmerComponent<{
  Args: {
    message?: string;
  };
  Element: HTMLElement;
}> {
  <template>
    <div
      class='dashboard-empty-state'
      ...attributes
      data-test-dashboard-empty-state
    >
      <PaletteIcon
        class='dashboard-empty-state-icon'
        width='48'
        height='48'
        aria-hidden='true'
      />
      <h2 class='dashboard-empty-state-title'>No theme yet</h2>
      <p class='dashboard-empty-state-message'>
        {{#if @message}}
          {{@message}}
        {{else}}
          Switch to edit mode to import a theme or build one field by field.
        {{/if}}
      </p>
    </div>
    <style scoped>
      @layer baseComponent {
        .dashboard-empty-state {
          /* fills the grown content area so the footer below stays pinned
             to the bottom of the card; the message itself stays at the top */
          flex-grow: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xl) calc(var(--boxel-sp) * 2);
          text-align: center;
          text-wrap: pretty;
          color: var(--muted-foreground);
        }
        .dashboard-empty-state-icon {
          flex-shrink: 0;
        }
        .dashboard-empty-state-title {
          margin: 0;
          color: var(--foreground);
          font-size: var(--boxel-font-size);
        }
        .dashboard-empty-state-message {
          margin: 0;
          max-width: 30rem;
          text-wrap: balance;
        }
      }
    </style>
  </template>
}

// Pill samples for the semantic color roles (default, primary, secondary,
// accent, muted, destructive) rendered with the ambient theme tokens. Shared
// by the theme visualizer and the brand guide's UI component samples.
export class PreviewPills extends GlimmerComponent<{
  Element: HTMLElement;
}> {
  <template>
    <div class='preview-pills' ...attributes>
      <Pill data-test-pill-preview='default'>Default</Pill>
      <Pill @variant='primary' data-test-pill-preview='primary'>
        Primary
      </Pill>
      <Pill @variant='secondary' data-test-pill-preview='secondary'>
        Secondary
      </Pill>
      <Pill @variant='accent' data-test-pill-preview='accent'>
        Accent
      </Pill>
      <Pill @variant='muted' data-test-pill-preview='muted'>
        Muted
      </Pill>
      <Pill @variant='destructive' data-test-pill-preview='destructive'>
        Destructive
      </Pill>
    </div>
    <style scoped>
      @layer baseComponent {
        .preview-pills {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
        }
      }
    </style>
  </template>
}

export class ThemeVisualizer extends GlimmerComponent<{
  Args: {
    toggleDarkMode?: () => void;
    isDarkMode?: boolean;
    fontStack?: { label: string; stack?: string }[];
    cssImports?: string[] | null;
    editMode?: boolean;
  };
  Blocks: { colorPalette: []; cssImports: []; typography: [] };
  Element: HTMLElement;
}> {
  private get hasNoImports() {
    return !this.args.cssImports?.length;
  }

  private get showFontsSection() {
    return Boolean(this.args.fontStack?.length || this.hasNoImports);
  }

  <template>
    <section class='dsr-theme-visualizer' ...attributes>
      <div class='dsr-theme-visualizer-header'>
        <h2>Theme Visualizer</h2>
        {{#if @toggleDarkMode}}
          <ModeToggle
            @toggleDarkMode={{@toggleDarkMode}}
            @isDarkMode={{bool @isDarkMode}}
          />
        {{/if}}
      </div>
      <div class='structured-theme-visualizer'>
        {{#if (has-block 'colorPalette')}}
          <div>
            <h3 class='structured-theme-visualizer-subtitle'>Color System</h3>
            <PreviewPills class='visualizer-preview-pills' />
            {{yield to='colorPalette'}}
          </div>
        {{/if}}
        {{#if @editMode}}
          {{yield to='cssImports'}}
        {{else if this.showFontsSection}}
          <div data-test-font-imports-section>
            <h3 class='structured-theme-visualizer-subtitle'>Fonts</h3>
            <FontPreviews @fontStack={{@fontStack}} />
            {{#if @cssImports.length}}
              <FieldContainer
                class='css-imports-preview'
                @label='CSS Imports'
                @vertical={{true}}
              >
                <ul class='font-import-links'>
                  {{#each @cssImports as |importUrl|}}
                    <li>
                      <a
                        class='font-import-link'
                        href={{importUrl}}
                        target='_blank'
                        rel='noopener noreferrer'
                      >
                        <ExternalLinkIcon
                          class='font-import-link-icon'
                          width='14'
                          height='14'
                          aria-hidden='true'
                        />
                        {{importUrl}}
                      </a>
                    </li>
                  {{/each}}
                </ul>
              </FieldContainer>
            {{else if this.hasNoImports}}
              <p class='font-import-empty'><em>No web fonts referenced.</em></p>
            {{/if}}
          </div>
        {{/if}}
        {{#if (has-block 'typography')}}
          <div>
            <h3 class='structured-theme-visualizer-subtitle'>Typography</h3>
            {{yield to='typography'}}
          </div>
        {{/if}}
        {{#unless @editMode}}
          <div>
            <h3 class='structured-theme-visualizer-subtitle'>Components</h3>
            <div class='structured-theme-component-samples'>
              <Button
                @size='small'
                @rectangular={{true}}
                data-test-action-sample='default'
              >
                Default Action
              </Button>
              <Button
                @kind='primary'
                @size='small'
                @rectangular={{true}}
                data-test-action-sample='primary'
              >
                Primary Action
              </Button>
              <Button
                @kind='secondary'
                @size='small'
                @rectangular={{true}}
                data-test-action-sample='secondary'
              >
                Secondary Action
              </Button>
              <CardContainer
                @displayBoundaries={{true}}
                class='structured-theme-component-sample-card'
              >
                <BoxelContainer @display='grid'>
                  <h3>Sample Card</h3>
                  <p>
                    Card component showcasing background, borders, and shadows
                    from the theme system.
                  </p>
                </BoxelContainer>
              </CardContainer>
            </div>
          </div>
        {{/unless}}
      </div>
    </section>

    <style scoped>
      @layer baseComponent {
        .dsr-theme-visualizer {
          background-color: var(--card);
          color: var(--card-foreground);
          border-radius: var(--radius);
          padding: calc(var(--boxel-sp) * 2);
          border: 1px solid var(--border);
        }
        .dsr-theme-visualizer + :deep(*) {
          margin-top: calc(var(--boxel-sp) * 2);
        }
        .dsr-theme-visualizer-header {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          align-items: center;
          gap: var(--boxel-sp-xs);
          margin-bottom: calc(var(--boxel-sp) * 2);
          padding-bottom: var(--boxel-sp);
          border-bottom: 2px solid var(--border);
        }
        .structured-theme-visualizer {
          display: flex;
          flex-direction: column;
          gap: calc(var(--boxel-sp) * 4);
          background-color: var(--background);
          color: var(--foreground);
          border-radius: var(--radius);
          padding: calc(var(--boxel-sp) * 2);
          border: 2px solid var(--border);
        }
        .structured-theme-visualizer-subtitle {
          border-bottom: var(--boxel-border);
          margin-bottom: calc(var(--boxel-sp) * 2);
        }
        .structured-theme-component-samples {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp);
          align-items: flex-start;
        }
        .visualizer-preview-pills {
          margin-bottom: var(--boxel-sp);
        }
      }
      .structured-theme-component-sample-card {
        background-color: var(--card);
        color: var(--card-foreground);
      }
      .css-imports-preview {
        margin-top: var(--boxel-sp-xl);
      }
      .font-import-links {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-2xs);
      }
      .font-import-link {
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-2xs);
        padding: var(--boxel-sp-2xs) var(--boxel-sp-xs);
        background-color: var(--muted);
        color: var(--muted-foreground);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius-sm);
        font-family: var(--font-mono);
        font-size: var(--boxel-font-size-xs);
        text-decoration: none;
        overflow-wrap: anywhere;
      }
      .font-import-link:hover,
      .font-import-link:focus-visible {
        text-decoration: underline;
      }
      .font-import-link-icon {
        flex-shrink: 0;
        align-self: center;
      }
      .font-import-empty {
        margin: var(--boxel-sp) 0 0;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export class ThemeDashboard extends GlimmerComponent<{
  Args: {
    title?: string;
    description?: string;
    sections?: SectionSignature[];
    headerLabel?: string;
    version?: string;
    isDarkMode?: boolean;
    themeCss?: string | null;
    themeId?: string | null;
  };
  Blocks: { default: []; header: []; navBar: [] };
  Element: HTMLElement;
}> {
  // Content-derived rather than guidFor: this markup can be persisted as
  // prerendered HTML, where the scoped rules are page-global. Equal scopes
  // are only safe when their declarations are equal too, which the theme id
  // plus content hash guarantees; a per-process guid can repeat across
  // prerender jobs with different themes. The guid fallback only covers
  // unsaved theme cards previewing their own CSS, which are never persisted.
  private get themeScopeId() {
    return themeScope(this.args.themeId, this.args.themeCss) ?? guidFor(this);
  }

  // The data-theme wrapper drives the preview's light/dark toggle through the
  // ambient `--boxel-color-scheme` signal, flipping the semantic tokens to the
  // boxel dark defaults for this subtree. The theme's own variables must be
  // re-scoped inside the wrapper (via `data-boxel-theme-scope` + the style
  // tag) because the card-level scope sits above it and resolves against the
  // app chrome's scheme, not this toggle.
  <template>
    <div
      class='theme-dashboard-scheme'
      data-theme={{if @isDarkMode 'dark' 'light'}}
    >
      <article
        id='top'
        class='detailed-style-reference'
        data-theme-dashboard
        data-boxel-theme-scope={{if @themeCss this.themeScopeId}}
        ...attributes
      >
        {{#if @themeCss}}
          {{! template-lint-disable require-scoped-style }}
          {{! data-boxel-theme-style marks this as a dedupable theme
              stylesheet; the attribute survives serialization, so prerendered
              fragments stay recognizable when re-inserted }}
          <style data-boxel-theme-style>
            {{themeScopedCss this.themeScopeId @themeCss}}
          </style>
          {{! template-lint-enable require-scoped-style }}
        {{/if}}
        {{#if (has-block 'header')}}
          {{yield to='header'}}
        {{/if}}

        {{#if (has-block 'navBar')}}
          {{yield to='navBar'}}
        {{else if @sections.length}}
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
    </div>

    <style scoped>
      @layer baseComponent {
        .theme-dashboard-scheme {
          height: 100%;
        }
        .detailed-style-reference {
          display: flex;
          flex-direction: column;
          height: 100%;
          background-color: var(--background);
          color: var(--foreground);
          overflow-y: auto;
          /* containment context for the NavBar's container queries, so
             responsive rules key off the card's width, not the viewport */
          container-type: inline-size;
        }

        .dsr-header :deep(h1) {
          font-size: var(--boxel-heading-font-size);
        }
        .dsr-header :deep(p) {
          font-size: var(--boxel-body-font-size);
        }

        /* Content */
        .dsr-content {
          /* fills the space above the footer so it stays pinned to the
             bottom of the card when the body is short */
          flex-grow: 1;
          display: flex;
          flex-direction: column;
          width: 100%;
          max-width: 56rem;
          margin: 0 auto;
          padding: calc(var(--boxel-sp) * 3) calc(var(--boxel-sp) * 2);
          counter-reset: section;
        }

        /* Footer */
        .dsr-footer {
          border-top: 1px solid var(--border);
          padding: calc(var(--boxel-sp) * 2);
          background-color: var(--muted);
          color: var(--muted-foreground);
        }
        .footer-content {
          max-width: 56rem;
          margin: 0 auto;
          text-align: center;
        }
        .footer-text {
          font-style: italic;
          font-size: var(--boxel-font-size-xs);
          text-wrap: pretty;
        }

        /* Responsive */
        @media (max-width: 768px) {
          .dsr-header {
            padding: calc(var(--boxel-sp) * 2) var(--boxel-sp);
          }
          .dsr-content {
            padding: calc(var(--boxel-sp) * 2) var(--boxel-sp);
          }
        }
      }
    </style>
  </template>
}
