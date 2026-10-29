import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import {
  isHostedRealm,
  orderedCatalogRealmURLs,
  wallpaperImage,
} from '@cardstack/host/lib/workspace-list';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import FlyoutWorkspace from './flyout-workspace';

import type { SectionFlyoutSignature } from './sections';

// The Catalogs entry's flyout: every catalog, in the page's order and
// whatever its filter, each opening its workspace.
export default class CatalogsFlyout extends Component<SectionFlyoutSignature> {
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  @cached
  private get catalogs() {
    return orderedCatalogRealmURLs(
      this.realmServer.displayedCatalogRealmIdentifiers,
      this.realm.info,
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
      <span class='flyout-title' id={{@titleId}}>Catalogs</span>
    </header>
    {{#each this.catalogs key='url' as |catalog|}}
      <FlyoutWorkspace
        @realmInfo={{catalog.info}}
        @wallpaper={{catalog.wallpaper}}
        @isHosted={{catalog.isHosted}}
        {{on 'click' (fn this.openWorkspace catalog.url)}}
        data-test-section-rail-catalog={{catalog.info.name}}
      />
    {{else}}
      <p class='flyout-empty' data-test-section-rail-catalogs-empty>
        No catalogs yet. Add public realms with the gear in the Catalogs
        section.
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
