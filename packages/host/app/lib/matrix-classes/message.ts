import { EventStatus } from 'matrix-js-sdk';

import { getCard } from '@cardstack/runtime-common';

import { CardDef } from 'https://cardstack.com/base/card-api';

import { PatchField } from 'https://cardstack.com/base/command';

import { RoomMember } from './member';

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
  attachedSkillCardIds?: string[] | null;
  isStreamingFinished?: boolean;
  index?: number;
  errorMessage?: string;
  clientGeneratedId?: string | null;
  command?: PatchField | null;
}

export class Message implements RoomMessageInterface {
  attachedCardIds?: string[] | null;
  attachedSkillCardIds?: string[] | null;
  index?: number;
  transactionId?: string | null;
  isStreamingFinished?: boolean;
  errorMessage?: string;
  clientGeneratedId?: string;
  command?: PatchField | null;

  author: RoomMember;
  formattedMessage: string;
  status: EventStatus | null;
  created: Date;
  updated: Date;
  eventId: string;
  message: string;

  constructor(init: RoomMessageInterface) {
    Object.assign(this, init);
    this.author = init.author;
    this.formattedMessage = init.formattedMessage;
    this.message = init.message;
    this.eventId = init.eventId;
    this.created = init.created;
    this.updated = init.updated;
    this.status = init.status;
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

  get attachedSkills(): AttachedCardResource[] | undefined {
    return this.getCardResources(this.attachedSkillCardIds);
  }
}
