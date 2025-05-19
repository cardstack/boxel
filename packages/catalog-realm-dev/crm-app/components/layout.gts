import GlimmerComponent from '@glimmer/component';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { htmlSafe } from '@ember/template';
import { type CardOrFieldTypeIcon } from 'https://cardstack.com/base/card-api';
import ImageIcon from '@cardstack/boxel-icons/image';
import { FilterList } from '@cardstack/boxel-ui/components';
import { element } from '@cardstack/boxel-ui/helpers';
import type { Query, ResolvedCodeRef } from '@cardstack/runtime-common';
import type { SortOption } from './sort';

export interface LayoutFilter {
  displayName: string;
  icon: CardOrFieldTypeIcon;
  cardTypeName?: string;
  createNewButtonText?: string;
  isCreateNewDisabled?: boolean;
  cardRef?: ResolvedCodeRef;
  query?: Query;
  sortOptions?: SortOption[];
  selectedSort?: SortOption;
  showAdminData?: boolean;
}

interface LayoutSignature {
  Args: {
    filters: LayoutFilter[];
    activeFilter?: LayoutFilter | undefined;
    onFilterChange: (filter: LayoutFilter) => void;
  };
  Blocks: {
    default: [];
    sidebar: [];
    contentHeader: [];
    grid: [];
  };
  Element: HTMLElement;
}

export const setBackgroundImage = (
  backgroundURL: string | null | undefined,
) => {
  if (!backgroundURL) {
    return;
  }
  return htmlSafe(`background-image: url(${backgroundURL});`);
};

interface TitleGroupSignature {
  Args: {
    title?: string;
    tagline?: string;
    thumbnailURL?: string;
    icon?: CardOrFieldTypeIcon;
    element?: keyof HTMLElementTagNameMap;
  };
  Element: HTMLElement;
}
export const TitleGroup: TemplateOnlyComponent<TitleGroupSignature> = <template>
  {{#let (element @element) as |Tag|}}
    <Tag class='title-group' ...attributes>
      {{#if @thumbnailURL}}
        <div
          class='image-container thumbnail'
          style={{setBackgroundImage @thumbnailURL}}
          role='img'
          alt={{@title}}
        />
      {{else if @icon}}
        <div class='image-container'>
          <@icon class='icon' width='24' height='24' />
        </div>
      {{else}}
        <div class='image-container default-icon-container'>
          <ImageIcon width='24' height='24' />
        </div>
      {{/if}}
      <h1 class='title'>{{@title}}</h1>
      <p class='tagline'>{{@tagline}}</p>
    </Tag>
  {{/let}}
  <style scoped>
    .title-group {
      display: grid;
      grid-template-columns: max-content 1fr;
      column-gap: var(--boxel-sp-xs);
    }
    .image-container {
      grid-row: 1 / 3;
      width: var(--thumbnail-size, var(--boxel-icon-xl));
      height: var(--thumbnail-size, var(--boxel-icon-xl));
      border: 1px solid var(--boxel-450);
      border-radius: var(--boxel-border-radius-xl);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .thumbnail {
      background-position: center;
      background-repeat: no-repeat;
      background-size: cover;
    }
    .default-icon-container {
      background-color: var(--boxel-200);
      color: var(--boxel-400);
    }
    .title {
      align-self: end;
      margin: 0;
      font: 600 var(--boxel-font);
      letter-spacing: var(--boxel-lsp-xs);
    }
    .tagline {
      grid-column: 2;
      margin: 0;
      font: var(--boxel-font-sm);
      letter-spacing: var(--boxel-lsp-xs);
    }
  </style>
</template>;

export class Layout extends GlimmerComponent<LayoutSignature> {
  <template>
    <section class='layout' ...attributes>
      <aside class='sidebar'>
        {{yield to='sidebar'}}
        <FilterList
          class='sidebar-filters'
          @filters={{@filters}}
          @activeFilter={{@activeFilter}}
          @onChanged={{@onFilterChange}}
        />
      </aside>
      <section class='content'>
        <header class='content-header' aria-label={{@activeFilter.displayName}}>
          {{yield to='contentHeader'}}
        </header>
        {{#if (has-block 'grid')}}
          <div class='content-grid'>
            {{yield to='grid'}}
          </div>
        {{/if}}
      </section>
    </section>
    <style scoped>
      .layout {
        --layout-padding: var(--boxel-sp-lg);
        --sidebar-width: 255px;
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
        flex-shrink: 0;
      }
      .content {
        max-width: 100%;
        flex-grow: 1;
        display: grid;
        grid-template-rows: max-content 1fr;
        overflow-y: scroll;
      }

      /* these help hide overlay button visibility through gaps during scroll */
      .sidebar,
      .content-header {
        position: relative;
        z-index: 1;
        background-color: var(--layout-background-color);
        border-top: 1px solid var(--boxel-400);
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
        gap: var(--boxel-sp-xs) var(--boxel-sp-lg);
      }
      .content-grid {
        max-width: 100%;
        padding: var(--layout-padding);
        padding-top: 0;
      }
    </style>
  </template>
}
