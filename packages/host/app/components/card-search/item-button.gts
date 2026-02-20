import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { Button } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';
import { IconPlus } from '@cardstack/boxel-ui/icons';

import { isCardInstance } from '@cardstack/runtime-common';

import type RealmService from '@cardstack/host/services/realm';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import CardRenderer from '../card-renderer';

import { removeFileExtension } from './utils';

import type { NewCardArgs } from './utils';
import type { ComponentLike } from '@glint/template';

type ItemType = ComponentLike<{ Element: Element }> | CardDef | NewCardArgs;

interface Signature {
  Element: HTMLElement;
  Args: {
    item: ItemType;
    itemId?: string;
    isSelected: boolean;
    onSelect: (selection: string | NewCardArgs) => void;
    onSubmit?: (selection: string | NewCardArgs) => void;
  };
}

// Render CardDef default fitted template for visual consistency of cards in search results
let resultsCardRef = {
  name: 'CardDef',
  module: 'https://cardstack.com/base/card-api',
};

function isNewCardArgs(item: ItemType): item is NewCardArgs {
  return typeof item === 'object' && 'realmURL' in item;
}

export default class ItemButton extends Component<Signature> {
  @service declare realm: RealmService;

  private get isNewCard(): boolean {
    return isNewCardArgs(this.args.item);
  }

  private get newCardItem(): NewCardArgs | undefined {
    return isNewCardArgs(this.args.item) ? this.args.item : undefined;
  }

  private get isCard(): boolean {
    return isCardInstance(this.args.item);
  }

  private get cardItem(): CardDef | undefined {
    return isCardInstance(this.args.item)
      ? (this.args.item as CardDef)
      : undefined;
  }

  private get isComponent(): boolean {
    return !this.isNewCard && !this.isCard;
  }

  private get componentItem(): ComponentLike<{ Element: Element }> | undefined {
    return this.isComponent
      ? (this.args.item as ComponentLike<{ Element: Element }>)
      : undefined;
  }

  private get cardRefName(): string {
    const newCard = this.newCardItem;
    if (!newCard) {
      return 'Card';
    }
    return (newCard.ref as { module: string; name: string }).name ?? 'Card';
  }

  private get selectPayload(): string | NewCardArgs {
    if (this.isNewCard) {
      return this.args.item as NewCardArgs;
    }
    return this.args.itemId ?? (this.cardItem?.id as string);
  }

  private get resolvedItemId(): string | undefined {
    return this.args.itemId ?? this.cardItem?.id;
  }

  @action handleClick() {
    this.args.onSelect(this.selectPayload);
  }

  @action handleDblClick() {
    this.args.onSelect(this.selectPayload);
    this.args.onSubmit?.(this.selectPayload);
  }

  @action handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      this.args.onSelect(this.selectPayload);
      this.args.onSubmit?.(this.selectPayload);
    }
  }

  <template>
    <Button
      @rectangular={{true}}
      class={{cn
        'catalog-item'
        selected=@isSelected
        create-new-button=this.isNewCard
      }}
      {{on 'click' this.handleClick}}
      {{on 'dblclick' this.handleDblClick}}
      {{on 'keydown' this.handleKeydown}}
      data-test-card-catalog-create-new-button={{this.newCardItem.realmURL}}
      data-test-card-catalog-item={{removeFileExtension this.resolvedItemId}}
      data-test-card-catalog-item-selected={{if @isSelected 'true'}}
      ...attributes
    >
      {{#if this.isNewCard}}
        <IconPlus
          class='plus-icon'
          width='16'
          height='16'
          role='presentation'
        />
        Create New
        {{this.cardRefName}}
      {{else if this.componentItem}}
        <this.componentItem
          class='hide-boundaries'
          data-test-search-result={{removeFileExtension this.resolvedItemId}}
        />
      {{else if this.cardItem}}
        <CardRenderer
          @card={{this.cardItem}}
          @format='fitted'
          @codeRef={{resultsCardRef}}
          @displayContainer={{false}}
          data-test-search-result={{removeFileExtension this.resolvedItemId}}
        />
      {{/if}}
    </Button>
    <style scoped>
      .catalog-item {
        height: 100%;
        width: 100%;
        max-width: 100%;
      }
      .catalog-item:not(.create-new-button) {
        --boxel-button-padding: 0;

        box-sizing: content-box;
        text-align: start;
      }
      .catalog-item :deep(*) {
        box-sizing: border-box;
      }
      .catalog-item:focus {
        --host-outline-offset: -1px;
      }
      .catalog-item.selected {
        border-color: var(--boxel-highlight);
        box-shadow: 0 0 0 1px var(--boxel-highlight);
      }
      .catalog-item:hover {
        box-shadow: var(--boxel-box-shadow);
      }
      .catalog-item.selected:hover {
        border-color: var(--boxel-highlight);
        box-shadow:
          0 0 0 1px var(--boxel-highlight),
          var(--boxel-box-shadow);
      }

      .create-new-button {
        gap: var(--boxel-sp-xs);
        flex-wrap: nowrap;
        justify-content: flex-start;
        letter-spacing: var(--boxel-lsp-xs);
      }
      .plus-icon > :deep(path) {
        stroke: none;
      }
    </style>
  </template>
}
