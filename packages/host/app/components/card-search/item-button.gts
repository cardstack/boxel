import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';

import { Button } from '@cardstack/boxel-ui/components';
import { and, cn, not } from '@cardstack/boxel-ui/helpers';
import { IconPlus } from '@cardstack/boxel-ui/icons';

import {
  cardTypeDisplayName,
  cardTypeIcon,
  isCardInstance,
  rri,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import AdornLabel from '@cardstack/host/components/adorn/adorn-label';
import AdornSelectChip from '@cardstack/host/components/adorn/adorn-select-chip';
import { htmlComponent } from '@cardstack/host/lib/html-component';
import type RealmService from '@cardstack/host/services/realm';

import {
  removeFileExtension,
  type NewCardArgs,
} from '@cardstack/host/utils/card-search/types';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import CardRenderer from '../card-renderer';

import type { ComponentLike, ModifierLike } from '@glint/template';

interface AdornCardMeta {
  name: string | undefined;
  iconHtml: string | undefined;
}

// CardRenderer / the prerendered wrapper stamp `data-card-type-display-name`
// and `data-card-type-icon-html` on each rendered card, so look them up
// inside the button DOM once it has rendered. These are the same attributes
// OperatorModeOverlays reads to label and icon the hover tab.
const captureAdornCardMeta = modifier(
  (
    element: HTMLElement,
    [setMeta, enabled]: [(meta: AdornCardMeta) => void, boolean | undefined],
  ) => {
    if (!enabled) return;
    let destroyed = false;
    let read = () => {
      if (destroyed) return;
      let inner = element.querySelector('[data-card-type-display-name]');
      setMeta({
        name: inner?.getAttribute('data-card-type-display-name') ?? undefined,
        iconHtml: inner?.getAttribute('data-card-type-icon-html') ?? undefined,
      });
    };
    // Defer the initial read out of the current render. This modifier
    // installs during render commit, and setMeta writes tracked state
    // the label getters already consumed this render — writing it
    // synchronously here trips a backtracking assertion. MutationObserver
    // callbacks are always async, so subsequent reads are already safe.
    scheduleOnce('afterRender', null, read);
    let observer = new MutationObserver(read);
    observer.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'data-card-type-display-name',
        'data-card-type-icon-html',
      ],
    });
    return () => {
      destroyed = true;
      observer.disconnect();
    };
  },
);

// Fallback used when no AdornContext positioner was threaded in (e.g.
// ItemButton rendered in isolation by a component test). Real callers
// inside an AdornContext thread its pre-wired `positionLabel`.
const noopPositionLabel = modifier<{
  Element: HTMLElement;
  Args: { Positional: [cardEl: HTMLElement | undefined] };
}>(() => {});

type ItemType = ComponentLike<{ Element: Element }> | CardDef | NewCardArgs;

interface Signature {
  Element: HTMLElement;
  Args: {
    item: ItemType;
    itemId?: string;
    isSelected: boolean;
    multiSelect?: boolean;
    onSelect: (selection: string | NewCardArgs) => void;
    onSubmit?: (selection: string | NewCardArgs) => void;
    // The ancestor type to render a live/fallback card as — the search's
    // resolved render type, so a live row renders identically to its
    // prerendered-HTML siblings. Omitted by callers that haven't adopted the
    // unified render type yet, which then fall back to the default fitted card
    // template.
    renderType?: ResolvedCodeRef;
    // When true, render the Adorn visual treatment: a teal hover type-label
    // tab, teal hover/selection outline, and a teal selection chip in place
    // of the legacy grey selection circle.
    adorn?: boolean;
    // The outline class yielded by the enclosing <AdornContext> (the
    // caller threads it down from `as |adorn|`). Applied to the button
    // so AdornContext's stroke rules match it, instead of hard-coding
    // the primitive's internal class name here.
    adornStrokeClass?: string;
    // The label positioner yielded by the enclosing <AdornContext>
    // (positionAdornLabel with the boundary resolver pre-wired). The
    // caller threads it down; we attach it to the type-label tab and
    // pass the card element to anchor against.
    adornPositionLabel?: ModifierLike<{
      Element: HTMLElement;
      Args: { Positional: [cardEl: HTMLElement | undefined] };
    }>;
  };
}

// The default render type for a live search result — the CardDef fitted
// template — used when the caller doesn't thread a resolved render type.
let defaultResultsCardRef: ResolvedCodeRef = {
  name: 'CardDef',
  module: rri('https://cardstack.com/base/card-api'),
};

function isNewCardArgs(item: ItemType): item is NewCardArgs {
  return typeof item === 'object' && 'realmURL' in item;
}

export default class ItemButton extends Component<Signature> {
  @service declare realm: RealmService;

