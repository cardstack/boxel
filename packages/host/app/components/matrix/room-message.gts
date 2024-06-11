import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked, cached } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import { modifier } from 'ember-modifier';

import { trackedFunction } from 'ember-resources/util/function';

import { Button } from '@cardstack/boxel-ui/components';
import { bool } from '@cardstack/boxel-ui/helpers';
import { Copy as CopyIcon } from '@cardstack/boxel-ui/icons';

import { markdownToHtml } from '@cardstack/runtime-common';

import monacoModifier from '@cardstack/host/modifiers/monaco';
import type { MonacoEditorOptions } from '@cardstack/host/modifiers/monaco';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type MonacoService from '@cardstack/host/services/monaco-service';
import { type MonacoSDK } from '@cardstack/host/services/monaco-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { type CardDef } from 'https://cardstack.com/base/card-api';
import { type MessageField } from 'https://cardstack.com/base/room';

import ApplyButton from '../ai-assistant/apply-button';
import { type ApplyButtonState } from '../ai-assistant/apply-button';
import AiAssistantMessage from '../ai-assistant/message';
import { aiBotUserId } from '../ai-assistant/panel';
import ProfileAvatarIcon from '../operator-mode/profile-avatar-icon';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    roomId: string;
    message: MessageField;
    index?: number;
    monacoSDK: MonacoSDK;
    isStreaming: boolean;
    currentEditor: number | undefined;
    setCurrentEditor: (editor: number | undefined) => void;
    retryAction?: () => void;
    isPending?: boolean;
  };
}

const STREAMING_TIMEOUT_MS = 60000;

