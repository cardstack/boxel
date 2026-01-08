import GlimmerComponent from '@glimmer/component';
// @ts-ignore
import type { ComponentLike } from '@glint/template';
import { hash } from '@ember/helper';

import { CardContainer } from '@cardstack/boxel-ui/components';
import { cn, cssVar, eq, sanitizeHtmlSafe } from '@cardstack/boxel-ui/helpers';

import { Badge } from './badge';

export interface SectionSignature {
  Args: {};
  Element: HTMLElement;
  Blocks: {
    default: [
      {
        Header: ComponentLike<SectionHeaderSignature>;
        Row: ComponentLike<SectionRowSignature>;
        Grid: ComponentLike<SectionRowSignature>;
      },
    ];
  };
}

export interface SectionHeaderSignature {
  Args: {
    headline?: string;
    subheadline?: string;
    label?: string;
    type?: 'tile' | 'row';
  };
  Element: HTMLElement;
  Blocks: { default: [] };
}

export class SectionHeader extends GlimmerComponent<SectionHeaderSignature> {
  <template>
    <div
      class={{cn 'section-header' section-header--row=(eq @type 'row')}}
      ...attributes
    >
      {{#if @label}}
        <span class='section-label'>{{@label}}</span>
      {{/if}}
      <h2 class='section-title'>{{@headline}}</h2>
      {{#if @subheadline}}
        <p class='section-subtitle'>{{@subheadline}}</p>
      {{/if}}

      {{yield}}
    </div>

    <style scoped>
      .section-header {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: var(--boxel-sp);
      }
      .section-header--row {
        grid-column: -1 / 1;
      }
      .section-title {
        font-family: var(--boxel-heading-font-family);
        font-size: var(--boxel-heading-font-size);
        font-weight: var(--boxel-heading-font-weight);
        line-height: var(--boxel-heading-line-height);
        letter-spacing: -0.03em;
        margin: 0 0 1.25rem 0;
      }
      .section-label {
        display: block;
        color: var(--muted-foreground);
        font-family: var(--boxel-caption-font-family);
        font-size: var(--boxel-caption-font-size);
        font-weight: var(--boxel-section-heading-font-weight);
        line-height: var(--boxel-section-heading-line-height);
        letter-spacing: var(--boxel-lsp-xxl);
        text-transform: uppercase;
      }
      .section-subtitle {
        max-width: 32.5rem;
        color: var(--muted-foreground);
        font-size: 1.125rem;
        font-weight: var(--boxel-body-font-weight);
        line-height: 1.7;
      }
    </style>
  </template>
}

const formatBulletItem = (str?: string) => {
  let item = str?.trim();
  if (!item) {
    return;
  }
  let [title, desc] = item.split(':');
  if (title && desc) {
    return sanitizeHtmlSafe(`<strong>${title}:</strong> ${desc}`);
  }

  return title ?? desc;
};

export class SectionBullet extends GlimmerComponent<{
  Args: { bullets?: string[] | null; accentColor?: string };
}> {
  <template>
    {{#if @bullets.length}}
      <ul class='bullets' style={{cssVar accent-border=@accentColor}}>
        {{#each @bullets as |bullet|}}
          <li>{{formatBulletItem bullet}}</li>
        {{/each}}
      </ul>
    {{else}}
      <p><em>No items</em></p>
    {{/if}}

    <style scoped>
      .bullets {
        list-style-type: '> ';
        list-style-position: inside;
        margin-block: 1.5rem 1rem;
        padding-left: 1rem;
        border-left: 2px solid var(--accent-border, var(--boxel-border-color));
        color: var(--muted-foreground, var(--boxel-500));
        font-family: var(--font-mono, var(--boxel-monospace-font-family));
        font-size: 0.9em;
        line-height: 1.8;
      }
    </style>
  </template>
}

interface SectionCardComponentSignature {
  Args: {
    accentColor?: string;
    badgeLabel?: string;
    title?: string;
    text?: string;
    headerBadge?: string;
    isHighlighted?: boolean;
  };
  Element: HTMLElement;
  Blocks: { before: []; default: []; footer: [] };
}

export class SectionCardComponent extends GlimmerComponent<SectionCardComponentSignature> {
  <template>
    <CardContainer
      class={{cn 'highlight-card' highlight-card--accent=@isHighlighted}}
      ...attributes
    >
      {{#if @badgeLabel}}
        <Badge
          class='highlight-card-badge'
          @label={{@badgeLabel}}
          @variant={{if @isHighlighted 'accent-inverse' 'primary-inverse'}}
        />
      {{/if}}

      {{#if (has-block 'before')}}
        <div>
          {{yield to='before'}}
        </div>
      {{/if}}

      <header>
        {{#if @headerBadge}}
          <Badge
            class='highlight-card-header-badge'
            @label={{@headerBadge}}
            @variant={{if @isHighlighted 'accent-inverse' 'primary-inverse'}}
          />
        {{/if}}
        <h3 class='highlight-card-title'>{{@title}}</h3>
        {{#if @text}}
          <p class='highlight-card-text'>{{@text}}</p>
        {{/if}}
      </header>

      {{#if (has-block)}}
        <div>
          {{yield}}
        </div>
      {{/if}}

      {{#if (has-block 'footer')}}
        <footer>
          {{yield to='footer'}}
        </footer>
      {{/if}}
    </CardContainer>

    <style scoped>
      .highlight-card {
        --card-shadow:
          0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 1.5rem;
        background: var(--card);
        color: var(--card-foreground);
        border: 1px solid var(--border);
        padding: 2rem;
        box-shadow: var(--card-shadow);
      }
      .highlight-card--accent {
        background: var(--accent);
        color: var(--accent-foreground);
      }
      .highlight-card--accent .highlight-card-text {
        color: color-mix(in oklab, currentColor 80%, transparent);
      }
      .highlight-card-badge {
        position: absolute;
        top: 1rem;
        right: 1rem;
        z-index: 1;
      }
      .highlight-card-header-badge {
        margin-bottom: 1rem;
      }
      .highlight-card-title {
        font-size: 1.5rem;
        font-weight: 700;
        margin-bottom: 0.75rem;
      }
      .highlight-card-text {
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

interface SectionRowSignature {
  Element: HTMLElement;
  Blocks: { default: [] };
}

export class SectionRow extends GlimmerComponent<SectionRowSignature> {
  <template>
    <div class='section-row' ...attributes>
      {{yield}}
    </div>

    <style scoped>
      .section-row {
        grid-column: -1 / 1;
      }
    </style>
  </template>
}

interface PluralFieldGridSignature {
  Args: {
    gridColWidth?: string;
    gridGap?: string;
  };
  Element: HTMLElement;
  Blocks: { default: [] };
}

// To be used with plural compound fields ie. containsMany compound field
export class PluralFieldGrid extends GlimmerComponent<PluralFieldGridSignature> {
  private get gridColWidth() {
    return this.args.gridColWidth ?? '16.875rem';
  }

  private get gap() {
    return this.args.gridGap ?? '2rem';
  }

  <template>
    <div
      class='section-cards-grid'
      style={{cssVar grid-col-width=this.gridColWidth grid-gap=this.gap}}
      ...attributes
    >
      {{yield}}
    </div>

    <style scoped>
      .section-cards-grid {
        grid-column: -1 / 1;
      }
      .section-cards-grid :deep(.containsMany-field) {
        display: grid;
        grid-template-columns: repeat(
          auto-fit,
          minmax(var(--grid-col-width), 1fr)
        );
        gap: var(--grid-gap, 2rem);
      }
      .section-cards-grid :deep(.compound-field) {
        height: 100%;
        word-break: initial;
      }
      .section-cards-grid :deep(.compound-field > *) {
        width: 100%;
        height: 100%;
      }
    </style>
  </template>
}

export class Section extends GlimmerComponent<SectionSignature> {
  <template>
    <div class='section-layout' ...attributes>
      {{yield
        (hash
          Header=(component SectionHeader)
          Row=(component SectionRow)
          Grid=(component PluralFieldGrid)
        )
      }}
    </div>

    <style scoped>
      .section-layout {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 3rem 4rem;
        padding: var(--boxel-sp);
        text-wrap: pretty;
      }
      :deep(.section-layout-row) {
        grid-column: -1 / 1;
      }
    </style>
  </template>
}
