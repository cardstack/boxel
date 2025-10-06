import Component from '@glimmer/component';
import { getCard } from '@cardstack/host/resources/card-resource';
import { htmlSafe } from '@ember/template';
import { CardDef } from 'https://cardstack.com/base/card-api';
import { action } from '@ember/object';

import { not, gt } from '@cardstack/boxel-ui/helpers';

import HostModeCard from './host-mode-card';
import HostModeStack from './host-mode-stack';

interface Signature {
  Element: HTMLElement;
  Args: {
    cardIds: string[];
    close?: (cardId: string) => void;
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

  get backgroundImageStyle() {
    // We only show background images when there's a single card being shown
    if (this.args.cardIds.length !== 1) {
      return false;
    }

    return htmlSafe(
      `background-image: url(https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1470&q=80);`,
    );
  }

  get hostModeContentContainer() {
    if (!this.currentCard) {
      return 'host-mode-content';
    }

    // Check if the card prefers wide format
    if (this.isWideCard) {
      return 'host-mode-content is-wide';
    }

    return 'host-mode-content';
  }

  get isWideCard() {
    if (!this.currentCard) {
      return false;
    }

    return (this.currentCard.constructor as typeof CardDef).prefersWideFormat;
  }

  @action
  close(cardId: string) {
    if (this.args.close) {
      this.args.close(cardId);
    }
  }

  <template>
    <div
      class={{this.hostModeContentContainer}}
      style={{this.backgroundImageStyle}}
    >
      <HostModeCard
        @cardId={{this.currentCardId}}
        @displayBoundaries={{not this.isWideCard}}
        class='current-card'
      />
      {{#if (gt @cardIds.length 1)}}
        <HostModeStack @cardIds={{this.args.cardIds}} @close={{this.close}} />
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
      }

      .host-mode-content.is-wide {
        padding: 0;
        --host-mode-card-width: 100%;
        --host-mode-card-padding: 0;
        --host-mode-card-border-radius: 0;
      }
    </style>
  </template>
}
