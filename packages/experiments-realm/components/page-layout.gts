import GlimmerComponent from '@glimmer/component';

interface PageLayoutArgs {
  Blocks: {
    header: [];
    summary: [];
    content: [];
  };
  Element: HTMLElement;
}

export default class PageLayout extends GlimmerComponent<PageLayoutArgs> {
  <template>
    <div class='page-layout' ...attributes>
      {{yield to='header'}}
      {{yield to='summary'}}
      {{yield to='content'}}
    </div>

    <style scoped>
      @layer {
        .page-layout {
          display: var(--page-layout-display, flex);
          flex-direction: var(--page-layout-flex-direction, column);
          gap: var(--page-layout-gap, var(--boxel-sp-lg));
          width: 100%;
          padding: var(--page-layout-padding, var(--boxel-sp-xl));
          box-sizing: border-box;
          background-color: var(
            --page-layout-background-color,
            var(--boxel-100)
          );
        }
      }
    </style>
  </template>
}
