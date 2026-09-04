import { tracked } from '@glimmer/tracking';
import GlimmerComponent from '@glimmer/component';
import { concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import { modifier } from 'ember-modifier';

import ExternalLinkIcon from '@cardstack/boxel-icons/external-link';
import PaletteIcon from '@cardstack/boxel-icons/palette';
import Moon from '@cardstack/boxel-icons/moon';
import Sun from '@cardstack/boxel-icons/sun';
import MenuIcon from '@cardstack/boxel-icons/menu';
import VersionIcon from '@cardstack/boxel-icons/book-text';

import {
  BoxelDropdown,
  Button,
  CardContainer,
  BoxelContainer,
  ContextButton,
  FieldContainer,
  BoxelInput,
  Menu as BoxelMenu,
  Pill,
  ProgressBar,
  Switch,
  CopyButton,
  BoxelSelect,
} from '@cardstack/boxel-ui/components';
import {
  and,
  bool,
  cn,
  eq,
  MenuItem,
  sanitizeHtmlSafe,
  themeScope,
  themeScopedCss,
} from '@cardstack/boxel-ui/helpers';

import {
  DEFAULT_THEME_SCALE,
  FontPreviews,
  TokenPill,
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
  scrollToSectionFrom(event.currentTarget as HTMLElement, sectionId);
}

function scrollToSectionFrom(navEl: HTMLElement, sectionId: string) {
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
      @layer baseComponent {
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
      }
    </style>
  </template>
}

export class CardContainerCss extends GlimmerComponent<{
  Args: {
    cssVariables: string;
    isDarkMode?: boolean;
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
      '--boxel-ui-label',
      '--boxel-eyebrow',
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
      <ThemeRecipe
        @cssVariables={{@cssVariables}}
        @isDarkMode={{@isDarkMode}}
      />
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
        <div class='card-container-mapping-group'>
          <h4>Typography <em>(optional overrides)</em></h4>
          <dl>
            <dt><code>--boxel-heading-*</code></dt><dd>h1</dd>
            <dt><code>--boxel-section-heading-*</code></dt><dd>h2</dd>
            <dt><code>--boxel-subheading-*</code></dt><dd>h3</dd>
            <dt><code>--boxel-body-*</code></dt><dd>p</dd>
            <dt><code>--boxel-caption-*</code></dt><dd>small</dd>
            <dt><code>--boxel-ui-label-*</code></dt><dd>UI labels, control text</dd>
            <dt><code>--boxel-eyebrow-*</code></dt><dd>kicker above a title</dd>
          </dl>
        </div>
      </div>
    </div>
    <style scoped>
      @layer baseComponent {
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
          /* min() lets the column shrink instead of overflowing a narrow card */
          grid-template-columns: repeat(
            auto-fill,
            minmax(min(18rem, 100%), 1fr)
          );
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
          overflow-x: auto;
          font-family: var(
            --font-mono,
            var(--boxel-monospace-font-family, monospace)
          );
          font-size: var(--boxel-font-size-xs);
          flex: 1;
        }
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
          scroll-margin-top: var(--boxel-sp-4xl);
          /* let wide children scroll or wrap instead of overflowing the card */
          min-width: 0;
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
          padding-block: var(--boxel-sp-xl);
        }

        @media (max-width: 768px) {
          .nav-section-header {
            flex-direction: column;
            align-items: flex-start;
            gap: var(--boxel-sp-xs);
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
    // affixes a dark-mode toggle to the right end of the bar
    toggleDarkMode?: () => void;
    isDarkMode?: boolean;
  };
  Element: HTMLElement;
}> {
  // items that don't fit move into the "more" dropdown; null means all fit
  @tracked private visibleCount: number | null = null;

  // at mobile widths the item strip becomes a hamburger menu
  @tracked private isCompact = false;

  private navElement: HTMLElement | null = null;
  private navList: HTMLElement | null = null;
  private navToggle: HTMLElement | null = null;

  // space kept free for the "more" trigger before items are dropped
  private moreButtonReserve = 40;

  private compactMaxWidth = 400;

  private get hasOverflowMenu() {
    return this.visibleCount !== null;
  }

  private toMenuItem = (section: SectionSignature) =>
    new MenuItem({
      label: section.navTitle,
      action: () => this.scrollFromMenu(section.id),
    });

  private get overflowMenuItems() {
    let sections = this.args.sections ?? [];
    if (this.visibleCount === null) {
      return [];
    }
    return sections.slice(this.visibleCount).map(this.toMenuItem);
  }

  private get allMenuItems() {
    return (this.args.sections ?? []).map(this.toMenuItem);
  }

  private isHidden = (index: number) =>
    this.visibleCount !== null && index >= this.visibleCount;

  private registerNav = modifier((el: HTMLElement) => {
    this.navElement = el;
    return () => {
      this.navElement = null;
    };
  });

  // the dropdown content is portaled outside the card, so the menu action
  // cannot walk up from its own element; scroll from the captured nav instead
  private scrollFromMenu = (sectionId: string) => {
    if (this.navElement) {
      scrollToSectionFrom(this.navElement, sectionId);
    }
  };

  private trackFit = modifier(
    (el: HTMLElement, [_sections]: [SectionSignature[] | undefined]) => {
      let update = () => this.updateVisibleCount(el);
      // the ResizeObserver's async first delivery is the initial measurement;
      // measuring synchronously here would cause a backtracking re-render
      let observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    },
  );

  // the container's observer has already fired by the time the strip
  // re-renders out of compact mode; observing the list re-measures it. the
  // list tracks its items' widths because overflowed items leave the flow and
  // at least one always stays in it, so a late-loading webfont or a per-mode
  // font swap resizes the list and re-measures
  private trackListFit = modifier((el: HTMLElement) => {
    this.navList = el;
    let update = () => this.updateVisibleCount(el.parentElement as HTMLElement);
    let observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      this.navList = null;
    };
  });

  private registerToggle = modifier((el: HTMLElement) => {
    this.navToggle = el;
    return () => {
      this.navToggle = null;
    };
  });

  // measures against the container, whose width is set from outside, so the
  // "more" button appearing cannot re-trigger the measurement. overflowed
  // items stay rendered (out of flow, not display:none) so widths stay
  // readable while contributing nothing to the list's own width
  private updateVisibleCount(container: HTMLElement) {
    this.isCompact = container.clientWidth <= this.compactMaxWidth;
    let list = this.navList;
    let items = list ? (Array.from(list.children) as HTMLElement[]) : [];
    if (!list || !items.length) {
      this.visibleCount = null;
      return;
    }
    let containerStyle = getComputedStyle(container);
    let available =
      container.clientWidth -
      parseFloat(containerStyle.paddingLeft) -
      parseFloat(containerStyle.paddingRight);
    if (this.navToggle) {
      // the toggle is a sibling flex item, so it costs the container's gap too
      available -=
        this.navToggle.offsetWidth +
        (parseFloat(containerStyle.columnGap) || 0);
    }
    let gap = parseFloat(getComputedStyle(list).columnGap) || 0;
    let widths = items.map((item) => item.offsetWidth);
    let total =
      widths.reduce((sum, width) => sum + width, 0) + gap * (items.length - 1);
    if (total <= available) {
      this.visibleCount = null;
      return;
    }
    available -= this.moreButtonReserve;
    let used = 0;
    let count = 0;
    for (let width of widths) {
      let next = used + (count > 0 ? gap : 0) + width;
      if (next > available) {
        break;
      }
      used = next;
      count++;
    }
    // the first item stays in the bar even when it has to ellipsize: it keeps
    // one item in flow, so the list's own box goes on tracking item widths,
    // and an empty strip beside a "more" button reads as broken. it is still
    // listed in the menu, so no section becomes unreachable
    this.visibleCount = Math.max(count, 1);
  }

  <template>
    <nav
      class='dsr-nav'
      aria-label='Sections'
      {{this.registerNav}}
      ...attributes
      data-test-theme-nav
    >
      <div class='nav-container' {{this.trackFit @sections}}>
        {{#if this.isCompact}}
          <BoxelDropdown>
            <:trigger as |bindings|>
              <ContextButton
                class='nav-menu-button'
                @variant='ghost'
                @label='Sections menu'
                @icon={{MenuIcon}}
                {{bindings}}
                data-test-theme-nav-menu
              />
            </:trigger>
            <:content as |dd|>
              <BoxelMenu
                class='nav-dropdown-menu'
                @closeMenu={{dd.close}}
                @items={{this.allMenuItems}}
              />
            </:content>
          </BoxelDropdown>
        {{else}}
          <ul
            class={{cn 'nav-grid' nav-grid--clipped=this.hasOverflowMenu}}
            {{this.trackListFit}}
            data-test-theme-nav-list
          >
            {{#each @sections as |section index|}}
              <li class={{if (this.isHidden index) 'nav-item-hidden'}}>
                <Button
                  @as='anchor'
                  @href='#{{section.id}}'
                  @kind='link-muted'
                  class='nav-item'
                  {{on 'click' (fn scrollToSection section.id)}}
                  data-test-theme-nav-item={{section.id}}
                >{{section.navTitle}}</Button>
              </li>
            {{/each}}
          </ul>

          {{#if this.hasOverflowMenu}}
            <div class='nav-more-button-container'>
              <BoxelDropdown>
                <:trigger as |bindings|>
                  <ContextButton
                    class='nav-more-button'
                    @variant='ghost'
                    @label='More sections'
                    @icon='context-menu-vertical'
                    {{bindings}}
                    data-test-theme-nav-more
                  />
                </:trigger>
                <:content as |dd|>
                  <BoxelMenu
                    class='nav-dropdown-menu'
                    @closeMenu={{dd.close}}
                    @items={{this.overflowMenuItems}}
                  />
                </:content>
              </BoxelDropdown>
            </div>
          {{/if}}
        {{/if}}

        {{#if @toggleDarkMode}}
          <ModeToggle
            class='nav-mode-toggle'
            @toggleDarkMode={{@toggleDarkMode}}
            @isDarkMode={{bool @isDarkMode}}
            {{this.registerToggle}}
          />
        {{/if}}
      </div>
    </nav>
    <style scoped>
      @layer baseComponent {
        /* Navigation */
        .dsr-nav {
          --dsr-nav-height: 3.25rem;
          --dsr-nav-item-max-width: 12rem;
          position: sticky;
          top: 0;
          height: var(--dsr-nav-height);
          width: 100%;
          border-bottom: 1px solid var(--border);
          z-index: 10;
          background: color-mix(in oklch, var(--background) 80%, transparent);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: stretch;
          justify-content: space-between;
        }
        .nav-grid {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          justify-content: space-between;
          gap: var(--boxel-sp-xs);
          min-width: 0;
          overflow: hidden;
          position: relative;
          align-items: center;
        }
        /* an item that doesn't fit moves into the overflow menu rather than
           being truncated in place */
        .nav-grid > li {
          flex-shrink: 0;
        }
        /* the list shrinks to its in-flow items, so the "more" button sits
           right after the last visible one */
        .nav-grid--clipped {
          justify-content: flex-start;
          flex: none;
        }
        /* out of flow rather than display:none, so the item keeps a real box
           the fit measurement and its ResizeObserver can read, while adding
           nothing to the list's width. max-content because shrink-to-fit
           would otherwise be clamped by the now-narrow list */
        .nav-item-hidden {
          position: absolute;
          top: 0;
          left: 0;
          width: max-content;
          visibility: hidden;
        }
        .nav-item {
          font-size: var(--boxel-font-size-sm);
          font-weight: 500;
          white-space: nowrap;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          /* text-overflow needs a block box; the Button is inline-flex */
          display: block;
          max-width: var(--dsr-nav-item-max-width);
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .nav-mode-toggle {
          align-self: center;
          justify-content: flex-end;
          margin-left: auto;
        }
        .nav-more-button-container,
        .nav-menu-button {
          align-self: center;
          flex-shrink: 0;
        }
        .nav-more-button,
        .nav-menu-button {
          color: var(--muted-foreground);
        }
        .nav-more-button :deep(svg),
        .nav-menu-button :deep(svg) {
          stroke-width: 1px;
        }
        .nav-more-button:hover,
        .nav-more-button:focus-visible,
        .nav-menu-button:hover,
        .nav-menu-button:focus-visible {
          color: var(--foreground);
          background: color-mix(in oklch, var(--foreground) 10%, transparent);
        }
        .nav-more-button:focus-visible,
        .nav-menu-button:focus-visible {
          outline: 2px solid var(--ring, var(--boxel-highlight));
        }
        /* portaled next to the app root, so it needs its own viewport cap */
        .nav-dropdown-menu {
          max-height: 50vh;
          overflow-y: auto;
        }
        /* the bar spans the card; its items keep to the content measure */
        .nav-container {
          position: relative;
          flex-grow: 1;
          display: flex;
          gap: var(--boxel-sp-xs);
          overflow: hidden;
          width: 100%;
          max-width: var(--dsr-content-max-width);
          margin: 0 auto;
          padding-inline: var(--boxel-sp-xl);
        }

        @container (width <= 768px) {
          .nav-grid {
            gap: var(--boxel-sp);
          }
          /* matches .dsr-content's compact padding so items stay aligned */
          .nav-container {
            padding-inline: var(--boxel-sp);
          }
        }
      }
    </style>
  </template>
}

export class ModeToggle extends GlimmerComponent<{
  Args: {
    toggleDarkMode: () => void;
    isDarkMode: boolean;
  };
  Element: HTMLLabelElement;
}> {
  <template>
    <Switch
      @isEnabled={{@isDarkMode}}
      @onChange={{@toggleDarkMode}}
      @size='touch'
      @checkedIcon={{Moon}}
      @uncheckedIcon={{Sun}}
      @label='Dark mode'
      data-test-mode={{if @isDarkMode 'toggle-light' 'toggle-dark'}}
      ...attributes
    />
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
      <div class='theme-dashboard-header-content'>
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
      </div>
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
          padding: var(--boxel-sp-3xl) var(--boxel-sp-xl);
        }
        .edit {
          padding: var(--boxel-sp-xl);
        }
        /* the band spans the card; its content keeps to the dashboard's measure */
        .theme-dashboard-header-content {
          /* the band carries the horizontal padding that .dsr-content and the
             nav include in their measure, so subtract it to keep text edges
             aligned */
          max-width: calc(
            var(--dsr-content-max-width, 56rem) - 2 * var(--boxel-sp-xl)
          );
          margin: 0 auto;
        }
        .theme-dashboard-header-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--boxel-sp-lg);
          font-size: var(--boxel-caption-font-size);
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-xxl);
          font-weight: 600;
        }
        .theme-dashboard-header-title {
          margin-bottom: var(--boxel-sp-sm);
          color: var(--foreground);
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
          padding: var(--boxel-sp-xl);
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

// Pill samples for the semantic color roles, rendered with the ambient theme
// tokens. Shared by the theme visualizer and the brand guide.
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

// The tokens that decide a theme's look, excerpted from the generated CSS so a
// reader does not have to scan the full variable dump for them
const RECIPE_TOKENS = [
  '--background',
  '--foreground',
  '--card',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--accent',
  '--destructive',
  '--border',
  '--ring',
  '--radius',
  '--spacing',
  '--font-sans',
  '--font-serif',
  '--font-mono',
  '--shadow',
];

export class ThemeRecipe extends GlimmerComponent<{
  Args: { cssVariables?: string | null; isDarkMode?: boolean };
  Element: HTMLElement;
}> {
  private get entries(): { name: string; value: string }[] {
    let css = this.args.cssVariables;
    if (!css) {
      return [];
    }
    let declared = new Map<string, string>();
    let collect = (selector: RegExp) => {
      let block = css!.match(selector);
      if (!block) {
        return;
      }
      for (let match of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        declared.set(match[1], match[2].trim());
      }
    };
    // the dark block layers over :root, so read it second in dark mode
    collect(/:root\s*{([^}]*)}/);
    if (this.args.isDarkMode) {
      collect(/\.dark\s*{([^}]*)}/);
    }
    return RECIPE_TOKENS.flatMap((name) => {
      let value = declared.get(name);
      return value ? [{ name, value }] : [];
    });
  }

  private get text(): string {
    return `:root {\n${this.entries
      .map(({ name, value }) => `  ${name}: ${value};`)
      .join('\n')}\n}`;
  }

  <template>
    {{#if this.entries.length}}
      <div class='theme-recipe' ...attributes>
        <div class='theme-recipe-header'>
          <h4>Key tokens{{if @isDarkMode ' (dark)'}}</h4>
          <CopyButton @textToCopy={{this.text}} />
        </div>
        <pre class='theme-recipe-pre' data-test-theme-recipe>{{this.text}}</pre>
      </div>
    {{/if}}
    <style scoped>
      @layer baseComponent {
        .theme-recipe {
          margin-bottom: var(--boxel-sp-xl);
        }
        .theme-recipe-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp-xs);
        }
        .theme-recipe-header h4 {
          margin: 0;
        }
        .theme-recipe-pre {
          margin: var(--boxel-sp-xs) 0 0;
          padding: var(--boxel-sp-sm) var(--boxel-sp);
          background-color: var(--muted);
          color: var(--muted-foreground);
          border-radius: var(--boxel-border-radius-sm);
          font-family: var(--font-mono, var(--boxel-monospace-font-family));
          font-size: var(--boxel-font-size-xs);
          overflow-x: auto;
        }
      }
    </style>
  </template>
}

const SPECIMEN_TABS = [
  { id: 'surfaces', label: 'Surfaces & Ink' },
  { id: 'controls', label: 'Controls' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'reading', label: 'Reading' },
] as const;

type SpecimenTabId = (typeof SPECIMEN_TABS)[number]['id'];

const SPECIMEN_ROWS = [
  { name: 'Website redesign', status: 'success', label: 'On track' },
  { name: 'Quarterly report', status: 'warning', label: 'At risk' },
  { name: 'Onboarding guide', status: 'info', label: 'In review' },
  { name: 'Vendor contract', status: 'attention', label: 'Needs sign-off' },
];

const INKS = [
  'primary',
  'secondary',
  'accent',
  'destructive',
  'success',
  'warning',
  'info',
  'attention',
];

const SELECT_OPTIONS = ['Draft', 'In review', 'Published', 'Archived'];

const CHART_BARS = [62, 84, 45, 91, 70].map((height, index) => ({
  className: `sp-bar sp-bar--${index + 1}`,
  style: sanitizeHtmlSafe(`height: ${height}%`),
}));

// Realistic scenes built from boxel-ui, so a theme is judged on a page rather
// than on isolated swatches. Every panel stays in the DOM (inactive ones are
// hidden) so tests and prerender see the full set.
export class ThemeSpecimens extends GlimmerComponent<{
  Element: HTMLElement;
}> {
  @tracked private activeTab: SpecimenTabId = 'surfaces';
  @tracked private switchOn = true;
  @tracked private selected: string | null = SELECT_OPTIONS[1];
  private selectOptions = SELECT_OPTIONS;
  private tabs = SPECIMEN_TABS;
  private rows = SPECIMEN_ROWS;
  private inks = INKS;
  private bars = CHART_BARS;

  private isActive = (id: SpecimenTabId) => this.activeTab === id;
  private isHidden = (id: SpecimenTabId) => this.activeTab !== id;

  @action private selectTab(id: SpecimenTabId) {
    this.activeTab = id;
  }

  @action private toggleSwitch(isEnabled: boolean) {
    this.switchOn = isEnabled;
  }

  @action private select(option: string | null) {
    this.selected = option;
  }

  private panelId = (id: string) => `${guidFor(this)}-${id}`;

  <template>
    <div class='specimens' ...attributes>
      <div class='specimen-tabs' role='tablist' aria-label='Theme specimens'>
        {{#each this.tabs as |tab|}}
          <button
            type='button'
            class={{cn
              'specimen-tab'
              specimen-tab--active=(this.isActive tab.id)
            }}
            role='tab'
            aria-selected={{if (this.isActive tab.id) 'true' 'false'}}
            aria-controls={{this.panelId tab.id}}
            {{on 'click' (fn this.selectTab tab.id)}}
            data-test-specimen-tab={{tab.id}}
          >
            {{tab.label}}
          </button>
        {{/each}}
      </div>

      {{! Surfaces & Ink }}
      <section
        id={{this.panelId 'surfaces'}}
        class='specimen-panel'
        role='tabpanel'
        hidden={{this.isHidden 'surfaces'}}
        data-test-specimen-panel='surfaces'
      >
        <div class='sp-canvas'>
          <div class='sp-canvas-label'>
            <span>Canvas</span>
            <TokenPill @name='--canvas' />
          </div>
          <div class='sp-card'>
            <header class='sp-card-header'>
              <h4>Card on canvas</h4>
              <TokenPill @name='--card' />
            </header>
            <div class='sp-inset'>
              <label class='sp-field-label' for={{this.panelId 'field'}}>
                Field at rest in an inset well
                <TokenPill @name='--inset' />
                <TokenPill @name='--field' />
                <TokenPill @name='--subtle-foreground' />
              </label>
              <BoxelInput
                @id={{this.panelId 'field'}}
                @placeholder='Placeholder in subtle ink'
              />
            </div>
            <div class='sp-table-scroll'>
              <table class='sp-table'>
                <thead>
                  <tr>
                    <th scope='col'>Project</th>
                    <th scope='col'>Status</th>
                    <th scope='col'>Row</th>
                  </tr>
                </thead>
                <tbody>
                  {{#each this.rows as |row index|}}
                    <tr
                      class={{cn
                        sp-row--hover=(eq index 1)
                        sp-row--selected=(eq index 2)
                      }}
                      aria-selected={{if (eq index 2) 'true'}}
                    >
                      <td>{{row.name}}</td>
                      <td>
                        <span
                          class={{cn
                            'sp-status'
                            (concat 'sp-status--' row.status)
                          }}
                        >{{row.label}}</span>
                      </td>
                      <td class='sp-row-note'>
                        {{#if (eq index 0)}}
                          <TokenPill @name='--card' />
                        {{else if (eq index 1)}}
                          <TokenPill @name='--hover' />
                        {{else if (eq index 2)}}
                          <TokenPill @name='--selected' />
                        {{else}}
                          <TokenPill @name='--stripe' />
                        {{/if}}
                      </td>
                    </tr>
                  {{/each}}
                </tbody>
              </table>
            </div>
            <div class='sp-tooltip-row'>
              <span class='sp-tooltip' role='tooltip'>Tooltip</span>
              <TokenPill @name='--tooltip' />
            </div>
          </div>
        </div>
        <div class='sp-ink-grid'>
          <div>
            <h4 class='sp-group-title'>Hue as ink</h4>
            <ul class='sp-inks'>
              {{#each this.inks as |ink|}}
                <li class={{concat 'sp-ink sp-ink--' ink}}>
                  <a href='#' class='sp-ink-link'>{{ink}} ink</a>
                  <TokenPill @name={{concat '--' ink '-ink'}} />
                </li>
              {{/each}}
            </ul>
          </div>
          <div>
            <h4 class='sp-group-title'>Status on its own fill</h4>
            <div class='sp-status-row'>
              <span class='sp-status sp-status--success'>Success</span>
              <span class='sp-status sp-status--warning'>Warning</span>
              <span class='sp-status sp-status--info'>Info</span>
              <span class='sp-status sp-status--attention'>Attention</span>
              <span class='sp-status sp-status--destructive'>Destructive</span>
            </div>
            <p class='sp-subtle'>
              Tertiary text in subtle ink
              <TokenPill @name='--subtle-foreground' />
            </p>
          </div>
        </div>
      </section>

      {{! Controls }}
      <section
        id={{this.panelId 'controls'}}
        class='specimen-panel'
        role='tabpanel'
        hidden={{this.isHidden 'controls'}}
        data-test-specimen-panel='controls'
      >
        <div class='sp-controls-row'>
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
          <Button @kind='muted' @size='small' @rectangular={{true}}>
            Muted Action
          </Button>
          <Button @kind='destructive' @size='small' @rectangular={{true}}>
            Destructive
          </Button>
          <Button @size='small' @rectangular={{true}} @disabled={{true}}>
            Disabled
          </Button>
        </div>
        <div class='sp-controls-grid'>
          <FieldContainer @label='Text input' @vertical={{true}}>
            <BoxelInput @placeholder='Type to search' />
          </FieldContainer>
          <FieldContainer @label='Select' @vertical={{true}}>
            <BoxelSelect
              @options={{this.selectOptions}}
              @selected={{this.selected}}
              @onChange={{this.select}}
              @placeholder='Choose a status'
              @renderInPlace={{true}}
              aria-label='Sample select'
              as |option|
            >
              {{option}}
            </BoxelSelect>
          </FieldContainer>
          <FieldContainer @label='Switch' @vertical={{true}}>
            <Switch
              @isEnabled={{this.switchOn}}
              @onChange={{this.toggleSwitch}}
              @label='Sample switch'
            />
          </FieldContainer>
          <FieldContainer @label='Progress' @vertical={{true}}>
            <ProgressBar @value={{64}} @max={{100}} @label='64%' />
          </FieldContainer>
        </div>
        <CardContainer @displayBoundaries={{true}} class='sp-sample-card'>
          <BoxelContainer @display='grid'>
            <h4>Sample Card</h4>
            <p>
              Card component showcasing background, borders, and shadows from
              the theme system.
            </p>
          </BoxelContainer>
        </CardContainer>
      </section>

      {{! Dashboard }}
      <section
        id={{this.panelId 'dashboard'}}
        class='specimen-panel'
        role='tabpanel'
        hidden={{this.isHidden 'dashboard'}}
        data-test-specimen-panel='dashboard'
      >
        <div class='sp-stats'>
          <div class='sp-stat'>
            <span class='sp-stat-label'>Tasks completed</span>
            <span class='sp-stat-value'>1,284</span>
            <span class='sp-delta sp-delta--up'>▲ 8.2%</span>
          </div>
          <div class='sp-stat'>
            <span class='sp-stat-label'>Avg. response</span>
            <span class='sp-stat-value'>42m</span>
            <span class='sp-delta sp-delta--down'>▼ 3.1%</span>
          </div>
          <div class='sp-stat'>
            <span class='sp-stat-label'>Open items</span>
            <span class='sp-stat-value'>17</span>
            <span class='sp-delta'>no change</span>
          </div>
        </div>
        <div class='sp-chart' role='img' aria-label='Sample bar chart'>
          {{#each this.bars as |bar|}}
            <div class={{bar.className}} style={{bar.style}}></div>
          {{/each}}
        </div>
        <div class='sp-banner' role='status'>
          <strong>Two projects need sign-off.</strong>
          Warning hue used as ink on a neutral surface.
          <TokenPill @name='--warning-ink' />
        </div>
      </section>

      {{! Reading }}
      <section
        id={{this.panelId 'reading'}}
        class='specimen-panel'
        role='tabpanel'
        hidden={{this.isHidden 'reading'}}
        data-test-specimen-panel='reading'
      >
        <article class='sp-article'>
          <span class='sp-eyebrow'>Field notes</span>
          <h2 class='sp-article-title'>The last vat still taking colour</h2>
          <p class='sp-lead'>
            Body copy at reading measure, with a
            <a
              href='#'
              class='sp-ink-link sp-ink--primary sp-ink-link-body'
            >link in primary ink</a>
            and a run of ordinary prose long enough to show line height.
          </p>
          <p>
            Every surface here is the theme's own: the page, the rule under the
            quote, the caption's quieter ink. Nothing is hard-coded.
          </p>
          <blockquote class='sp-quote'>
            A theme is judged on a page, not on a swatch.
          </blockquote>
          <p class='sp-caption'>Caption text in muted ink.</p>
        </article>
      </section>
    </div>
    <style scoped>
      @layer baseComponent {
        .specimens {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
          container-type: inline-size;
        }
        .specimen-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-4xs);
          border-bottom: 1px solid var(--border);
        }
        .specimen-tab {
          padding: var(--boxel-sp-xs) var(--boxel-sp);
          border: 0;
          border-bottom: 2px solid transparent;
          margin-bottom: -1px;
          background: none;
          color: var(--muted-foreground);
          font: inherit;
          font-size: var(--boxel-font-size-sm);
          font-weight: 500;
          cursor: pointer;
        }
        .specimen-tab:hover {
          background-color: var(--hover);
          color: var(--foreground);
        }
        .specimen-tab:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
        }
        .specimen-tab--active {
          color: var(--foreground);
          border-bottom-color: var(--primary);
        }
        .specimen-panel {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
        }
        /* author display beats the UA [hidden] rule, so restate it */
        .specimen-panel[hidden] {
          display: none;
        }
        .specimen-panel h4 {
          margin: 0;
        }
        .sp-group-title {
          margin-bottom: var(--boxel-sp-xs);
          color: var(--muted-foreground);
          font-size: var(--boxel-font-size-sm);
        }

        /* surfaces */
        .sp-canvas {
          min-width: 0;
          padding: var(--boxel-sp);
          background-color: var(--canvas);
          color: var(--foreground);
          border-radius: var(--radius);
        }
        .sp-canvas-label {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--boxel-sp-xs);
          margin-bottom: var(--boxel-sp-xs);
          color: var(--muted-foreground);
          font-size: var(--boxel-font-size-xs);
        }
        .sp-card {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp);
          background-color: var(--card);
          color: var(--card-foreground);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          box-shadow: var(--shadow-sm);
        }
        .sp-card-header {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp-xs);
        }
        .sp-inset {
          /* BoxelInput paints from --background and --muted-foreground, so remap
             those inside the well to show the field and subtle-ink tokens on
             the real component */
          --background: var(--field);
          --muted-foreground: var(--subtle-foreground);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp);
          background-color: var(--inset);
          border-radius: calc(var(--radius) - 0.25rem);
          box-shadow: var(--shadow-inset);
        }
        .sp-field-label {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          font-size: var(--boxel-font-size-sm);
        }
        .sp-table-scroll {
          overflow-x: auto;
        }
        .sp-table {
          width: 100%;
          border-collapse: collapse;
          font-size: var(--boxel-font-size-sm);
        }
        .sp-table td {
          white-space: nowrap;
        }
        .sp-table th {
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          border-bottom: 1px solid var(--border-strong);
          color: var(--muted-foreground);
          text-align: left;
          font-family: var(--boxel-ui-label-font-family);
          font-size: var(--boxel-ui-label-font-size);
          font-weight: var(--boxel-ui-label-font-weight);
          letter-spacing: var(--boxel-ui-label-letter-spacing);
        }
        .sp-table td {
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          border-bottom: 1px solid var(--border);
        }
        .sp-table tbody tr:nth-child(even) {
          background-color: var(--stripe);
        }
        .sp-table tbody tr.sp-row--hover,
        .sp-table tbody tr:hover {
          background-color: var(--hover);
        }
        .sp-table tbody tr.sp-row--selected {
          background-color: var(--selected);
        }
        .sp-row-note {
          text-align: right;
        }
        .sp-tooltip-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .sp-tooltip {
          padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
          background-color: var(--tooltip);
          color: var(--tooltip-foreground);
          border-radius: var(--boxel-border-radius-sm);
          font-size: var(--boxel-font-size-xs);
        }
        .sp-ink-grid {
          display: grid;
          grid-template-columns: repeat(
            auto-fit,
            minmax(min(14rem, 100%), 1fr)
          );
          gap: var(--boxel-sp-lg);
        }
        .sp-inks {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          grid-template-columns: repeat(
            auto-fill,
            minmax(min(14rem, 100%), 1fr)
          );
          gap: var(--boxel-sp-xs);
        }
        .sp-ink {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp-4xs) var(--boxel-sp-xs);
        }
        .sp-ink-link {
          color: inherit;
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
          text-decoration: underline;
          text-decoration-thickness: 1px;
          text-underline-offset: 0.15em;
          text-transform: capitalize;
        }
        .sp-ink-link-body {
          font-size: inherit;
        }
        .sp-ink--primary {
          color: var(--primary-ink);
        }
        .sp-ink--secondary {
          color: var(--secondary-ink);
        }
        .sp-ink--accent {
          color: var(--accent-ink);
        }
        .sp-ink--destructive {
          color: var(--destructive-ink);
        }
        .sp-ink--success {
          color: var(--success-ink);
        }
        .sp-ink--warning {
          color: var(--warning-ink);
        }
        .sp-ink--info {
          color: var(--info-ink);
        }
        .sp-ink--attention {
          color: var(--attention-ink);
        }
        .sp-status-row {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
        }
        .sp-status {
          display: inline-block;
          padding: 0 var(--boxel-sp-xs);
          border-radius: var(--boxel-border-radius-xl);
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          line-height: 1.6;
        }
        .sp-status--success {
          background-color: var(--success);
          color: var(--success-foreground);
        }
        .sp-status--warning {
          background-color: var(--warning);
          color: var(--warning-foreground);
        }
        .sp-status--info {
          background-color: var(--info);
          color: var(--info-foreground);
        }
        .sp-status--attention {
          background-color: var(--attention);
          color: var(--attention-foreground);
        }
        .sp-status--destructive {
          background-color: var(--destructive);
          color: var(--destructive-foreground);
        }
        .sp-subtle {
          margin: var(--boxel-sp) 0 0;
          color: var(--subtle-foreground);
          font-size: var(--boxel-font-size-sm);
        }

        /* controls */
        .sp-controls-row {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
        }
        .sp-controls-grid {
          display: grid;
          grid-template-columns: repeat(
            auto-fit,
            minmax(min(12rem, 100%), 1fr)
          );
          gap: var(--boxel-sp);
          align-items: start;
        }
        .sp-sample-card {
          background-color: var(--card);
          color: var(--card-foreground);
        }

        /* dashboard */
        .sp-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(9rem, 100%), 1fr));
          gap: var(--boxel-sp);
        }
        .sp-stat {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-4xs);
          padding: var(--boxel-sp);
          background-color: var(--card);
          color: var(--card-foreground);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          box-shadow: var(--shadow-xs);
        }
        .sp-stat-label {
          color: var(--muted-foreground);
          font-family: var(--boxel-ui-label-font-family);
          font-size: var(--boxel-ui-label-font-size);
          font-weight: var(--boxel-ui-label-font-weight);
          letter-spacing: var(--boxel-ui-label-letter-spacing);
        }
        .sp-stat-value {
          font-size: var(--boxel-heading-font-size);
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .sp-delta {
          color: var(--subtle-foreground);
          font-size: var(--boxel-font-size-xs);
        }
        .sp-delta--up {
          color: var(--success-ink);
        }
        .sp-delta--down {
          color: var(--destructive-ink);
        }
        .sp-chart {
          display: flex;
          align-items: flex-end;
          gap: var(--boxel-sp-xs);
          height: 6rem;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm) 0;
          border-bottom: 1px solid var(--border-strong);
        }
        .sp-bar {
          flex: 1;
          border-radius: var(--boxel-border-radius-xs)
            var(--boxel-border-radius-xs) 0 0;
        }
        .sp-bar--1 {
          background-color: var(--chart-1);
        }
        .sp-bar--2 {
          background-color: var(--chart-2);
        }
        .sp-bar--3 {
          background-color: var(--chart-3);
        }
        .sp-bar--4 {
          background-color: var(--chart-4);
        }
        .sp-bar--5 {
          background-color: var(--chart-5);
        }
        .sp-banner {
          padding: var(--boxel-sp-xs) var(--boxel-sp);
          border-left: 3px solid var(--warning);
          background-color: var(--card);
          color: var(--warning-ink);
          font-size: var(--boxel-font-size-sm);
        }

        /* reading */
        .sp-article {
          max-width: 40rem;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
        }
        .sp-article p {
          margin: 0;
        }
        .sp-eyebrow {
          color: var(--muted-foreground);
          font-family: var(--boxel-eyebrow-font-family);
          font-size: var(--boxel-eyebrow-font-size);
          font-weight: var(--boxel-eyebrow-font-weight);
          letter-spacing: var(--boxel-eyebrow-letter-spacing);
          text-transform: uppercase;
        }
        .sp-article-title {
          margin: 0;
        }
        .sp-lead {
          font-size: var(--boxel-subheading-font-size);
        }
        .sp-quote {
          margin: var(--boxel-sp-xs) 0;
          padding-left: var(--boxel-sp);
          border-left: 3px solid var(--border-strong);
          color: var(--muted-foreground);
          font-style: italic;
        }
        .sp-caption {
          color: var(--subtle-foreground);
          font-size: var(--boxel-caption-font-size);
        }
      }
    </style>
  </template>
}

// Font previews beside the CSS import list, used by the visualizer and by the
// Brand Guide's Fonts section
export class FontsPreview extends GlimmerComponent<{
  Args: {
    fontStack?: { label: string; stack?: string }[];
    cssImports?: string[] | null;
  };
  Element: HTMLElement;
}> {
  <template>
    <div class='fonts-grid' ...attributes>
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
      {{else}}
        <p class='font-import-empty'><em>No web fonts referenced.</em></p>
      {{/if}}
    </div>
    <style scoped>
      /* previews beside the import list when both fit, stacked otherwise */
      .fonts-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(20rem, 100%), 1fr));
        gap: var(--boxel-sp-xl);
        align-items: start;
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
        margin: 0;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export class ThemeVisualizer extends GlimmerComponent<{
  Args: {
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
            <FontsPreview
              @fontStack={{@fontStack}}
              @cssImports={{@cssImports}}
            />
          </div>
        {{/if}}
        {{#if (has-block 'typography')}}
          <div>
            <h3 class='structured-theme-visualizer-subtitle'>Typography</h3>
            {{yield to='typography'}}
          </div>
        {{/if}}
        <div>
          <h3 class='structured-theme-visualizer-subtitle'>Specimens</h3>
          <ThemeSpecimens />
        </div>
      </div>
    </section>

    <style scoped>
      @layer baseComponent {
        .dsr-theme-visualizer {
          background-color: var(--card);
          color: var(--card-foreground);
          border-radius: var(--boxel-border-radius);
          padding: var(--boxel-sp-xl);
          min-width: 0;
          border: 1px solid var(--border);
        }
        .dsr-theme-visualizer + :deep(*) {
          margin-top: var(--boxel-sp-xl);
        }
        .dsr-theme-visualizer-header {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          align-items: center;
          gap: var(--boxel-sp-xs);
          margin-bottom: var(--boxel-sp-xl);
          padding-bottom: var(--boxel-sp);
          border-bottom: 2px solid var(--border);
        }
        .structured-theme-visualizer {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-4xl);
          background-color: var(--background);
          color: var(--foreground);
          border-radius: var(--radius);
          padding: var(--boxel-sp-xl);
          border: 2px solid var(--border);
        }
        @container (width <= 768px) {
          .dsr-theme-visualizer,
          .structured-theme-visualizer {
            padding-inline: var(--boxel-sp);
          }
        }
        .structured-theme-visualizer-subtitle {
          border-bottom: var(--boxel-border);
          margin-bottom: var(--boxel-sp-xl);
        }
        .visualizer-preview-pills {
          margin-bottom: var(--boxel-sp);
        }
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
    // affixes a dark-mode toggle to the right end of the nav bar
    toggleDarkMode?: () => void;
  };
  Blocks: { default: []; header: [] };
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
        data-test-theme-dashboard
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

        {{#if @sections.length}}
          <NavBar
            @sections={{@sections}}
            @toggleDarkMode={{@toggleDarkMode}}
            @isDarkMode={{@isDarkMode}}
          />
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
          /* one measure for the header, content, and footer columns; the
             theme card opens in the wide stack format, so this is sized for it */
          --dsr-content-max-width: 90rem;
          /* long generated CSS scrolls inside its block instead of stretching the page */
          --css-field-max-height: 40vh;
          display: flex;
          flex-direction: column;
          height: 100%;
          background-color: var(--background);
          color: var(--foreground);
          overflow-y: auto;
          /* the NavBar's container queries key off the card, not the viewport */
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
          max-width: var(--dsr-content-max-width);
          margin: 0 auto;
          padding: var(--boxel-sp-3xl) var(--boxel-sp-xl);
          counter-reset: section;
        }

        /* Footer */
        .dsr-footer {
          border-top: 1px solid var(--border);
          padding: var(--boxel-sp-xl);
          background-color: var(--muted);
          color: var(--muted-foreground);
        }
        .footer-content {
          max-width: var(--dsr-content-max-width);
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
            padding: var(--boxel-sp-xl) var(--boxel-sp);
          }
          .dsr-content {
            padding: var(--boxel-sp-xl) var(--boxel-sp);
          }
        }
      }
    </style>
  </template>
}
