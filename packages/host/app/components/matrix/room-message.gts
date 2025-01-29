import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { trackedFunction } from 'ember-resources/util/function';

import { Avatar } from '@cardstack/boxel-ui/components';

import { bool } from '@cardstack/boxel-ui/helpers';

import { markdownToHtml } from '@cardstack/runtime-common';

import { Message } from '@cardstack/host/lib/matrix-classes/message';
import CommandService from '@cardstack/host/services/command-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import { type MonacoSDK } from '@cardstack/host/services/monaco-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { type CardDef } from 'https://cardstack.com/base/card-api';

import AiAssistantMessage from '../ai-assistant/message';
import { aiBotUserId } from '../ai-assistant/panel';

import PreparingRoomMessageCommand from './preparing-room-message-command';
import RoomMessageCommand from './room-message-command';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    roomId: string;
    message: Message;
    index: number;
    monacoSDK: MonacoSDK;
    isStreaming: boolean;
    currentEditor: number | undefined;
    setCurrentEditor: (editor: number | undefined) => void;
    retryAction?: () => void;
    isPending?: boolean;
    isDisplayingCode: boolean;
    onToggleViewCode: () => void;
    registerScroller: (args: {
      index: number;
      element: HTMLElement;
      scrollTo: Element['scrollIntoView'];
    }) => void;
  };
}

const STREAMING_TIMEOUT_MS = 60000;

export default class RoomMessage extends Component<Signature> {
  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);

    this.checkStreamingTimeout.perform();
  }

  @tracked private streamingTimeout = false;

  private checkStreamingTimeout = task(async () => {
    if (!this.isFromAssistant || !this.args.isStreaming) {
      return;
    }

    // If message is streaming and hasn't been updated in the last minute, show a timeout message
    if (Date.now() - Number(this.args.message.updated) > STREAMING_TIMEOUT_MS) {
      this.streamingTimeout = true;
      return;
    }

    // Do this check every second
    await new Promise((resolve) => setTimeout(resolve, 1000));

    this.checkStreamingTimeout.perform();
  });

  private get isFromAssistant() {
    return this.args.message.author.userId === aiBotUserId;
  }

  run = task(async () => {
    if (!this.args.message.command) {
      throw new Error('No command to run');
    }
    return this.commandService.run
      .unlinked()
      .perform(this.args.message.command);
  });

  <template>
    {{! We Intentionally wait until message resources are loaded (i.e. have a value) before rendering the message.
      This is because if the message resources render asynchronously after the message is already rendered (e.g. card pills),
      it is problematic to ensure the last message sticks to the bottom of the screen.
      In AiAssistantMessage, there is a ScrollIntoView modifier that will scroll the last message into view (i.e. scroll to the bottom) when it renders.
      If we let things in the message render asynchronously, the height of the message will change after that and the scroll position will move up a bit (i.e. not stick to the bottom).
    }}
    {{#if this.resources}}
      <AiAssistantMessage
        id='message-container-{{@index}}'
        class='room-message'
        @formattedMessage={{htmlSafe
          (markdownToHtml @message.formattedMessage)
        }}
        @datetime={{@message.created}}
        @index={{@index}}
        @registerScroller={{@registerScroller}}
        @isFromAssistant={{this.isFromAssistant}}
        @profileAvatar={{component
          Avatar
          isReady=true
          userId=@message.author.userId
          displayName=@message.author.displayName
        }}
        @resources={{this.resources}}
        @errorMessage={{this.errorMessage}}
        @isStreaming={{@isStreaming}}
        @retryAction={{if @message.command (perform this.run) @retryAction}}
        @isPending={{@isPending}}
        data-test-boxel-message-from={{@message.author.name}}
        data-test-boxel-message-instance-id={{@message.instanceId}}
        ...attributes
      >
        {{#if @message.command}}
          <RoomMessageCommand
            @messageCommand={{@message.command}}
            @messageIndex={{@message.index}}
            @runCommand={{perform this.run}}
            @roomId={{@roomId}}
            @isPending={{@isPending}}
            @isDisplayingCode={{@isDisplayingCode}}
            @onToggleViewCode={{@onToggleViewCode}}
            @monacoSDK={{@monacoSDK}}
            @currentEditor={{@currentEditor}}
            @failedCommandState={{this.failedCommandState}}
            @isError={{bool this.errorMessage}}
          />
        {{else if @message.isPreparingCommand}}
          <PreparingRoomMessageCommand />
        {{/if}}
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

  private loadMessageResources = trackedFunction(this, async () => {
    let cards: CardDef[] = [];
    let errors: { id: string; error: Error }[] = [];

    let promises = this.args.message.attachedResources?.map(
      async (resource) => {
        await resource.loaded;
        if (resource.card) {
          cards.push(resource.card);
        } else if (resource.cardError) {
          let { id, error } = resource.cardError;
          errors.push({
            id,
            error,
          });
        }
      },
    );

    if (promises) {
      await Promise.all(promises);
    }

    return {
      cards: cards.length ? cards : undefined,
      errors: errors.length ? errors : undefined,
    };
  });

  private get resources() {
    return this.loadMessageResources.value;
  }

  @cached
  private get failedCommandState() {
    if (!this.args.message.command?.eventId) {
      return undefined;
    }
    return this.matrixService.failedCommandState.get(
      this.args.message.command.eventId,
    );
  }

  private get errorMessage() {
    if (this.failedCommandState) {
      return `Failed to apply changes. ${this.failedCommandState.message}`;
    }
    if (this.args.message.errorMessage) {
      return this.args.message.errorMessage;
    }
    if (this.streamingTimeout) {
      return 'This message was processing for too long. Please try again.';
    }
    if (!this.resources?.errors) {
      return undefined;
    }

    let hasResourceErrors = this.resources.errors.length > 0;
    if (hasResourceErrors) {
      return 'Error rendering attached cards.';
    }

    return this.resources.errors
      .map((e: { id: string; error: Error }) => `${e.id}: ${e.error.message}`)
      .join(', ');
  }
}
