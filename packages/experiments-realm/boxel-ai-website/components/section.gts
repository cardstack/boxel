import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';
import { hash } from '@ember/helper';

import { CardContainer, Pill } from '@cardstack/boxel-ui/components';
import { cssVar, sanitizeHtml } from '@cardstack/boxel-ui/helpers';

export interface SectionSignature {
  Args: {};
  Element: HTMLElement;
  Blocks: {
    default: [
      {
        Header: ComponentLike<SectionHeaderSignature>;
        Row: ComponentLike<SectionRowSignature>;
      },
    ];
  };
}

export interface SectionHeaderSignature {
  Args: {
    headline?: string;
    subheadline?: string;
    label?: string;
  };
  Element: HTMLElement;
  Blocks: { default: [] };
}

export class SectionHeader extends Component<SectionHeaderSignature> {
  <template>
    <div class='section-header' ...attributes>
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

interface SectionCardComponentSignature {
  Args: {
    accentColor?: string;
    badgeLabel?: string;
    title?: string;
    text?: string;
    linkColor?: string;
    linkText?: string;
    linkUrl?: string;
  };
  Element: HTMLElement;
  Blocks: { default: [] };
}

export class SectionCardComponent extends Component<SectionCardComponentSignature> {
  <template>
    <CardContainer class='highlight-card' ...attributes>
      {{#if @badgeLabel}}
        <Pill class='highlight-card-badge'>{{@badgeLabel}}</Pill>
      {{/if}}
      <h3 class='highlight-card-title'>{{@title}}</h3>
      {{#if @text}}
        <p class='highlight-card-text'>{{@text}}</p>
      {{/if}}

      {{yield}}

      <a
        href={{if @linkUrl (sanitizeHtml @linkUrl) '/'}}
        class='highlight-card-link'
        style={{cssVar link-color=@linkColor}}
      >
        {{@linkText}}
      </a>
    </CardContainer>

    <style scoped>
      a {
        font-family: var(--font-mono, var(--boxel-monospace-font-family));
        font-size: 0.8rem;
        text-decoration: none;
      }
      .highlight-card {
        --card-shadow:
          0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
        position: relative;
        background: var(--card);
        color: var(--card-foreground);
        border: 1px solid var(--border);
        padding: 2rem;
        box-shadow: var(--card-shadow);
      }
      .highlight-card-badge {
        position: absolute;
        top: 1rem;
        right: 1rem;
        padding: 0.35rem 0.75rem;
        border-radius: var(--boxel-border-radius-xs);
        background-color: var(--brand-dark, var(--boxel-dark));
        color: var(--brand-primary, var(--boxel-highlight));
        font-family: var(--boxel-caption-font-family);
        font-size: var(--boxel-caption-font-size);
        font-weight: var(--boxel-caption-font-weight);
        line-height: var(--boxel-caption-line-height);
        letter-spacing: var(--boxel-lsp-xl);
        text-transform: uppercase;
      }
      .highlight-card-badge + .highlight-card-title {
        margin-top: 1.25rem;
      }
      .highlight-card-title {
        font-size: 1.5rem;
        font-weight: 700;
        margin-bottom: 0.75rem;
      }
      .highlight-card-text {
        color: var(--muted-foreground);
      }
      .highlight-card-link {
        display: block;
        margin-top: var(--boxel-sp);
        color: var(--link-color);
      }
    </style>
  </template>
}

interface SectionRowSignature {
  Element: HTMLElement;
  Blocks: { default: [] };
}

export class SectionRow extends Component<SectionRowSignature> {
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

export class Section extends Component<SectionSignature> {
  <template>
    <div class='section-layout' ...attributes>
      {{yield
        (hash Header=(component SectionHeader) Row=(component SectionRow))
      }}
    </div>

    <style scoped>
      .section-layout {
        --card-width: 16.875rem;

        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 3rem 4rem;
        padding: var(--boxel-sp);
        text-wrap: pretty;
      }
      :deep(.section-layout-row) {
        grid-column: -1 / 1;
      }
      :deep(.section-cards-grid) {
        grid-column: -1 / 1;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(var(--card-width), 1fr));
        gap: 2rem;
      }
      :deep(.section-cards-grid .compound-field) {
        height: 100%;
      }
      /* markdown */
      .section-layout :deep(blockquote) {
        border-right: none;
        border-left: 2px solid var(--primary, var(--boxel-highlight));
      }
      .section-layout :deep(blockquote p) {
        margin: 0;
        padding-left: var(--boxel-sp);
        color: var(--muted-foreground, var(--boxel-450));
        font-family: var(--font-mono, var(--boxel-monospace-font-family));
        font-size: 0.8rem;
        font-style: normal;
        line-height: 1.8;
      }
    </style>
  </template>
}
