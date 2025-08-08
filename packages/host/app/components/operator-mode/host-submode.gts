import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

import { BoxelButton, CardContainer } from '@cardstack/boxel-ui/components';

import { meta } from '@cardstack/runtime-common/constants';

import CardRenderer from '@cardstack/host/components/card-renderer';

import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type StoreService from '@cardstack/host/services/store';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import SubmodeLayout from './submode-layout';
import { getCard } from '@cardstack/host/resources/card-resource';

interface HostSubmodeSignature {
  Element: HTMLElement;
  Args: {};
}

export default class HostSubmode extends Component<HostSubmodeSignature> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare store: StoreService;

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

  get containerClass() {
    return 'container';
  }

  <template>
    <SubmodeLayout
      class='host-submode-layout'
      data-test-host-submode
      as |layout|
    >
      <div class='host-submode' style={{this.backgroundImageStyle}}>
        <div class='host-mode-top-bar'>
        </div>
        <div class={{this.hostModeContentClass}}>
          <CardContainer
            @displayBoundaries={{true}}
            class={{this.containerClass}}
          >
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

    <style scoped>
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
        padding: var(--boxel-sp);
        border-bottom: 1px solid var(--boxel-600);
        flex-shrink: 0;
        height: 60px;
      }

      .host-mode-top-bar-content {
        display: flex;
        align-items: center;
        justify-content: center;
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
    </style>
  </template>
}
