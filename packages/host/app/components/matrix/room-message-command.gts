import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { inject as service } from '@ember/service';
import Component from '@glimmer/component';

import { cached, tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';
import { modifier } from 'ember-modifier';

import { Button } from '@cardstack/boxel-ui/components';

import { cn } from '@cardstack/boxel-ui/helpers';
import { Copy as CopyIcon } from '@cardstack/boxel-ui/icons';

import MessageCommand from '@cardstack/host/lib/matrix-classes/message-command';
import type { MonacoEditorOptions } from '@cardstack/host/modifiers/monaco';
import monacoModifier from '@cardstack/host/modifiers/monaco';
import type CommandService from '@cardstack/host/services/command-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type MonacoService from '@cardstack/host/services/monaco-service';

import { type MonacoSDK } from '@cardstack/host/services/monaco-service';

import ApplyButton from '../ai-assistant/apply-button';
import { type ApplyButtonState } from '../ai-assistant/apply-button';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    messageCommand: MessageCommand;
    messageIndex: number | undefined;
    roomId: string;
    runCommand: () => void;
    isError?: boolean;
    isPending?: boolean;
    failedCommandState: Error | undefined;
    monacoSDK: MonacoSDK;
    currentEditor: number | undefined;
    setCurrentEditor: (editor: number | undefined) => void;
  };
}

export default class RoomMessageCommand extends Component<Signature> {
  @service private declare commandService: CommandService;
  @service private declare matrixService: MatrixService;
  @service private declare monacoService: MonacoService;

  @tracked private isDisplayingCode = false;

  editorDisplayOptions: MonacoEditorOptions = {
    wordWrap: 'on',
    wrappingIndent: 'indent',
    fontWeight: 'bold',
    scrollbar: {
      alwaysConsumeMouseWheel: false,
    },
  };

  private get previewCommandCode() {
    let { name, payload } = this.args.messageCommand;
    return JSON.stringify({ name, payload }, null, 2);
  }

  private copyToClipboard = task(async () => {
    await navigator.clipboard.writeText(this.previewCommandCode);
  });

  @cached
  private get applyButtonState(): ApplyButtonState {
    if (this.args.failedCommandState) {
      return 'failed';
    }
    return this.args.messageCommand?.status ?? 'ready';
  }

  @action private viewCodeToggle() {
    this.isDisplayingCode = !this.isDisplayingCode;
    if (this.isDisplayingCode) {
      this.args.setCurrentEditor(this.args.messageIndex);
    }
  }

  private get getCommandResultComponent() {
    let commandResultCardEventId =
      this.args.messageCommand?.commandResultCardEventId;
    if (!commandResultCardEventId) {
      return undefined;
    }
    // TODO: load the card from the the room (commandResultCardEventId)
    return undefined;
    // return commandResult.constructor.getComponent(commandResult);
  }

  // TODO need to reevalutate this modifier--do we want to hijack the scroll
  // when the user views the code?
  private scrollBottomIntoView = modifier((element: HTMLElement) => {
    if (this.args.currentEditor !== this.args.messageIndex) {
      return;
    }

    let height = this.monacoService.getContentHeight();
    if (!height || height < 0) {
      return;
    }
    element.style.height = `${height}px`;

    let outerContainer = document.getElementById(
      `message-container-${this.args.messageIndex}`,
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

  <template>
    <div class={{cn is-pending=@isPending is-error=@isError}} ...attributes>
      <div
        class='command-button-bar'
        {{! In test, if we change this isIdle check to the task running locally on this component, it will fail because roomMessages get destroyed during re-indexing.
              Since services are long-lived so it we will not have this issue. I think this will go away when we convert our room field into a room component }}
        {{! TODO: Convert to non-EC async method after fixing CS-6987 }}
        data-test-command-card-idle={{this.commandService.run.isIdle}}
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
          {{on 'click' @runCommand}}
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
      {{#let this.getCommandResultComponent as |Component|}}
        {{#if Component}}
          <Component @format='embedded' />
        {{/if}}
      {{/let}}
    </div>
    <style scoped>
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
        --boxel-button-font: 600 var(--boxel-font-xs);
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
        margin: var(--boxel-sp) var(--fill-container-spacing) 0
          var(--fill-container-spacing);
        padding: var(--spacing) 0;
        background-color: var(--boxel-dark);
      }
      .copy-to-clipboard-button {
        --boxel-button-font: 600 var(--boxel-font-xs);
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
}
