import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { BoxelButton, CardContainer } from '@cardstack/boxel-ui/components';
import { bool } from '@cardstack/boxel-ui/helpers';

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

  get cardErrorMessage() {
    if (this.cardError?.status === 404) {
      return 'Card not found.';
    }
    return undefined;
  }

  get isLoading() {
    return Boolean(this.args.cardId) && !this.card && !this.cardError;
  }

  get shouldShowEmptyMessage() {
    return (
      !this.args.cardId && !this.card && !this.cardError && !this.isLoading
    );
  }

  <template>
    <CardContainer
      class='host-mode-card {{if @isPrimary "is-primary"}}'
      displayBoundaries={{@displayBoundaries}}
      data-test-host-mode-card-loaded={{bool this.card}}
      ...attributes
    >
      {{#if this.cardError}}
        <CardError
          @error={{this.cardError}}
          @hideHeader={{true}}
          @message={{this.cardErrorMessage}}
        />
      {{else if this.card}}
        <CardRenderer
          class='card'
          @card={{this.card}}
          @format='isolated'
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
