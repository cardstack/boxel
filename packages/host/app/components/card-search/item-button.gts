import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { Button } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';
import { IconPlus } from '@cardstack/boxel-ui/icons';

import { isCardInstance } from '@cardstack/runtime-common';

import { urlForRealmLookup } from '@cardstack/host/lib/utils';
import type RealmService from '@cardstack/host/services/realm';

import type { CardDef } from '@cardstack/base/card-api';

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
    isCompact: boolean;
    displayRealmName?: boolean;
    onSelect: (selection: string | NewCardArgs) => void;
    onSubmit?: (selection: string | NewCardArgs) => void;
  };
}

// Render CardDef default fitted template for visual consistency of cards in search results
let resultsCardRef = {
  name: 'CardDef',
  module: '@cardstack/base/card-api',
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

  private get urlForRealmLookup(): string | undefined {
    if (!this.args.displayRealmName) {
      return undefined;
    }
    return this.cardItem ? urlForRealmLookup(this.cardItem) : this.args.itemId;
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
    {{#if this.isNewCard}}
      <Button
        class={{cn 'create-card' 'catalog-item' selected=@isSelected}}
        {{on 'click' this.handleClick}}
        {{on 'dblclick' this.handleDblClick}}
        {{on 'keydown' this.handleKeydown}}
        data-test-card-catalog-create-new-button={{this.newCardItem.realmURL}}
        data-test-card-catalog-item-selected={{if @isSelected 'true'}}
        ...attributes
      >
        <IconPlus
          class='plus-icon'
          width='16'
          height='16'
          role='presentation'
        />
        Create New
        {{this.cardRefName}}
      </Button>
    {{else}}
      <div class={{cn 'item-button-container' compact=@isCompact}}>
        {{#if this.componentItem}}
          <Button
            class={{cn 'catalog-item' selected=@isSelected compact=@isCompact}}
            {{on 'click' this.handleClick}}
            {{on 'dblclick' this.handleDblClick}}
            {{on 'keydown' this.handleKeydown}}
            data-test-card-catalog-item={{removeFileExtension
              this.resolvedItemId
            }}
            data-test-card-catalog-item-selected={{if @isSelected 'true'}}
            ...attributes
          >
            {{#let this.componentItem as |CardComponent|}}
              <CardComponent
                class='hide-boundaries'
                data-test-search-result={{removeFileExtension
                  this.resolvedItemId
                }}
              />
            {{/let}}
          </Button>
        {{else if this.cardItem}}
          <Button
            class={{cn 'catalog-item' selected=@isSelected compact=@isCompact}}
            {{on 'click' this.handleClick}}
            {{on 'dblclick' this.handleDblClick}}
            {{on 'keydown' this.handleKeydown}}
            data-test-card-catalog-item={{this.resolvedItemId}}
            data-test-card-catalog-item-selected={{if @isSelected 'true'}}
            ...attributes
          >
            <CardRenderer
              @card={{this.cardItem}}
              @format='fitted'
              @codeRef={{resultsCardRef}}
              data-test-search-result={{removeFileExtension
                this.resolvedItemId
              }}
              class='hide-boundaries'
            />
          </Button>
        {{/if}}
        {{#if this.urlForRealmLookup}}
          {{#let (this.realm.info this.urlForRealmLookup) as |realmInfo|}}
            <div
              class='realm-name'
              data-test-realm-name
            >{{realmInfo.name}}</div>
          {{/let}}
        {{/if}}
      </div>
    {{/if}}
    <style scoped>
      .catalog-item {
        --boxel-button-padding: 0;
        --boxel-button-border-radius: var(--boxel-border-radius);
        --boxel-button-border: 1px solid var(--boxel-200);
        height: var(--item-height, 67px);
        width: 100%;
        max-width: 100%;
        overflow: hidden;
        container-name: fitted-card;
        container-type: size;
        display: flex;
        text-align: left;
      }
      .catalog-item.selected {
        border-color: var(--boxel-highlight);
        box-shadow: 0 0 0 1px var(--boxel-highlight);
      }
      .catalog-item:hover {
        border-color: var(--boxel-darker-hover);
      }
      .catalog-item.selected:hover {
        border-color: var(--boxel-highlight);
      }
      .catalog-item.compact {
        width: var(--item-width, 250px);
        height: var(--item-height, 40px);
      }
      .create-card.catalog-item {
        --boxel-button-padding: var(--boxel-sp-xs) var(--boxel-sp);
        --boxel-button-letter-spacing: var(--boxel-lsp-xs);
        gap: var(--boxel-sp-xs);
        flex-wrap: nowrap;
        justify-content: flex-start;
        height: var(--item-height, 67px);
        width: 100%;
        max-width: 100%;
      }
      .plus-icon > :deep(path) {
        stroke: none;
      }
      .item-button-container {
        display: flex;
        flex-direction: column;
        align-items: self-end;
        width: 100%;
      }
      .realm-name {
        font: 400 var(--boxel-font);
        color: var(--boxel-400);
        padding-top: var(--boxel-sp-4xs);
        padding-right: var(--boxel-sp-xxs);
        height: 20px;
        font-size: var(--boxel-font-size-xs);
      }
    </style>
  </template>
}
