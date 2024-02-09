import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { restartableTask, timeout, all } from 'ember-concurrency';

import { getRoom } from '@cardstack/host/resources/room';

import type CardService from '@cardstack/host/services/card-service';
import type MatrixService from '@cardstack/host/services/matrix-service';

import { AiAssistantConversation } from '../ai-assistant/message';

import RoomInput from './room-input';
import RoomMessage from './room-message';

interface Signature {
  Args: {
    roomId: string;
  };
}

export default class Room extends Component<Signature> {
  <template>
    <section
      class='room'
      data-room-settled={{this.doWhenRoomChanges.isIdle}}
      data-test-room-settled={{this.doWhenRoomChanges.isIdle}}
      data-test-room={{this.room.name}}
    >
      <header class='room-info'>
        <h3 class='room-name' data-test-room-name>{{this.room.name}}</h3>
      </header>

      <AiAssistantConversation>
        <div class='timeline-start' data-test-timeline-start>
          - Beginning of conversation -
        </div>
        {{#each this.room.messages as |message i|}}
          <RoomMessage @message={{message}} data-test-message-idx={{i}} />
        {{else}}
          <div data-test-no-messages>(No messages)</div>
        {{/each}}
      </AiAssistantConversation>

      <footer class='room-actions'>
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

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.doMatrixEventFlush.perform();
  }

  private doMatrixEventFlush = restartableTask(async () => {
    await this.matrixService.flushMembership;
    await this.matrixService.flushTimeline;
    await this.roomResource.loading;
  });

  private get room() {
    return this.roomResource.room;
  }

  private doWhenRoomChanges = restartableTask(async () => {
    await all([this.cardService.cardsSettled(), timeout(500)]);
  });
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Room {
    'Matrix::Room': typeof Room;
  }
}
