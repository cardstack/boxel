import { fn } from '@ember/helper';
import type Owner from '@ember/owner';
import { service } from '@ember/service';

import Component from '@glimmer/component';
import { tracked, cached } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { consume } from 'ember-provide-consume-context';

import { Avatar } from '@cardstack/boxel-ui/components';

import { bool } from '@cardstack/boxel-ui/helpers';

import {
  type getCardCollection,
  GetCardCollectionContextName,
} from '@cardstack/runtime-common';

import consumeContext from '@cardstack/host/helpers/consume-context';
import type MessageCommand from '@cardstack/host/lib/matrix-classes/message-command';
import type { RoomResource } from '@cardstack/host/resources/room';
import type CommandService from '@cardstack/host/services/command-service';
import type { MonacoSDK } from '@cardstack/host/services/monaco-service';

import AiAssistantMessage from '../ai-assistant/message';
import { aiBotUserId } from '../ai-assistant/panel';

import RoomMessageCommand from './room-message-command';

interface Signature {
  Element: HTMLElement;
  Args: {
    roomId: string;
    // use a RoomResource as an arg instead of message to keep this component stable
    // when new messages are received--otherwise a RoomMessage component is created for
    // _every_ matrix event received regardless if the event had anything to do with this
    // message.
    roomResource: RoomResource;
    index: number;
    monacoSDK: MonacoSDK;
    isStreaming: boolean;
    retryAction?: () => void;
    isPending?: boolean;
    registerScroller: (args: {
      index: number;
      element: HTMLElement;
      scrollTo: Element['scrollIntoView'];
    }) => void;
  };
}

const STREAMING_TIMEOUT_MS = 3 * 60 * 1000;
export const STREAMING_TIMEOUT_MINUTES = STREAMING_TIMEOUT_MS / 60_000;

