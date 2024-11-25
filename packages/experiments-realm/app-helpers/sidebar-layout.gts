import GlimmerComponent from '@glimmer/component';
import { FilterList } from '@cardstack/boxel-ui/components';
import type { SidebarFilter } from './filter';

interface SidebarLayoutSignature {
  Args: {
    filters: SidebarFilter[];
    activeFilter: SidebarFilter;
    onFilterChange: (filter: SidebarFilter) => void;
  };
  Blocks: {
    default: [];
    'sidebar-header': [];
    'sidebar-subheader': [];
    'sidebar-content': [];
    'content-header': [];
    'content-subheader': [];
    grid: [];
  };
  Element: HTMLElement;
}
export class SidebarLayout extends GlimmerComponent<SidebarLayoutSignature> {
  <template>
    <section class='sidebar-layout'>
      <aside class='sidebar-layout-column sidebar'>
        <header class='sidebar-header' aria-label='sidebar-header'>
          {{yield to='sidebar-header'}}
        </header>
        {{yield to='sidebar-subheader'}}
        {{#if (has-block 'sidebar-content')}}
          {{yield to='sidebar-content'}}
        {{else}}
          <FilterList
            class='sidebar-filters'
            @filters={{@filters}}
            @activeFilter={{@activeFilter}}
            @onChanged={{@onFilterChange}}
          />
        {{/if}}
      </aside>
      <section class='sidebar-layout-column content'>
        <header class='content-header' aria-label={{@activeFilter.displayName}}>
          {{yield to='content-header'}}
        </header>
        {{#if (has-block 'content-subheader')}}
          {{yield to='content-subheader'}}
        {{/if}}
        {{#if (has-block 'grid')}}
          {{yield to='grid'}}
        {{/if}}
      </section>
    </section>
    <style scoped>
      .sidebar-layout {
        display: flex;
        width: 100%;
        max-width: 100%;
        height: 100%;
        max-height: 100vh;
        background-color: var(--boxel-light);
        border-top: 1px solid var(--boxel-400);
        overflow: hidden;
      }
      .sidebar-layout-column {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-lg);
        max-width: 100%;
      }
      .sidebar-layout-column + .sidebar-layout-column {
        border-left: 1px solid var(--boxel-400);
      }
      .sidebar {
        width: 255px;
      }
      .content {
        flex-grow: 1;
      }

      .sidebar-header {
        display: grid;
        grid-template-columns: auto 1fr;
        column-gap: var(--boxel-sp-xs);
      }
      .sidebar-create-button {
        --icon-color: currentColor;
        --boxel-loading-indicator-size: 15px;
        gap: var(--boxel-sp-xs);
        font-weight: 600;
      }
      .sidebar-create-button-icon {
        flex-shrink: 0;
      }
      .sidebar-create-button :deep(.loading-indicator) {
        margin: 0;
      }

      /* TODO: fix filter component styles in boxel-ui */
      .sidebar-filters {
        width: auto;
        margin: 0;
        gap: var(--boxel-sp-4xs);
      }
      .sidebar-filters > :deep(button) {
        margin: 0;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .sidebar-filters > :deep(button > svg) {
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
      }

      .content-header {
        min-height: 60px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs) var(--boxel-sp-lg);
      }
    </style>
  </template>
}
