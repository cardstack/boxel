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
  wallpaperImage,
} from '@cardstack/host/lib/workspace-list';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';

import HostedPill from './hosted-pill';

import type { SectionFlyoutSignature } from './sections';

interface Signature {
  Args: SectionFlyoutSignature['Args'] & {
    title: string;
    realmURLs: string[];
    emptyMessage: string;
  };
}

// A section rail flyout that lists realms, each opening its workspace.
export default class RealmListFlyout extends Component<Signature> {
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;

  @cached
  private get realms() {
    return this.args.realmURLs.map((url) => {
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
      <span class='flyout-title' id={{@titleId}}>{{@title}}</span>
    </header>
    {{#each this.realms key='url' as |realm|}}
      <Button
        class='realm'
        @appearance='plain'
        {{on 'click' (fn this.openWorkspace realm.url)}}
        data-test-section-rail-realm={{realm.info.name}}
      >
        <span class='realm-content'>
          <span
            class='realm-thumb'
            style={{cssVar realm-wallpaper=realm.wallpaper}}
          >
            <RealmIcon
              class='realm-icon'
              @realmInfo={{realm.info}}
              aria-hidden='true'
            />
          </span>
          <span class='realm-name'>{{realm.info.name}}</span>
          {{#if realm.isHosted}}
            <HostedPill />
          {{/if}}
        </span>
      </Button>
    {{else}}
      <p class='flyout-empty' data-test-section-rail-flyout-empty>
        {{@emptyMessage}}
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
      .realm {
        --pretui-button-h: 2.75rem;
        --pretui-button-px: var(--boxel-sp-xs);
        --pretui-button-radius: var(--boxel-border-radius-lg);
        justify-content: flex-start;
        width: 100%;
      }
      /* The panel's content width, less the row's padding and border, so a
         long name truncates instead of widening the row. */
      .realm-content {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        width: calc(
          var(--section-rail-flyout-content-width) - 2 * var(--boxel-sp-xs) -
            2px
        );
      }
      .realm-thumb {
        position: relative;
        flex-shrink: 0;
        width: 3rem;
        height: 2rem;
        border-radius: var(--boxel-border-radius-sm);
        background-color: var(--muted);
        background-image: var(--realm-wallpaper);
        background-size: cover;
        background-position: center;
        box-shadow: inset 0 0 0 1px var(--boxel-light-10);
      }
      .realm-icon {
        --boxel-realm-icon-size: 1.125rem;
        --boxel-realm-icon-border-radius: var(--boxel-border-radius-xs);
        --boxel-realm-icon-background-color: var(--boxel-light);
        position: absolute;
        inset-inline-start: var(--boxel-sp-5xs);
        bottom: var(--boxel-sp-5xs);
      }
      .realm-name {
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
