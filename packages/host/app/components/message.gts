import Component from '@glimmer/component';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { not, and } from '../helpers/truth-helpers';
import { ScrollIntoView } from '../modifiers/scrollers';
import { BoxelMessage, LoadingIndicator } from '@cardstack/boxel-ui';
import cssVar from '@cardstack/boxel-ui/helpers/css-var';
import { formatRFC3339 } from 'date-fns';
import { type LooseSingleCardDocument } from '@cardstack/runtime-common';
import { type RoomMember } from 'matrix-js-sdk';
import type MatrixService from '../services/matrix-service';
import { type Event } from '../services/matrix-service';
import { type Card } from 'https://cardstack.com/base/card-api';
import type CardService from '../services/card-service';

interface MessageArgs {
  Args: {
    event: Event;
    index: number;
    members: { member: RoomMember }[];
    register: (id: string, scrollIntoView: () => void) => void;
    loadCard: {
      perform: (
        doc: LooseSingleCardDocument,
        onComplete: (card: Card) => void
      ) => void;
    };
    resetScroll: () => void;
  };
}

const messageStyle = {
  boxelMessageAvatarSize: '2.5rem',
  boxelMessageMetaHeight: '1.25rem',
  boxelMessageGap: 'var(--boxel-sp)',
  boxelMessageMarginLeft:
    'calc( var(--boxel-message-avatar-size) + var(--boxel-message-gap) )',
};

export default class Message extends Component<MessageArgs> {
  <template>
    <BoxelMessage
      {{ScrollIntoView register=this.register}}
      data-test-message-idx={{this.args.index}}
      data-test-message-card={{this.card.id}}
      @name={{this.sender.member.name}}
      @datetime={{formatRFC3339 this.timestamp}}
      style={{cssVar
        boxel-message-avatar-size=messageStyle.boxelMessageAvatarSize
        boxel-message-meta-height=messageStyle.boxelMessageMetaHeight
        boxel-message-gap=messageStyle.boxelMessageGap
        boxel-message-margin-left=messageStyle.boxelMessageMarginLeft
      }}
    >
      {{{this.content}}}

      {{#if this.hasCard}}
        {{#if (and this.hasCard (not this.card))}}
          <LoadingIndicator />
        {{/if}}
        <this.cardComponent />
      {{/if}}
    </BoxelMessage>
  </template>

  @service private declare matrixService: MatrixService;
  @service declare cardService: CardService;
  @tracked private card: Card | undefined;

  constructor(owner: unknown, args: any) {
    super(owner, args);
    if (this.hasCard) {
      let cardJSON = this.args.event.content?.instance;
      if (!cardJSON) {
        throw new Error(
          `bug: card JSON missing from message event: ${JSON.stringify(
            this.args.event,
            null,
            2
          )}`
        );
      }
      this.args.loadCard.perform(cardJSON, (card) => {
        this.card = card;
        // this is a silly hack to deal with the fact that after the card
        // is rendered the scroll will need to be re-positioned since the
        // message height is altered
        this.args.resetScroll();
      });
    }
  }

  get id() {
    return this.args.event.event_id!; // these always have an ID since they are keyed that way in the event map
  }

  get sender() {
    let member = this.args.members.find(
      (m) => m.member.userId === this.args.event.sender
    );
    if (!member) {
      let user = this.matrixService.client.getUser(this.args.event.sender!);
      return {
        member: {
          name: `${user?.displayName ?? this.args.event.sender} (left room)`,
        },
      };
    }
    return member;
  }

  get content() {
    return this.htmlContent ?? this.rawContent;
  }

  get htmlContent() {
    // We have sanitized this using DOMPurify
    return this.args.event.content?.formatted_body;
  }

  get hasCard() {
    return this.args.event.content?.msgtype === 'org.boxel.card';
  }

  get cardComponent() {
    if (this.card) {
      // TODO we'll probably also need to pass in the CardContext...
      return this.card.constructor.getComponent(this.card, 'isolated');
    }
    return undefined;
  }

  get rawContent() {
    return this.args.event.content?.body;
  }

  get timestamp() {
    return this.args.event.origin_server_ts!;
  }

  @action
  private register(scrollIntoView: () => void) {
    this.args.register(this.id, scrollIntoView);
  }
}
