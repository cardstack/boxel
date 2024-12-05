import GlimmerComponent from '@glimmer/component';

interface ContentCardArgs {
  Blocks: {
    title: [];
    icon: [];
    content: [];
  };
  Element: HTMLElement;
}

class ContentCard extends GlimmerComponent<ContentCardArgs> {
  <template>
    <article class='content'>
      <header class='content-header'>
        {{#if (has-block 'title')}}
          {{yield to='title'}}
        {{/if}}
        {{#if (has-block 'icon')}}
          {{yield to='icon'}}
        {{/if}}
      </header>
      <div class='content-display'>
        {{#if (has-block 'content')}}
          {{yield to='content'}}
        {{/if}}
      </div>
    </article>

    <style scoped>
      .content {
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
      .content-header {
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

export default ContentCard;
