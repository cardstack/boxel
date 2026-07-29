import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { cardTypeIcon, isCardInstance } from '@cardstack/runtime-common';

import { getCard } from '@cardstack/host/resources/card-resource';

import type { ComponentLike } from '@glint/template';

interface Signature {
  Element: HTMLButtonElement | HTMLSpanElement;
  Args: {
    cardId: string;
    disabled?: boolean;
    isCurrent?: boolean;
    onClick?: (cardId: string) => void;
  };
}

interface BreadcrumbItemContentSignature {
  Args: {
    icon?: ComponentLike<{ Element: SVGSVGElement }>;
    hasCard: boolean;
    isLoading: boolean;
    label: string;
  };
}

const BreadcrumbItemContent: TemplateOnlyComponent<BreadcrumbItemContentSignature> =
  <template>
    {{#if @hasCard}}
      {{#if @icon}}
        <@icon
          class='breadcrumb-item-icon'
          width='18'
          height='18'
          aria-hidden='true'
        />
      {{/if}}
      <span class='label'>{{@label}}</span>
    {{else if @isLoading}}
      <span class='label muted'>
        Loading…
      </span>
    {{else}}
      <span class='label'>{{@label}}</span>
    {{/if}}

    <style scoped>
      .breadcrumb-item-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: var(--boxel-highlight);
      }

      @media (max-width: 30rem) {
        .breadcrumb-item-icon {
          width: 0.75rem;
          height: 0.75rem;
        }
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
  </template>;

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

  private get iconComponent():
    | ComponentLike<{
        Element: SVGSVGElement;
      }>
    | undefined {
    if (!this.card) {
      return undefined;
    }

    return cardTypeIcon(this.card) as
      | ComponentLike<{ Element: SVGSVGElement }>
      | undefined;
  }

  private get label() {
    let card = this.card;
    if (card && isCardInstance(card) && typeof card.cardTitle === 'string') {
      return card.cardTitle;
    }
    if (card && 'name' in card && typeof card.name === 'string') {
      return card.name;
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
    {{#let this.iconComponent as |Icon|}}
      {{#if @isCurrent}}
        <span
          class='breadcrumb-item'
          aria-current='page'
          title={{this.label}}
          data-test-host-mode-breadcrumb={{@cardId}}
        >
          <BreadcrumbItemContent
            @icon={{Icon}}
            @hasCard={{if this.card true false}}
            @isLoading={{this.isLoading}}
            @label={{this.label}}
          />
        </span>
      {{else}}
        <button
          type='button'
          class='breadcrumb-item'
          disabled={{this.isDisabled}}
          title={{this.label}}
          data-test-host-mode-breadcrumb={{@cardId}}
          {{on 'click' this.handleClick}}
        >
          <BreadcrumbItemContent
            @icon={{Icon}}
            @hasCard={{if this.card true false}}
            @isLoading={{this.isLoading}}
            @label={{this.label}}
          />
        </button>
      {{/if}}
    {{/let}}

    <style scoped>
      .breadcrumb-item {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-2xs);
        max-width: 16rem;
        min-height: 1.5rem;
        box-sizing: border-box;
        background: none;
        border: none;
        padding-block: var(--boxel-sp-4xs);
        padding-inline: 0;
        margin: 0;
        color: inherit;
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }

      button.breadcrumb-item:focus-visible {
        outline: 1px solid var(--boxel-light-60);
        border-radius: var(--boxel-border-radius-lg);
      }
    </style>
  </template>
}
