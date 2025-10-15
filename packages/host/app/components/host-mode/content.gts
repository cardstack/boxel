import Component from '@glimmer/component';

import { provide } from 'ember-provide-consume-context';

import { gt, not } from '@cardstack/boxel-ui/helpers';

import { CardCrudFunctionsContextName } from '@cardstack/runtime-common';

import { getCard } from '@cardstack/host/resources/card-resource';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import type {
  ViewCardFn,
  CardCrudFunctions,
} from 'https://cardstack.com/base/card-api';

import HostModeBreadcrumbs from './breadcrumbs';
import HostModeCard from './card';
import HostModeStack from './stack';

interface Signature {
  Element: HTMLElement;
  Args: {
    primaryCardId: string | null;
    stackItemCardIds: string[];
    removeCardFromStack: (cardId: string) => void;
    openInteractSubmode?: () => void;
    viewCard: ViewCardFn;
  };
}

export default class HostModeContent extends Component<Signature> {
  get primaryCard() {
    return this.primaryCardResource?.card;
  }

  get primaryCardResource() {
    if (!this.args.primaryCardId) {
      return undefined;
    }

    return getCard(this, () => this.args.primaryCardId!);
  }

  get cardIds() {
    return [this.args.primaryCardId, ...this.args.stackItemCardIds].filter(
      (cardId): cardId is string => Boolean(cardId),
    );
  }

  get displayBreadcrumbs() {
    return this.args.stackItemCardIds.length > 0;
  }

  get isWideCard() {
    if (!this.primaryCard) {
      return false;
    }

    return (this.primaryCard.constructor as typeof CardDef).prefersWideFormat;
  }

  @provide(CardCrudFunctionsContextName)
  // @ts-ignore "cardCrudFunctions" is declared but not used
  private get cardCrudFunctions(): Optional<CardCrudFunctions> {
    return {
      viewCard: this.args.viewCard,
    };
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
            @cardIds={{this.cardIds}}
            @close={{@removeCardFromStack}}
          />
        </div>
      {{/if}}
      <HostModeCard
        @cardId={{@primaryCardId}}
        @displayBoundaries={{not this.isWideCard}}
        @openInteractSubmode={{@openInteractSubmode}}
        class='current-card'
      />
      {{#if (gt @stackItemCardIds.length 0)}}
        <HostModeStack
          @stackItemCardIds={{@stackItemCardIds}}
          @close={{@removeCardFromStack}}
        />
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
