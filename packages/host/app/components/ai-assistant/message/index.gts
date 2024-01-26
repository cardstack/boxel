import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import type { SafeString } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { format as formatDate, formatISO } from 'date-fns';
import { restartableTask } from 'ember-concurrency';
import Modifier from 'ember-modifier';

import { Button } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';
import { FailureBordered } from '@cardstack/boxel-ui/icons';

import Pill from '@cardstack/host/components/pill';
import { getCard } from '@cardstack/host/resources/card-resource';

import { type CardDef } from 'https://cardstack.com/base/card-api';

import type { ComponentLike } from '@glint/template';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    formattedMessage: SafeString;
    datetime: Date;
    isFromAssistant: boolean;
    profileAvatar?: ComponentLike;
    errorMessage?: string;
    retryAction?: () => void;
    attachedCardIds?: string[];
  };
  Blocks: { default: [] };
}

class ScrollIntoView extends Modifier {
  modify(element: HTMLElement) {
    element.scrollIntoView();
  }
}

export default class AiAssistantMessage extends Component<Signature> {
  <template>
    <div
      class={{cn 'ai-assistant-message' is-from-assistant=@isFromAssistant}}
      {{ScrollIntoView}}
      data-test-ai-assistant-message
      ...attributes
    >
      <div class='meta'>
        {{#if @isFromAssistant}}
          {{! template-lint-disable no-inline-styles }}
          <div
            class='ai-avatar'
            style="background-image: image-set(url('/images/ai-assist-icon.webp') 1x, url('/images/ai-assist-icon@2x.webp') 2x, url('/images/ai-assist-icon@3x.webp') 3x)"
          ></div>
        {{else if @profileAvatar}}
          <@profileAvatar />
        {{/if}}
        <time datetime={{formatISO @datetime}} class='time'>
          {{formatDate @datetime 'iiii MMM d, yyyy, h:mm aa'}}
        </time>
      </div>
      <div class='content-container'>
        {{#if this.errorMessage}}
          <div class='error-container'>
            <FailureBordered class='error-icon' />
            <div class='error-message'>{{this.errorMessage}}</div>
            {{#if @retryAction}}
              <Button
                {{on 'click' @retryAction}}
                class='retry-button'
                @size='small'
                @kind='secondary-dark'
              >
                Retry
              </Button>
            {{/if}}
          </div>
        {{/if}}
        <div class='content'>
          {{@formattedMessage}}

          {{#if this.cards}}
            <div class='card-picker' data-test-message-cards>
              {{#each this.cards as |card i|}}
                <Pill
                  @inert={{true}}
                  class='card-pill'
                  data-test-pill-index={{i}}
                  data-test-selected-card={{card.id}}
                >
                  <div class='card-title'>{{getDisplayTitle card}}</div>
                </Pill>
              {{/each}}
            </div>
          {{else if this.getCards.isRunning}}
            <div class='loading'>Loading...</div>
          {{/if}}
        </div>
      </div>
    </div>

    <style>
      .ai-assistant-message {
        --ai-assistant-message-avatar-size: 1.25rem; /* 20px. */
        --ai-assistant-message-meta-height: 1.25rem; /* 20px */
        --ai-assistant-message-gap: var(--boxel-sp-xs);
        --profile-avatar-icon-size: var(--ai-assistant-message-avatar-size);
        --profile-avatar-icon-border: 1px solid var(--boxel-400);
      }
      .meta {
        display: grid;
        grid-template-columns: var(--ai-assistant-message-avatar-size) 1fr;
        grid-template-rows: var(--ai-assistant-message-meta-height);
        align-items: start;
        gap: var(--ai-assistant-message-gap);
      }
      .ai-avatar {
        width: var(--ai-assistant-message-avatar-size);
        height: var(--ai-assistant-message-avatar-size);
        background-repeat: no-repeat;
        background-size: var(--ai-assistant-message-avatar-size);
      }
      .avatar-img {
        width: var(--ai-assistant-message-avatar-size);
        height: var(--ai-assistant-message-avatar-size);
        border-radius: 100px;
      }

      .time {
        display: block;
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-sm);
        color: var(--boxel-450);
        white-space: nowrap;
      }

      /* spacing for sequential thread messages */
      .ai-assistant-message + .ai-assistant-message {
        margin-top: var(--boxel-sp-lg);
      }

      .ai-assistant-message + .hide-meta {
        margin-top: var(--boxel-sp);
      }

      .content-container {
        margin-top: var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius-xs)
          var(--boxel-border-radius-xl) var(--boxel-border-radius-xl)
          var(--boxel-border-radius-xl);
        overflow: hidden;
      }

      .content {
        background-color: var(--boxel-light);
        color: var(--boxel-dark);
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
        padding: var(--boxel-sp);
      }
      .is-from-assistant .content {
        background: #433358;
        color: var(--boxel-light);
      }

      .error-container {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background-color: var(--boxel-danger);
        color: var(--boxel-light);
        font: 700 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
      }
      .error-icon {
        --icon-background-color: var(--boxel-light);
        --icon-color: var(--boxel-danger);
        margin-top: var(--boxel-sp-5xs);
      }
      .error-message {
        align-self: center;
      }
      .retry-button {
        --boxel-button-padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        --boxel-button-min-height: max-content;
        --boxel-button-min-width: max-content;
        border-color: var(--boxel-light);
      }

      .card-picker {
        --pill-height: 1.875rem;
        --pill-content-max-width: 10rem;
        color: var(--boxel-dark);
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
      }
      .card-pill {
        background-color: var(--boxel-light);
        border: 1px solid var(--boxel-400);
        height: var(--pill-height);
      }
      .card-title {
        max-width: var(--pill-content-max-width);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    </style>
  </template>

  @tracked cards: CardDef[] | undefined = [];
  @tracked errors: { id?: string; error: string }[] | undefined = undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    if (!this.args.attachedCardIds?.length) {
      return;
    }
    this.getCards.perform(this.args.attachedCardIds);
  }

  private getCards = restartableTask(async (cardIds: string[]) => {
    let cards: CardDef[] = [];
    let errors: { id?: string; error: string }[] = [];
    await Promise.all(
      cardIds.map(async (id) => {
        try {
          let cardResource = getCard(this, () => id);
          await cardResource.loaded;
          if (!cardResource.card) {
            errors.push({ id, error: `cannot find card for id "${id}"` });
            return;
          }
          cards.push(cardResource.card);
        } catch (e) {
          errors.push({ id, error: `cannot find card for id "${id}"` });
        }
      }),
    );
    this.cards = cards.length ? cards : undefined;
    this.errors = errors.length ? errors : undefined;
    console.log(this.cards, this.errors);
  });

  private get errorMessage() {
    if (!this.errors && !this.args.errorMessage) {
      return undefined;
    }
    let errors = this.errors || [];
    if (this.args.errorMessage) {
      errors.push({ error: this.args.errorMessage });
    }
    return errors.map((e) => e.error).join(', ');
  }
}

interface AiAssistantConversationSignature {
  Element: HTMLDivElement;
  Args: {};
  Blocks: {
    default: [];
  };
}

export class AiAssistantConversation extends Component<AiAssistantConversationSignature> {
  <template>
    <div class='ai-assistant-conversation'>
      {{yield}}
    </div>
    <style>
      .ai-assistant-conversation {
        padding: var(--boxel-sp);
        overflow-y: auto;
      }
    </style>
  </template>
}

function getDisplayTitle(card: CardDef) {
  return card.title || card.constructor.displayName || 'Untitled Card';
}
