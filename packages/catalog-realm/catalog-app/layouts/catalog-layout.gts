import GlimmerComponent from '@glimmer/component';

import { and } from '@cardstack/boxel-ui/helpers';

interface CatalogLayoutSignature {
  Args: {
    showSidebar?: boolean; // Control visibility of sidebar
  };
  Blocks: {
    header?: []; //  header content
    sidebar?: []; //  sidebar content
    content: []; // Main content (required)
  };
  Element: HTMLElement;
}

export default class CatalogLayout extends GlimmerComponent<CatalogLayoutSignature> {
  get showSidebar() {
    return this.args.showSidebar ?? true;
  }

  <template>
    <div class='layout-container' ...attributes>
      {{yield to='header'}}

      <div class='layout-body'>
        {{#if (and (has-block 'sidebar') this.showSidebar)}}
          <aside class='sidebar'>
            {{yield to='sidebar'}}
          </aside>
        {{/if}}

        <main class='layout-content'>
          {{yield to='content'}}
        </main>
      </div>
    </div>

    <style scoped>
      .layout-container {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        background-color: var(--layout-container-background-color);
        max-height: 100vh;
        overflow: hidden;
        container-type: inline-size;
      }

      .layout-body {
        display: flex;
        flex: 1;
        overflow: hidden;
        gap: var(--column-gap);
      }

      .sidebar {
        width: var(--sidebar-width, 290px);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--layout-padding, 0);
        border-right: 1px solid var(--boxel-400);
        flex-shrink: 0;
        position: relative;
      }

      .layout-content {
        flex: 1;
        overflow-y: auto;
        min-width: 0; /* Prevents content from expanding beyond available space */
        padding: var(--layout-content-padding, var(--boxel-sp));
      }
    </style>
  </template>
}
