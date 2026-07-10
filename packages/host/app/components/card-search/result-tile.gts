import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';

import { Button } from '@cardstack/boxel-ui/components';
import { and, cn, not } from '@cardstack/boxel-ui/helpers';
import { CheckMark, IconPlus } from '@cardstack/boxel-ui/icons';

import {
  cardTypeDisplayName,
  cardTypeIcon,
  rri,
  type RenderableSearchEntryLike,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import AdornLabel from '@cardstack/host/components/adorn/adorn-label';
import AdornSelectChip from '@cardstack/host/components/adorn/adorn-select-chip';
import { htmlComponent } from '@cardstack/host/lib/html-component';

import {
  removeFileExtension,
  type NewCardArgs,
} from '@cardstack/host/utils/card-search/types';

import CardRenderer from '../card-renderer';

import type { CardDef } from '@cardstack/base/card-api';

import type { ModifierLike } from '@glint/template';

// Fallback used when no AdornContext positioner was threaded in (e.g. the tile
// rendered in isolation by a component test). Real callers inside an
// AdornContext thread its pre-wired `positionLabel`.
const noopPositionLabel = modifier<{
  Element: HTMLElement;
  Args: { Positional: [cardEl: HTMLElement | undefined] };
}>(() => {});

interface Signature {
  Element: HTMLElement;
  Args: {
    // A search result, rendered through its `entry.component` (the
    // `HydratableCard` — inert prerendered HTML or a live card). The realm and
    // recents sections pass this.
    entry?: RenderableSearchEntryLike;
    // A live card resolved by URL paste (`getCard`), rendered with a
    // `CardRenderer` so it matches the prerendered tiles around it.
    card?: CardDef;
    // The "Create New <Type>" affordance for a realm the user can write to.
    newCard?: NewCardArgs;
    isSelected: boolean;
    multiSelect?: boolean;
    onSelect: (selection: string | NewCardArgs) => void;
    onSubmit?: (selection: string | NewCardArgs) => void;
    // When true, render the Adorn visual treatment: a teal hover type-label
    // tab, teal hover/selection outline, and a teal selection chip in place of
    // the plain grey selection circle.
    adorn?: boolean;
    // The outline class yielded by the enclosing <AdornContext> (the caller
    // threads it down from `as |adorn|`). Applied to the button so
    // AdornContext's stroke rules match it.
    adornStrokeClass?: string;
    // The label positioner yielded by the enclosing <AdornContext>
    // (positionAdornLabel with the boundary resolver pre-wired). Attached to
    // the type-label tab, anchored against the tile element.
    adornPositionLabel?: ModifierLike<{
      Element: HTMLElement;
      Args: { Positional: [cardEl: HTMLElement | undefined] };
    }>;
    // When true, render a right-aligned <CheckMark> whenever @isSelected is set
    // and the row is not in multi-select mode. Used by the mini-chooser variant,
    // whose selection treatment is a teal fill + checkmark rather than the
    // border-color shift.
    showSelectedCheckmark?: boolean;
  };
}

// The render type for the URL-paste live card — the CardDef fitted template,
// matching the prerendered tiles' default native rendering.
const defaultResultsCardRef: ResolvedCodeRef = {
  name: 'CardDef',
  module: rri('https://cardstack.com/base/card-api'),
};

export default class SearchResultTile extends Component<Signature> {
  // The tile element, captured so the shared positionAdornLabel modifier can
  // anchor the type-label tab to the card's footprint (the same way the
  // stack-item overlay anchors to the rendered card). Tracked so the label
  // positioner re-runs once the element is available, regardless of modifier
  // install order.
  @tracked private cardEl: HTMLElement | undefined;

  private registerCardEl = modifier((element: HTMLElement) => {
    // Assigned unconditionally: this modifier takes no tracked args, so it
    // installs once and never re-runs. A guard reading `this.cardEl` here would
    // trip a backtracking assertion, since the install reads tracked state the
    // label positioner consumes in the same render.
    this.cardEl = element;
  });

  private get positionLabel(): ModifierLike<{
    Element: HTMLElement;
    Args: { Positional: [cardEl: HTMLElement | undefined] };
  }> {
    return this.args.adornPositionLabel ?? noopPositionLabel;
  }

  private get isNewCard(): boolean {
    return this.args.newCard != null;
  }

  // The type name shown in the Adorn type-label tab. Entry rows carry it
  // on their deduped `icon` resource (no live instance needed); the URL-paste
  // live card supplies it in-memory. The "Create New" row has no label.
  private get adornTypeName(): string | undefined {
    if (!this.args.adorn || this.isNewCard) return undefined;
    if (this.args.entry) {
      return this.args.entry.displayName;
    }
    if (this.args.card) {
      return cardTypeDisplayName(this.args.card);
    }
    return undefined;
  }

  // Type-name precedence mirrored for the icon: entry rows carry icon
  // HTML on the `icon` resource; the live card supplies a component in-memory.
  private get adornTypeIcon(): unknown {
    if (!this.args.adorn || this.isNewCard) return undefined;
    if (this.args.entry?.iconHtml) {
      return htmlComponent(this.args.entry.iconHtml);
    }
    if (this.args.card) {
      return cardTypeIcon(this.args.card);
    }
    return undefined;
  }

  private get cardRefName(): string {
    let ref = this.args.newCard?.ref as { name?: string } | undefined;
    return ref?.name ?? 'Card';
  }

  private get resolvedItemId(): string | undefined {
    return this.args.entry?.id ?? this.args.card?.id;
  }

  private get selectPayload(): string | NewCardArgs {
    if (this.args.newCard) {
      return this.args.newCard;
    }
    return this.resolvedItemId as string;
  }

  @action handleClick() {
    if (this.isNewCard) {
      // "Create New" always submits immediately, even in multi-select mode.
      this.args.onSelect(this.selectPayload);
      this.args.onSubmit?.(this.selectPayload);
      return;
    }
    this.args.onSelect(this.selectPayload);
  }

  @action handleDblClick() {
    if (this.args.multiSelect && !this.isNewCard) {
      // In multi-select, double-click just toggles for existing cards.
      this.args.onSelect(this.selectPayload);
      return;
    }
    this.args.onSelect(this.selectPayload);
    this.args.onSubmit?.(this.selectPayload);
  }

  @action handleKeydown(event: Event) {
    if ((event as KeyboardEvent).key === 'Enter') {
      if (this.args.multiSelect && !this.isNewCard) {
        this.args.onSelect(this.selectPayload);
        return;
      }
      this.args.onSelect(this.selectPayload);
      this.args.onSubmit?.(this.selectPayload);
    }
  }

  <template>
    {{! The caller is responsible for wrapping the item list in an AdornContext
        when @adorn is true — the context publishes the Adorn tokens, the
        outline utility, and the label boundary anchor at the outer-container
        level so they don't need re-establishing for each item. }}
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
      {{this.registerCardEl}}
      data-test-item-button-create-new={{@newCard.realmURL}}
      data-test-item-button={{removeFileExtension this.resolvedItemId}}
      data-test-item-button-selected={{if @isSelected 'true'}}
      ...attributes
    >
      {{#if @adorn}}
        {{#if this.adornTypeName}}
          {{! The type-label tab is positioned by the same shared modifier the
              stack-item overlay uses: it anchors to the card's top-left and
              clamps to the AdornContext boundary. }}
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
      {{#if
        (and
          @showSelectedCheckmark
          @isSelected
          (not @multiSelect)
          (not this.isNewCard)
        )
      }}
        <CheckMark
          class='selected-checkmark'
          width='16'
          height='16'
          aria-hidden='true'
          data-test-item-button-selected-checkmark
        />
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
      {{else if @entry}}
        <@entry.component
          class='hide-boundaries'
          data-test-search-result={{removeFileExtension this.resolvedItemId}}
        />
      {{else if @card}}
        <CardRenderer
          @card={{@card}}
          @format='fitted'
          @codeRef={{defaultResultsCardRef}}
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
        display: block;
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

      /* Adorn treatment — the outline, the label tab, and the selection chip
         are provided by AdornContext + the AdornLabel / AdornSelectChip
         primitives. The rules below only position the catalog-rendered wrappers
         around those primitives and drop the Button's default border so
         AdornContext's teal outline shows through when adorn is active. */
      .item-button.adorn:hover,
      .item-button.adorn.selected {
        border-color: transparent;
      }
      /* Selection ring for adorn catalog items. Defined here on the item itself
         (rather than relying on AdornContext's :deep stroke rule, which the
         portaled catalog item didn't reliably inherit — leaving only the thin
         1px button border) so the ring stays a full-weight 4px whether or not
         the item is hovered, darkening on hover to match the rest of the Adorn
         treatment. `transition: none` makes the ring appear in lockstep with
         the selection tag/chip (which render instantly) instead of fading in
         ~0.2s later — and it's needed on the hover variant too, since a card is
         normally hovered at the moment it's clicked to select, so that rule
         governs the ring's first paint. */
      .item-button.adorn.selected,
      .item-button.adorn.selected:hover {
        box-shadow: 0 0 0 0.25rem var(--boxel-highlight);
        transition: none;
      }
      .item-button.adorn.selected:hover {
        box-shadow: 0 0 0 0.25rem var(--boxel-highlight-hover);
      }
      /* The type-label tab is placed by the shared positionAdornLabel modifier
         (inline position/top/left), so this class only carries the consumer's
         concerns: keep it out of pointer events and fade it in on hover. */
      .search-type-label {
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.1s;
        z-index: 1;
      }
      .item-button.adorn:hover .search-type-label {
        opacity: 1;
      }
      /* Selection chip in the bottom-right corner — purely decorative here, so
         no button wrapper. */
      .adorn-select-position {
        position: absolute;
        bottom: 0.25rem;
        right: 0.25rem;
        pointer-events: none;
        z-index: 1;
      }
      /* Right-aligned check icon for single-select rows (mini chooser).
         Vertically centered on the row; the row-level background is
         supplied by the variant's parent scope. */
      .selected-checkmark {
        position: absolute;
        top: 50%;
        right: var(--boxel-sp);
        transform: translateY(-50%);
        color: var(--boxel-dark);
        pointer-events: none;
        z-index: 1;
      }
    </style>
  </template>
}
