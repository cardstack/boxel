import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import { modifier } from 'ember-modifier';
import { marked } from 'marked';

import { Button } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { Copy as CopyIcon } from '@cardstack/boxel-ui/icons';

import { sanitizeHtml } from '@cardstack/runtime-common';

import monacoModifier from '@cardstack/host/modifiers/monaco';
import type { MonacoEditorOptions } from '@cardstack/host/modifiers/monaco';
import type MonacoService from '@cardstack/host/services/monaco-service';
import { type MonacoSDK } from '@cardstack/host/services/monaco-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { type CardDef } from 'https://cardstack.com/base/card-api';
import { type MessageField } from 'https://cardstack.com/base/room';

import ApplyButton from '../ai-assistant/apply-button';
import AiAssistantMessage from '../ai-assistant/message';
import { aiBotUserId } from '../ai-assistant/panel';
import ProfileAvatarIcon from '../operator-mode/profile-avatar-icon';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    message: MessageField;
    monacoSDK: MonacoSDK;
    isStreaming: boolean;
    currentEditor: number | undefined;
    setCurrentEditor: (editor: number | undefined) => void;
  };
}

export default class Room extends Component<Signature> {
  <template>
    <AiAssistantMessage
      id='message-container-{{@message.index}}'
      class='room-message'
      @formattedMessage={{htmlSafe this.formattedMessage}}
      @datetime={{@message.created}}
      @isFromAssistant={{eq @message.author.userId aiBotUserId}}
      @profileAvatar={{component
        ProfileAvatarIcon
        userId=@message.author.userId
      }}
      @attachedCards={{this.resources.cards}}
      @errorMessage={{this.errorMessage}}
      @isStreaming={{@isStreaming}}
      data-test-boxel-message-from={{@message.author.name}}
      ...attributes
    >
      {{#if (eq @message.command.commandType 'patch')}}
        <div
          class='patch-button-bar'
          data-test-patch-card-idle={{this.operatorModeStateService.patchCard.isIdle}}
        >
          {{#let @message.command.payload as |payload|}}
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
              @state={{if
                this.operatorModeStateService.patchCard.isRunning
                'applying'
                'ready'
              }}
              data-test-command-apply
              {{on
                'click'
                (fn this.patchCard payload.id payload.patch.attributes)
              }}
            />
          {{/let}}
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
              {{this.viewCodePanelModifier}}
              {{monacoModifier
                content=this.previewPatchCode
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

    <style>
      .room-message {
        --ai-assistant-message-padding: var(--boxel-sp);
      }
      .patch-button-bar {
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
  };

  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare monacoService: MonacoService;

  @tracked private isDisplayingCode = false;

  private copyToClipboard = task(async () => {
    await navigator.clipboard.writeText(this.previewPatchCode);
  });

  private get formattedMessage() {
    return sanitizeHtml(marked(this.args.message.formattedMessage));
  }

  private get resources() {
    let cards: CardDef[] = [];
    let errors: { id: string; error: Error }[] = [];
    this.args.message.attachedResources?.map((resource) => {
      if (resource.card) {
        cards.push(resource.card);
      } else if (resource.cardError) {
        let { id, error } = resource.cardError;
        errors.push({
          id,
          error,
        });
      }
    });
    return {
      cards: cards.length ? cards : undefined,
      errors: errors.length ? errors : undefined,
    };
  }

  private get errorMessage() {
    if (!this.resources.errors) {
      return undefined;
    }
    return this.resources.errors
      .map(
        (e: { id: string; error: Error }) =>
          `cannot render card ${e.id}: ${e.error.message}`,
      )
      .join(', ');
  }

  @action patchCard(cardId: string, attributes: Record<string, unknown>) {
    if (this.operatorModeStateService.patchCard.isRunning) {
      return;
    }
    this.operatorModeStateService.patchCard.perform(cardId, attributes);
  }

  private get previewPatchCode() {
    return JSON.stringify(this.args.message.command.payload.patch, null, 2);
  }

  @action private viewCodeToggle() {
    this.isDisplayingCode = !this.isDisplayingCode;
    if (this.isDisplayingCode) {
      this.args.setCurrentEditor(this.args.message.index);
    }
  }

  private viewCodePanelModifier = modifier((element: HTMLElement) => {
    if (this.args.currentEditor !== this.args.message.index) {
      return;
    }

    let height = this.monacoService.getContentHeight();
    if (!height || height < 0) {
      return;
    }
    element.style.height = `${height}px`;

    let outerContainer = document.getElementById(
      `message-container-${this.args.message.index}`,
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
