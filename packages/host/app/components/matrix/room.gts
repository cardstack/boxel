import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
//@ts-expect-error the types don't recognize the cached export
import { tracked, cached } from '@glimmer/tracking';

import { restartableTask, /* task, */ timeout, all } from 'ember-concurrency';

import { Button } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import {
  catalogEntryRef,
  chooseCard,
  isMatrixCardError,
} from '@cardstack/runtime-common';

import { getRoom } from '@cardstack/host/resources/room';

import type CardService from '@cardstack/host/services/card-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { type CatalogEntry } from 'https://cardstack.com/base/catalog-entry';

import AiAssistantMessage, {
  AiAssistantConversation,
} from '../ai-assistant/message';
import { aiBotUserId } from '../ai-assistant/panel';
import ProfileAvatarIcon from '../operator-mode/profile-avatar-icon';

import RoomInput from './room-input';
import RoomMembers from './room-members';

interface Signature {
  Args: {
    roomId: string;
  };
}

export default class Room extends Component<Signature> {
  <template>
    <section
      class='room'
      data-test-room-settled={{this.doWhenRoomChanges.isIdle}}
      data-test-room-name={{this.room.name}}
    >
      <header class='room-info'>
        <h3 class='room-name'>{{this.room.name}}</h3>
        <RoomMembers @roomId={{@roomId}} @memberNames={{this.memberNames}} />
      </header>

      <AiAssistantConversation>
        {{#if this.objective}}
          <section class='room-objective'>
            {{#if this.objectiveError}}
              <div class='error' data-test-objective-error>
                Error: cannot render card
                {{this.objectiveError.id}}:
                {{this.objectiveError.error.message}}
              </div>
            {{else}}
              <this.objectiveComponent />
            {{/if}}
          </section>
        {{/if}}
        <div class='timeline-start' data-test-timeline-start>
          - Beginning of conversation -
        </div>
        {{#each this.messageCardComponents as |Message i|}}
          <AiAssistantMessage
            @formattedMessage={{htmlSafe Message.card.formattedMessage}}
            @datetime={{Message.card.created}}
            @isFromAssistant={{eq Message.card.author.userId aiBotUserId}}
            @profileAvatar={{component
              ProfileAvatarIcon
              userId=Message.card.author.userId
            }}
            data-test-message-index={{i}}
            data-test-boxel-message-from={{Message.card.author.name}}
          >
            {{#if Message.card.attachedCardId}}
              <Message.component />
            {{/if}}
          </AiAssistantMessage>

          {{#if (eq Message.card.command.commandType 'patch')}}
            <div
              data-test-patch-card-idle={{this.operatorModeStateService.patchCard.isIdle}}
            >
              {{#let Message.card.command.payload as |payload|}}
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

        {{else}}
          <div data-test-no-messages>
            (No messages)
          </div>
        {{/each}}
      </AiAssistantConversation>

      <footer class='room-actions'>
        {{#if this.showSetObjectiveButton}}
          <div class='set-objective'>
            <Button
              @kind='secondary-dark'
              {{on 'click' this.setObjective}}
              @disabled={{this.doSetObjective.isRunning}}
              data-test-set-objective-btn
            >
              Set Objective
            </Button>
          </div>
        {{/if}}
        <RoomInput @roomId={{@roomId}} @roomName={{this.room.name}} />
      </footer>
    </section>

    <style>
      .room {
        display: grid;
        grid-template-rows: auto 1fr auto;
        height: 100%;
        overflow: hidden;
      }

      .room-info {
        border-bottom: var(--boxel-border);
        padding: var(--boxel-sp);
      }

      .room-name {
        margin-top: 0;
      }

      .room-actions {
        border-top: var(--boxel-border);
        padding: var(--boxel-sp);
      }

      .room-objective {
        margin-bottom: var(--boxel-sp-lg);
      }

      .set-objective {
        margin-bottom: var(--boxel-sp);
      }

      .error {
        color: var(--boxel-danger);
        font-weight: 'bold';
      }

      .timeline-start {
        padding-bottom: var(--boxel-sp);
      }
    </style>
  </template>

  private roomResource = getRoom(this, () => this.args.roomId);

  @service private declare cardService: CardService;
  @service private declare matrixService: MatrixService;
  @service private declare operatorModeStateService: OperatorModeStateService;

  @tracked private isAllowedToSetObjective: boolean | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.doMatrixEventFlush.perform();
  }

  private doMatrixEventFlush = restartableTask(async () => {
    await this.matrixService.flushMembership;
    await this.matrixService.flushTimeline;
    await this.roomResource.loading;
    this.isAllowedToSetObjective =
      await this.matrixService.allowedToSetObjective(this.args.roomId);
  });

  private get room() {
    return this.roomResource.room;
  }

  @cached
  private get memberNames() {
    if (!this.room) {
      return 'None';
    }
    return [
      ...this.room.joinedMembers.map((m) => m.name),
      ...this.room.invitedMembers
        .map((m) =>
          m.userId !== aiBotUserId ? `${m.name} (invited)` : undefined,
        )
        .filter(Boolean),
    ].join(', ');
  }

  private get objective() {
    return this.matrixService.roomObjectives.get(this.args.roomId);
  }

  private get objectiveComponent() {
    if (this.objective && !isMatrixCardError(this.objective)) {
      return this.objective.constructor.getComponent(
        this.objective,
        'embedded',
      );
    }
    return undefined;
  }

  private get objectiveError() {
    if (isMatrixCardError(this.objective)) {
      return this.objective;
    }
    return undefined;
  }

  private get messageCardComponents() {
    return this.room
      ? this.room.messages.map((messageCard) => {
          return {
            component: messageCard.constructor.getComponent(
              messageCard,
              'embedded',
            ),
            card: messageCard,
          };
        })
      : [];
  }

  private patchCard = (cardId: string, attributes: any) => {
    this.operatorModeStateService.patchCard.perform(cardId, attributes);
  };

  private doWhenRoomChanges = restartableTask(async () => {
    await all([this.cardService.cardsSettled(), timeout(500)]);
  });

  private get showSetObjectiveButton() {
    return !this.objective && this.isAllowedToSetObjective;
  }

  @action
  private setObjective() {
    this.doSetObjective.perform();
  }

  private doSetObjective = restartableTask(async () => {
    // objective are currently non-primitive fields
    let catalogEntry = await chooseCard<CatalogEntry>({
      filter: {
        every: [
          {
            on: catalogEntryRef,
            eq: { isField: true },
          },
          {
            on: catalogEntryRef,
            eq: { isPrimitive: false },
          },
        ],
      },
    });
    if (catalogEntry) {
      await this.matrixService.setObjective(this.args.roomId, catalogEntry.ref);
    }
  });
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Room {
    'Matrix::Room': typeof Room;
  }
}
