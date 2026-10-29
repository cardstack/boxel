import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { Button } from '@cardstack/pretui/components/button';

import { RealmIcon } from '@cardstack/boxel-ui/components';
import { cssVar } from '@cardstack/boxel-ui/helpers';

import {
  isHostedRealm,
  orderedCatalogRealmURLs,
  wallpaperImage,
} from '@cardstack/host/lib/workspace-list';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import HostedPill from './hosted-pill';

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
      <Button
        class='catalog'
        @appearance='plain'
        {{on 'click' (fn this.openWorkspace catalog.url)}}
        data-test-section-rail-catalog={{catalog.info.name}}
      >
        <span class='catalog-content'>
          <span
            class='catalog-thumb'
            style={{cssVar catalog-wallpaper=catalog.wallpaper}}
          >
            <RealmIcon
              class='catalog-icon'
              @realmInfo={{catalog.info}}
              aria-hidden='true'
            />
          </span>
          <span class='catalog-name'>{{catalog.info.name}}</span>
          {{#if catalog.isHosted}}
            <HostedPill />
          {{/if}}
        </span>
      </Button>
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
      .catalog {
        --pretui-button-h: 2.75rem;
        --pretui-button-px: var(--boxel-sp-xs);
        --pretui-button-radius: var(--boxel-border-radius-lg);
        justify-content: flex-start;
        width: 100%;
      }
      /* The panel's content width, less the row's padding and border, so a
         long name truncates instead of widening the row. */
      .catalog-content {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        width: calc(
          var(--section-rail-flyout-content-width) - 2 * var(--boxel-sp-xs) -
            2px
        );
      }
      .catalog-thumb {
        position: relative;
        flex-shrink: 0;
        width: 3rem;
        height: 2rem;
        border-radius: var(--boxel-border-radius-sm);
        background-color: var(--muted);
        background-image: var(--catalog-wallpaper);
        background-size: cover;
        background-position: center;
        box-shadow: inset 0 0 0 1px var(--boxel-light-10);
      }
      .catalog-icon {
        --boxel-realm-icon-size: 1.125rem;
        --boxel-realm-icon-border-radius: var(--boxel-border-radius-xs);
        --boxel-realm-icon-background-color: var(--boxel-light);
        position: absolute;
        inset-inline-start: var(--boxel-sp-5xs);
        bottom: var(--boxel-sp-5xs);
      }
      .catalog-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-align: start;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
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
