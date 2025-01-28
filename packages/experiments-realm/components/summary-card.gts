import GlimmerComponent from '@glimmer/component';

interface SummaryCardArgs {
  Blocks: {
    content: [];
    icon: [];
    title: [];
  };
  Element: HTMLElement;
}

export default class SummaryCard extends GlimmerComponent<SummaryCardArgs> {
  <template>
    <div class='summary-card' ...attributes>
      <header class='summary-card-header'>
        {{#if (has-block 'title')}}
          {{yield to='title'}}
        {{/if}}

        {{#if (has-block 'icon')}}
          <div class='summary-card-icon'>
            {{yield to='icon'}}
          </div>
        {{/if}}
      </header>

      {{#if (has-block 'content')}}
        <div class='summary-card-content'>
          {{yield to='content'}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .summary-card {
        background: var(--summary-card-bg, var(--boxel-light));
        border: var(--summary-card-border, 1px solid rgba(0 0 0 / 10%));
        border-radius: var(
          --summary-card-border-radius,
          var(--boxel-border-radius-xl)
        );
        box-shadow: var(
          --summary-card-box-shadow,
          0 2px 2px 0 rgba(0 0 0 / 16%)
        );
        padding: var(--summary-card-padding, var(--boxel-sp-sm));
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: var(--summary-card-gap, var(--boxel-sp-xs));
        overflow: hidden;
        min-height: var(--summary-card-min-height, 95px);
      }
      .summary-card-header {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--summary-card-header-gap, var(--boxel-sp-sm));
      }
      .summary-card-icon {
        flex-shrink: 0;
      }
      .summary-card-content {
        display: var(--summary-card-content-display, flex);
        flex-direction: var(--summary-card-content-direction, column);
        gap: var(--summary-card-content-gap, var(--boxel-sp-xs));
      }
    </style>
  </template>
}
