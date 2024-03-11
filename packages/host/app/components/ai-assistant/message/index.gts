import { on } from '@ember/modifier';
import { service } from '@ember/service';
import type { SafeString } from '@ember/template';
import Component from '@glimmer/component';

import { cached } from '@glimmer/tracking';

import { format as formatDate, formatISO } from 'date-fns';
import Modifier from 'ember-modifier';

import { trackedFunction } from 'ember-resources/util/function';

import { Button } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';
import { FailureBordered } from '@cardstack/boxel-ui/icons';

import RealmIcon from '@cardstack/host/components/operator-mode/realm-icon';
import Pill from '@cardstack/host/components/pill';

import type CardService from '@cardstack/host/services/card-service';

import { type CardDef } from 'https://cardstack.com/base/card-api';

import type { ComponentLike } from '@glint/template';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    formattedMessage: SafeString;
    datetime: Date;
    isFromAssistant: boolean;
    profileAvatar?: ComponentLike;
    attachedCards?: CardDef[];
    errorMessage?: string;
    retryAction?: () => void;
  };
  Blocks: { default: [] };
}

class ScrollIntoView extends Modifier {
  modify(element: HTMLElement) {
    element.scrollIntoView();
  }
}

export default class AiAssistantMessage extends Component<Signature> {
  @service private declare cardService: CardService;

  <template>
    <div
      class={{cn 'ai-assistant-message' is-from-assistant=@isFromAssistant}}
      {{ScrollIntoView}}
      data-test-ai-assistant-message
      ...attributes
    >
      <div class='meta'>
        {{#if @isFromAssistant}}
          <div class='ai-avatar'></div>
        {{else if @profileAvatar}}
          <@profileAvatar />
        {{/if}}
        <time datetime={{formatISO @datetime}} class='time'>
          {{formatDate @datetime 'iiii MMM d, yyyy, h:mm aa'}}
        </time>
      </div>
      <div class='content-container'>
        {{#if @errorMessage}}
          <div class='error-container'>
            <FailureBordered class='error-icon' />
            <div class='error-message' data-test-card-error>
              Error:
              {{@errorMessage}}
            </div>
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

          {{yield}}

          {{#if @attachedCards.length}}
            <div class='cards' data-test-message-cards>
              {{#each @attachedCards as |card|}}
                <CardPill @card={{card}} />
              {{/each}}
            </div>
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
        align-items: center;
        gap: var(--ai-assistant-message-gap);
      }
      .ai-avatar {
        width: var(--ai-assistant-message-avatar-size);
        height: var(--ai-assistant-message-avatar-size);

        background-image: image-set(
          url('../ai-assist-icon.webp') 1x,
          url('../ai-assist-icon@2x.webp') 2x,
          url('../ai-assist-icon@3x.webp')
        );
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
        font: 500 var(--boxel-font-xs);
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
        font-size: var(--boxel-font-sm);
        font-weight: 500;
        line-height: 1.25rem;
        letter-spacing: var(--boxel-lsp-xs);
        padding: var(--boxel-sp);
      }
      .is-from-assistant .content {
        background: #3b394b;
        color: var(--boxel-light);
      }

      .content > :deep(.patch-message) {
        font-weight: 700;
      }

      .content > :deep(*) {
        margin-top: 0;
        margin-bottom: 0;
      }
      .content > :deep(* + *) {
        margin-top: var(--boxel-sp);
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

      .cards {
        color: var(--boxel-dark);
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
      }
    </style>
  </template>
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
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        padding: var(--boxel-sp);
        overflow-y: auto;
      }
    </style>
  </template>
}

interface CardPillSignature {
  Element: HTMLDivElement;
  Args: {
    card: CardDef;
  };
  Blocks: {
    default: [];
  };
}

export class CardPill extends Component<CardPillSignature> {
  @service private declare cardService: CardService;

  get component() {
    return this.args.card.constructor.getComponent(this.args.card, 'atom');
  }

  @cached
  private get realmIconURL() {
    return this.fetchRealmInfo.value?.iconURL || null;
  }

  @cached
  private get realmName() {
    return this.fetchRealmInfo.value?.name;
  }

  private fetchRealmInfo = trackedFunction(
    this,
    async () => await this.cardService.getRealmInfo(this.args.card),
  );

  <template>
    <div data-test-message-card={{@card.id}}>
      <Pill>
        <RealmIcon
          class='realm-icon'
          @realmIconURL={{this.realmIconURL}}
          @realmName={{this.realmName}}
        />
        <this.component @displayContainer={{false}} />
      </Pill>
    </div>
    <style>
      .realm-icon {
        width: 18px;
        height: 18px;
      }
    </style>
  </template>
}
