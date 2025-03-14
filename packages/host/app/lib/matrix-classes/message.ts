import { guidFor } from '@ember/object/internals';
import { tracked } from '@glimmer/tracking';

import { EventStatus } from 'matrix-js-sdk';

import { TrackedArray } from 'tracked-built-ins';

import { getCard } from '@cardstack/host/resources/card-resource';

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
  message: string;
  formattedMessage: string;
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
}

export class Message implements RoomMessageInterface {
  @tracked formattedMessage: string;
  @tracked message: string;
  @tracked commands: TrackedArray<MessageCommand>;
  @tracked isStreamingFinished?: boolean;
  @tracked reasoningContent?: string | null;

  attachedCardIds?: string[] | null;
  attachedFiles?: FileDef[];
  attachedSkillCardIds?: string[] | null;
  index?: number;
  transactionId?: string | null;
  errorMessage?: string;
  clientGeneratedId?: string;

  author: RoomMember;
  status: EventStatus | null;
  @tracked created: Date;
  updated: Date;
  eventId: string;
  roomId: string;

  //This property is used for testing purpose
  instanceId: string;

  constructor(init: RoomMessageInterface) {
    Object.assign(this, init);
    this.author = init.author;
    this.formattedMessage = init.formattedMessage;
    this.message = init.message;
    this.eventId = init.eventId;
    this.created = init.created;
    this.updated = init.updated;
    this.status = init.status;
    this.roomId = init.roomId;
    this.attachedFiles = init.attachedFiles;
    this.reasoningContent = init.reasoningContent;
    this.commands = new TrackedArray<MessageCommand>();
    this.instanceId = guidFor(this);
  }
  get isRetryable() {
    return (
      this.errorMessage === undefined ||
      (this.errorMessage && this.errorMessage !== ErrorMessage['M_TOO_LARGE'])
    );
  }

  attachedResources(owner: object) {
    if (!this.attachedCardIds?.length) {
      return undefined;
    }
    // TODO this is not using the @consume getCard. please refactor this.
    // probably this should get pushed up into the consumers of this function.
    // also, we really want a single resource that holds multiple cards, not
    // multiple resources holding one card each. Please make ticket for this
    // refactor.
    return this.attachedCardIds.map((id) => getCard(owner, () => id));
  }
}
