import { guidFor } from '@ember/object/internals';
import Component from '@glimmer/component';

import Store from '@cardstack/boxel-icons/store';

import { add, eq } from '@cardstack/boxel-ui/helpers';

import type { RealmIdentifier } from '@cardstack/runtime-common';

import { catalogRealmURL } from '@cardstack/host/lib/utils';

import ManageCatalogs from '../workspace-chooser/manage-catalogs';

import CatalogShelf from './catalog-shelf';
import Workspace from './workspace';

import type KeyboardCursor from './keyboard-cursor';

interface Signature {
  Element: HTMLElement;
  Args: {
    realmIdentifiers: RealmIdentifier[];
    emptyMessage: string | null;
    // Where the catalog tiles start in the keyboard cursor's walk.
    navBase: number;
    cursor: KeyboardCursor;
  };
}

// The Catalogs section: the catalog's stories, then the catalog workspaces as
// tiles. The dashboard places it ahead of Workspaces or after them.
export default class CatalogSection extends Component<Signature> {
  // Named by the title span in its heading, so the count stays out of the
  // name.
  private headingId = `${guidFor(this)}-catalogs`;

  private catalogRealmURL = catalogRealmURL;

  private get count() {
    return this.args.emptyMessage ? 0 : this.args.realmIdentifiers.length;
  }

  <template>
    <section
      class='dashboard-section'
      aria-labelledby={{this.headingId}}
      data-test-dashboard-section='catalogs'
      ...attributes
    >
      <div class='section-head'>
        <h2 class='section-title'>
          <Store
            class='section-icon'
            width='20'
            height='20'
            aria-hidden='true'
          />
          <span id={{this.headingId}}>Catalogs</span>
          {{#if this.count}}
            <span class='group-count'>{{this.count}}</span>
          {{/if}}
        </h2>
        <ManageCatalogs />
        <p class='section-hint'>Apps, fields and themes to use in your
          workspaces.</p>
      </div>
      {{#if this.catalogRealmURL}}
        <CatalogShelf @realmURL={{this.catalogRealmURL}} />
      {{/if}}
      {{#if @emptyMessage}}
        <p class='group-empty' data-test-catalog-empty>{{@emptyMessage}}</p>
      {{else}}
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
      {{/if}}
    </section>

    <style scoped>
      .dashboard-section {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xl);
      }
      .section-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        column-gap: var(--boxel-sp-xs);
        row-gap: var(--boxel-sp-2xs);
        padding-bottom: var(--boxel-sp-sm);
        border-bottom: 1px solid var(--boxel-light-10);
      }
      .section-title {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        margin: 0;
        font-size: var(--dashboard-section-title-font-size);
        font-weight: 700;
        letter-spacing: -0.015em;
      }
      .section-icon {
        --icon-color: var(--muted-foreground);
        color: var(--muted-foreground);
        flex-shrink: 0;
      }
      .section-hint {
        flex-basis: 100%;
        margin: 0;
        font-size: var(--dashboard-section-hint-font-size);
        color: var(--muted-foreground);
      }
      .group-count {
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--subtle-foreground);
      }
      .group-count::before {
        content: '· ' / '';
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
