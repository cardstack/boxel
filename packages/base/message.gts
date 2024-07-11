import {
  contains,
  containsMany,
  field,
  Component,
  FieldDef,
  CardDef,
} from './card-api';
import StringField from './string';
import DateTimeField from './datetime';
import NumberField from './number';
import MarkdownField from './markdown';
import { getCard } from '@cardstack/runtime-common';
import { cached } from '@glimmer/tracking';
import BooleanField from './boolean';
import { RoomMemberField } from './room-membership';
import { PatchField } from './command';

import Modifier from 'ember-modifier';

const ErrorMessage: Record<string, string> = {
  ['M_TOO_LARGE']: 'Message is too large',
};

function getCardComponent(card: CardDef) {
  return card.constructor.getComponent(card);
}

class ScrollIntoView extends Modifier {
  modify(element: HTMLElement) {
    element.scrollIntoView();
  }
}

class EmbeddedMessageField extends Component<typeof MessageField> {
  <template>
    <div
      {{ScrollIntoView}}
      data-test-message-idx={{@model.index}}
      data-test-message-cards
    >
      <div>
        {{@fields.message}}
      </div>

      {{#each @model.attachedResources as |cardResource|}}
        {{#if cardResource.cardError}}
          <div data-test-card-error={{cardResource.cardError.id}} class='error'>
            Error: cannot render card
            {{cardResource.cardError.id}}:
            {{cardResource.cardError.error.message}}
          </div>
        {{else if cardResource.card}}
          {{#let (getCardComponent cardResource.card) as |CardComponent|}}
            <div data-test-attached-card={{cardResource.card.id}}>
              <CardComponent @format='atom' />
            </div>
          {{/let}}
        {{/if}}
      {{/each}}
    </div>

    <style>
      .error {
        color: var(--boxel-danger);
        font-weight: 'bold';
      }
    </style>
  </template>

  get timestamp() {
    if (!this.args.model.created) {
      throw new Error(`message created time is undefined`);
    }
    return this.args.model.created.getTime();
  }
}

type AttachedCardResource = {
  card: CardDef | undefined;
  loaded?: Promise<void>;
  cardError?: { id: string; error: Error };
};

export class MessageField extends FieldDef {
  @field eventId = contains(StringField);
  @field author = contains(RoomMemberField);
  @field message = contains(MarkdownField);
  @field formattedMessage = contains(MarkdownField);
  @field created = contains(DateTimeField);
  @field updated = contains(DateTimeField);
  @field attachedCardIds = containsMany(StringField);
  @field index = contains(NumberField);
  @field transactionId = contains(StringField);
  @field command = contains(PatchField);
  @field isStreamingFinished = contains(BooleanField);
  @field errorMessage = contains(StringField);

  // ID from the client and can be used by client
  // to verify whether the message is already sent or not.
  @field clientGeneratedId = contains(StringField);
  @field status = contains(StringField);
  @field isRetryable = contains(BooleanField, {
    computeVia: function (this: MessageField) {
      return this.errorMessage !== ErrorMessage['M_TOO_LARGE'];
    },
  });

  static embedded = EmbeddedMessageField;
  // The edit template is meant to be read-only, this field card is not mutable
  static edit = class Edit extends Component<typeof this> {};

  @cached
  get attachedResources(): AttachedCardResource[] | undefined {
    if (!this.attachedCardIds?.length) {
      return undefined;
    }
    let cards = this.attachedCardIds.map((id) => {
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
