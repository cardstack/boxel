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
    <article class='summary-card' ...attributes>
      <header class='summary-card-header'>
        <div class='summary-card-title'>
          {{yield to='title'}}
        </div>
        <div class='summary-card-icon'>
          {{yield to='icon'}}
        </div>
      </header>
      <div class='summary-card-content'>
        {{#if (has-block 'content')}}
          {{yield to='content'}}
        {{/if}}
      </div>
    </article>

    <style scoped>
      .summary-card {
        background: var(--summary-card-bg, var(--boxel-light));
        border: 1px solid var(--summary-card-border, var(--boxel-border));
        border-radius: var(
          --summary-card-border-radius,
          var(--boxel-border-radius-xl)
        );
        box-shadow: var(--summary-card-box-shadow, var(--boxel-box-shadow));
        padding: var(--summary-card-padding, var(--boxel-sp-sm));
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: var(--summary-card-gap, var(--boxel-sp-sm));
        overflow: hidden;
        min-width: 0;
      }
      .summary-card-header {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--summary-card-header-gap, var(--boxel-sp-sm));
      }
      .summary-card-title {
        font-size: var(
          --summary-card-title-font-size,
          var(--boxel-font-size-sm)
        );
        font-weight: var(--summary-card-title-font-weight, 600);
        margin: 0;
      }
      .summary-card-icon {
        flex-shrink: 0;
      }
    </style>
  </template>
}
