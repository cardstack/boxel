import { setOwner } from '@ember/owner';
import type Owner from '@ember/owner';
import { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import {
  isCardInstance,
  type LooseSingleCardDocument,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  AI_BOT_EXECUTOR,
  type ToolRequest,
} from '@cardstack/runtime-common/commands';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type StoreService from '@cardstack/host/services/store';
import type ToolService from '@cardstack/host/services/tool-service';

import type { Message } from './message';
import type { CardDef } from '@cardstack/base/card-api';
import type { SerializedFile } from '@cardstack/base/file-api';

type ToolCallStatus = 'applied' | 'ready' | 'applying' | 'invalid' | 'failed';

export default class MessageTool {
  @tracked toolRequest: Partial<ToolRequest>;
  @tracked toolCallStatus?: ToolCallStatus;
  @tracked toolResultFileDef?: SerializedFile;
  // origin_server_ts of the event whose chunk last wrote toolRequest, so
  // builder passes finishing out of order can't regress it to stale data.
  toolRequestEventTs = 0;

  constructor(
    public message: Message,
    toolRequest: Partial<ToolRequest>,
    public codeRef: ResolvedCodeRef | undefined,
    public eventId: string,
    public requiresApproval: boolean,
    public actionVerb: string,
    toolCallStatus: ToolCallStatus,
    toolResultFileDef: SerializedFile | undefined,
    owner: Owner,
    public failureReason?: string | undefined,
  ) {
    setOwner(this, owner);

    this.toolRequest = toolRequest;
    this.toolCallStatus = toolCallStatus;
    this.toolResultFileDef = toolResultFileDef;
  }

  @service declare toolService: ToolService;
  @service declare matrixService: MatrixService;
  @service declare store: StoreService;

  get id() {
    return this.toolRequest.id;
  }

  get name() {
    return this.toolRequest.name;
  }

  // The actor that already executed this tool call (e.g. 'ai-bot' for
  // readRealmFile). When set, the host records it in the timeline but never runs it.
  get executedBy() {
    return this.toolRequest.executedBy;
  }

  // ai-bot fulfilled this tool call itself (e.g. readRealmFile), so the host
  // shows only a status indicator for it — never an Apply button.
  get isBotExecuted() {
    return this.executedBy === AI_BOT_EXECUTOR;
  }

  get arguments() {
    return this.toolRequest.arguments;
  }

  get description() {
    // Sometimes the AI does not provide a description, so we fall back to the
    // attributes.description if it exists.
    return (
      this.arguments?.description || this.arguments?.attributes?.description
    );
  }

  get status() {
    if (this.toolService.currentlyExecutingToolRequestIds.has(this.id!)) {
      return 'applying';
    }

    return this.toolCallStatus;
  }

  async commandResultCardDoc() {
    if (!this.toolResultFileDef) {
      return undefined;
    }
    let roomResource = this.matrixService.roomResources.get(
      this.message.roomId,
    );
    if (!roomResource) {
      return undefined;
    }
    try {
      if (!this.toolResultFileDef) {
        return undefined;
      }
      let cardDoc = await this.matrixService.downloadCardFileDef(
        this.toolResultFileDef,
      );
      return cardDoc;
    } catch {
      // the command result card fragments might not be loaded yet
      return undefined;
    }
  }

  // The result doc stored in the room is a snapshot of the card as it was when
  // the tool ran. When that card lives in a realm (the doc carries its id), the
  // snapshot must never be installed in the store under that id: the store
  // holds one instance per id, so adding the snapshot would replace the live
  // instance everywhere it is rendered, and its autosave would then write the
  // stale state back over the newer file. Render the live instance instead,
  // and fall back to an id-less ephemeral copy only when the live card can no
  // longer be loaded (for example, it was deleted since).
  async getCommandResultCard(): Promise<CardDef | undefined> {
    let cardDoc = await this.commandResultCardDoc();
    if (!cardDoc) {
      return undefined;
    }
    let id = cardDoc.data.id;
    if (id) {
      let live = await this.store.get<CardDef>(id);
      if (isCardInstance(live)) {
        return live;
      }
    }
    let { id: _id, ...resource } = cardDoc.data;
    let ephemeralDoc: LooseSingleCardDocument = { ...cardDoc, data: resource };
    return (await this.store.add(ephemeralDoc, {
      doNotPersist: true,
    })) as CardDef;
  }
}
