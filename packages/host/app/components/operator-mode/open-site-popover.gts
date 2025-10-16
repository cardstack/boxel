import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import ExternalLink from '@cardstack/boxel-icons/external-link';

import window from 'ember-window-mock';

import { BoxelButton } from '@cardstack/boxel-ui/components';

import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import RealmService from '@cardstack/host/services/realm';

interface OpenSitePopoverArgs {
  isOpen: boolean;
}

export default class OpenSitePopover extends Component<OpenSitePopoverArgs> {
  @service declare realm: RealmService;
  @service declare operatorModeStateService: OperatorModeStateService;

  getFullURL = (baseURL: string) => {
    if (this.currentCardId) {
      return baseURL + this.currentCardId.replace(this.realmURL, '');
    }
    return baseURL;
  };

  get publishedRealms() {
    const realmInfo = this.operatorModeStateService.currentRealmInfo;
    if (
      !realmInfo?.lastPublishedAt ||
      typeof realmInfo.lastPublishedAt !== 'object'
    ) {
      return [];
    }

    // Return the URLs that have been published (keys of lastPublishedAt)
    return Object.keys(realmInfo.lastPublishedAt);
  }

  get hasPublishedRealms() {
    return this.publishedRealms.length > 0;
  }

  get realmURL() {
    return this.operatorModeStateService.realmURL.href;
  }

  get currentCardId() {
    return this.operatorModeStateService.hostModePrimaryCard?.replace(
      '.json',
      '',
    );
  }

  @action
  openSite(url: string) {
    window.open(url, '_blank');
  }

  <template>
    {{#if @isOpen}}
      <div class='open-site-popover' data-test-open-site-popover>
        {{#if this.hasPublishedRealms}}
          <div class='published-realms'>
            {{#each this.publishedRealms as |url|}}
              <div
                class='realm-item'
                data-test-published-realm-item={{this.getFullURL url}}
              >
                <div class='realm-url'>{{this.getFullURL url}}</div>
                <BoxelButton
                  @kind='secondary-light'
                  @size='small'
                  {{on 'click' (fn this.openSite (this.getFullURL url))}}
                  class='open-site-button'
                  data-test-open-site-button
                >
                  <ExternalLink
                    width='16'
                    height='16'
                    class='external-link-icon'
                  />
                  Open
                </BoxelButton>
              </div>
            {{/each}}
          </div>
        {{else}}
          <p class='no-published-message'>No sites are currently published.</p>
        {{/if}}
      </div>
    {{/if}}

    <style scoped>
      .open-site-popover {
        position: absolute;
        top: 100%;
        right: 0;
        background: white;
        border: solid 1px rgba(0, 0, 0, 0.35);
        border-radius: 8px;
        box-shadow: 0 10px 15px 0 rgba(0, 0, 0, 0.25);
        z-index: 1000;
        margin-top: 4px;
        padding: var(--boxel-sp-xs);
        min-width: 320px;
        max-width: 450px;
      }

      .published-realms {
        max-height: 200px;
        overflow-y: auto;
      }

      .realm-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid var(--boxel-light-200);
        padding: 0.5rem 0;
      }

      .realm-item:last-child {
        border-bottom: none;
      }

      .realm-url {
        flex: 1;
        font: 500 var(--boxel-font-sm);
        color: var(--boxel-dark);
        text-wrap: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-right: 0.75rem;
      }

      .open-site-button {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
        font-size: var(--boxel-font-size-xs);
      }

      .external-link-icon {
        flex-shrink: 0;
      }

      .no-published-message {
        text-align: center;
        color: var(--boxel-light-600);
        font-style: italic;
        padding: 1rem;
        font-size: var(--boxel-font-size-xs);
      }
    </style>
  </template>
}
