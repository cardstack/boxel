import { service } from '@ember/service';
import Component from '@glimmer/component';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';

import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import RealmService from '@cardstack/host/services/realm';

interface PublishingRealmArgs {
  isOpen: boolean;
}

export default class PublishingRealmPopover extends Component<PublishingRealmArgs> {
  @service declare realm: RealmService;
  @service declare operatorModeStateService: OperatorModeStateService;

  get publishingRealms() {
    return this.realm.publishingRealms(this.realmURL);
  }

  get realmURL() {
    return this.operatorModeStateService.realmURL.href;
  }

  <template>
    {{#if @isOpen}}
      <div class='publishing-realm-popover'>
        <div class='publishing-realm-header'>
          Publishing to:
        </div>
        <div class='publishing-realm-content'>
          {{#if this.publishingRealms.length}}
            <div class='realm-urls'>
              {{#each this.publishingRealms as |url|}}
                <div class='realm-item'>
                  <div class='realm-icon-container'>
                    {{#if this.operatorModeStateService.currentRealmInfo}}
                      <img
                        src={{this.operatorModeStateService.currentRealmInfo.iconURL}}
                        alt='Realm icon'
                        class='realm-icon'
                      />
                    {{else}}
                      <div class='default-realm-icon'></div>
                    {{/if}}
                  </div>
                  <div class='realm-url'>{{url}}</div>
                  <div class='status-icon'>
                    <LoadingIndicator class='loading-icon' />
                  </div>
                </div>
              {{/each}}
            </div>
          {{else}}
            <p class='no-domains-message'>No domains are currently publishing.</p>
          {{/if}}
        </div>
      </div>
    {{/if}}

    <style scoped>
      .publishing-realm-popover {
        position: absolute;
        top: 100%;
        left: 0;
        background: white;
        border: solid 1px rgba(0, 0, 0, 0.35);
        border-radius: 8px;
        box-shadow: 0 10px 15px 0 rgba(0, 0, 0, 0.25);
        min-width: 320px;
        max-width: 320px;
        z-index: 1000;
        margin-top: 4px;
        padding: var(--boxel-sp-xs);
      }

      .publishing-realm-header {
        font: 500 var(--boxel-font-xs);
        color: var(--boxel-dark);
        line-height: 2.91;
        letter-spacing: 0.17px;
      }

      .publishing-realm-content {
        padding: 0.5rem 0;
      }

      .publishing-realms-list {
        max-height: 200px;
      }

      .realm-item {
        display: flex;
        align-items: center;
        border-bottom: 1px solid var(--boxel-200);
      }

      .realm-item:last-child {
        border-bottom: none;
      }

      .realm-icon-container {
        width: 20px;
        height: 20px;
        margin-right: 0.75rem;
        flex-shrink: 0;
      }

      .realm-icon {
        width: 100%;
        height: 100%;
        border-radius: 3px;
        object-fit: cover;
      }

      .default-realm-icon {
        width: 100%;
        height: 100%;
        background-color: var(--boxel-200);
        border-radius: 3px;
      }

      .realm-url {
        flex: 1;
        font: 500 var(--boxel-font-sm);
        color: var(--boxel-dark);
        text-wrap: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .status-icon {
        margin-left: 0.75rem;
        flex-shrink: 0;
      }

      .loading-icon {
        color: var(--boxel-600);
      }

      .no-domains-message {
        text-align: center;
        color: var(--boxel-300);
        font-style: italic;
        padding: 1rem;
        font-size: var(--boxel-font-size-xs);
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }
    </style>
  </template>
}
