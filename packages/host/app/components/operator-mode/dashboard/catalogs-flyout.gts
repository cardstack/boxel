import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { orderedCatalogRealmURLs } from '@cardstack/host/lib/workspace-list';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import RealmListFlyout from './realm-list-flyout';

import type { SectionFlyoutSignature } from './sections';

// The Catalogs entry's flyout: every catalog, in the page's order and
// whatever its filter.
export default class CatalogsFlyout extends Component<SectionFlyoutSignature> {
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  @cached
  private get catalogURLs() {
    return orderedCatalogRealmURLs(
      this.realmServer.displayedCatalogRealmIdentifiers,
      this.realm.info,
    );
  }

  <template>
    <RealmListFlyout
      @title='Catalogs'
      @titleId={{@titleId}}
      @close={{@close}}
      @realmURLs={{this.catalogURLs}}
      @emptyMessage='No catalogs yet. Add one from the Catalogs section.'
    />
  </template>
}
