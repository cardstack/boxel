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
  listedFavoriteRealmIdentifiers,
} from '@cardstack/host/lib/workspace-list';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

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
        wallpaper: info.backgroundURL
          ? `url("${info.backgroundURL}")`
          : undefined,
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
      <Button
        class='favorite'
        @appearance='plain'
        {{on 'click' (fn this.openWorkspace favorite.url)}}
        data-test-section-rail-favorite={{favorite.info.name}}
      >
        <span class='favorite-content'>
          <span
            class='favorite-thumb'
            style={{cssVar favorite-wallpaper=favorite.wallpaper}}
          >
            <RealmIcon
              class='favorite-icon'
              @realmInfo={{favorite.info}}
              aria-hidden='true'
            />
          </span>
          <span class='favorite-name'>{{favorite.info.name}}</span>
          {{#if favorite.isHosted}}
            <span class='hosted-chip'>Hosted</span>
          {{/if}}
        </span>
      </Button>
    {{else}}
      <p class='flyout-empty' data-test-section-rail-favorites-empty>
        Star a workspace to keep it here and at the top of the dashboard.
      </p>
    {{/each}}

    <style scoped>
      .flyout-header {
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xs) var(--boxel-sp-xs);
      }
      .flyout-title {
        font-size: var(--boxel-font-size);
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      .favorite {
        --pretui-button-h: 2.75rem;
        --pretui-button-px: var(--boxel-sp-xs);
        --pretui-button-radius: var(--boxel-border-radius-lg);
        justify-content: flex-start;
        width: 100%;
      }
      /* The panel's content width, less the row's padding and border, so a
         long name truncates instead of widening the row. */
      .favorite-content {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        width: calc(
          var(--section-rail-flyout-content-width) - 2 * var(--boxel-sp-xs) -
            2px
        );
      }
      .favorite-thumb {
        position: relative;
        flex-shrink: 0;
        width: 3rem;
        height: 2rem;
        border-radius: var(--boxel-border-radius-sm);
        background-color: var(--muted);
        background-image: var(--favorite-wallpaper);
        background-size: cover;
        background-position: center;
        box-shadow: inset 0 0 0 1px var(--boxel-light-10);
      }
      .favorite-icon {
        --boxel-realm-icon-size: 1.125rem;
        --boxel-realm-icon-border-radius: var(--boxel-border-radius-xs);
        --boxel-realm-icon-background-color: var(--boxel-light);
        position: absolute;
        left: var(--boxel-sp-5xs);
        bottom: var(--boxel-sp-5xs);
      }
      .favorite-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
      }
      /* The workspace tile's Hosted pill: lime, with its dot. */
      .hosted-chip {
        flex-shrink: 0;
        padding: var(--boxel-sp-6xs) var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius-lg);
        color: var(--boxel-lime);
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-2xs);
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .hosted-chip::before {
        content: '● ' / '';
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
