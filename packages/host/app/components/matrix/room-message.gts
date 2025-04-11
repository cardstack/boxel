import { fn } from '@ember/helper';
import { service } from '@ember/service';

import Component from '@glimmer/component';
import { tracked, cached } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { consume } from 'ember-provide-consume-context';

import { trackedFunction } from 'ember-resources/util/function';

import { Avatar } from '@cardstack/boxel-ui/components';

import { bool } from '@cardstack/boxel-ui/helpers';

import {
  type getCard,
  GetCardContextName,
  markdownToHtml,
} from '@cardstack/runtime-common';
import {
  isHtml,
  escapeHtmlOutsideCodeBlocks,
} from '@cardstack/runtime-common/helpers/html';

import consumeContext from '@cardstack/host/helpers/consume-context';
import MessageCommand from '@cardstack/host/lib/matrix-classes/message-command';
import { type RoomResource } from '@cardstack/host/resources/room';
import CommandService from '@cardstack/host/services/command-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import { type MonacoSDK } from '@cardstack/host/services/monaco-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import AiAssistantMessage from '../ai-assistant/message';
import { aiBotUserId } from '../ai-assistant/panel';

import RoomMessageCommand from './room-message-command';

interface Signature {
  Element: HTMLDivElement;
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

const STREAMING_TIMEOUT_MS = 60000;

export default class RoomMessage extends Component<Signature> {
  @consume(GetCardContextName) private declare getCard: getCard;
  @tracked private streamingTimeout = false;
  @tracked private attachedCardCollectionResource:
    | { value: ReturnType<getCard>[] | null }
    | undefined;

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);

    this.checkStreamingTimeout.perform();
  }

  private makeCardResources = () => {
    this.attachedCardCollectionResource = trackedFunction(this, () =>
      (this.message.attachedCardIds ?? []).map((id) =>
        this.getCard(this, () => id),
      ),
    );
  };

  private get attachedCardResources() {
    return this.attachedCardCollectionResource?.value ?? [];
  }

  private get message() {
    return this.args.roomResource.messages[this.args.index];
  }

  private checkStreamingTimeout = task(async () => {
    if (!this.isFromAssistant || !this.args.isStreaming) {
      return;
    }

    // If message is streaming and hasn't been updated in the last minute, show a timeout message
    if (Date.now() - Number(this.message.updated) > STREAMING_TIMEOUT_MS) {
      this.streamingTimeout = true;
      return;
    }

    // Do this check every second
    await new Promise((resolve) => setTimeout(resolve, 1000));

    this.checkStreamingTimeout.perform();
  });

  private get isFromAssistant() {
    return this.message.author.userId === aiBotUserId;
  }

  private run = task(async (command: MessageCommand) => {
    return this.commandService.run.unlinked().perform(command);
  });

  private get formattedMessage() {
    if (
      !this.message.formattedMessage ||
      isHtml(this.message.formattedMessage)
    ) {
      return this.message.formattedMessage;
    }
    return markdownToHtml(
      escapeHtmlOutsideCodeBlocks(this.message.formattedMessage),
      false,
    );
  }

  <template>
    {{consumeContext this.makeCardResources}}
    {{! We Intentionally wait until message resources are loaded (i.e. have a value) before rendering the message.
      This is because if the message resources render asynchronously after the message is already rendered (e.g. card pills),
      it is problematic to ensure the last message sticks to the bottom of the screen.
      In AiAssistantMessage, there is a ScrollIntoView modifier that will scroll the last message into view (i.e. scroll to the bottom) when it renders.
      If we let things in the message render asynchronously, the height of the message will change after that and the scroll position will move up a bit (i.e. not stick to the bottom).
    }}
    {{#if this.areResourcesLoaded}}
      <AiAssistantMessage
        id='message-container-{{@index}}'
        class='room-message'
        @formattedMessage={{this.formattedMessage}}
        @reasoningContent={{this.message.reasoningContent}}
        @monacoSDK={{@monacoSDK}}
        @datetime={{this.message.created}}
        @eventId={{this.message.eventId}}
        @index={{@index}}
        @registerScroller={{@registerScroller}}
        @isFromAssistant={{this.isFromAssistant}}
        @profileAvatar={{component
          Avatar
          isReady=true
          userId=this.message.author.userId
          displayName=this.message.author.displayName
        }}
        @resources={{this.attachedCardResources}}
        @files={{this.message.attachedFiles}}
        @errorMessage={{this.errorMessage}}
        @isStreaming={{@isStreaming}}
        @retryAction={{@retryAction}}
        @isPending={{@isPending}}
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
            @monacoSDK={{@monacoSDK}}
            @isError={{bool this.errorMessage}}
            @isStreaming={{@isStreaming}}
          />
        {{/each}}
      </AiAssistantMessage>
    {{/if}}

    <style scoped>
      .room-message {
        --ai-assistant-message-padding: var(--boxel-sp);
      }
    </style>
  </template>

  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare matrixService: MatrixService;
  @service declare commandService: CommandService;

  @cached
  private get areResourcesLoaded() {
    if (!this.attachedCardResources) {
      return false;
    }

    return this.attachedCardResources.length === 0
      ? true
      : this.attachedCardResources.every((r) => r.isLoaded);
  }

  @cached
  private get errorMessage() {
    if (this.message.errorMessage) {
      return this.message.errorMessage;
    }
    if (this.streamingTimeout) {
      return 'This message was processing for too long. Please try again.';
    }
    let resourcesWithErrors = (this.attachedCardResources ?? []).filter(
      (r) => r.cardError,
    );
    if (resourcesWithErrors.length === 0) {
      return undefined;
    }
    return 'Error rendering attached cards.';
  }
}
