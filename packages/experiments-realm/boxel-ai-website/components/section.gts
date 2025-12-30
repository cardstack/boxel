import Component from '@glimmer/component';

import { CardContainer, Pill } from '@cardstack/boxel-ui/components';
import { cssVar, sanitizeHtml } from '@cardstack/boxel-ui/helpers';

export interface SectionSignature {
  Args: {};
  Element: HTMLElement;
  Blocks: { default: [] };
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
      {{#if @label.length}}
        <span class='section-label'>{{@label}}</span>
      {{/if}}
      <h2 class='section-title'>{{@headline}}</h2>
      {{#if @subheadline.length}}
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
        font-family: var(--boxel-section-heading-font-family);
        font-size: var(--boxel-section-heading-font-size);
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
      <p class='highlight-card-text'>{{@text}}</p>

      {{yield}}

      <a
        href={{if @linkUrl.length (sanitizeHtml @linkUrl) '/'}}
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

export class Section extends Component<SectionSignature> {
  <template>
    <div class='section-template' ...attributes>
      {{yield}}
    </div>

    <style scoped>
      .section-template {
        padding: var(--boxel-sp);
        text-wrap: pretty;
      }
    </style>
  </template>
}
