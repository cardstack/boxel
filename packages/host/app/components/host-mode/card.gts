import { on } from '@ember/modifier';
import { cancel, next, scheduleOnce } from '@ember/runloop';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';

import { BoxelButton, CardContainer } from '@cardstack/boxel-ui/components';
import { bool, cn } from '@cardstack/boxel-ui/helpers';

import CardRenderer from '@cardstack/host/components/card-renderer';
import CardError from '@cardstack/host/components/operator-mode/card-error';
import { getCard } from '@cardstack/host/resources/card-resource';

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
