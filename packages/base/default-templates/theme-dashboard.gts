import { tracked } from '@glimmer/tracking';
import GlimmerComponent from '@glimmer/component';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { modifier } from 'ember-modifier';

import Moon from '@cardstack/boxel-icons/moon';
import Sun from '@cardstack/boxel-icons/sun';
import ChevronCompactRight from '@cardstack/boxel-icons/chevron-compact-right';
import ChevronCompactLeft from '@cardstack/boxel-icons/chevron-compact-left';

import {
  Button,
  CardContainer,
  BoxelContainer,
  FieldContainer,
  BoxelInput,
} from '@cardstack/boxel-ui/components';
import { bool, cn } from '@cardstack/boxel-ui/helpers';

function scrollToSection(sectionId: string, event: Event) {
  event.preventDefault();
  let navEl = event.currentTarget as HTMLElement;
  let card = navEl.closest('.detailed-style-reference');
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
  history.pushState(null, '', `#${sectionId}`);
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

export class CssFieldEditor extends GlimmerComponent<{
  Args: {
    label?: string;
    placeholder?: string;
    setCss?: (content: string) => void;
  };
  Element: HTMLElement;
}> {
  defaultLabel = 'Paste your CSS below to customize the theme variables:';
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

  <template>
    <FieldContainer
      class='css-field-editor'
      @vertical={{true}}
      @label={{if @label.length @label this.defaultLabel}}
      @tag='label'
      ...attributes
    >
      <BoxelInput
        @type='textarea'
        @onInput={{@setCss}}
        @placeholder={{if
          @placeholder.length
          @placeholder
          this.defaultPlaceholder
        }}
        class='css-textarea'
        data-test-custom-css-variables
      />
    </FieldContainer>
    <style scoped>
      .css-field-editor {
        gap: var(--boxel-sp);
      }
      .css-textarea {
        min-height: 15rem;
        background-color: var(--dsr-card);
        color: var(--dsr-card-fg);
        border: 1px solid var(--dsr-border);
        font-size: var(--boxel-font-size-xs);
        font-family: var(
          --font-mono,
          var(--boxel-monospace-font-family, monospace)
        );
      }
      .css-textarea::placeholder {
        opacity: 0.5;
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
    if (!el) return '1.333';
    return (
      getComputedStyle(el).getPropertyValue('--theme-scale').trim() || '1.333'
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
        color: var(--dsr-muted-fg);
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
        background-color: var(--dsr-card);
        color: var(--dsr-card-fg);
        border: 1px solid var(--dsr-border);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp);
      }
      .card-container-mapping-group h4 {
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--dsr-muted-fg);
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
        color: var(--dsr-muted-fg);
        margin-bottom: var(--boxel-sp-xs);
      }
      .card-container-mapping-group dt {
        font-weight: 500;
      }
      .card-container-mapping-group dd {
        margin: 0;
        color: var(--dsr-muted-fg);
      }
      .computed-vars-heading {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--dsr-muted-fg);
        margin-block: var(--boxel-sp-lg) var(--boxel-sp-sm);
        padding-top: var(--boxel-sp-lg);
        border-top: 1px solid var(--dsr-border);
      }
      .computed-vars-section {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
        gap: var(--boxel-sp-lg);
      }
      .computed-vars-group {
        background-color: var(--dsr-card);
        color: var(--dsr-card-fg);
        border: 1px solid var(--dsr-border);
        border-radius: var(--boxel-border-radius);
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
        color: var(--dsr-muted-fg);
        margin: 0;
      }
      .computed-vars-group--full {
        grid-column: 1 / -1;
      }
      .computed-vars-description {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--dsr-muted-fg);
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