  @tracked private prerenderedTypeName: string | undefined;
  @tracked private prerenderedTypeIconHtml: string | undefined;

  // The item-button element, captured so the shared
  // positionAdornLabel modifier can anchor the type-label tab to the
  // card's footprint (the same way the stack-item overlay anchors to
  // the rendered card). Tracked so the label positioner re-runs once
  // the element is available, regardless of modifier install order.
  @tracked private cardEl: HTMLElement | undefined;

  private registerCardEl = modifier((element: HTMLElement) => {
    // Assigned unconditionally: this modifier takes no tracked args, so
    // it installs once and never re-runs. A guard that read `this.cardEl`
    // here would instead trip a backtracking assertion, since the
    // modifier install reads tracked state the label positioner consumes
    // in the same render.
    this.cardEl = element;
  });

  // AdornContext's pre-wired label positioner, or a no-op when this
  // button is rendered outside an AdornContext.
  private get positionLabel(): ModifierLike<{
    Element: HTMLElement;
    Args: { Positional: [cardEl: HTMLElement | undefined] };
  }> {
    return this.args.adornPositionLabel ?? noopPositionLabel;
  }

  @action private setAdornCardMeta(meta: AdornCardMeta) {
    // Only write when a value actually changed. The MutationObserver
    // that feeds this fires on any mutation inside the button subtree —
    // including our own label/icon render — so re-assigning identical
    // values would dirty tracked state and re-render in a loop.
    if (meta.name !== this.prerenderedTypeName) {
      this.prerenderedTypeName = meta.name;
    }
    if (meta.iconHtml !== this.prerenderedTypeIconHtml) {
      this.prerenderedTypeIconHtml = meta.iconHtml;
    }
  }

  private get adornTypeName(): string | undefined {
    if (!this.args.adorn) return undefined;
    if (this.isNewCard) return undefined; // hover bar isn't relevant for "Create New"
    if (this.cardItem) {
      return cardTypeDisplayName(this.cardItem);
    }
    return this.prerenderedTypeName;
  }

  // Type-name precedence mirrored for the icon: card instances supply
  // it in-memory; prerendered items carry it as icon HTML stamped on
  // the rendered wrapper (the realm server resolves the proper
  // subclass icon there).
  private get adornTypeIcon(): unknown {
    if (!this.args.adorn || this.isNewCard) return undefined;
    if (this.cardItem) {
      return cardTypeIcon(this.cardItem);
    }
    if (this.prerenderedTypeIconHtml) {
      return htmlComponent(this.prerenderedTypeIconHtml);
    }
    return undefined;
  }

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

  // The type to render a live card as: the search's resolved render type when
  // threaded, else the default fitted card template.
  private get resolvedRenderType(): ResolvedCodeRef {
    return this.args.renderType ?? defaultResultsCardRef;
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
    if (this.isNewCard) {
      // "Create New" always submits immediately, even in multi-select mode
      this.args.onSelect(this.selectPayload);
      this.args.onSubmit?.(this.selectPayload);
      return;
    }
    this.args.onSelect(this.selectPayload);
  }

  @action handleDblClick() {
    if (this.args.multiSelect && !this.isNewCard) {
      // In multi-select, double-click just toggles for existing cards
      this.args.onSelect(this.selectPayload);
      return;
    }
    this.args.onSelect(this.selectPayload);
    this.args.onSubmit?.(this.selectPayload);
  }

  @action handleKeydown(event: Event) {
    if ((event as KeyboardEvent).key === 'Enter') {
      if (this.args.multiSelect && !this.isNewCard) {
        // In multi-select, Enter just toggles for existing cards
        this.args.onSelect(this.selectPayload);
        return;
      }
      this.args.onSelect(this.selectPayload);
      this.args.onSubmit?.(this.selectPayload);
    }
  }

