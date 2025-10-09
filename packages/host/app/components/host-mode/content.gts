import { action } from '@ember/object';

import Component from '@glimmer/component';

import { gt, not } from '@cardstack/boxel-ui/helpers';

import { getCard } from '@cardstack/host/resources/card-resource';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import HostModeBreadcrumbs from './breadcrumbs';
import HostModeCard from './card';
import HostModeStack from './stack';

interface Signature {
  Element: HTMLElement;
  Args: {
    cardIds: string[];
    removeCard?: (cardId: string) => void;
    openInteractSubmode?: () => void;
  };
}

export default class HostModeContent extends Component<Signature> {
  get currentCard() {
    return this.currentCardResource?.card;
  }

  get isError() {
    return this.currentCardResource?.cardError;
  }

  get isLoading() {
    return this.currentCardId && !this.currentCard && !this.isError;
  }

  get currentCardResource() {
    if (!this.currentCardId) {
      return undefined;
    }

    return getCard(this, () => this.currentCardId);
  }

  get currentCardId() {
    return this.args.cardIds[0];
  }

  get displayBreadcrumbs() {
    return this.args.cardIds && this.args.cardIds.length > 1;
  }

  get isWideCard() {
    if (!this.currentCard) {
      return false;
    }

    return (this.currentCard.constructor as typeof CardDef).prefersWideFormat;
  }

  @action
  removeCard(cardId: string) {
    if (this.args.removeCard) {
      this.args.removeCard(cardId);
    }
  }

  <template>
    <div
      class='host-mode-content {{if this.isWideCard "is-wide"}}'
      data-test-host-mode-content
      ...attributes
    >
      {{#if this.displayBreadcrumbs}}
        <div class='breadcrumb-container'>
          <HostModeBreadcrumbs
            @cardIds={{@cardIds}}
            @close={{this.removeCard}}
          />
        </div>
      {{/if}}
      <HostModeCard
        @cardId={{this.currentCardId}}
        @displayBoundaries={{not this.isWideCard}}
        @openInteractSubmode={{@openInteractSubmode}}
        class='current-card'
      />
      {{#if (gt @cardIds.length 1)}}
        <HostModeStack @cardIds={{@cardIds}} @close={{this.removeCard}} />
      {{/if}}
    </div>

    <style scoped>
      .host-mode-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        flex: 1;
        overflow: hidden;
        padding: var(--boxel-sp);
        position: relative;
        background-color: #686283;
      }

      .breadcrumb-container {
        position: absolute;
        top: var(--boxel-sp);
        left: var(--boxel-sp);
        z-index: 2;
      }

      .host-mode-content.is-wide {
        padding: 0;
        --host-mode-card-width: 100%;
        --host-mode-card-padding: 0;
        --host-mode-card-border-radius: 0;
      }

      .host-mode-content.is-wide .breadcrumb-container {
        top: var(--boxel-sp-lg);
        left: var(--boxel-sp-lg);
      }
    </style>
  </template>
}
