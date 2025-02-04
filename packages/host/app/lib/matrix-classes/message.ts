import { guidFor } from '@ember/object/internals';
import { tracked } from '@glimmer/tracking';

import { EventStatus } from 'matrix-js-sdk';

import { getCard } from '@cardstack/runtime-common';

import { CardDef } from 'https://cardstack.com/base/card-api';

import { RoomMember } from './member';
import MessageCommand from './message-command';

const ErrorMessage: Record<string, string> = {
  ['M_TOO_LARGE']: 'Message is too large',
};

type AttachedCardResource = {
  card: CardDef | undefined;
  loaded?: Promise<void>;
  cardError?: { id: string; error: Error };
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
  isStreamingFinished?: boolean;
  index?: number;
  errorMessage?: string;
  clientGeneratedId?: string | null;
  command?: MessageCommand | null;
}

export class Message implements RoomMessageInterface {
  @tracked formattedMessage: string;
  @tracked message: string;
  @tracked command?: MessageCommand | null;
  @tracked isPreparingCommand?: boolean;
  @tracked isStreamingFinished?: boolean;

  attachedCardIds?: string[] | null;
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
    this.instanceId = guidFor(this);
  }
  get isRetryable() {
    return (
      this.errorMessage === undefined ||
      (this.errorMessage && this.errorMessage !== ErrorMessage['M_TOO_LARGE'])
    );
  }

  getCardResources(
    cardIds: string[] | null | undefined,
  ): AttachedCardResource[] | undefined {
    if (!cardIds?.length) {
      return undefined;
    }
    let cards = cardIds.map((id) => {
      let card = getCard(new URL(id));
      if (!card) {
        return {
          card: undefined,
          cardError: {
            id,
            error: new Error(`cannot find card for id "${id}"`),
          },
        };
      }
      return card;
    });
    return cards;
  }

  get attachedResources(): AttachedCardResource[] | undefined {
    return this.getCardResources(this.attachedCardIds);
  }
}
