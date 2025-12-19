import { modifier, on } from '@ember/modifier';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { BoxelButton, CardContainer } from '@cardstack/boxel-ui/components';

import { service } from '@ember/service';
import CardRenderer from '@cardstack/host/components/card-renderer';
import { getCard } from '@cardstack/host/resources/card-resource';
import PrerenderHydrationService from '@cardstack/host/services/prerender-hydration';

interface Signature {
  Element: HTMLElement;
  Args: {
    cardId: string | null;
    displayBoundaries?: boolean;
    openInteractSubmode?: () => void;
  };
}

export default class HostModeCard extends Component<Signature> {
  @service declare prerenderHydration: PrerenderHydrationService;

  @cached
  get cardResource() {
    if (!this.args.cardId) {
      return undefined;
    }

    return getCard(this, () => this.args.cardId!);
  }

  get card() {
    let card = this.cardResource?.card;

    if (card) {
      this.prerenderHydration.discard();
    }

    return card;
  }

  get isError() {
    return Boolean(this.cardError);
  }

  get isLoading() {
    return Boolean(this.args.cardId) && !this.card && !this.isError;
  }

  get cardError() {
    let error = this.cardResource?.cardError;

    if (error) {
      this.prerenderHydration.discard();
    }

    return error;
  }

  get errorMessage() {
    return this.cardError?.message;
  }

  get shouldShowEmptyMessage() {
    return !this.args.cardId && !this.card && !this.isError && !this.isLoading;
  }

  get normalizedCardId() {
    return this.args.cardId
      ?.replace(/\.json$/, '')
      .replace(/#.*$/, '')
      .replace(/\?.*$/, '')
      .replace(/\/$/, '');
  }

  get hasPrerenderedCard() {
    return this.prerenderHydration.hasMarkupFor(this.normalizedCardId);
  }

  hydratePrerender = modifier((element: HTMLElement) => {
    if (this.prerenderHydration.consume(element, this.normalizedCardId)) {
      return;
    }

    this.prerenderHydration.discard();
  });

  clearPrerender = modifier(() => {
    if (!this.hasPrerenderedCard) {
      this.prerenderHydration.discard();
    }
  });

  <template>
    <CardContainer
      class='host-mode-card'
      displayBoundaries={{@displayBoundaries}}
      {{this.clearPrerender}}
      ...attributes
    >
      {{#if this.card}}
        <CardRenderer
          class='card'
          @card={{this.card}}
          @format='isolated'
          data-test-host-mode-card={{@cardId}}
        />
      {{else if this.isError}}
        <div class='message message--error' data-test-host-mode-error>
          <p>{{this.errorMessage}}</p>
        </div>
      {{else if this.hasPrerenderedCard}}
        <div
          class='card card--prerender'
          data-test-host-mode-card-prerender={{@cardId}}
          {{this.hydratePrerender}}
        ></div>
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
        overflow: auto;
      }

      .message {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 16rem;
        text-align: center;
        gap: var(--boxel-sp);
      }

      .message--error {
        color: var(--boxel-error-100);
      }

      .card--prerender {
        display: flex;
        justify-content: center;
        align-items: stretch;
      }

      .card--prerender [data-boxel-prerender-card] {
        width: 100%;
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
    </style>
  </template>
}
