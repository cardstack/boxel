import { setOwner } from '@ember/owner';
import type Owner from '@ember/owner';
import { inject as service } from '@ember/service';

import type CardService from '@cardstack/host/services/card-service';
import type CommandService from '@cardstack/host/services/command-service';
import type MatrixService from '@cardstack/host/services/matrix-service';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { Message } from './message';

type CommandStatus = 'applied' | 'ready' | 'applying';

export default class MessageCommand {
  constructor(
    public message: Message,
    public toolCallId: string,
    public name: string,
    public payload: any, //arguments of toolCall. Its not called arguments due to lint
    public eventId: string,
    private commandStatus: CommandStatus,
    public commandResultCardEventId: string | undefined,
    owner: Owner,
  ) {
    setOwner(this, owner);
  }

  @service declare commandService: CommandService;
  @service declare matrixService: MatrixService;
  @service declare cardService: CardService;

  get status() {
    if (
      this.commandService.currentlyExecutingCommandEventIds.has(this.eventId)
    ) {
      return 'applying';
    }

    return this.commandStatus;
  }

  get commandResultCardDoc() {
    if (!this.commandResultCardEventId) {
      return undefined;
    }
    let roomResource = this.matrixService.roomResources.get(
      this.message.roomId,
    );
    if (!roomResource) {
      return undefined;
    }
    try {
      let cardDoc = roomResource.serializedCardFromFragments(
        this.commandResultCardEventId,
      );
      return cardDoc;
    } catch {
      // the command result card fragments might not be loaded yet
      return undefined;
    }
  }

  async getCommandResultCard(): Promise<CardDef | undefined> {
    let cardDoc = this.commandResultCardDoc;
    if (!cardDoc) {
      return undefined;
    }
    let card = await this.cardService.createFromSerialized(
      cardDoc.data,
      cardDoc,
      undefined,
    );
    return card;
  }
}
