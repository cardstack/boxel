import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

import { Button } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { type CardDef } from 'https://cardstack.com/base/card-api';
import { type MessageField } from 'https://cardstack.com/base/room';

import AiAssistantMessage from '../ai-assistant/message';
import { aiBotUserId } from '../ai-assistant/panel';
import ProfileAvatarIcon from '../operator-mode/profile-avatar-icon';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    message: MessageField;
  };
}

export default class Room extends Component<Signature> {
  <template>
    <AiAssistantMessage
      @formattedMessage={{htmlSafe @message.formattedMessage}}
      @datetime={{@message.created}}
      @isFromAssistant={{eq @message.author.userId aiBotUserId}}
      @profileAvatar={{component
        ProfileAvatarIcon
        userId=@message.author.userId
      }}
      @attachedCards={{this.resources.cards}}
      @errorMessage={{this.errorMessage}}
      data-test-boxel-message-from={{@message.author.name}}
      ...attributes
    >
      {{#if (eq @message.command.commandType 'patch')}}
        <div
          data-test-patch-card-idle={{this.operatorModeStateService.patchCard.isIdle}}
        >
          {{#let @message.command.payload as |payload|}}
            <Button
              @kind='secondary-dark'
              data-test-command-apply
              {{on
                'click'
                (fn this.patchCard payload.id payload.patch.attributes)
              }}
              @loading={{this.operatorModeStateService.patchCard.isRunning}}
              @disabled={{this.operatorModeStateService.patchCard.isRunning}}
            >
              Apply
            </Button>
          {{/let}}
        </div>
      {{/if}}
    </AiAssistantMessage>
  </template>

  @service private declare operatorModeStateService: OperatorModeStateService;

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
    this.operatorModeStateService.patchCard.perform(cardId, attributes);
  }
}
