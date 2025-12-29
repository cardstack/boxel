import Component from '@glimmer/component';

// import { Button } from '@cardstack/boxel-ui/components';
// import { cn, eq } from '@cardstack/boxel-ui/helpers';

export interface SectionSignature {
  Args: {};
  Blocks: { default: [] };
  Element: HTMLElement;
}

export interface SectionHeaderSignature {
  Args: {
    headline?: string;
    subheadline?: string;
    label?: string;
  };
  Blocks: { default: [] };
}

export class SectionHeader extends Component<SectionHeaderSignature> {
  <template>
    <div class='section-header'>
      {{#if @label}}
        <span class='section-number'>{{@label}}</span>
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
      }
      .section-number {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--boxel-slate);
        margin-bottom: 0.75rem;
        display: block;
      }
      .section-title {
        font-size: clamp(2.5rem, 6vw, 4rem);
        font-weight: 700;
        line-height: 1.05;
        letter-spacing: -0.03em;
        margin: 0 0 1.25rem 0;
        color: var(--boxel-slate);
      }
      .section-subtitle {
        font-size: 1.125rem;
        font-weight: 400;
        color: var(--text-muted);
        max-width: 520px;
        line-height: 1.7;
      }
    </style>
  </template>
}

export class Section extends Component<SectionSignature> {
  <template>
    <div class='section' ...attributes>
      {{yield}}
    </div>

    <style scoped>
      .section {
        text-wrap: pretty;
      }
    </style>
  </template>
}
