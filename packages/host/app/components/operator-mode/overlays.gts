import { array } from '@ember/helper';
import { action } from '@ember/object';
import { service } from '@ember/service';
import type { SafeString } from '@ember/template';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { dropTask } from 'ember-concurrency';
import { velcro } from 'ember-velcro';
import { isEqual, omit } from 'lodash';

import { localId as localIdSymbol } from '@cardstack/runtime-common';

import type CardService from '@cardstack/host/services/card-service';
import type RealmService from '@cardstack/host/services/realm';

import type {
  CardDef,
  Format,
  ViewCardFn,
} from 'https://cardstack.com/base/card-api';

import type { CardDefOrId } from './stack-item';

import type { RenderedCardForOverlayActions } from '../../resources/element-tracker';
import type { MiddlewareState } from '@floating-ui/dom';

interface OverlaySignature {
  Args: {
    renderedCardsForOverlayActions: RenderedCardForOverlayActions[];
    viewCard?: ViewCardFn;
    requestDeleteCard?: (card: CardDef | URL | string) => Promise<void>;
    onSelectCard?: (cardDefOrId: CardDefOrId) => void;
    toggleSelect?: (cardDefOrId: CardDefOrId) => void;
    selectedCards?: Set<CardDefOrId>;
    overlayClassName?: string;
  };
  Element: HTMLElement;
  Blocks: {
    default: [
      renderedCard: RenderedCardForOverlayActions,
      cardDefOrId: CardDefOrId,
      cardId: string,
      isSelected: boolean,
      isHovered: boolean,
    ];
  };
}

let boundRenderedCardElement = new WeakSet<HTMLElement>();

export default class Overlays extends Component<OverlaySignature> {
  @tracked overlayClassName = this.args.overlayClassName ?? 'base-overlay';

