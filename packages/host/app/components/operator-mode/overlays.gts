import { registerDestructor } from '@ember/destroyable';
import { array } from '@ember/helper';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import type { SafeString } from '@ember/template';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { dropTask } from 'ember-concurrency';
import { velcro } from 'ember-velcro';
import { isEqual, omit } from 'lodash-es';

import { localId as localIdSymbol, rri } from '@cardstack/runtime-common';

import type CardService from '@cardstack/host/services/card-service';
import type RealmService from '@cardstack/host/services/realm';

import type { CardDefOrId } from './stack-item';

import type { RenderedCardForOverlayActions } from '../../resources/element-tracker';
import type { CardDef, Format, ViewCardFn } from '@cardstack/base/card-api';
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

export default class Overlays extends Component<OverlaySignature> {
  @tracked overlayClassName = this.args.overlayClassName ?? 'base-overlay';
  private boundRenderedCardElements = new Map<
    HTMLElement,
    {
      mouseenter: (ev: MouseEvent) => void;
      mouseleave: (ev: MouseEvent) => void;
      click: (ev: MouseEvent) => void;
    }
  >();

  constructor(owner: Owner, args: OverlaySignature['Args']) {
    super(owner, args);
    registerDestructor(this, () => this.teardownBoundRenderedCards());
  }

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
        pointer-events: none;
      }
    </style>
  </template>

  @service declare protected cardService: CardService;
  @service declare protected realm: RealmService;

  @tracked
  protected currentlyHoveredCard: RenderedCardForOverlayActions | null = null;

  // When the cursor leaves the underlying card it may still be travelling to
  // floating chrome rendered above the card (e.g. the type-label tab in
  // OperatorModeOverlays which sits a couple of pixels above the card's top
  // edge). We defer the hover clear so the cursor can bridge that gap; any
  // mouseenter on the chrome cancels the pending clear.
  private hoverClearTimer: ReturnType<typeof setTimeout> | null = null;

  // Subclasses opt into a hover-bridge delay by overriding this getter.
  // The base Overlays has no floating chrome, so the default is immediate
  // (0ms) — preserving existing immediate-clear behaviour for consumers
  // like spec-preview and playground-panel.
  protected get hoverClearDelayMs(): number {
    return 0;
  }

  protected offset = {
    name: 'offset',
    fn: (state: MiddlewareState) => {
      let { elements } = state;
      let { floating, reference } = elements;
      let refRect = reference.getBoundingClientRect();

      floating.style.width = refRect.width + 'px';
      floating.style.height = refRect.height + 'px';
      floating.style.position = 'absolute';
      // Mirror the underlying card's corner radius so any decorative
      // outline / box-shadow on the overlay follows the same curve.
      if (reference instanceof Element) {
        floating.style.borderRadius =
          window.getComputedStyle(reference).borderRadius;
      }

      // Position the overlay from the live reference rect relative to the
      // floating element's own offset parent, rather than floating-ui's
      // `rects.reference`. floating-ui's first one-or-two computePosition calls
      // omit the offset parent's offset (they return the reference in viewport
      // coordinates and only subtract the offset parent a frame later), so
      // trusting `rects.reference` makes the overlay — and everything riding it
      // (the type-label tab, the select chip, the menu, the outline) — paint
      // one frame off and visibly jump into place on first appearance.
      // Computing it ourselves from the current rects is correct on the very
      // first frame. We recover the offset parent's scale the same way the
      // Adorn label positioner does (the test runner scales `#ember-testing`),
      // and convert the viewport anchor into the offset parent's local space.
      let offsetParent = floating.offsetParent as HTMLElement | null;
      let parentRect = offsetParent
        ? offsetParent.getBoundingClientRect()
        : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      let scaleX =
        offsetParent && offsetParent.offsetWidth > 0
          ? parentRect.width / offsetParent.offsetWidth
          : 1;
      let scaleY =
        offsetParent && offsetParent.offsetHeight > 0
          ? parentRect.height / offsetParent.offsetHeight
          : 1;
      if (!Number.isFinite(scaleX) || scaleX === 0) {
        scaleX = 1;
      }
      if (!Number.isFinite(scaleY) || scaleY === 0) {
        scaleY = 1;
      }
      return {
        x: (refRect.left - parentRect.left) / scaleX,
        y: (refRect.top - parentRect.top) / scaleY,
      };
    },
  };

  // Since we put absolutely positined overlays containing operator mode actions on top of the rendered cards,
  // we are running into a problem where the overlays are interfering with scrolling of the container that holds the rendered cards.
  // That means scrolling stops when the cursor gets over the overlay, which is a bug. We solved this problem by disabling pointer
  // events on the overlay. However, that prevents the browser from detecting hover state, which is needed to show the operator mode actions, and
  // click event, needed to open the card. To solve this, we add event listeners to the rendered cards underneath the overlay, and use those to
  // detect hover state and click event.
  // This must stay coupled to render-time reconciliation because the set of rendered card elements
  // is only known once the template has produced them. We use this getter as the single place that
  // synchronizes imperative DOM listeners with the current rendered-card set, and we also tear down
  // listeners for elements that are no longer present. A pure getter would leak stale listeners here.
  /* eslint-disable ember/no-side-effects */
  protected get renderedCardsForOverlayActionsWithEvents() {
    let renderedCards = this.args.renderedCardsForOverlayActions;
    let currentElements = new Set(renderedCards.map((card) => card.element));
    for (let [element, handlers] of this.boundRenderedCardElements) {
      if (!currentElements.has(element)) {
        this.unbindRenderedCardElement(element, handlers);
      }
    }
    for (const renderedCard of renderedCards) {
      if (this.boundRenderedCardElements.has(renderedCard.element)) {
        continue;
      }
      let mouseenter = (_ev: MouseEvent) => {
        this.cancelHoverClear();
        if (this.currentlyHoveredCard === renderedCard) {
          return;
        }
        this.setCurrentlyHoveredCard(renderedCard);
      };
      let mouseleave = (ev: MouseEvent) => {
        let relatedTarget = ev.relatedTarget as HTMLElement;
        if (relatedTarget?.closest?.(`.${this.overlayClassName}`)) {
          return;
        }
        this.scheduleHoverClear();
      };
      let click = (e: MouseEvent) => {
        // prevent outer nested contains fields from triggering when inner most
        // contained field was clicked
        e.stopPropagation();
        if (this.shouldSwallowCardClick()) {
          // A subclass is currently holding chrome open (e.g. an overlay
          // dropdown is open). This click is the outside-click that's about
          // to dismiss that chrome — don't *also* open the underlying card.
          return;
        }
        this.openOrSelectCard(
          renderedCard.cardDefOrId,
          this.getFormatForCard(renderedCard),
          renderedCard.fieldType,
          renderedCard.fieldName,
        );
      };
      renderedCard.element.addEventListener('mouseenter', mouseenter);
      renderedCard.element.addEventListener('mouseleave', mouseleave);
      renderedCard.element.addEventListener('click', click);
      this.boundRenderedCardElements.set(renderedCard.element, {
        mouseenter,
        mouseleave,
        click,
      });
      renderedCard.element.style.cursor = 'pointer';
      renderedCard.overlayZIndexStyle = this.zIndexStyle(
        renderedCard.element,
        renderedCard.overlayZIndexStyle,
      );
    }

    return renderedCards;
  }
  /* eslint-enable ember/no-side-effects */

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

  @action
  protected scheduleHoverClear() {
    if (this.shouldDelayHoverClear()) {
      return;
    }
    if (this.hoverClearTimer) {
      return;
    }
    this.hoverClearTimer = setTimeout(() => {
      this.hoverClearTimer = null;
      if (this.shouldDelayHoverClear()) {
        // A subclass began holding hover state (e.g. menu opened) while the
        // timer was pending — re-schedule so we'll re-check after the hold
        // lifts.
        this.scheduleHoverClear();
        return;
      }
      this.setCurrentlyHoveredCard(null);
    }, this.hoverClearDelayMs);
  }

  @action
  protected cancelHoverClear() {
    if (this.hoverClearTimer) {
      clearTimeout(this.hoverClearTimer);
      this.hoverClearTimer = null;
    }
  }

  /**
   * Hook for subclasses to pin the current hover state. While this returns
   * true, scheduleHoverClear is a no-op and any in-flight timer re-schedules
   * itself. Use for "the cursor logically left but we don't want to dismiss
   * the chrome yet" — e.g. a dropdown opened from the chrome is now floating
   * in a portal outside the overlay.
   */
  protected shouldDelayHoverClear(): boolean {
    return false;
  }

  /**
   * Hook for subclasses to suppress the default card-open behavior on click.
   * Use when the overlay has floating chrome whose outside-click dismissal
   * shouldn't also trigger card navigation (e.g. clicking outside an open
   * dropdown menu).
   */
  protected shouldSwallowCardClick(): boolean {
    return false;
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
        let target =
          typeof cardDefOrId === 'string' ? rri(cardDefOrId) : cardDefOrId;
        await this.args.viewCard(
          target,
          format,
          this.buildViewCardOpts(cardDefOrId, fieldType, fieldName),
        );
      }
    },
  );

  protected buildViewCardOpts(
    _cardDefOrId: CardDefOrId,
    fieldType?: 'linksTo' | 'contains' | 'containsMany' | 'linksToMany',
    fieldName?: string,
  ): {
    type?: 'card' | 'file';
    fieldType?: 'linksTo' | 'contains' | 'containsMany' | 'linksToMany';
    fieldName?: string;
  } {
    return {
      fieldType,
      fieldName,
    };
  }

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
    if (renderedCard.format === 'data') {
      return 'isolated';
    }
    return (renderedCard.format || 'isolated') as Format;
  }

  private unbindRenderedCardElement(
    element: HTMLElement,
    handlers: {
      mouseenter: (ev: MouseEvent) => void;
      mouseleave: (ev: MouseEvent) => void;
      click: (ev: MouseEvent) => void;
    },
  ) {
    element.removeEventListener('mouseenter', handlers.mouseenter);
    element.removeEventListener('mouseleave', handlers.mouseleave);
    element.removeEventListener('click', handlers.click);
    this.boundRenderedCardElements.delete(element);
  }

  private teardownBoundRenderedCards() {
    for (let [element, handlers] of this.boundRenderedCardElements) {
      this.unbindRenderedCardElement(element, handlers);
    }
    if (this.hoverClearTimer) {
      clearTimeout(this.hoverClearTimer);
      this.hoverClearTimer = null;
    }
    this.currentlyHoveredCard = null;
  }
}