export default class RoomMessage extends Component<Signature> {
  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);

    this.checkStreamingTimeout.perform();
  }

  @tracked streamingTimeout = false;

  checkStreamingTimeout = task(async () => {
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

  get isFromAssistant() {
    return this.args.message.author.userId === aiBotUserId;
  }

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
        @isFromAssistant={{this.isFromAssistant}}
        @profileAvatar={{component
          ProfileAvatarIcon
          userId=@message.author.userId
        }}
        @resources={{this.resources}}
        @errorMessage={{this.errorMessage}}
        @isStreaming={{@isStreaming}}
        @retryAction={{if
          (bool this.isCommand)
          (perform this.patchCard)
          @retryAction
        }}
        @isPending={{@isPending}}
        data-test-boxel-message-from={{@message.author.name}}
        ...attributes
      >
        {{#if (bool this.isCommand)}}
          <div
            class='command-button-bar'
            data-test-command-idle={{this.operatorModeStateService.patchCard.isIdle}}
          >
            <Button
              class='view-code-button'
              {{on 'click' this.viewCodeToggle}}
              @kind={{if this.isDisplayingCode 'primary-dark' 'secondary-dark'}}
              @size='extra-small'
              data-test-view-code-button
            >
              {{if this.isDisplayingCode 'Hide Code' 'View Code'}}
            </Button>
            <ApplyButton
              @state={{this.applyButtonState}}
              {{on 'click' (perform this.patchCard)}}
              data-test-command-apply={{this.applyButtonState}}
            />
          </div>
          {{#if this.isDisplayingCode}}
            <div class='preview-code'>
              <Button
                class='copy-to-clipboard-button'
                @kind='text-only'
                @size='extra-small'
                {{on 'click' (perform this.copyToClipboard)}}
                data-test-copy-code
              >
                <CopyIcon
                  width='16'
                  height='16'
                  role='presentation'
                  aria-hidden='true'
                />
                Copy to clipboard
              </Button>
              <div
                class='monaco-container'
                {{this.scrollBottomIntoView}}
                {{monacoModifier
                  content=this.previewCommandCode
                  contentChanged=undefined
                  monacoSDK=@monacoSDK
                  language='json'
                  readOnly=true
                  darkTheme=true
                  editorDisplayOptions=this.editorDisplayOptions
                }}
                data-test-editor
                data-test-percy-hide
              />
            </div>
          {{/if}}
        {{/if}}
      </AiAssistantMessage>
    {{/if}}

    <style>
      .room-message {
        --ai-assistant-message-padding: var(--boxel-sp);
      }
      .is-pending .view-code-button,
      .is-error .view-code-button {
        background: var(--boxel-200);
        color: var(--boxel-500);
      }
      .command-button-bar {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-xs);
        margin-top: var(--boxel-sp);
      }
      .view-code-button {
        --boxel-button-font: 700 var(--boxel-font-xs);
        --boxel-button-min-height: 1.5rem;
        --boxel-button-padding: 0 var(--boxel-sp-xs);
        min-width: initial;
        width: auto;
        max-height: 1.5rem;
      }
      .view-code-button:hover:not(:disabled) {
        filter: brightness(1.1);
      }
      .preview-code {
        --spacing: var(--boxel-sp-sm);
        --fill-container-spacing: calc(
          -1 * var(--ai-assistant-message-padding)
        );
        margin: var(--boxel-sp) var(--fill-container-spacing)
          var(--fill-container-spacing);
        padding: var(--spacing) 0;
        background-color: var(--boxel-dark);
      }
      .copy-to-clipboard-button {
        --boxel-button-font: 700 var(--boxel-font-xs);
        --boxel-button-padding: 0 var(--boxel-sp-xs);
        --icon-color: var(--boxel-highlight);
        --icon-stroke-width: 2px;
        margin-left: var(--spacing);
        margin-bottom: var(--spacing);
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--spacing);
      }
      .copy-to-clipboard-button:hover:not(:disabled) {
        --boxel-button-text-color: var(--boxel-highlight);
        filter: brightness(1.1);
      }
      .monaco-container {
        height: var(--monaco-container-height);
        min-height: 7rem;
        max-height: 30vh;
      }
    </style>
  </template>

  editorDisplayOptions: MonacoEditorOptions = {
    wordWrap: 'on',
    wrappingIndent: 'indent',
    fontWeight: 'bold',
    scrollbar: {
      alwaysConsumeMouseWheel: false,
    },
  };

  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare matrixService: MatrixService;
  @service private declare monacoService: MonacoService;

  @tracked private isDisplayingCode = false;

  private copyToClipboard = task(async () => {
    await navigator.clipboard.writeText(this.previewCommandCode);
  });

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

  get isCommand() {
    if (!this.args.message.command) {
      return false;
    }
    return (
      this.args.message.command.commandType === 'patchCard' ||
      this.args.message.command.commandType === 'searchCard'
    );
  }

  private patchCard = task(async () => {
    if (this.operatorModeStateService.patchCard.isRunning) {
      return;
    }
    let { payload, eventId } = this.args.message.command;
    this.matrixService.failedCommandState.delete(eventId);
    try {
      await this.operatorModeStateService.patchCard.perform(
        payload.id,
        payload.patch,
      );
      //here is reaction event
      await this.matrixService.sendReactionEvent(
        this.args.roomId,
        eventId,
        'applied',
      );
    } catch (e) {
      let error =
        typeof e === 'string'
          ? new Error(e)
          : e instanceof Error
          ? e
          : new Error('Patch failed.');
      this.matrixService.failedCommandState.set(eventId, error);
    }
  });

  private get previewCommandCode() {
    let { commandType, payload } = this.args.message.command;
    return JSON.stringify({ commandType, payload }, null, 2);
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

  @cached
  private get applyButtonState(): ApplyButtonState {
    if (this.patchCard.isRunning) {
      return 'applying';
    }
    if (this.failedCommandState) {
      return 'failed';
    }
    return this.args.message.command.status;
  }

  @action private viewCodeToggle() {
    this.isDisplayingCode = !this.isDisplayingCode;
    if (this.isDisplayingCode) {
      this.args.setCurrentEditor(this.args.message.index);
    }
  }

  private scrollBottomIntoView = modifier((element: HTMLElement) => {
    if (this.args.currentEditor !== this.args.message.index) {
      return;
    }

    let height = this.monacoService.getContentHeight();
    if (!height || height < 0) {
      return;
    }
    element.style.height = `${height}px`;

    let outerContainer = document.getElementById(
      `message-container-${this.args.index}`,
    );
    if (!outerContainer) {
      return;
    }
    this.scrollIntoView(outerContainer);
  });

  private scrollIntoView(element: HTMLElement) {
    let { top, bottom } = element.getBoundingClientRect();
    let isVerticallyInView = top >= 0 && bottom <= window.innerHeight;

    if (!isVerticallyInView) {
      element.scrollIntoView({ block: 'end' });
    }
  }
}
