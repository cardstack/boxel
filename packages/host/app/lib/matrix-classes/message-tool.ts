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

// A tool class's per-call click rule (HostBaseTool.neverAutoExecutesFor).
export type NeverAutoExecutesFor = (
  attributes: Record<string, unknown> | undefined,
) => boolean;

// 'approved' is the user's approval of a call ai-bot holds for approval; the
// call is then running (see `status`) until ai-bot's result lands.
type ToolCallStatus =
  | 'applied'
  | 'ready'
  | 'applying'
  | 'invalid'
  | 'failed'
  | 'approved';

// 'read-file-for-ai-assistant_a831' -> 'Read file for ai assistant',
// 'patchCardInstance' -> 'Patch card instance'. Tool names are a kebab or
// camelCase slug, usually with a four-character hex hash suffix (see
// buildCommandFunctionNameFromResolvedRef).
export function labelFromToolName(name: string | undefined) {
  if (!name) {
    return undefined;
  }
  let words = name
    .replace(/_[0-9a-f]{4}$/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  if (words.length === 0) {
    return undefined;
  }
  let label = words.join(' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

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
    // The tool class declares that it must always wait for the user's
    // click, whatever the room's mode (see HostBaseTool.neverAutoExecutes).
    private alwaysNeedsClick: boolean = false,
    // The same, for this call's input (see
    // HostBaseTool.neverAutoExecutesFor).
    private needsClickFor?: NeverAutoExecutesFor,
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

  // Whether this call must wait for the user's click, whatever the room's
  // mode. Read from the current arguments, so it is right once they finish
  // streaming.
  get neverAutoExecutes(): boolean {
    if (this.alwaysNeedsClick) {
      return true;
    }
    let attributes = this.arguments?.attributes;
    return (
      this.needsClickFor?.(
        attributes && typeof attributes === 'object'
          ? (attributes as Record<string, unknown>)
          : undefined,
      ) === true
    );
  }

  get argumentsError() {
    return this.toolRequest.argumentsError;
  }

  get argumentsText() {
    return this.toolRequest.argumentsText;
  }

  // ai-bot fulfilled this tool call itself (e.g. readRealmFile), so the host
  // shows only a status indicator for it — never an Apply button.
  get isBotExecuted() {
    return this.executedBy === AI_BOT_EXECUTOR;
  }

  // Set by validation when it had to convert a stringified argument to make
  // the call valid; the run uses these.
  #coercedArguments: ToolRequest['arguments'] | undefined;
  setCoercedArguments(args: unknown) {
    this.#coercedArguments = args as ToolRequest['arguments'];
  }

  // Every host tool takes its input under `attributes`. A model can lose that
  // nesting and send the fields at the top level; nest them again rather than
  // fail the call on its shape, since the call is otherwise the one the model
  // meant. Memoized on the request's arguments so each read returns the same
  // object.
  get arguments() {
    if (this.#coercedArguments) {
      return this.#coercedArguments;
    }
    let raw = this.toolRequest.arguments;
    if (raw !== this.#rawArguments) {
      this.#rawArguments = raw;
      this.#arguments = nestTopLevelAttributes(raw);
    }
    return this.#arguments;
  }
  #rawArguments: ToolRequest['arguments'] | undefined;
  #arguments: ToolRequest['arguments'] | undefined;

  get description() {
    // The model does not always send the `description` label (it is optional
    // for validation). Fall back to attributes.description, then, once the
    // message has finished streaming, to a readable form of the tool name, so
    // the pill never renders empty for a call that ran. While the message is
    // still streaming a request arrives with its name first and its arguments
    // later; returning undefined then keeps the pill's own "preparing"
    // placeholder until the model's sentence lands.
    return (
      this.arguments?.description ||
      this.arguments?.attributes?.description ||
      (this.message.isStreamingFinished
        ? labelFromToolName(this.name)
        : undefined)
    );
  }

  // ai-bot runs this call itself, but only once the user approves it (the
  // bot tool marked it `approvalRequired`). Until an answer lands the call
  // shows the full request with Approve / Decline rather than a status
  // indicator.
  get awaitsApproval() {
    return (
      this.isBotExecuted &&
      this.toolRequest.approvalRequired === true &&
      this.toolCallStatus === 'applying' &&
      !this.toolService.answeredApprovalIds.has(this.id!)
    );
  }

  get status(): Exclude<ToolCallStatus, 'approved'> | undefined {
    if (this.toolService.currentlyExecutingToolRequestIds.has(this.id!)) {
      return 'applying';
    }
    if (this.awaitsApproval) {
      return 'ready';
    }
    let status = this.toolCallStatus;
    return status === 'approved' ? 'applying' : status;
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
    } catch (e) {
      // the command result card fragments might not be loaded yet. The
      // download is retried only when the tool's result file changes, so
      // until then the result card stays hidden and this warning is the only
      // trace of why.
      console.warn(
        `Unable to download the result card for tool call ${this.toolRequest.id} (${this.toolResultFileDef?.url}):`,
        e,
      );
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
  // longer be loaded (for example, it was deleted since). `isRealmCard` says
  // whether the result names a realm card, which stays true for that copy.
  async getCommandResultCard(): Promise<
    { card: CardDef; isRealmCard: boolean } | undefined
  > {
    let cardDoc = await this.commandResultCardDoc();
    if (!cardDoc) {
      return undefined;
    }
    let id = cardDoc.data.id;
    if (id) {
      let live = await this.store.get(id);
      if (isCardInstance(live)) {
        return { card: live, isRealmCard: true };
      }
    }
    let { id: _id, ...resource } = cardDoc.data;
    let ephemeralDoc: LooseSingleCardDocument = { ...cardDoc, data: resource };
    let card = (await this.store.addWithoutPersisting(ephemeralDoc)) as CardDef;
    return { card, isRealmCard: !!id };
  }
}

const TOP_LEVEL_TOOL_ARGUMENT_KEYS = new Set([
  'attributes',
  'relationships',
  'description',
]);

export function nestTopLevelAttributes(
  args: ToolRequest['arguments'] | undefined,
): ToolRequest['arguments'] | undefined {
  if (
    !args ||
    typeof args !== 'object' ||
    Array.isArray(args) ||
    'attributes' in args
  ) {
    return args;
  }
  let attributes: Record<string, unknown> = {};
  let rest: Record<string, unknown> = {};
  for (let [key, value] of Object.entries(args)) {
    if (TOP_LEVEL_TOOL_ARGUMENT_KEYS.has(key)) {
      rest[key] = value;
    } else {
      attributes[key] = value;
    }
  }
  if (Object.keys(attributes).length === 0) {
    return args;
  }
  return { ...rest, attributes };
}