  <template>
    {{! Note: the caller is responsible for wrapping the item list in
        an AdornContext when @adorn is true — the context publishes
        the Adorn tokens, the outline utility, and the label boundary
        anchor at the outer-container level so they don't need
        re-establishing for each item. }}
    <Button
      @rectangular={{true}}
      class={{cn
        'item-button'
        (if @adorn @adornStrokeClass)
        selected=@isSelected
        create-new-button=this.isNewCard
        multi-select=@multiSelect
        adorn=@adorn
      }}
      {{on 'click' this.handleClick}}
      {{on 'dblclick' this.handleDblClick}}
      {{on 'keydown' this.handleKeydown}}
      {{! Only prerendered (component) items need the DOM observer — card
          instances supply their type name/icon directly, and the
          "Create New" row has no label. }}
      {{captureAdornCardMeta
        this.setAdornCardMeta
        (and @adorn this.isComponent)
      }}
      {{this.registerCardEl}}
      data-test-card-catalog-create-new-button={{this.newCardItem.realmURL}}
      data-test-card-catalog-item={{removeFileExtension this.resolvedItemId}}
      data-test-card-catalog-item-selected={{if @isSelected 'true'}}
      ...attributes
    >
      {{#if @adorn}}
        {{#if this.adornTypeName}}
          {{! The type-label tab is positioned by the same shared
              modifier the stack-item overlay uses: it anchors to the
              card's top-left and clamps to the AdornContext boundary.
              The class only carries hover-fade + interaction concerns;
              the flag shape lives in the AdornLabel primitive. }}
          <AdornLabel
            class='search-type-label'
            data-test-adorn-label
            aria-hidden='true'
            {{this.positionLabel this.cardEl}}
          >
            <:icon>
              {{#let this.adornTypeIcon as |TypeIcon|}}
                {{#if TypeIcon}}
                  <TypeIcon />
                {{/if}}
              {{/let}}
            </:icon>
            <:text>{{this.adornTypeName}}</:text>
          </AdornLabel>
        {{/if}}
      {{/if}}
      {{#if (and @multiSelect @isSelected (not this.isNewCard))}}
        {{#if @adorn}}
          <span class='adorn-select-position'>
            <AdornSelectChip @selected={{true}} data-test-adorn-selected />
          </span>
        {{else}}
          <div class='selection-indicator'>
            <div class='selection-circle' />
          </div>
        {{/if}}
      {{/if}}
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
          @codeRef={{this.resolvedRenderType}}
          @displayContainer={{false}}
          data-test-search-result={{removeFileExtension this.resolvedItemId}}
        />
      {{/if}}
    </Button>
    <style scoped>
      .item-button {
        height: 100%;
        width: 100%;
        max-width: 100%;
        position: relative;
      }
      .item-button:not(.create-new-button) {
        --boxel-button-padding: 0;

        box-sizing: content-box;
        text-align: start;
      }
      .item-button :deep(*) {
        box-sizing: border-box;
      }
      .item-button:focus {
        --host-outline-offset: -1px;
      }
      .item-button.selected {
        border-color: var(--boxel-highlight);
      }
      .item-button:hover {
        box-shadow: var(--boxel-box-shadow);
      }
      .item-button.selected:hover {
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

      .selection-indicator {
        position: absolute;
        top: var(--boxel-sp-xxxs);
        left: var(--boxel-sp-xxxs);
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--boxel-light);
        border: 1px solid var(--boxel-450);
        border-radius: var(--boxel-border-radius-sm);
        box-shadow: 0 3px 3px 0 rgba(0, 0, 0, 0.5);
        padding: var(--boxel-sp-3xs);
        pointer-events: none;
      }
      .selection-circle {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background-color: var(--boxel-highlight);
        border: 1.5px solid var(--boxel-dark);
      }

      /* Adorn treatment — the outline, the label tab, and the
         selection chip are provided by AdornContext + the AdornLabel /
         AdornSelectChip primitives. The rules below only position the
         catalog-rendered wrappers around those primitives and drop the
         Button's default border so AdornContext's teal outline shows
         through when adorn is active. */
      .item-button.adorn:hover,
      .item-button.adorn.selected {
        border-color: transparent;
      }
      /* Selection ring for adorn catalog items. Defined here on the item
         itself (rather than relying on AdornContext's :deep stroke rule,
         which the portaled catalog item didn't reliably inherit — leaving
         only the thin 1px button border) so the ring stays a full-weight
         4px whether or not the item is hovered, darkening on hover to match
         the rest of the Adorn treatment. `transition: none` makes the ring
         appear in lockstep with the selection tag/chip (which render
         instantly) instead of fading in ~0.2s later — and it's needed on the
         hover variant too, since a card is normally hovered at the moment
         it's clicked to select, so that rule governs the ring's first paint. */
      .item-button.adorn.selected,
      .item-button.adorn.selected:hover {
        box-shadow: 0 0 0 0.25rem var(--boxel-highlight);
        transition: none;
      }
      .item-button.adorn.selected:hover {
        box-shadow: 0 0 0 0.25rem var(--boxel-highlight-hover);
      }
      /* The type-label tab is placed by the shared positionAdornLabel
         modifier (inline position/top/left), so this class only carries
         the consumer's concerns: keep it out of pointer events and fade
         it in on hover. */
      .search-type-label {
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.1s;
        z-index: 1;
      }
      .item-button.adorn:hover .search-type-label {
        opacity: 1;
      }
      /* Selection chip in the bottom-right corner — purely
         decorative here, so no button wrapper. */
      .adorn-select-position {
        position: absolute;
        bottom: 0.25rem;
        right: 0.25rem;
        pointer-events: none;
        z-index: 1;
      }
    </style>
  </template>
}
