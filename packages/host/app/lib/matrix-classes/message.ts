import { guidFor } from '@ember/object/internals';
import { cached, tracked } from '@glimmer/tracking';

import { TrackedArray } from 'tracked-built-ins';

import { markdownToHtml } from '@cardstack/runtime-common';
import { escapeHtmlOutsideCodeBlocks } from '@cardstack/runtime-common/helpers/html';

import {
  parseHtmlContent,
  type HtmlTagGroup,
} from '@cardstack/host/lib/formatted-message/utils';

import type { FileDef } from 'https://cardstack.com/base/file-api';

import type { RoomMember } from './member';

import type MessageCodePatchResult from './message-code-patch-result';

import type MessageCommand from './message-command';
import type { EventStatus } from 'matrix-js-sdk';

const ErrorMessage: Record<string, string> = {
  ['M_TOO_LARGE']: 'Message is too large',
};

type RoomMessageInterface = RoomMessageRequired & RoomMessageOptional;

interface RoomMessageRequired {
  roomId: string;
  author: RoomMember;
  created: Date;
  updated: Date;
  body: string;
  eventId: string;
  status: EventStatus | null;
}

interface RoomMessageOptional {
  transactionId?: string | null;
  attachedCardIds?: string[] | null;
  attachedFiles?: FileDef[];
  isStreamingFinished?: boolean;
  index?: number;
  errorMessage?: string;
  clientGeneratedId?: string | null;
  reasoningContent?: string | null;
  isDebugMessage?: boolean;
  hasContinuation?: boolean;
  continuationOf?: string | null;
  agentId?: string;
}

export class Message implements RoomMessageInterface {
  @tracked _body: string;
  @tracked _reasoningContent?: string | null;
  @tracked _commands: TrackedArray<MessageCommand>;
  @tracked codePatchResults: TrackedArray<MessageCodePatchResult>;
  @tracked created: Date;
  @tracked _isStreamingFinished?: boolean;
  @tracked _isCanceled?: boolean;
  @tracked hasContinuation?: boolean;
  @tracked continuedInMessage?: Message | null;
  continuationOf?: string | null;

  attachedCardIds?: string[] | null;
  attachedFiles?: FileDef[];
  attachedCardsAsFiles?: FileDef[];
  attachedSkillCardIds?: string[] | null;
  index?: number;
  transactionId?: string | null;
  errorMessage?: string;
  clientGeneratedId?: string;
  isDebugMessage?: boolean;

  author: RoomMember;
  status: EventStatus | null;
  _updated: Date;
  eventId: string;
  roomId: string;
  agentId?: string;

  //This property is used for testing purpose
  instanceId: string;

  constructor(init: RoomMessageInterface) {
    this._body = init.body;
    this._reasoningContent = init.reasoningContent;
    this._commands = new TrackedArray<MessageCommand>();
    this.author = init.author;
    this.eventId = init.eventId;
    this.created = init.created;
    this._updated = init.updated;
    this.status = init.status;
    this.roomId = init.roomId;
    this.agentId = init.agentId;
    this.attachedFiles = init.attachedFiles;
    this.hasContinuation = init.hasContinuation;
    this.continuationOf = init.continuationOf;
    this._reasoningContent = init.reasoningContent;
    this._commands = new TrackedArray<MessageCommand>();
    this.codePatchResults = new TrackedArray<MessageCodePatchResult>();
    this.instanceId = guidFor(this);
  }

  get isRetryable() {
    return (
      this.errorMessage === undefined ||
      (this.errorMessage && this.errorMessage !== ErrorMessage['M_TOO_LARGE'])
    );
  }

  get reasoningContent(): string {
    return [this._reasoningContent, this.continuedReasoningContent]
      .filter(Boolean)
      .join('');
  }

  setReasoningContent(reasoningContent: string | null) {
    if (this._reasoningContent !== reasoningContent) {
      this._reasoningContent = reasoningContent;
    }
  }

  get continuedReasoningContent() {
    return this.continuedInMessage?.reasoningContent ?? '';
  }

  get body(): string {
    return [this._body, this.continuedBody].filter(Boolean).join('');
  }

  setBody(body: string) {
    if (this._body !== body) {
      this._body = body;
    }
  }

  get continuedBody() {
    return this.continuedInMessage?.body;
  }

  get commands(): MessageCommand[] {
    return (this.continuedInMessage?.commands?.length ?? 0) > 0
      ? this.continuedInMessage!.commands
      : (this._commands ?? []);
  }

  setCommands(commands: MessageCommand[]) {
    this._commands = new TrackedArray<MessageCommand>(commands);
  }

  get continuedCommands() {
    return this.continuedInMessage?.commands;
  }

  setIsStreamingFinished(isStreamingFinished: boolean | undefined) {
    if (this._isStreamingFinished !== isStreamingFinished) {
      this._isStreamingFinished = isStreamingFinished;
    }
  }

  setIsCanceled(isCanceled: boolean | undefined) {
    if (this._isCanceled !== isCanceled) {
      this._isCanceled = isCanceled;
    }
  }

  get isCanceled(): boolean {
    return this._isCanceled ?? false;
  }

  get isStreamingFinished(): boolean | undefined {
    if (this.hasContinuation) {
      return this.continuedInMessage?.isStreamingFinished ?? false;
    }
    return this._isStreamingFinished;
  }

  get isStreamingOfEventFinished(): boolean {
    return this._isStreamingFinished === true;
  }

  get updated(): Date {
    return this.continuedInMessage?.updated ?? this._updated;
  }

  setUpdated(updated: Date) {
    if (this._updated.getTime() !== updated.getTime()) {
      this._updated = updated;
    }
  }

  @cached
  get bodyHTML() {
    // message is expected to be in markdown so we need to convert the markdown to html when the message is sent by the ai bot
    if (!this.body) {
      return this.body;
    }
    return markdownToHtml(escapeHtmlOutsideCodeBlocks(this.body), {
      sanitize: false,
      escapeHtmlInCodeBlocks: true,
    });
  }

  /*
    We are splitting the html into parts so that we can target the
    code blocks (<pre> tags) and apply Monaco editor to them. Here is an
    example of the html argument:

    <p>Here is some code for you.</p>
    <pre data-codeblock="javascript">const x = 1;</pre>
    <p>I hope you like this code. But here is some more!</p>
    <pre data-codeblock="javascript">const y = 2;</pre>
    <p>Feel free to use it in your project.</p>

    A drawback of this approach is that we can't render monaco editors for
    code blocks that are nested inside other elements. We should make sure
    our skills teach the model to respond with code blocks that are not nested
    inside other elements.
  */
  @cached
  get htmlParts(): HtmlTagGroup[] {
    let htmlParts = parseHtmlContent(this.bodyHTML, this.roomId, this.eventId);
    if (this._isCanceled) {
      htmlParts.push({
        type: 'non_pre_tag',
        content: '<p style="font-weight: bold;">{Generation Cancelled}</p>',
        codeData: null,
      });
    }
    return htmlParts;
  }
}
