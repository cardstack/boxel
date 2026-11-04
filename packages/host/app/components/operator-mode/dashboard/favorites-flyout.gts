import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { listedFavoriteRealmIdentifiers } from '@cardstack/host/lib/workspace-list';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type RealmServerService from '@cardstack/host/services/realm-server';

import RealmListFlyout from './realm-list-flyout';

import type { SectionFlyoutSignature } from './sections';

// The Workspaces entry's flyout: every favorite the page's Favorites lists,
// catalogs included, whatever the page's filter.
export default class FavoritesFlyout extends Component<SectionFlyoutSignature> {
  @service declare private matrixService: MatrixService;
  @service declare private realmServer: RealmServerService;

  @cached
  private get favoriteURLs() {
    return listedFavoriteRealmIdentifiers(
      this.matrixService.workspaceFavorites,
      this.realmServer.userRealmIdentifiers,
      this.realmServer.displayedCatalogRealmIdentifiers,
    );
  }

  <template>
    <RealmListFlyout
      @title='Favorites'
      @titleId={{@titleId}}
      @close={{@close}}
      @realmURLs={{this.favoriteURLs}}
      @emptyMessage='Favorite a workspace to keep it here and at the top of the dashboard.'
    />
  </template>
}
