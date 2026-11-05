import { guidFor } from '@ember/object/internals';
import Component from '@glimmer/component';

import Store from '@cardstack/boxel-icons/store';

import { add, eq } from '@cardstack/boxel-ui/helpers';

import type { RealmIdentifier } from '@cardstack/runtime-common';

import { catalogRealmURL } from '@cardstack/host/lib/utils';

import ManageCatalogs from '../workspace-chooser/manage-catalogs';

import CatalogShelf from './catalog-shelf';
import SectionHead from './section-head';
import Workspace from './workspace';

import type KeyboardCursor from './keyboard-cursor';

interface Signature {
  Element: HTMLElement;
  Args: {
    realmIdentifiers: RealmIdentifier[];
    // Shown in place of the tiles when there are none.
    emptyMessage: string;
    showShelf: boolean;
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

  private get shelfRealmURL() {
    return this.args.showShelf ? catalogRealmURL : null;
  }

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
      {{#if this.shelfRealmURL}}
        <CatalogShelf @realmURL={{this.shelfRealmURL}} />
      {{/if}}
      {{#if @realmIdentifiers.length}}
        <div class='catalog-list' data-test-catalog-list>
          {{#each @realmIdentifiers as |realmIdentifier i|}}
            {{#let (add @navBase i) as |navIndex|}}
              <Workspace
                @realmIdentifier={{realmIdentifier}}
                @variant='tile'
                @navIndex={{navIndex}}
                @isSelected={{eq @cursor.currentIndex navIndex}}
                @selectionActive={{@cursor.isRingShown}}
              />
            {{/let}}
          {{/each}}
        </div>
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
        padding: var(--boxel-sp-xs) 0;
      }
    </style>
  </template>
}
