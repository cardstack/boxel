import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';
import { consume } from 'ember-provide-consume-context';

import {
  CardContextName,
  isCardInstance,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import type { HTMLComponent } from '@cardstack/host/lib/html-component';
import { getCard } from '@cardstack/host/resources/card-resource';

import type { CardContext, CardDef } from 'https://cardstack.com/base/card-api';

import CardRenderer from '../card-renderer';

// How an HTML-backed search result becomes a live, running card. `none` stays
// inert; `hover` / `click` / `touch` fetch the card on the matching gesture and
// swap the inert HTML for a live `<CardRenderer>`. The mode is a host-side UX
// choice and never travels on the wire.
export type HydrationMode = 'none' | 'hover' | 'click' | 'touch';

type CardComponentModifier = NonNullable<CardContext['cardComponentModifier']>;

// A function-based no-op stands in for the operator-mode tracking modifier so
// applying it is always type-safe even when no context provides a real one.
const noopCardModifier = modifier(
  () => undefined,
) as unknown as CardComponentModifier;

// Wires the hydration gesture onto the inert element. The listener belongs to
// the rendering path itself — not the operator-mode overlay — so hydration
// behaves identically in operator mode, host mode, and published views.
const hydrationTrigger = modifier(
  (element: Element, [mode, onTrigger]: [HydrationMode, () => void]) => {
    if (mode === 'none') {
      return;
    }
    let event =
      mode === 'hover'
        ? 'mouseenter'
        : mode === 'touch'
          ? 'touchstart'
          : 'click';
    let handler = () => onTrigger();
    element.addEventListener(event, handler);
    return () => element.removeEventListener(event, handler);
  },
);

interface Signature {
  Element: HTMLElement;
  Args: {
    // The card's identity URL, which is also its `links.self` GET target.
    cardId: string;
    // The inert prerendered HTML for an HTML-backed row. Absent for a full
    // live row, which carries no HTML and resolves to its live card directly.
    component?: HTMLComponent;
    // The ancestor type the HTML was rendered as; the live card renders under
    // the same type so a hydrated row matches its prerendered siblings.
    renderType?: ResolvedCodeRef;
    // An error rendering never hydrates.
    isError?: boolean;
    // The hydration gesture (defaults to `none`).
    mode?: HydrationMode;
  };
}

export default class HydratableCard extends Component<Signature> {
  @consume(CardContextName) declare private cardContext:
    | CardContext
    | undefined;

  // Set to the card id once a hydration gesture fires; `getCard` then fetches
  // `links.self`, deposits the instance in the Store, and tracks it live.
  @tracked private hydrationId: string | undefined;

  private cardResource = getCard(this, () => this.resolvedId);

  // A full live row (no inert HTML) has nothing to stay inert as, so it
  // resolves its instance immediately; an HTML-backed row resolves only once
  // its gesture has fired. An error row never resolves.
  private get resolvedId(): string | undefined {
    if (this.args.isError) {
      return undefined;
    }
    if (this.args.component == null) {
      return this.args.cardId;
    }
    return this.hydrationId;
  }

  private get mode(): HydrationMode {
    // An error rendering never hydrates, so no gesture is wired regardless of
    // the requested mode.
    if (this.args.isError) {
      return 'none';
    }
    return this.args.mode ?? 'none';
  }

  private get liveCard(): CardDef | undefined {
    let card = this.cardResource.card;
    return isCardInstance(card) ? (card as CardDef) : undefined;
  }

  // The diagnostic attribute value: the configured gesture while inert, and
  // `hydrated` once the live card has replaced the inert HTML.
  private get hydrationState(): string {
    return this.liveCard ? 'hydrated' : this.mode;
  }

  // The overlay's element tracker when an operator-mode context provides one,
  // else a no-op (host mode / published views have no overlay). Applying it to
  // whichever element is shown lets the overlay anchor to the inert HTML and
  // re-anchor to the live card after the swap: the inert element's modifier
  // tears down (unregister) as the live element's installs (register).
  private get trackElement(): CardComponentModifier {
    return this.cardContext?.cardComponentModifier ?? noopCardModifier;
  }

  @action private hydrate() {
    if (this.args.isError || this.hydrationId != null) {
      return;
    }
    this.hydrationId = this.args.cardId;
  }

  <template>
    {{#if this.liveCard}}
      <CardRenderer
        @card={{this.liveCard}}
        @format='fitted'
        @codeRef={{@renderType}}
        @displayContainer={{false}}
        {{this.trackElement
          card=this.liveCard
          cardId=@cardId
          format='data'
          fieldType=undefined
          fieldName=undefined
        }}
        data-hydration={{this.hydrationState}}
        data-test-hydratable-card={{@cardId}}
        ...attributes
      />
    {{else if @component}}
      <@component
        {{hydrationTrigger this.mode this.hydrate}}
        {{this.trackElement
          cardId=@cardId
          format='data'
          fieldType=undefined
          fieldName=undefined
        }}
        data-hydration={{this.hydrationState}}
        data-test-hydratable-card={{@cardId}}
        ...attributes
      />
    {{/if}}
  </template>
}