  <template>
    {{#each this.renderedCardsForOverlayActionsWithEvents as |renderedCard|}}
      {{#let
        renderedCard.cardDefOrId
        (this.getCardId renderedCard.cardDefOrId)
        (this.isSelected renderedCard.cardDefOrId)
        as |cardDefOrId cardId isSelected|
      }}
        {{#if (this.shouldRenderOverlay renderedCard isSelected)}}
          <div
            class={{this.overlayClassName}}
            {{velcro renderedCard.element middleware=(array this.offset)}}
            style={{renderedCard.overlayZIndexStyle}}
            data-test-card-overlay
            ...attributes
          >
            {{yield
              renderedCard
              cardDefOrId
              cardId
              isSelected
              (this.isHovered renderedCard)
            }}
          </div>
        {{/if}}
      {{/let}}
    {{/each}}
    <style scoped>
      .base-overlay {
        width: 100%;
        height: 100%;
      }
    </style>
  </template>

  @service declare protected cardService: CardService;
  @service declare protected realm: RealmService;

  @tracked
  protected currentlyHoveredCard: RenderedCardForOverlayActions | null = null;

  protected offset = {
    name: 'offset',
    fn: (state: MiddlewareState) => {
      let { elements, rects } = state;
      let { floating, reference } = elements;
      let { width, height } = reference.getBoundingClientRect();

      floating.style.width = width + 'px';
      floating.style.height = height + 'px';
      floating.style.position = 'absolute';
      return {
        x: rects.reference.x,
        y: rects.reference.y,
      };
    },
  };

  // Since we put absolutely positined overlays containing operator mode actions on top of the rendered cards,
  // we are running into a problem where the overlays are interfering with scrolling of the container that holds the rendered cards.
  // That means scrolling stops when the cursor gets over the overlay, which is a bug. We solved this problem by disabling pointer
  // events on the overlay. However, that prevents the browser from detecting hover state, which is needed to show the operator mode actions, and
  // click event, needed to open the card. To solve this, we add event listeners to the rendered cards underneath the overlay, and use those to
  // detect hover state and click event.
  protected get renderedCardsForOverlayActionsWithEvents() {
    let renderedCards = this.args.renderedCardsForOverlayActions;
    for (const renderedCard of renderedCards) {
      if (boundRenderedCardElement.has(renderedCard.element)) {
        continue;
      }
      boundRenderedCardElement.add(renderedCard.element);
      renderedCard.element.addEventListener('mouseenter', (_ev: MouseEvent) => {
        if (this.currentlyHoveredCard === renderedCard) {
          return;
        }
        this.setCurrentlyHoveredCard(renderedCard);
      });
      renderedCard.element.addEventListener('mouseleave', (ev: MouseEvent) => {
        let relatedTarget = ev.relatedTarget as HTMLElement;
        if (relatedTarget?.closest?.(`.${this.overlayClassName}`)) {
          return;
        }
        this.setCurrentlyHoveredCard(null);
      });
      renderedCard.element.addEventListener('click', (e: MouseEvent) => {
        // prevent outer nested contains fields from triggering when inner most
        // contained field was clicked
        e.stopPropagation();
        this.openOrSelectCard(
          renderedCard.cardDefOrId,
          this.getFormatForCard(renderedCard),
          renderedCard.fieldType,
          renderedCard.fieldName,
        );
      });
      renderedCard.element.style.cursor = 'pointer';
      renderedCard.overlayZIndexStyle = this.zIndexStyle(
        renderedCard.element,
        renderedCard.overlayZIndexStyle,
      );
    }

    return renderedCards;
  }

  @action protected shouldRenderOverlay(
    renderedCard: RenderedCardForOverlayActions,
    isSelected: boolean,
  ): boolean {
    return isSelected || this.isHovered(renderedCard);
  }

  @action protected getCardId(cardDefOrId: CardDefOrId) {
    if (typeof cardDefOrId === 'string') {
      return cardDefOrId;
    }
    return cardDefOrId.id ?? cardDefOrId[localIdSymbol];
  }

  @action
  protected setCurrentlyHoveredCard(
    renderedCard: RenderedCardForOverlayActions | null,
  ) {
    this.currentlyHoveredCard = renderedCard;
  }

  @action protected openOrSelectCard(
    cardDefOrId: CardDefOrId,
    format: Format = 'isolated',
    fieldType?: 'linksTo' | 'contains' | 'containsMany' | 'linksToMany',
    fieldName?: string,
  ) {
    if (this.args.toggleSelect && this.args.selectedCards?.size) {
      this.args.toggleSelect(cardDefOrId);
    } else if (this.args.onSelectCard) {
      this.args.onSelectCard(cardDefOrId);
    } else {
      this.viewCard.perform(cardDefOrId, format, fieldType, fieldName);
    }
  }

  @action protected isSelected(cardDefOrId: CardDefOrId) {
    if (!this.args.selectedCards) return false;
    if (this.args.selectedCards.has(cardDefOrId)) return true;
    if (typeof cardDefOrId !== 'string' && cardDefOrId.id) {
      return this.args.selectedCards.has(cardDefOrId.id);
    }
    return false;
  }

  @action protected isHovered(renderedCard: RenderedCardForOverlayActions) {
    return isEqual(
      omit(this.currentlyHoveredCard, ['overlayZIndexStyle']),
      omit(renderedCard, ['overlayZIndexStyle']),
    );
  }

  protected isField(renderedCard: RenderedCardForOverlayActions) {
    return (
      renderedCard.fieldType === 'contains' ||
      renderedCard.fieldType === 'linksTo' ||
      renderedCard.fieldType === 'linksToMany'
    );
  }

  protected viewCard = dropTask(
    async (
      cardDefOrId: CardDefOrId,
      format: Format = 'isolated',
      fieldType?: 'linksTo' | 'contains' | 'containsMany' | 'linksToMany',
      fieldName?: string,
    ) => {
      let cardId =
        typeof cardDefOrId === 'string' ? cardDefOrId : cardDefOrId.id;
      let canWrite = this.realm.canWrite(cardId);
      format = canWrite ? format : 'isolated';
      if (this.args.viewCard) {
        await this.args.viewCard(new URL(cardId), format, {
          fieldType,
          fieldName,
        });
      }
    },
  );

  protected zIndexStyle(element: HTMLElement, overlayZIndexStyle?: SafeString) {
    if (overlayZIndexStyle) {
      return overlayZIndexStyle;
    }

    let parentElement = element.parentElement!;
    let zIndexParentElement = window
      .getComputedStyle(parentElement)
      .getPropertyValue('z-index');
    let zIndex =
      zIndexParentElement === 'auto'
        ? zIndexParentElement
        : String(Number(zIndexParentElement) + 1);
    return htmlSafe(`z-index: ${zIndex}`);
  }

  /**
   * Gets the format to use when opening or selecting a card
   * Override this in subclasses to customize format behavior
   */
  @action
  protected getFormatForCard(
    renderedCard: RenderedCardForOverlayActions,
  ): Format {
    // Default implementation - prefer stackItem.format if available, otherwise use direct format
    return (renderedCard.format || 'isolated') as Format;
  }
}
