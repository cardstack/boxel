import { getOwner } from '@ember/application';
import { on } from '@ember/modifier';
import { cancel, next, scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';
import { consume } from 'ember-provide-consume-context';

import { BoxelButton, CardContainer } from '@cardstack/boxel-ui/components';
import { bool, cn } from '@cardstack/boxel-ui/helpers';

import {
  CardContextName,
  CardCrudFunctionsContextName,
  GetCardCollectionContextName,
  GetCardContextName,
  GetCardsContextName,
  type getCard as GetCard,
  type getCardCollection as GetCardCollection,
  type getCards as GetCards,
} from '@cardstack/runtime-common';

import CardIsland from '@cardstack/host/components/card-island';
import CardRenderer from '@cardstack/host/components/card-renderer';
import CardError from '@cardstack/host/components/operator-mode/card-error';
import { cardIslandCompatibilityFailure } from '@cardstack/host/lib/card-island-protocol';
import {
  discardSuspendedSerializedComponent,
  hasSerializedComponent,
  rehydrateWithArgs,
  renderWithArgs,
  suspendSerializedComponent,
  teardown,
} from '@cardstack/host/lib/isolated-render';
import { getCard } from '@cardstack/host/resources/card-resource';
import type RealmSandboxService from '@cardstack/host/services/realm-sandbox';

import type { CardContext, CardCrudFunctions } from '@cardstack/base/card-api';

interface Signature {
  Element: HTMLElement;
  Args: {
    cardId: string | null;
    displayBoundaries?: boolean;
    isPrimary?: boolean;
    openInteractSubmode?: () => void;
  };
}

export default class HostModeCard extends Component<Signature> {
  @service declare private realmSandbox: RealmSandboxService;
  @consume(GetCardContextName) declare private getCardForContext: GetCard;
  @consume(GetCardsContextName) declare private getCards: GetCards;
  @consume(GetCardCollectionContextName)
  declare private getCardCollection: GetCardCollection;
  @consume(CardContextName) declare private cardContext: CardContext;
  @consume(CardCrudFunctionsContextName)
  declare private cardCrudFunctions: CardCrudFunctions | undefined;
  private mountedPrerenderedIsland?: HTMLElement;

  @cached
  get cardResource() {
    if (!this.args.cardId) {
      return undefined;
    }

    return getCard(this, () => this.args.cardId!);
  }

  get card() {
    return this.cardResource?.card;
  }

  get cardError() {
    return this.cardResource?.cardError;
  }

  // A routing rule pointing at a card that no longer exists, or a direct
  // visit to a missing card, resolves to a 404. Rather than surfacing the
  // raw card-error/debug treatment on a public page, render a friendly
  // not-found placeholder so one dangling reference degrades gracefully
  // instead of taking the page down. A card that exists but is in an error
  // state — e.g. because one of its dependencies is missing — does not get
  // this treatment: the store reports it with its real (non-404) status, so
  // its error is surfaced instead of a bare 404.
  get isNotFound() {
    return this.cardError?.status === 404;
  }

  get isLoading() {
    return Boolean(this.args.cardId) && !this.card && !this.cardError;
  }

  get shouldShowEmptyMessage() {
    return (
      !this.args.cardId && !this.card && !this.cardError && !this.isLoading
    );
  }

  private get prerenderedIsland(): HTMLElement | undefined {
    if (
      typeof document === 'undefined' ||
      !this.args.isPrimary ||
      !this.args.cardId
    ) {
      return undefined;
    }
    let island = this.mountedPrerenderedIsland;
    if (!island?.isConnected) {
      let start = document.getElementById('boxel-isolated-start');
      let candidate = start?.nextElementSibling;
      island = candidate?.hasAttribute('data-boxel-card-island')
        ? (candidate as HTMLElement)
        : undefined;
    }
    if (!island) {
      return undefined;
    }
    let prerenderedURL = island.dataset.boxelCardUrl;
    if (
      !prerenderedURL ||
      normalizeCardID(prerenderedURL) !== normalizeCardID(this.args.cardId)
    ) {
      return undefined;
    }
    return island;
  }

  get hasPrerenderedIsland() {
    return Boolean(this.prerenderedIsland);
  }

  get prerenderedIslandHydrationReady() {
    return Boolean(
      this.card &&
      this.realmSandbox.isCardIslandHydrationReady(this.card, 'isolated'),
    );
  }

  mountPrerenderedIsland = modifier((element: HTMLElement) => {
    let island = this.prerenderedIsland;
    if (island && island.parentElement !== element) {
      element.appendChild(island);
    }
    this.mountedPrerenderedIsland = island;
  });

  rehydratePrerenderedIsland = modifier(
    (element: HTMLElement, [card, hydrationReady]: [this['card'], boolean]) => {
      if (!card || !hydrationReady) {
        let waitingIsland = element.querySelector<HTMLElement>(
          ':scope > [data-boxel-card-island]',
        );
        if (waitingIsland) {
          waitingIsland.dataset.boxelCardIslandHandoff = 'waiting';
        }
        return;
      }
      let island = element.querySelector<HTMLElement>(
        ':scope > [data-boxel-card-island]',
      );
      if (!island) {
        return;
      }
      delete island.dataset.boxelCardIslandHandoff;
      let args = {
        card,
        format: 'isolated',
        getCard: this.getCardForContext,
        getCards: this.getCards,
        getCardCollection: this.getCardCollection,
        context: this.cardContext,
        cardCrudFunctions: this.cardCrudFunctions,
      };

      let compatibilityFailure = cardIslandCompatibilityFailure(
        island,
        'isolated',
      );
      if (compatibilityFailure) {
        renderWithArgs(CardIsland as any, island as any, getOwner(this)!, args);
        island.dataset.boxelCardIslandStatus = 'replaced';
        island.dataset.boxelCardIslandReason = compatibilityFailure;
        return () => teardown(island as any);
      }

      let nestedSandboxIslands: HTMLElement[] = [];
      try {
        if (!hasSerializedComponent(island as any)) {
          renderWithArgs(
            CardIsland as any,
            island as any,
            getOwner(this)!,
            args,
          );
          island.dataset.boxelCardIslandStatus = 'replaced';
          island.dataset.boxelCardIslandReason = 'missing-boundary';
          return () => teardown(island as any);
        }
        nestedSandboxIslands = Array.from(
          island.querySelectorAll<HTMLElement>(
            '[data-realm-sandbox-template-island]',
          ),
        );
        for (let nestedIsland of nestedSandboxIslands) {
          suspendSerializedComponent(nestedIsland as any);
        }
        rehydrateWithArgs(
          CardIsland as any,
          island as any,
          getOwner(this)!,
          args,
        );
        island.dataset.boxelCardIslandStatus = 'rehydrated';
        delete island.dataset.boxelCardIslandReason;
      } catch (error) {
        renderWithArgs(CardIsland as any, island as any, getOwner(this)!, args);
        island.dataset.boxelCardIslandStatus = 'replaced';
        island.dataset.boxelCardIslandReason = 'rehydration-error';
        console.warn('Card island rehydration failed; replaced its DOM', error);
      } finally {
        for (let nestedIsland of nestedSandboxIslands) {
          discardSuspendedSerializedComponent(nestedIsland as any);
        }
      }

      return () => teardown(island as any);
    },
  );

  // Reads a scroll offset stashed by removeIsolatedMarkup in a <meta> element
  // and applies it once the primary card's content has rendered and the
  // actual scroll host is available. Only runs on the primary card.
  restoreScroll = modifier((element: HTMLElement, [card]: [unknown]) => {
    if (!card || !this.args.isPrimary) {
      return;
    }

    let timer: ReturnType<typeof next> | undefined;
    let attempts = 0;
    const maxAttempts = 10;

    let restore = () => {
      attempts++;

      let meta = document.querySelector('meta[name="boxel-restore-scroll"]');
      if (!(meta instanceof HTMLMetaElement)) {
        return;
      }

      let scrollTop = parseInt(meta.getAttribute('content') ?? '0', 10);
      if (scrollTop <= 0) {
        meta.remove();
        return;
      }

      let scrollTarget =
        (element.querySelector(
          '[data-host-mode-card-scroll-container]',
        ) as HTMLElement | null) ?? element;
      let isScrollable = scrollTarget.scrollHeight > scrollTarget.clientHeight;
      if (!isScrollable && attempts < maxAttempts) {
        timer = next(restore);
        return;
      }

      scrollTarget.scrollTop = scrollTop;

      if (scrollTarget.scrollTop === scrollTop || attempts >= maxAttempts) {
        meta.remove();
        return;
      }

      timer = next(restore);
    };

    scheduleOnce('afterRender', restore);

    return () => {
      if (timer) {
        cancel(timer);
      }
    };
  });

  <template>
    <CardContainer
      {{this.restoreScroll this.card}}
      class={{cn 'host-mode-card' is-primary=@isPrimary}}
      @displayBoundaries={{@displayBoundaries}}
      data-test-host-mode-card-loaded={{bool this.card}}
      ...attributes
    >
      {{#if this.cardError}}
        {{#if this.isNotFound}}
          <div class='not-found' data-test-host-mode-404>
            <p class='not-found-code'>404</p>
            <p class='not-found-message'>This page could not be found.</p>
          </div>
        {{else}}
          <CardError @error={{this.cardError}} @hideHeader={{true}} />
        {{/if}}
      {{else if this.hasPrerenderedIsland}}
        <div
          class='card'
          data-boxel-card-island-slot
          data-host-mode-card-scroll-container
          {{this.mountPrerenderedIsland}}
          {{this.rehydratePrerenderedIsland
            this.card
            this.prerenderedIslandHydrationReady
          }}
        ></div>
      {{else if this.card}}
        <CardRenderer
          class='card'
          @card={{this.card}}
          @format='isolated'
          data-host-mode-card-scroll-container
          data-test-host-mode-card={{@cardId}}
        />
      {{else if this.isLoading}}
        <div class='message'>
          <p>Loading card…</p>
        </div>
      {{else if @openInteractSubmode}}
        <div class='non-publishable-message'>
          <p>This file is not in a publishable realm.</p>
          <BoxelButton
            {{on 'click' @openInteractSubmode}}
            data-test-switch-to-interact
          >View in Interact mode</BoxelButton>
        </div>
      {{else if this.shouldShowEmptyMessage}}
        <div class='message'>
          <p>No card selected.</p>
        </div>
      {{/if}}
    </CardContainer>

    <style scoped>
      .host-mode-card,
      .card {
        width: var(--host-mode-card-width, 50rem);
        padding: var(--host-mode-card-padding);
        border-radius: var(--host-mode-card-border-radius, 20px);
        flex: 1;
        z-index: 0;
        overflow: auto;
        position: relative;
      }

      .message {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 16rem;
        text-align: center;
        gap: var(--boxel-sp);
      }

      [data-boxel-card-island] {
        display: contents;
      }

      .not-found {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 16rem;
        height: 100%;
        text-align: center;
        gap: var(--boxel-sp-xs);
      }

      .not-found-code {
        margin: 0;
        font: 700 var(--boxel-font-xl);
        line-height: 1;
      }

      .not-found-message {
        margin: 0;
        color: var(--boxel-450);
        font: var(--boxel-font);
      }

      .non-publishable-message {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 16rem;
        text-align: center;
        gap: var(--boxel-sp);
      }

      @media print {
        .host-mode-card.is-primary {
          display: contents;
        }

        .host-mode-card.is-primary .card {
          max-height: none;
          overflow: visible;
        }
      }
    </style>
  </template>
}

function normalizeCardID(cardID: string): string {
  return cardID.replace(/\.json$/, '');
}