export class SimpleNavBar extends GlimmerComponent<{
  Args: {
    items?: SectionSignature[];
  };
  Element: HTMLElement;
}> {
  <template>
    <nav class='structured-theme-nav' ...attributes>
      <ul class='structured-theme-nav-list'>
        {{#each @items as |navItem|}}
          <li>
            <Button
              @as='anchor'
              @href='#{{navItem.id}}'
              @kind='secondary'
              @size='small'
              class='boxel-ellipsize'
              {{on 'click' (fn scrollToSection navItem.id)}}
            >
              {{navItem.navTitle}}
            </Button>
          </li>
        {{/each}}
      </ul>
    </nav>
    <style scoped>
      .structured-theme-nav {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp) calc(var(--boxel-sp) * 2);
        border-bottom: 1px solid var(--dsr-border);
      }
      .structured-theme-nav-list {
        list-style-type: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
}

export class NavBar extends GlimmerComponent<{
  Args: {
    sections?: SectionSignature[];
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
            <a
              href='#{{section.id}}'
              class='nav-item'
              {{on 'click' (fn scrollToSection section.id)}}
            >{{section.navTitle}}</a>
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
    title?: string;
    description?: string;
    isDarkMode?: boolean;
    metaLabel?: string;
    version?: string;
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

export class ThemeVisualizer extends GlimmerComponent<{
  Args: {
    toggleDarkMode?: () => void;
    isDarkMode?: boolean;
  };
  Blocks: { colorPalette: []; typography: [] };
  Element: HTMLElement;
}> {
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
            {{yield to='colorPalette'}}
          </div>
        {{/if}}
        {{#if (has-block 'typography')}}
          <div>
            <h3 class='structured-theme-visualizer-subtitle'>Typography</h3>
            {{yield to='typography'}}
          </div>
        {{/if}}
        <div>
          <h3 class='structured-theme-visualizer-subtitle'>Components</h3>
          <div class='structured-theme-component-samples'>
            <Button @kind='primary' @size='small' @rectangular={{true}}>
              Primary Action
            </Button>
            <Button @kind='secondary' @size='small' @rectangular={{true}}>
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
      </div>
    </section>

    <style scoped>
      @layer baseComponent {
        .dsr-theme-visualizer {
          background-color: var(--dsr-card);
          color: var(--dsr-card-fg);
          border-radius: var(--boxel-border-radius);
          padding: calc(var(--boxel-sp) * 2);
          border: 1px solid var(--dsr-border);
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
          border-bottom: 2px solid var(--dsr-border);
        }
        .structured-theme-visualizer {
          display: flex;
          flex-direction: column;
          gap: calc(var(--boxel-sp) * 4);
          background-color: var(--dsr-bg);
          color: var(--dsr-fg);
          border-radius: var(--boxel-border-radius);
          padding: calc(var(--boxel-sp) * 2);
          border: 2px solid var(--dsr-border);
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
      }
      .structured-theme-component-sample-card {
        background-color: var(--dsr-card);
        color: var(--dsr-card-fg);
        border: 1px solid var(--dsr-border);
        box-shadow: var(--boxel-box-shadow);
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
  };
  Blocks: { default: []; header: []; navBar: [] };
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
          @metaLabel={{@headerLabel}}
          @version={{@version}}
        />
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

    <style scoped>
      @layer baseComponent {
        .detailed-style-reference {
          --dsr-bg: var(--background, var(--boxel-light));
          --dsr-fg: var(--foreground, var(--boxel-700));
          --dsr-muted: var(
            --muted,
            color-mix(in oklab, var(--dsr-fg) 10%, var(--dsr-bg))
          );
          --dsr-muted-fg: var(
            --muted-foreground,
            color-mix(in oklab, var(--dsr-fg) 60%, var(--dsr-bg))
          );
          --dsr-border: var(
            --border,
            color-mix(in oklab, var(--dsr-fg) 20%, var(--dsr-bg))
          );
          --dsr-card: var(
            --card,
            color-mix(in oklab, var(--dsr-fg) 5%, var(--dsr-bg))
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
          font-size: var(--boxel-heading-font-size);
        }
        .dsr-header :deep(p) {
          font-size: var(--boxel-body-font-size);
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
          font-size: var(--boxel-font-size-xs);
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
      }
    </style>
  </template>
}
