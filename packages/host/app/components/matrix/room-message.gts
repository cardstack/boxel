import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

import { marked } from 'marked';

import { eq } from '@cardstack/boxel-ui/helpers';

import { sanitizeHtml } from '@cardstack/runtime-common';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type AiService from '@cardstack/host/services/ai-service';

import { type CardDef } from 'https://cardstack.com/base/card-api';
import { type MessageField } from 'https://cardstack.com/base/room';

import ApplyButton from '../ai-assistant/apply-button';
import AiAssistantMessage from '../ai-assistant/message';
import { aiBotUserId } from '../ai-assistant/panel';
import ProfileAvatarIcon from '../operator-mode/profile-avatar-icon';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    message: MessageField;
    roomId: string;
    isStreaming: boolean;
  };
}

export default class Room extends Component<Signature> {
  <template>
    <AiAssistantMessage
      @formattedMessage={{htmlSafe this.formattedMessage}}
      @datetime={{@message.created}}
      @isFromAssistant={{eq @message.author.userId aiBotUserId}}
      @profileAvatar={{component
        ProfileAvatarIcon
        userId=@message.author.userId
      }}
      @attachedCards={{this.resources.cards}}
      @errorMessage={{this.errorMessage}}
      @isStreaming={{@isStreaming}}
      data-test-boxel-message-from={{@message.author.name}}
      ...attributes
    >
      {{#if (eq @message.command.commandType 'patch')}}
        <div
          class='patch-button-bar'
          data-test-patch-card-idle={{this.operatorModeStateService.patchCard.isIdle}}
        >
          {{#let @message.command.payload as |payload|}}
            <ApplyButton
              @state={{if
                this.operatorModeStateService.patchCard.isRunning
                'applying'
                'ready'
              }}
              data-test-command-apply
              {{on
                'click'
                (fn this.patchCard payload.id payload.patch.attributes)
              }}
            />
          {{/let}}
        </div>
      {{else}}
        <div
          class='patch-button-bar'
          data-test-patch-card-idle={{this.operatorModeStateService.patchCard.isIdle}}
        >
          {{#if @message.command}}
            {{#let @message.command as |command|}}
              <ApplyButton
                @state={{if
                  this.operatorModeStateService.patchCard.isRunning
                  'applying'
                  'ready'
                }}
                data-test-command-apply
                {{on 'click' (fn this.callFunction command)}}
              />
            {{/let}}
          {{/if}}
        </div>
      {{/if}}
    </AiAssistantMessage>

    <style>
      .patch-button-bar {
        display: flex;
        justify-content: flex-end;
        margin-top: var(--boxel-sp);
      }
    </style>
  </template>

  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare aiService: AiService;

  private get formattedMessage() {
    return sanitizeHtml(marked(this.args.message.formattedMessage));
  }

  private get resources() {
    let cards: CardDef[] = [];
    let errors: { id: string; error: Error }[] = [];
    this.args.message.attachedResources?.map((resource) => {
      if (resource.card) {
        cards.push(resource.card);
      } else if (resource.cardError) {
        let { id, error } = resource.cardError;
        errors.push({
          id,
          error,
        });
      }
    });
    return {
      cards: cards.length ? cards : undefined,
      errors: errors.length ? errors : undefined,
    };
  }

  private get errorMessage() {
    if (!this.resources.errors) {
      return undefined;
    }
    return this.resources.errors
      .map(
        (e: { id: string; error: Error }) =>
          `cannot render card ${e.id}: ${e.error.message}`,
      )
      .join(', ');
  }

  @action patchCard(cardId: string, attributes: Record<string, unknown>) {
    if (this.operatorModeStateService.patchCard.isRunning) {
      return;
    }
    this.operatorModeStateService.patchCard.perform(cardId, attributes);
  }
  // Pass in entire stack?
  // = give it a loader? If we have a loader can we load a card and update it?
  // With a loader we can totally ignore whether it's in the stack or not
  // If we just do the stack we can simplify the UI for this demo... or can we?
  // Stacks are shit.
  // How do we get the id in?
  // Auto calls  - where is this specified?
  // Where can we do auto calls? Would need to process a call, but *once* - not every time the card is rendered
  // Hack this in. It doesn't need to be perfect, just to show the concept
  // Add to a list in a field of processed things. Only run iif it's new
  @action callFunction(command: any) {
    console.log('callFunction', command, 'in', this.args.roomId);
    let result = this.aiService.callFunction(
      command.commandType,
      command.payload.patch,
      command.functionCall,
      this.args.roomId,
    );
  }
}
