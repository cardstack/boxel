import { guidFor } from '@ember/object/internals';
import { tracked } from '@glimmer/tracking';

import { EventStatus } from 'matrix-js-sdk';

import { TrackedArray } from 'tracked-built-ins';

import { type FileDef } from 'https://cardstack.com/base/file-api';

import { RoomMember } from './member';

import type MessageCommand from './message-command';

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
  hasContinuation?: boolean;
  continuationOf?: string | null;
}

export class Message implements RoomMessageInterface {
  @tracked _body: string;
  @tracked _reasoningContent?: string | null;
  @tracked _commands: TrackedArray<MessageCommand>;
  @tracked created: Date;
  @tracked _isStreamingFinished?: boolean;
  @tracked hasContinuation?: boolean;
  @tracked continuedInMessage?: Message | null;
  continuationOf?: string | null;

  attachedCardIds?: string[] | null;
  attachedFiles?: FileDef[];
  attachedSkillCardIds?: string[] | null;
  index?: number;
  transactionId?: string | null;
  errorMessage?: string;
  clientGeneratedId?: string;

  author: RoomMember;
  status: EventStatus | null;
  updated: Date;
  eventId: string;
  roomId: string;

  //This property is used for testing purpose
  instanceId: string;

  constructor(init: RoomMessageInterface) {
    this._body = init.body;
    this._reasoningContent = init.reasoningContent;
    this._commands = new TrackedArray<MessageCommand>();
    this.author = init.author;
    this.eventId = init.eventId;
    this.created = init.created;
    this.updated = init.updated;
    this.status = init.status;
    this.roomId = init.roomId;
    this.attachedFiles = init.attachedFiles;
    this.hasContinuation = init.hasContinuation;
    this.continuationOf = init.continuationOf;
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

  get isStreamingFinished(): boolean | undefined {
    if (this.hasContinuation) {
      return this.continuedInMessage?.isStreamingFinished ?? false;
    }
    return this._isStreamingFinished;
  }
}
