import { setOwner } from '@ember/owner';
import type Owner from '@ember/owner';
import { inject as service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import {
  LooseSingleCardDocument,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { CommandRequest } from '@cardstack/runtime-common/commands';

import type CommandService from '@cardstack/host/services/command-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type StoreService from '@cardstack/host/services/store';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { SerializedFile } from 'https://cardstack.com/base/file-api';

import { Message } from './message';

type CommandStatus = 'applied' | 'ready' | 'applying';

export default class MessageCommand {
  @tracked commandRequest: Partial<CommandRequest>;
  @tracked commandStatus?: CommandStatus;
  @tracked commandResultFileDef?: SerializedFile;

  // @deprecated use commandResultCardId instead
  @tracked commandResultCardEventId?: string;

  constructor(
    public message: Message,
    commandRequest: Partial<CommandRequest>,
    public codeRef: ResolvedCodeRef | undefined,
    public eventId: string,
    public requiresApproval: boolean,
    commandStatus: CommandStatus,
    commandResultCardEventId: string | undefined,
    commandResultFileDef: SerializedFile | undefined,
    owner: Owner,
  ) {
    setOwner(this, owner);

    this.commandRequest = commandRequest;
    this.commandStatus = commandStatus;
    this.commandResultCardEventId = commandResultCardEventId;
    this.commandResultFileDef = commandResultFileDef;
  }

  @service declare commandService: CommandService;
  @service declare matrixService: MatrixService;
  @service declare store: StoreService;

  get id() {
    return this.commandRequest.id;
  }

  get name() {
    return this.commandRequest.name;
  }

  get arguments() {
    return this.commandRequest.arguments;
  }

  get description() {
    return this.arguments?.description;
  }

  get status() {
    if (this.commandService.currentlyExecutingCommandRequestIds.has(this.id!)) {
      return 'applying';
    }

    return this.commandStatus;
  }

  async commandResultCardDoc() {
    if (!this.commandResultCardEventId && !this.commandResultFileDef) {
      return undefined;
    }
    let roomResource = this.matrixService.roomResources.get(
      this.message.roomId,
    );
    if (!roomResource) {
      return undefined;
    }
    try {
      let cardDoc: LooseSingleCardDocument | undefined;
      if (this.commandResultCardEventId) {
        cardDoc = roomResource.serializedCardFromFragments(
          this.commandResultCardEventId,
        );
      } else if (this.commandResultFileDef) {
        cardDoc = await this.matrixService.downloadCardFileDef(
          this.commandResultFileDef,
        );
      }
      return cardDoc;
    } catch {
      // the command result card fragments might not be loaded yet
      return undefined;
    }
  }

  async getCommandResultCard(): Promise<CardDef | undefined> {
    let cardDoc = await this.commandResultCardDoc();
    let card: CardDef | undefined;
    if (cardDoc) {
      card = (await this.store.add(cardDoc, { doNotPersist: true })) as CardDef;
    }
    return card;
  }
}
