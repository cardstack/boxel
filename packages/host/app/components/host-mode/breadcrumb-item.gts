import { on } from '@ember/modifier';
import { action } from '@ember/object';

import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { cardTypeIcon } from '@cardstack/runtime-common';

import { getCard } from '@cardstack/host/resources/card-resource';

import type { ComponentLike } from '@glint/template';

interface Signature {
  Element: HTMLButtonElement;
  Args: {
    cardId: string;
    disabled?: boolean;
    onClick?: (cardId: string) => void;
  };
}

export default class HostModeBreadcrumbItem extends Component<Signature> {
  @cached
  private get cardResource(): ReturnType<typeof getCard> | undefined {
    if (!this.args.cardId) {
      return undefined;
    }

    return getCard(this, () => this.args.cardId);
  }

  @cached
  private get card() {
    return this.cardResource?.card;
  }

  private get cardError() {
    return this.cardResource?.cardError;
  }

  private get isLoading() {
    return Boolean(this.args.cardId) && !this.card && !this.cardError;
  }

  private get iconComponent(): ComponentLike | undefined {
    if (!this.card) {
      return undefined;
    }

    return cardTypeIcon(this.card) as ComponentLike | undefined;
  }

  private get label() {
    if (this.card && typeof this.card.cardTitle === 'string') {
      return this.card.cardTitle;
    }

    return this.args.cardId;
  }

  private get isDisabled() {
    return Boolean(this.args.disabled);
  }

  @action
  private handleClick() {
    if (this.isDisabled) {
      return;
    }

    if (this.args.onClick) {
      this.args.onClick(this.args.cardId);
    }
  }

  <template>
    <button
      type='button'
      class='breadcrumb-item'
      disabled={{this.isDisabled}}
      title={{this.label}}
      data-test-host-mode-breadcrumb={{@cardId}}
      {{on 'click' this.handleClick}}
    >
      {{#if this.card}}
        {{#if this.iconComponent}}
          {{#let this.iconComponent as |Icon|}}
            <span class='icon' aria-hidden='true'>
              <Icon />
            </span>
          {{/let}}
        {{/if}}
        <span class='label'>{{this.label}}</span>
      {{else if this.isLoading}}
        <span class='label muted'>
          Loading…
        </span>
      {{else}}
        <span class='label'>{{this.label}}</span>
      {{/if}}
    </button>

    <style scoped>
      .breadcrumb-item {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        max-width: 16rem;
        background: none;
        border: none;
        padding: 0;
        margin: 0;
        color: inherit;
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }

      .breadcrumb-item:focus-visible {
        outline: 1px solid rgba(255, 255, 255, 0.6);
        border-radius: var(--boxel-border-radius-lg);
      }

      .icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        color: var(--boxel-teal);
      }

      .label {
        font: 500 var(--boxel-font-sm);
        color: var(--boxel-light);
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .muted {
        opacity: 0.7;
        font-weight: 500;
      }
    </style>
  </template>
}
