import { setOwner } from '@ember/owner';
import type Owner from '@ember/owner';
import { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import type { ResolvedCodeRef } from '@cardstack/runtime-common';
import type { CommandRequest } from '@cardstack/runtime-common/commands';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type StoreService from '@cardstack/host/services/store';
import type ToolService from '@cardstack/host/services/tool-service';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { SerializedFile } from 'https://cardstack.com/base/file-api';

import type { Message } from './message';

type CommandStatus = 'applied' | 'ready' | 'applying' | 'invalid';

export default class MessageTool {
  @tracked commandRequest: Partial<CommandRequest>;
  @tracked commandStatus?: CommandStatus;
  @tracked commandResultFileDef?: SerializedFile;

  constructor(
    public message: Message,
    commandRequest: Partial<CommandRequest>,
    public codeRef: ResolvedCodeRef | undefined,
    public eventId: string,
    public requiresApproval: boolean,
    public actionVerb: string,
    commandStatus: CommandStatus,
    commandResultFileDef: SerializedFile | undefined,
    owner: Owner,
    public failureReason?: string | undefined,
  ) {
    setOwner(this, owner);

    this.commandRequest = commandRequest;
    this.commandStatus = commandStatus;
    this.commandResultFileDef = commandResultFileDef;
  }

  @service declare toolService: ToolService;
  @service declare matrixService: MatrixService;
  @service declare store: StoreService;

  get id() {
    return this.commandRequest.id;
  }

  get name() {
    return this.commandRequest.name;
  }

  // The actor that already executed this tool call (e.g. 'ai-bot' for
  // readRealmFile). When set, the host records it in the timeline but never runs it.
  get executedBy() {
    return this.commandRequest.executedBy;
  }

  get arguments() {
    return this.commandRequest.arguments;
  }

  get description() {
    // Sometimes the AI does not provide a description, so we fall back to the
    // attributes.description if it exists.
    return (
      this.arguments?.description || this.arguments?.attributes?.description
    );
  }

  get status() {
    if (this.toolService.currentlyExecutingCommandRequestIds.has(this.id!)) {
      return 'applying';
    }

    return this.commandStatus;
  }

  async commandResultCardDoc() {
    if (!this.commandResultFileDef) {
      return undefined;
    }
    let roomResource = this.matrixService.roomResources.get(
      this.message.roomId,
    );
    if (!roomResource) {
      return undefined;
    }
    try {
      if (!this.commandResultFileDef) {
        return undefined;
      }
      let cardDoc = await this.matrixService.downloadCardFileDef(
        this.commandResultFileDef,
      );
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
