import GlimmerComponent from '@glimmer/component';
// @ts-ignore
import type { ComponentLike } from '@glint/template';
import { cn } from '@cardstack/boxel-ui/helpers';

interface SummaryCardArgs {
  Args: {
    size?: 'small' | 'default';
    iconComponent?: ComponentLike<{ Element: Element }>;
    title?: string;
  };
  Blocks: {
    content: [];
    icon: [];
    title: [];
  };
  Element: HTMLElement;
}

export default class SummaryCard extends GlimmerComponent<SummaryCardArgs> {
  <template>
    <div class={{cn 'summary-card' @size}} ...attributes>
      <header class='summary-card-header'>
        {{#if (has-block 'title')}}
          {{yield to='title'}}
        {{else if @title}}
          <h3 class='summary-title'>{{@title}}</h3>
        {{/if}}
        {{#if @iconComponent}}
          <@iconComponent class='summary-card-icon' />
        {{else if (has-block 'icon')}}
          {{yield to='icon'}}
        {{/if}}
      </header>

      {{#if (has-block 'content')}}
        <div class='summary-card-content'>
          {{yield to='content'}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      @layer {
        .summary-card {
          --entity-display-title-font-weight: 400;
          --summary-card-min-height: 170px;

          background-color: var(--boxel-light);
          border: 1px solid rgba(0 0 0 / 10%);
          border-radius: var(--boxel-border-radius-xl);
          box-shadow: 0 2px 2px 0 rgba(0 0 0 / 16%);
          padding: var(--boxel-sp);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: var(--boxel-sp-sm);
          overflow: hidden;
          min-height: var(--summary-card-min-height);
        }
        .summary-card.small {
          --summary-card-min-height: 95px;
          gap: var(--boxel-sp-xs);
        }
        .summary-card-header {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--summary-card-header-gap, var(--boxel-sp-sm));
        }
        .summary-title {
          margin-block: 0;
          font: 600 var(--boxel-font);
          letter-spacing: var(--boxel-lsp-xxs);
          align-self: flex-start;
        }
        .summary-card-icon {
          flex-shrink: 0;
          margin-left: auto;
          width: var(--boxel-icon-sm);
          height: var(--boxel-icon-sm);
          align-self: flex-start;
        }
        .summary-card-content {
          display: var(--summary-card-content-display, flex);
          flex-direction: var(--summary-card-content-direction, column);
          gap: var(--summary-card-content-gap, var(--boxel-sp-xs));
        }
      }
    </style>
  </template>
}
