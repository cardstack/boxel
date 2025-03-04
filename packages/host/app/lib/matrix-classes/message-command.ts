import { setOwner } from '@ember/owner';
import type Owner from '@ember/owner';
import { inject as service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import { ResolvedCodeRef } from '@cardstack/runtime-common';
import { CommandRequest } from '@cardstack/runtime-common/commands';

import type CardService from '@cardstack/host/services/card-service';
import type CommandService from '@cardstack/host/services/command-service';
import type MatrixService from '@cardstack/host/services/matrix-service';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { Message } from './message';

type CommandStatus = 'applied' | 'ready' | 'applying';

export default class MessageCommand {
  @tracked commandRequest: Partial<CommandRequest>;
  @tracked commandStatus?: CommandStatus;
  @tracked commandResultCardEventId?: string;

  constructor(
    public message: Message,
    commandRequest: Partial<CommandRequest>,
    public codeRef: ResolvedCodeRef | undefined,
    public eventId: string,
    commandStatus: CommandStatus,
    commandResultCardEventId: string | undefined,
    owner: Owner,
  ) {
    setOwner(this, owner);

    this.commandRequest = commandRequest;
    this.commandStatus = commandStatus;
    this.commandResultCardEventId = commandResultCardEventId;
  }

  @service declare commandService: CommandService;
  @service declare matrixService: MatrixService;
  @service declare cardService: CardService;

  get id() {
    return this.commandRequest.id;
  }

  get name() {
    return this.commandRequest.name;
  }

  get arguments() {
    return this.commandRequest.arguments;
  }

  get status() {
    if (this.commandService.currentlyExecutingCommandRequestIds.has(this.id!)) {
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
