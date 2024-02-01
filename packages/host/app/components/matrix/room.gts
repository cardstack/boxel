import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, /* task, */ timeout, all } from 'ember-concurrency';

import { Button } from '@cardstack/boxel-ui/components';

import {
  catalogEntryRef,
  chooseCard,
  isMatrixCardError,
} from '@cardstack/runtime-common';

import { getRoom } from '@cardstack/host/resources/room';

import type CardService from '@cardstack/host/services/card-service';
import type MatrixService from '@cardstack/host/services/matrix-service';

import { type CatalogEntry } from 'https://cardstack.com/base/catalog-entry';

import { AiAssistantConversation } from '../ai-assistant/message';

import RoomInput from './room-input';
import RoomMessage from './room-message';

interface Signature {
  Args: {
    roomId: string;
    leaveRoom: (roomId: string) => void;
  };
}

export default class Room extends Component<Signature> {
  <template>
    <section
      class='room'
      data-room-settled={{this.doWhenRoomChanges.isIdle}}
      data-test-room-settled={{this.doWhenRoomChanges.isIdle}}
      data-test-room-name={{this.room.name}}
    >
      <header class='room-info'>
        <h3 class='room-name'>{{this.room.name}}</h3>
        <Button
          @kind='secondary-dark'
          @size='extra-small'
          {{on 'click' (fn @leaveRoom @roomId)}}
          data-test-leave-room-btn={{this.room.name}}
        >
          Leave Room
        </Button>
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
        {{#each this.room.messages as |message i|}}
          <RoomMessage @message={{message}} data-test-message-idx={{i}} />
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

      .room-actions {
        box-shadow: var(--boxel-box-shadow);
      }
    </style>
  </template>

  private roomResource = getRoom(this, () => this.args.roomId);

  @service private declare cardService: CardService;
  @service private declare matrixService: MatrixService;

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
