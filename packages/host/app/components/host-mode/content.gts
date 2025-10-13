import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { consume, provide } from 'ember-provide-consume-context';

import { gt, not } from '@cardstack/boxel-ui/helpers';

import {
  CardContextName,
  CardCrudFunctionsContextName,
} from '@cardstack/runtime-common';

import { createHostModeNavigationModifier } from '@cardstack/host/modifiers/create-host-mode-navigation-modifier';
import { getCard } from '@cardstack/host/resources/card-resource';

import type { CardContext, CardDef } from 'https://cardstack.com/base/card-api';

import type {
  CreateCardFn,
  DeleteCardFn,
  EditCardFn,
  SaveCardFn,
  ViewCardFn,
  CardCrudFunctions,
} from 'https://cardstack.com/base/card-api';

import HostModeBreadcrumbs from './breadcrumbs';
import HostModeCard from './card';
import HostModeStack from './stack';

interface Signature {
  Element: HTMLElement;
  Args: {
    primaryCardId: string;
    stackItemIds: string[];
    removeCardFromStack: (cardId: string) => void;
    openInteractSubmode?: () => void;
    viewCard: ViewCardFn;
  };
}

export default class HostModeContent extends Component<Signature> {
  @consume(CardContextName) private declare parentCardContext:
    | CardContext
    | undefined;

  @cached
  private get hostModeNavigationModifier() {
    return createHostModeNavigationModifier(this.args.viewCard);
  }

  get primaryCard() {
    return this.primaryCardResource?.card;
  }

  get primaryCardResource() {
    if (!this.args.primaryCardId) {
      return undefined;
    }

    return getCard(this, () => this.args.primaryCardId);
  }

  get cardIds() {
    return [this.args.primaryCardId, ...this.args.stackItemIds];
  }

  get displayBreadcrumbs() {
    return this.args.stackItemIds.length > 0;
  }

  get isWideCard() {
    if (!this.primaryCard) {
      return false;
    }

    return (this.primaryCard.constructor as typeof CardDef).prefersWideFormat;
  }

  private noopCreateCard: CreateCardFn = async () => undefined;
  private noopSaveCard: SaveCardFn = () => {};
  private noopEditCard: EditCardFn = () => {};
  private noopDeleteCard: DeleteCardFn = async () => {};

  @provide(CardCrudFunctionsContextName)
  // @ts-ignore "cardCrudFunctions" is declared but not used
  private get cardCrudFunctions(): CardCrudFunctions {
    return {
      createCard: this.noopCreateCard,
      saveCard: this.noopSaveCard,
      editCard: this.noopEditCard,
      viewCard: this.args.viewCard,
      deleteCard: this.noopDeleteCard,
    };
  }

  @provide(CardContextName)
  // @ts-ignore "context" is declared but not used
  private get context(): CardContext {
    let parentContext = this.parentCardContext;
    if (!parentContext) {
      throw new Error('HostModeContent requires a CardContext');
    }

    return {
      ...parentContext,
      cardComponentModifier: this.hostModeNavigationModifier,
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
      {{#if (gt @stackItemIds.length 0)}}
        <HostModeStack
          @stackItemIds={{@stackItemIds}}
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
