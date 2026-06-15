import { isDestroyed, isDestroying } from '@ember/destroyable';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';
import { consume } from 'ember-provide-consume-context';

import {
  CardContextName,
  GetCardContextName,
  type Format,
  type ResolvedCodeRef,
  type StoreReadType,
  type getCard,
} from '@cardstack/runtime-common';

import type { HTMLComponent } from '@cardstack/host/lib/html-component';

import type { BaseDef, CardContext } from 'https://cardstack.com/base/card-api';

import CardRenderer from '../card-renderer';

// How an HTML-backed search result becomes a live, running card. `none` stays
// inert; `hover` / `click` / `touch` fetch the card on the matching gesture and
// swap the inert HTML for a live `<CardRenderer>`. The mode is a host-side UX
// choice and never travels on the wire.
export type HydrationMode = 'none' | 'hover' | 'click' | 'touch';

type CardComponentModifier = NonNullable<CardContext['cardComponentModifier']>;

// The card context can be torn down out from under a consumer mid-render (realm
// refresh / unmount); reading it then throws this owner-destroyed error. Match
// the full message (not a loose substring) so an unrelated error mentioning
// "destroyed" isn't silently swallowed.
const OWNER_DESTROYED_ERROR =
  "Cannot call `.lookup('renderer:-dom')` after the owner has been destroyed";

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
    // Hover mode treats pointer-hover and keyboard-focus synonymously, so a
    // card hydrates the same way for both. `focusin` (which bubbles, unlike
    // `focus`) also fires when focus lands on a descendant during keyboard
    // navigation into the card.
    let events =
      mode === 'hover'
        ? ['mouseenter', 'focusin']
        : mode === 'touch'
          ? ['touchstart']
          : ['click'];
    let handler = () => onTrigger();
    events.forEach((event) => element.addEventListener(event, handler));
    return () =>
      events.forEach((event) => element.removeEventListener(event, handler));
  },
);

interface Signature {
  Element: HTMLElement;
  Args: {
    // The card/file identity URL, which is also its `links.self` GET target.
    cardId: string;
    // The inert prerendered HTML for an HTML-backed row. Absent for a full
    // live row, which carries no HTML and resolves to its live instance.
    component?: HTMLComponent;
    // The ancestor type the HTML was rendered as; the live card renders under
    // the same type so a hydrated row matches its prerendered siblings.
    renderType?: ResolvedCodeRef;
    // The resource type to resolve — `card` (default) or `file-meta`, so a
    // full live file-meta row renders its `FileDef` instead of nothing.
    type?: StoreReadType;
    // An error rendering never hydrates.
    isError?: boolean;
    // The hydration gesture (defaults to `none`).
    mode?: HydrationMode;
    // The format the live/hydrated card renders as, so it matches the
    // prerendered HTML the query selected (defaults to `fitted`).
    format?: Format;
  };
}

export default class HydratableCard extends Component<Signature> {
  @consume(GetCardContextName) declare private getCard: getCard;
  @consume(CardContextName) declare private cardContext:
    | CardContext
    | undefined;

  // Flips true once a hydration gesture fires; `getCard` then fetches
  // `links.self`, deposits the instance in the Store, and tracks it live. A
  // boolean — not the id captured at gesture time — so a recycled component
  // whose `@cardId` changes resolves the new card, never a stale captured one.
  @tracked private hydrated = false;

  // One `getCard` resource per component instance — `@cached` so reading it
  // from several getters doesn't spin up a resource each time, and a getter
  // (not a field initializer) so the consumed `getCard` provider is injected
  // before it runs. It's parented to `this`, so it's torn down with the
  // component and `getCard` drops its Store reference then (no leak); it's
  // only reached once `resolvedId` is set (see `liveCard`), so an inert row
  // that never hydrates never creates it.
  @cached
  private get cardResource(): ReturnType<getCard> {
    return this.getCard(this, () => this.resolvedId, { type: this.args.type });
  }

  // A full live row (no inert HTML) has nothing to stay inert as, so it
  // resolves its instance immediately; an HTML-backed row resolves only once
  // its gesture has fired. An error row never resolves.
  private get resolvedId(): string | undefined {
    if (this.args.isError) {
      return undefined;
    }
    // No inert HTML → nothing to gate on; a full live row always resolves
    // immediately and ungated (there is no gesture to wait for).
    if (this.args.component == null) {
      return this.args.cardId;
    }
    // HTML-backed → resolve the CURRENT `@cardId` once the gesture has fired.
    return this.hydrated ? this.args.cardId : undefined;
  }

  private get mode(): HydrationMode {
    // An error rendering never hydrates, so no gesture is wired regardless of
    // the requested mode.
    if (this.args.isError) {
      return 'none';
    }
    return this.args.mode ?? 'none';
  }

  private get format(): Format {
    return this.args.format ?? 'fitted';
  }

  // The resolved live instance — a `CardDef` or a `FileDef`. Short-circuits
  // before touching `cardResource` when there's nothing to resolve, so an
  // inert row that never hydrates never creates a resource. `getCard` returns
  // the instance only when the Store holds a real one (not an error).
  private get liveCard(): BaseDef | undefined {
    if (this.resolvedId == null) {
      return undefined;
    }
    return this.cardResource.card;
  }

  // The diagnostic attribute value: the configured gesture while inert, and
  // `hydrated` once the live instance has replaced the inert HTML.
  private get hydrationState(): string {
    return this.liveCard ? 'hydrated' : this.mode;
  }

  // The overlay's element tracker when an operator-mode context provides one,
  // else a no-op (host mode / published views have no overlay). Applied to the
  // inert HTML so the overlay can anchor to it before hydration — raw HTML
  // isn't a card component, so nothing else registers it. After the swap the
  // live `CardRenderer` registers itself through the card context (the same way
  // any delegate-rendered card does), so the overlay re-anchors to the new
  // element with no extra wiring here. Guarded so reading the context while
  // this component is being destroyed can't throw.
  private get trackElement(): CardComponentModifier {
    if (isDestroying(this) || isDestroyed(this)) {
      return noopCardModifier;
    }
    try {
      return this.cardContext?.cardComponentModifier ?? noopCardModifier;
    } catch (e) {
      if (e instanceof Error && e.message.includes(OWNER_DESTROYED_ERROR)) {
        return noopCardModifier;
      }
      throw e;
    }
  }

  @action private hydrate() {
    if (this.args.isError) {
      return;
    }
    this.hydrated = true;
  }

  <template>
    {{#if this.liveCard}}
      {{! The diagnostic / test attributes ride `...attributes` onto the
          card-api's own container (`boxel-card-container` from `getComponent`),
          which spreads them regardless of the userland template — so no extra
          wrapper element (which would perturb grid/child-selector styling) is
          needed. }}
      <CardRenderer
        @card={{this.liveCard}}
        @format={{this.format}}
        @codeRef={{@renderType}}
        @displayContainer={{false}}
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
