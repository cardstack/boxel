import { RoomMember } from './member';
import { EventStatus } from 'matrix-js-sdk';
import { CardDef } from 'https://cardstack.com/base/card-api';
import { getCard } from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';

const ErrorMessage: Record<string, string> = {
  ['M_TOO_LARGE']: 'Message is too large',
};

type AttachedCardResource = {
  card: CardDef | undefined;
  loaded?: Promise<void>;
  cardError?: { id: string; error: Error };
};

interface RoomMessageInterface {
  message?: string;
  eventId?: string;
  author?: RoomMember;
  created?: Date;
  updated?: Date;
  attachedCardIds?: string[] | null;
  index?: number;
  transactionId?: string | null;
  isStreamingFinished?: boolean;
  formattedMessage?: string;
  errorMessage?: string;
  clientGeneratedId?: string | null;
  status?: EventStatus | null;
  command?: any;
}

export class RoomMessageModel implements RoomMessageInterface {
  attachedCardIds?: string[] | null;
  message?: string;
  eventId?: string;
  author?: RoomMember;
  created?: Date;
  updated?: Date;
  index?: number;
  transactionId?: string | null;
  isStreamingFinished?: boolean;
  formattedMessage?: string;
  errorMessage?: string;
  clientGeneratedId?: string | null;
  status?: EventStatus | null;
  command?: any;

  constructor(init: Partial<RoomMessageInterface>) {
    Object.assign(this, init);
  }
  get isRetryable() {
    return (
      this.errorMessage && this.errorMessage !== ErrorMessage['M_TOO_LARGE']
    );
  }
  get attachedResources(): AttachedCardResource[] | undefined {
    console.log('getting attached resource');
    if (!this.attachedCardIds?.length) {
      return undefined;
    }
    let cards = this.attachedCardIds.map((id) => {
      console.log('attached card id');
      console.log(id);
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
}
