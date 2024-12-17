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
        {{#if (has-block 'title')}}
          {{yield to='title'}}
        {{/if}}
        {{#if (has-block 'icon')}}
          {{yield to='icon'}}
        {{/if}}
      </header>
      <div class='summary-card-content'>
        {{#if (has-block 'content')}}
          {{yield to='content'}}
        {{/if}}
      </div>
    </article>

    <style scoped>
      .summary-card {
        background: var(--boxel-light);
        border: 1px solid var(--boxel-border);
        border-radius: var(--boxel-border-radius-xl);
        box-shadow: var(--boxel-box-shadow);
        padding: var(--boxel-sp-sm);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: var(--boxel-sp-sm);
        overflow: hidden;
        min-width: 0;
      }
      .summary-card-header {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-sm);
      }
    </style>
  </template>
}
