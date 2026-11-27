import { guidFor } from '@ember/object/internals';
import Component from '@glimmer/component';

import Store from '@cardstack/boxel-icons/store';

import { add, eq } from '@cardstack/boxel-ui/helpers';

import type { RealmIdentifier } from '@cardstack/runtime-common';

import ManageCatalogs from '../dashboard-modals/manage-catalogs';

import CatalogShelf, { type CatalogShelfStories } from './catalog-shelf';
import SectionHead from './section-head';
import Workspace from './workspace';

import type KeyboardCursor from './keyboard-cursor';

interface Signature {
  Element: HTMLElement;
  Args: {
    realmIdentifiers: RealmIdentifier[];
    // Shown in place of the tiles when there are none.
    emptyMessage: string;
    // Shown above the tiles while it has a catalog.
    shelf: CatalogShelfStories;
    // Where the shelf's stories start in the keyboard cursor's walk.
    shelfNavBase: number;
    // Where the catalog tiles start in the keyboard cursor's walk.
    navBase: number;
    cursor: KeyboardCursor;
  };
}

// The Catalogs section: the catalog's stories, then the catalog workspaces as
// tiles.
export default class CatalogSection extends Component<Signature> {
  // Named by the title span in its heading, so the count stays out of the
  // name.
  private headingId = `${guidFor(this)}-catalogs`;

  <template>
    <section
      class='dashboard-section'
      aria-labelledby={{this.headingId}}
      data-test-dashboard-section='catalogs'
      ...attributes
    >
      <SectionHead
        @icon={{Store}}
        @title='Catalogs'
        @titleId={{this.headingId}}
        @count={{@realmIdentifiers.length}}
      >
        <:actions><ManageCatalogs /></:actions>
        <:default>Apps, fields and themes to use in your workspaces.</:default>
      </SectionHead>
      {{#if @shelf.realmURL}}
        <CatalogShelf
          @stories={{@shelf}}
          @navBase={{@shelfNavBase}}
          @cursor={{@cursor}}
        />
      {{/if}}
      {{#if @realmIdentifiers.length}}
        {{! The role keeps the list semantics Safari drops from a list with no
            markers. }}
        <ul
          class='catalog-list'
          role='list'
          data-workspace-list
          data-test-catalog-list
        >
          {{#each @realmIdentifiers as |realmIdentifier i|}}
            {{#let (add @navBase i) as |navIndex|}}
              <li class='list-item'>
                <Workspace
                  @realmIdentifier={{realmIdentifier}}
                  @variant='tile'
                  @navIndex={{navIndex}}
                  @isSelected={{eq @cursor.currentIndex navIndex}}
                  @selectionActive={{@cursor.isRingShown}}
                />
              </li>
            {{/let}}
          {{/each}}
        </ul>
      {{else}}
        <p class='group-empty' data-test-catalog-empty>{{@emptyMessage}}</p>
      {{/if}}
    </section>

    <style scoped>
      .dashboard-section {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xl);
      }
      .group-empty {
        margin: 0;
        color: var(--muted-foreground);
        font: 400 var(--boxel-font-sm);
      }
      .catalog-list {
        display: grid;
        grid-template-columns: repeat(
          auto-fill,
          minmax(min(var(--dashboard-tile-min-width), 100%), 1fr)
        );
        gap: var(--boxel-sp-lg) var(--boxel-sp);
        margin: 0;
        padding: var(--boxel-sp-xs) 0;
        list-style: none;
      }
      /* A one-cell grid, so the tile fills the list's grid cell. */
      .list-item {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-width: 0;
      }
    </style>
  </template>
}
