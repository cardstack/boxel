import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { BoxelButton, CardContainer } from '@cardstack/boxel-ui/components';

import CardRenderer from '@cardstack/host/components/card-renderer';
import { getCard } from '@cardstack/host/resources/card-resource';

interface Signature {
  Element: HTMLElement;
  Args: {
    cardId: string;
    displayBoundaries?: boolean;
    openInteractSubmode?: () => void;
  };
}

export default class HostModeCard extends Component<Signature> {
  @cached
  get cardResource() {
    if (!this.args.cardId) {
      return undefined;
    }

    return getCard(this, () => this.args.cardId);
  }

  get card() {
    return this.cardResource?.card;
  }

  get isError() {
    return this.cardResource?.cardError;
  }

  get isLoading() {
    return Boolean(this.args.cardId) && !this.card && !this.isError;
  }

  get cardError() {
    return this.cardResource?.cardError;
  }

  get errorMessage() {
    return this.cardError?.message;
  }

  get loadingMessage() {
    return 'Loading card...';
  }

  get shouldShowEmptyMessage() {
    return !this.args.cardId && !this.card && !this.isError && !this.isLoading;
  }

  get emptyMessage() {
    return 'No card selected.';
  }

  <template>
    <CardContainer
      class='host-mode-card'
      displayBoundaries={{@displayBoundaries}}
      ...attributes
    >
      {{#if this.card}}
        <CardRenderer
          class='host-mode-card'
          @card={{this.card}}
          @format='isolated'
          data-test-host-mode-card={{@cardId}}
        />
      {{else if this.isError}}
        <div class='message message--error' data-test-host-mode-error>
          <p>{{this.errorMessage}}</p>
        </div>
      {{else if this.isLoading}}
        <div class='message'>
          <p>{{this.loadingMessage}}</p>
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
          <p>{{this.emptyMessage}}</p>
        </div>
      {{/if}}
    </CardContainer>

    <style scoped>
      .host-mode-card {
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
