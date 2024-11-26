import GlimmerComponent from '@glimmer/component';
import { FilterList } from '@cardstack/boxel-ui/components';
import type { SidebarFilter } from './filter';

interface SidebarLayoutSignature {
  Args: {
    filters: SidebarFilter[];
    activeFilter?: SidebarFilter | undefined;
    onFilterChange: (filter: SidebarFilter) => void;
  };
  Blocks: {
    default: [];
    sidebarHeader: [];
    sidebarSubheader: [];
    contentHeader: [];
    contentSubheader: [];
    grid: [];
  };
  Element: HTMLElement;
}
export class SidebarLayout extends GlimmerComponent<SidebarLayoutSignature> {
  <template>
    <section class='sidebar-layout'>
      <aside class='sidebar'>
        <header class='sidebar-header' aria-label='sidebar-header'>
          {{yield to='sidebarHeader'}}
        </header>
        {{yield to='sidebarSubheader'}}
        <FilterList
          class='sidebar-filters'
          @filters={{@filters}}
          @activeFilter={{@activeFilter}}
          @onChanged={{@onFilterChange}}
        />
      </aside>
      <section class='content'>
        <div>
          <header
            class='content-header'
            aria-label={{@activeFilter.displayName}}
          >
            {{yield to='contentHeader'}}
          </header>
          {{#if (has-block 'contentSubheader')}}
            <div class='content-subheader'>
              {{yield to='contentSubheader'}}
            </div>
          {{/if}}
        </div>
        {{#if (has-block 'grid')}}
          <div class='content-grid content-scroll-container'>
            {{yield to='grid'}}
          </div>
        {{/if}}
      </section>
    </section>
    <style scoped>
      .sidebar-layout {
        --layout-padding: var(--boxel-sp-lg);
        --sidebar-width: 255px;
        --content-max-width: 1040px;
        --layout-background-color: var(--boxel-light);
        display: flex;
        width: 100%;
        max-width: 100%;
        height: 100%;
        max-height: 100vh;
        overflow: hidden;
      }
      .sidebar {
        width: var(--sidebar-width);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--layout-padding);
        border-right: 1px solid var(--boxel-400);
      }
      .content {
        max-width: 100%;
        flex-grow: 1;
        display: grid;
        grid-template-rows: max-content 1fr;
        gap: var(--boxel-sp-lg);
      }
      .sidebar-header {
        display: grid;
        grid-template-columns: max-content 1fr;
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
        min-height: calc(60px + 2 * var(--layout-padding));
        padding: var(--layout-padding);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs) var(--boxel-sp-lg);
      }
      .content-subheader {
        min-height: calc(60px + 2 * var(--layout-padding));
        padding: 0 var(--layout-padding);
        min-height: 60px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs) var(--boxel-sp-lg);
      }
      .content-grid {
        max-width: var(--content-max-width);
        padding-left: var(--layout-padding);
        padding-bottom: var(--layout-padding);
      }
      .content-scroll-container {
        padding-right: var(--layout-padding);
        overflow: auto;
      }
    </style>
  </template>
}
