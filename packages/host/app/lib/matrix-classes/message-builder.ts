import type Owner from '@ember/owner';

import { getOwner, setOwner } from '@ember/owner';

import { inject as service } from '@ember/service';

import { TrackedMap } from 'tracked-built-ins';

import { LooseSingleCardDocument } from '@cardstack/runtime-common';

import type CommandService from '@cardstack/host/services/command-service';

import type { CommandStatus } from 'https://cardstack.com/base/command';

import type {
  CardFragmentContent,
  CardMessageContent,
  CardMessageEvent,
  CommandEvent,
  CommandResultEvent,
  MatrixEvent as DiscreteMatrixEvent,
  MessageEvent,
  ReactionEvent,
} from 'https://cardstack.com/base/matrix-event';

import { RoomMember } from './member';
import { Message } from './message';
import MessageCommand from './message-command';

const ErrorMessage: Record<string, string> = {
  ['M_TOO_LARGE']: 'Message is too large',
};

export default class MessageBuilder {
  constructor(
    private event:
      | MessageEvent
      | CommandEvent
      | CardMessageEvent
      | CommandResultEvent,
    owner: Owner,
    private builderContext: {
      effectiveEventId: string;
      author: RoomMember;
      index: number;
      fragmentCache: TrackedMap<string, CardFragmentContent>;
      events: DiscreteMatrixEvent[];
    },
  ) {
    setOwner(this, owner);
  }

  @service declare commandService: CommandService;

  private get coreMessageArgs() {
    return new Message({
      author: this.builderContext.author,
      created: new Date(this.event.origin_server_ts),
      updated: new Date(), // Changes every time an update from AI bot streaming is received, used for detecting timeouts
      message: this.event.content.body,
      formattedMessage: this.event.content.formatted_body,
      // These are not guaranteed to exist in the event
      transactionId: this.event.unsigned?.transaction_id || null,
      attachedCardIds: null,
      attachedSkillCardIds: null,
      command: null,
      commandResult: null,
      status: this.event.status,
      eventId: this.builderContext.effectiveEventId,
      index: this.builderContext.index,
    });
  }

  get clientGeneratedId() {
    return (this.event.content as CardMessageContent).clientGeneratedId;
  }

  get attachedCardIds() {
    let content = this.event.content as CardMessageContent;
    // Safely skip over cases that don't have attached cards or a data type
    let cardDocs = content.data?.attachedCardsEventIds
      ? content.data.attachedCardsEventIds.map((eventId) =>
          this.serializedCardFromFragments(eventId),
        )
      : [];
    let attachedCardIds: string[] = [];
    cardDocs.map((c) => {
      if (c.data.id) {
        attachedCardIds.push(c.data.id);
      }
    });
    if (attachedCardIds.length < cardDocs.length) {
      throw new Error(`cannot handle cards in room without an ID`);
    }
    return attachedCardIds;
  }

  get errorMessage() {
    let errorMessage: string | undefined;
    let { event } = this;
    if (event.status === 'cancelled' || event.status === 'not_sent') {
      errorMessage =
        event.error?.data.errcode &&
        Object.keys(ErrorMessage).includes(event.error?.data.errcode)
          ? ErrorMessage[event.error?.data.errcode]
          : 'Failed to send';
    }
    if ('errorMessage' in event.content) {
      errorMessage = event.content.errorMessage;
    }
    return errorMessage;
  }

  get formattedMessageForCommand() {
    return `<p data-test-command-message class="command-message">${this.event.content.formatted_body}</p>`;
  }

  async buildMessage(): Promise<Message> {
    let { event } = this;
    let messageArgs = this.coreMessageArgs;
    messageArgs.errorMessage = this.errorMessage;
    if (event.content.msgtype === 'org.boxel.message') {
      messageArgs.clientGeneratedId = this.clientGeneratedId;
      messageArgs.attachedCardIds = this.attachedCardIds;
    } else if (event.content.msgtype === 'm.text') {
      messageArgs.isStreamingFinished = !!event.content.isStreamingFinished; // Indicates whether streaming (message updating while AI bot is sending more content into the message) has finished
    } else if (
      event.content.msgtype === 'org.boxel.command' &&
      event.content.data.toolCall
    ) {
      messageArgs.formattedMessage = this.formattedMessageForCommand;
      messageArgs.command = await this.buildMessageCommand();
      messageArgs.commandResult = await this.buildCommandResultCard();
      messageArgs.isStreamingFinished = true;
    }
    return messageArgs;
  }

  private async buildMessageCommand() {
    let event = this.event as CommandEvent;
    let command = event.content.data.toolCall;
    let annotation = this.builderContext.events.find(
      (e) =>
        e.type === 'm.reaction' &&
        e.content['m.relates_to']?.rel_type === 'm.annotation' &&
        e.content['m.relates_to']?.event_id ===
          // If the message is a replacement message, eventId in command payload will be undefined.
          // Because it will not refer to any other events, so we can use event_id of the message itself.
          (event.content.data.eventId ?? this.builderContext.effectiveEventId),
    ) as ReactionEvent | undefined;
    let status: CommandStatus = 'ready';
    if (annotation?.content['m.relates_to'].key === 'applied') {
      status = 'applied';
    }
    let messageCommand = new MessageCommand(
      command.id,
      command.name,
      command.arguments,
      this.builderContext.effectiveEventId,
      status,
      getOwner(this)!,
    );
    return messageCommand;
  }

  private async buildCommandResultCard() {
    let event = this.event as CommandEvent;
    let commandResultEvent = this.builderContext.events.find(
      (e) =>
        e.type === 'm.room.message' &&
        e.content.msgtype === 'org.boxel.commandResult' &&
        e.content['m.relates_to']?.rel_type === 'm.annotation' &&
        e.content['m.relates_to'].event_id === event.content.data.eventId,
    ) as CommandResultEvent;
    let r = commandResultEvent?.content?.result
      ? await this.commandService.createCommandResultArgs(
          event,
          commandResultEvent,
        )
      : undefined;
    let commandResult = r
      ? await this.commandService.createCommandResult(r)
      : undefined;
    return commandResult;
  }

  private serializedCardFromFragments(
    eventId: string,
  ): LooseSingleCardDocument {
    let fragments: CardFragmentContent[] = [];
    let currentFragment: string | undefined = eventId;
    do {
      let fragment = this.builderContext.fragmentCache.get(currentFragment);
      if (!fragment) {
        throw new Error(
          `No card fragment found in cache for event id ${eventId}`,
        );
      }
      fragments.push(fragment);
      currentFragment = fragment.data.nextFragment;
    } while (currentFragment);

    fragments.sort((a, b) => (a.data.index = b.data.index));
    if (fragments.length !== fragments[0].data.totalParts) {
      throw new Error(
        `Expected to find ${fragments[0].data.totalParts} fragments for fragment of event id ${eventId} but found ${fragments.length} fragments`,
      );
    }

    let cardDoc = JSON.parse(
      fragments.map((f) => f.data.cardFragment).join(''),
    ) as LooseSingleCardDocument;
    return cardDoc;
  }
}