export default class RoomMessage extends Component<Signature> {
  @consume(GetCardCollectionContextName)
  declare private getCardCollection: getCardCollection;
  @tracked private attachedCardCollection:
    | ReturnType<getCardCollection>
    | undefined;
  @tracked private timeoutCheckTimestamp = Date.now();
  @tracked private waitStartTimestamp: number | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);

    this.checkStreamingTimeout.perform();
  }

  private makeCardResources = () => {
    this.attachedCardCollection = this.getCardCollection(
      this,
      () => this.message.attachedCardIds ?? [],
    );
  };

  private get message() {
    return this.args.roomResource.messages[this.args.index];
  }

  private checkStreamingTimeout = task(async () => {
    if (!this.isFromAssistant || !this.args.isStreaming) {
      return;
    }

    if (this.message.isStreamingFinished === true) {
      return;
    }

    this.bumpTimeoutCheckTimestamp();

    // Do this check every second
    await new Promise((resolve) => setTimeout(resolve, 1000));

    this.checkStreamingTimeout.perform();
  });

  private waitLonger = () => {
    this.waitStartTimestamp = Date.now();
    this.bumpTimeoutCheckTimestamp();
    if (!this.checkStreamingTimeout.isRunning) {
      this.checkStreamingTimeout.perform();
    }
  };

  private bumpTimeoutCheckTimestamp() {
    // This is needed for the streamingTimeout getter reactivity - it will update on every tick of the checkStreamingTimeout task
    this.timeoutCheckTimestamp = Date.now();
  }

  private get streamingTimeout() {
    if (!this.isFromAssistant || !this.args.isStreaming) {
      return false;
    }

    if (!this.isLastAssistantMessage) {
      return false;
    }

    if (this.message.isStreamingFinished === true) {
      return false;
    }

    let lastActivityTimestamp = Math.max(
      Number(this.message.updated),
      this.waitStartTimestamp ?? 0,
    );

    // If message is streaming and hasn't been updated in the last three minutes, show a timeout message
    return (
      this.timeoutCheckTimestamp - lastActivityTimestamp > STREAMING_TIMEOUT_MS
    );
  }

  private get isFromAssistant() {
    return this.message.author.userId === aiBotUserId;
  }

  private get isLastAssistantMessage() {
    return (
      this.isFromAssistant &&
      this.args.index === this.args.roomResource.indexOfLastNonDebugMessage
    );
  }

  private get userMessageThisMessageIsRespondingTo() {
    if (!this.isFromAssistant) {
      return undefined;
    }

    // Going backwards, find the first message that is not from the assistant
    for (let i = this.args.index - 1; i >= 0; i--) {
      let message = this.args.roomResource.messages[i];
      if (message.author.userId !== aiBotUserId) {
        return message;
      }
    }

    return undefined;
  }

  private run = task(async (command: MessageCommand) => {
    return this.commandService.run.unlinked().perform(command);
  });

  <template>
    {{consumeContext this.makeCardResources}}
    {{! We Intentionally wait until message resources are loaded (i.e. have a value) before rendering the message.
      This is because if the message resources render asynchronously after the message is already rendered (e.g. card pills),
      it is problematic to ensure the last message sticks to the bottom of the screen.
      In AiAssistantMessage, there is a ScrollIntoView modifier that will scroll the last message into view (i.e. scroll to the bottom) when it renders.
      If we let things in the message render asynchronously, the height of the message will change after that and the scroll position will move up a bit (i.e. not stick to the bottom).
    }}
    {{#if this.attachedCardCollection.isLoaded}}
      <AiAssistantMessage
        id='message-container-{{@index}}'
        @messageHTML={{this.message.bodyHTML}}
        @messageHTMLParts={{this.message.htmlParts}}
        @reasoningContent={{this.message.reasoningContent}}
        @monacoSDK={{@monacoSDK}}
        @datetime={{this.message.created}}
        @roomId={{this.message.roomId}}
        @eventId={{this.message.eventId}}
        @index={{@index}}
        @isLastAssistantMessage={{this.isLastAssistantMessage}}
        @userMessageThisMessageIsRespondingTo={{this.userMessageThisMessageIsRespondingTo}}
        @registerScroller={{@registerScroller}}
        @isFromAssistant={{this.isFromAssistant}}
        {{! @glint-ignore }}
        @profileAvatar={{component
          Avatar
          isReady=true
          userId=this.message.author.userId
          displayName=this.message.author.displayName
        }}
        @collectionResource={{this.attachedCardCollection}}
        @files={{this.message.attachedFiles}}
        @attachedCardsAsFiles={{this.message.attachedCardsAsFiles}}
        @errorMessage={{this.errorMessage}}
        @isDebugMessage={{this.message.isDebugMessage}}
        @isStreaming={{@isStreaming}}
        @retryAction={{@retryAction}}
        @waitAction={{if this.streamingTimeout this.waitLonger}}
        @isPending={{@isPending}}
        @hideMeta={{this.message.isCodePatchCorrectness}}
        @isCodePatchCorrectness={{this.message.isCodePatchCorrectness}}
        @commands={{this.message.commands}}
        data-test-boxel-message-from={{this.message.author.name}}
        data-test-boxel-message-instance-id={{this.message.instanceId}}
        ...attributes
      >
        {{#each this.message.commands as |command|}}
          <RoomMessageCommand
            @messageCommand={{command}}
            @roomResource={{@roomResource}}
            @runCommand={{fn (perform this.run) command}}
            @roomId={{@roomId}}
            @isPending={{@isPending}}
            @isCompact={{this.message.isCodePatchCorrectness}}
            @monacoSDK={{@monacoSDK}}
            @isError={{bool this.errorMessage}}
            @isStreaming={{@isStreaming}}
          />
        {{/each}}
      </AiAssistantMessage>
    {{/if}}
  </template>

  @service declare commandService: CommandService;

  knownErrorMessagePrefixes: { [errorMessagePrefix: string]: string }[] = [
    {
      'MatrixError: [413] event too large':
        'Response from the AI assistant was too large to process',
    },
  ];

  @cached
  private get errorMessage() {
    if (this.message.errorMessage) {
      let humanFriendlyErrorMessage = null;
      for (let errorMessagePrefix of this.knownErrorMessagePrefixes) {
        let key = Object.keys(errorMessagePrefix)[0];
        if (this.message.errorMessage.startsWith(key)) {
          humanFriendlyErrorMessage = errorMessagePrefix[key];
        }
      }
      return humanFriendlyErrorMessage || this.message.errorMessage;
    }
    if (this.streamingTimeout) {
      return `This message has been processing for a long time (more than ${STREAMING_TIMEOUT_MINUTES} minutes), possibly due to a delay in response time, or due to a system error.`; // Will show a "Wait longer" and "Retry" button
    }
    if (this.attachedCardCollection?.cardErrors.length === 0) {
      return undefined;
    }
    return 'Error rendering attached cards.';
  }
}
