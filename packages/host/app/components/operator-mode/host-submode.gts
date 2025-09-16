import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import Refresh from '@cardstack/boxel-icons/refresh';

import { BoxelButton, CardContainer } from '@cardstack/boxel-ui/components';
import { PublishSiteIcon } from '@cardstack/boxel-ui/icons';

import { meta } from '@cardstack/runtime-common/constants';

import CardRenderer from '@cardstack/host/components/card-renderer';
import PublishingRealm from '@cardstack/host/components/operator-mode/publishing-realm';

import { getCard } from '@cardstack/host/resources/card-resource';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type StoreService from '@cardstack/host/services/store';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import PublishSiteModal from './publish-site-modal';
import SubmodeLayout from './submode-layout';

interface HostSubmodeSignature {
  Element: HTMLElement;
  Args: {};
}

export default class HostSubmode extends Component<HostSubmodeSignature> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare store: StoreService;
  @service private declare realmServer: RealmServerService;
  @service private declare realm: RealmService;

  @tracked isPublishSiteModalOpen = false;
  @tracked isPublishingDropdownOpen = false;

  get currentCardId() {
    return this.operatorModeStateService.currentTrailItem?.replace('.json', '');
  }

  get currentCardResource() {
    if (!this.currentCardId) {
      return undefined;
    }
    return getCard(this, () => this.currentCardId);
  }

  get currentCard() {
    return this.currentCardResource?.card;
  }

  get isError() {
    return this.currentCardResource?.cardError;
  }

  get isLoading() {
    return this.currentCardId && !this.currentCard && !this.isError;
  }

  get backgroundImageStyle() {
    if (!this.currentCard) {
      return false;
    }

    let backgroundImageUrl = this.currentCard[meta]?.realmInfo?.backgroundURL;

    if (backgroundImageUrl) {
      return htmlSafe(`background-image: url(${backgroundImageUrl});`);
    }
    return false;
  }

  get hostModeContentClass() {
    if (!this.currentCard) {
      return 'host-mode-content';
    }

    // Check if the card prefers wide format
    if ((this.currentCard.constructor as typeof CardDef).prefersWideFormat) {
      return 'host-mode-content is-wide';
    }

    return 'host-mode-content';
  }

  @action
  openPublishSiteModal() {
    this.isPublishSiteModalOpen = true;
  }

  @action
  closePublishSiteModal() {
    this.isPublishSiteModalOpen = false;
  }

  @action
  showPublishingStatus() {
    this.isPublishingDropdownOpen = !this.isPublishingDropdownOpen;
  }

  @action
  closePublishingDropdown() {
    this.isPublishingDropdownOpen = false;
  }

  @action
  handlePublish(selectedDomains: string[]) {
    if (selectedDomains.length === 0) {
      return;
    }

    try {
      this.realmServer.publishRealmToDomains(
        this.operatorModeStateService.realmURL.href,
        selectedDomains,
        () => {
          this.closePublishingDropdown();
        },
      );
      this.closePublishSiteModal();
    } catch (error) {
      console.error('Error publishing to domains:', error);
    }
  }

  <template>
    <SubmodeLayout
      class='host-submode-layout'
      data-test-host-submode
      as |layout|
    >
      <div class='host-submode' style={{this.backgroundImageStyle}}>
        <div class='host-mode-top-bar'>
          <div class='publish-button-container'>
            {{#if this.realmServer.isPublishingRealm}}
              <BoxelButton
                @kind='primary'
                @size='tall'
                class='publish-site-button publishing'
                {{on 'click' this.showPublishingStatus}}
                data-test-publish-site-button
              >
                <Refresh width='22' height='22' class='publish-icon' />
                Publishing...
              </BoxelButton>
            {{else}}
              <BoxelButton
                @kind='primary'
                @size='tall'
                class='publish-site-button'
                {{on 'click' this.openPublishSiteModal}}
                data-test-publish-site-button
              >
                <PublishSiteIcon width='22' height='22' class='publish-icon' />
                Publish Site
              </BoxelButton>
            {{/if}}
            <PublishingRealm @isOpen={{this.isPublishingDropdownOpen}} />
          </div>
        </div>
        <div class={{this.hostModeContentClass}}>
          <CardContainer @displayBoundaries={{true}} class='container'>
            {{#if this.operatorModeStateService.currentRealmInfo.publishable}}
              {{#if this.currentCard}}
                <CardContainer class='card'>
                  <CardRenderer
                    class='card-preview'
                    @card={{this.currentCard}}
                    @format='isolated'
                    data-test-host-submode-card={{this.currentCard.id}}
                  />
                </CardContainer>
              {{else if this.isError}}
                <div data-test-host-submode-error class='error-message'>
                  <p>Card not found: {{this.currentCardId}}</p>
                </div>
              {{else if this.isLoading}}
                <div class='loading-message'>
                  <p>Loading card...</p>
                </div>
              {{/if}}
            {{else}}
              <div class='non-publishable-message'>
                <p>This file is not in a publishable realm.</p>
                <BoxelButton
                  {{on 'click' (fn layout.updateSubmode 'interact')}}
                  data-test-switch-to-interact
                >View in Interact mode</BoxelButton>
              </div>
            {{/if}}
          </CardContainer>
        </div>
      </div>
    </SubmodeLayout>

    <PublishSiteModal
      @isOpen={{this.isPublishSiteModalOpen}}
      @onClose={{this.closePublishSiteModal}}
      @onPublish={{this.handlePublish}}
    />

    <style scoped>
      .host-submode-layout {
        --submode-bar-item-border-radius: var(--boxel-border-radius);
        --submode-bar-item-box-shadow: var(--boxel-deep-box-shadow);
        --submode-bar-item-outline: var(--boxel-border-flexible);
        --operator-mode-left-column: calc(
          21.5rem - var(--submode-new-file-button-width)
        );
      }

      .host-submode-layout :deep(.submode-switcher),
      .host-submode-layout :deep(.workspace-button) {
        border: 1px solid #ffffff59;
      }

      .host-submode {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        background-position: center;
        background-size: cover;
      }

      .host-mode-top-bar {
        background-color: var(--boxel-700);
        padding: var(--operator-mode-spacing);
        border-bottom: 1px solid var(--boxel-600);
        flex-shrink: 0;
        height: 60px;

        display: flex;
        align-items: center;
        justify-content: flex-start;
        padding-left: var(--operator-mode-left-column);
      }

      .publish-button-container {
        position: relative;
      }

      .host-mode-top-bar-content {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        padding-left: calc(
          var(--operator-mode-left-column) + var(--submode-switcher-width) +
            var(--operator-mode-spacing)
        );
      }

      .publish-site-button {
        border: none;
        border-radius: var(--submode-bar-item-border-radius);
        box-shadow: var(--submode-bar-item-box-shadow);
        outline: var(--submode-bar-item-outline);
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }

      .publish-icon {
        flex-shrink: 0;
      }

      .publish-site-button.publishing {
        animation: pulse 2s infinite;
      }

      @keyframes pulse {
        0% {
          opacity: 1;
        }
        50% {
          opacity: 0.7;
        }
        100% {
          opacity: 1;
        }
      }

      .host-mode-title {
        color: var(--boxel-light);
        font-weight: 600;
        font-size: var(--boxel-font-size-sm);
      }

      .host-mode-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        flex: 1;
        overflow: hidden;
        padding: var(--boxel-sp);
      }

      .host-mode-content.is-wide {
        padding: 0;
      }

      .container {
        width: 50rem;
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
      }

      .host-mode-content.is-wide .container {
        width: 100%;
        max-width: 100%;
        padding: 0;
      }

      .card {
        width: 50rem;
      }

      .host-mode-content.is-wide .card {
        width: 100%;
        max-width: 100%;
      }

      .error-message,
      .loading-message,
      .non-publishable-message,
      .no-card-message {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp);
        text-align: center;
      }

      .error-message {
        color: var(--boxel-error-100);
      }

      .host-submode :deep(.boxel-card-container) {
        overflow: auto;
      }

      .host-mode-content.is-wide :deep(.boxel-card-container) {
        border-radius: 0;
      }
    </style>
  </template>
}
