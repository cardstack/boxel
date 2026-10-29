import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import {
  isHostedRealm,
  listedFavoriteRealmIdentifiers,
  wallpaperImage,
} from '@cardstack/host/lib/workspace-list';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import FlyoutWorkspace from './flyout-workspace';

import type { SectionFlyoutSignature } from './sections';

// The Workspaces entry's flyout: every favorite the page's Favorites lists,
// catalogs included, whatever the page's filter, each opening its workspace.
export default class FavoritesFlyout extends Component<SectionFlyoutSignature> {
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  @cached
  private get favorites() {
    return listedFavoriteRealmIdentifiers(
      this.matrixService.workspaceFavorites,
      this.realmServer.userRealmIdentifiers,
      this.realmServer.displayedCatalogRealmIdentifiers,
    ).map((url) => {
      let info = this.realm.info(url);
      return {
        url,
        info,
        isHosted: isHostedRealm(info),
        wallpaper: wallpaperImage(info.backgroundURL),
      };
    });
  }

  @action private async openWorkspace(url: string) {
    this.args.close();
    await this.operatorModeStateService.openWorkspace(url);
  }

  <template>
    <header class='flyout-header'>
      <span class='flyout-title' id={{@titleId}}>Favorites</span>
    </header>
    {{#each this.favorites key='url' as |favorite|}}
      <FlyoutWorkspace
        @realmInfo={{favorite.info}}
        @wallpaper={{favorite.wallpaper}}
        @isHosted={{favorite.isHosted}}
        {{on 'click' (fn this.openWorkspace favorite.url)}}
        data-test-section-rail-favorite={{favorite.info.name}}
      />
    {{else}}
      <p class='flyout-empty' data-test-section-rail-favorites-empty>
        Favorite a workspace to keep it here and at the top of the dashboard.
      </p>
    {{/each}}

    <style scoped>
      .flyout-header {
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xs) var(--boxel-sp-xs);
      }
      .flyout-title {
        font-size: var(--boxel-font-size);
        font-weight: 700;
      }
      .flyout-empty {
        margin: 0;
        padding: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}
