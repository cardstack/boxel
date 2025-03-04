import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { inject as service } from '@ember/service';
import Component from '@glimmer/component';

import { cached } from '@glimmer/tracking';

import { task, timeout } from 'ember-concurrency';

import { modifier } from 'ember-modifier';

import { resource, use } from 'ember-resources';

import { TrackedObject } from 'tracked-built-ins';

import {
  Button,
  CardContainer,
  CardHeader,
} from '@cardstack/boxel-ui/components';

import { MenuItem, cn } from '@cardstack/boxel-ui/helpers';
import { ArrowLeft, Copy as CopyIcon } from '@cardstack/boxel-ui/icons';

import { cardTypeDisplayName, cardTypeIcon } from '@cardstack/runtime-common';

import CopyCardCommand from '@cardstack/host/commands/copy-card';
import ShowCardCommand from '@cardstack/host/commands/show-card';
import MessageCommand from '@cardstack/host/lib/matrix-classes/message-command';
import type { MonacoEditorOptions } from '@cardstack/host/modifiers/monaco';
import monacoModifier from '@cardstack/host/modifiers/monaco';
import type CommandService from '@cardstack/host/services/command-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type MonacoService from '@cardstack/host/services/monaco-service';

import { type MonacoSDK } from '@cardstack/host/services/monaco-service';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import ApplyButton from '../ai-assistant/apply-button';
import { type ApplyButtonState } from '../ai-assistant/apply-button';
import Preview from '../preview';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    messageCommand: MessageCommand;
    messageIndex: number | undefined;
    roomId: string;
    runCommand: () => void;
    isError?: boolean;
    isPending?: boolean;
    isDisplayingCode: boolean;
    failedCommandState: Error | undefined;
    monacoSDK: MonacoSDK;
    onToggleViewCode: () => void;
    currentEditor: number | undefined;
  };
}

export default class RoomMessageCommand extends Component<Signature> {
  @service private declare commandService: CommandService;
  @service private declare matrixService: MatrixService;
  @service private declare monacoService: MonacoService;

  editorDisplayOptions: MonacoEditorOptions = {
    wordWrap: 'on',
    wrappingIndent: 'indent',
    fontWeight: 'bold',
    scrollbar: {
      alwaysConsumeMouseWheel: false,
    },
    lineNumbers: 'off',
  };

  private get previewCommandCode() {
    let { name, payload } = this.args.messageCommand;
    return JSON.stringify({ name, payload }, null, 2);
  }

  private copyToClipboard = (event: MouseEvent) => {
    this.copyClipboardTask.perform(event.currentTarget as HTMLElement);
  };

  private copyClipboardTask = task(async (buttonElement: HTMLElement) => {
    await navigator.clipboard.writeText(this.previewCommandCode);
    let svg = buttonElement.children[0];
    buttonElement.replaceChildren(svg, document.createTextNode('Copied'));
    await timeout(2000);
    buttonElement.replaceChildren(
      svg,
      document.createTextNode('Copy to clipboard'),
    );
  });

  @cached
  private get applyButtonState(): ApplyButtonState {
    if (this.args.failedCommandState) {
      return 'failed';
    }
    return this.args.messageCommand?.status ?? 'ready';
  }

  @use private commandResultCard = resource(() => {
    let initialState = { card: undefined } as { card: CardDef | undefined };
    let state = new TrackedObject(initialState);
    if (this.args.messageCommand.commandResultCardDoc !== undefined) {
      this.args.messageCommand.getCommandResultCard().then((card) => {
        state.card = card;
      });
    }
    return state;
  });

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

  private get headerTitle() {
    if (this.commandResultCard.card) {
      return cardTypeDisplayName(this.commandResultCard.card);
    }
    return '';
  }

  private get moreOptionsMenuItems() {
    let menuItems: MenuItem[] = [
      new MenuItem('Copy to Workspace', 'action', {
        action: () => this.copyToWorkspace(),
        icon: ArrowLeft,
      }),
    ];
    return menuItems;
  }

  @action async copyToWorkspace() {
    let { commandContext } = this.commandService;
    const { newCard } = await new CopyCardCommand(commandContext).execute({
      sourceCard: this.commandResultCard.card as CardDef,
    });

    let showCardCommand = new ShowCardCommand(commandContext);
    await showCardCommand.execute({
      cardToShow: newCard,
    });
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
          {{on 'click' @onToggleViewCode}}
          @kind={{if @isDisplayingCode 'primary-dark' 'secondary-dark'}}
          @size='extra-small'
          data-test-view-code-button
        >
          {{if @isDisplayingCode 'Hide Code' 'View Code'}}
        </Button>
        <ApplyButton
          @state={{this.applyButtonState}}
          {{on 'click' @runCommand}}
          data-test-command-apply={{this.applyButtonState}}
        />
      </div>
      {{#if @isDisplayingCode}}
        <div class='preview-code'>
          <Button
            class='code-copy-button'
            @kind='text-only'
            @size='extra-small'
            {{on 'click' this.copyToClipboard}}
            data-test-copy-code
          >
            <CopyIcon
              width='16'
              height='16'
              role='presentation'
              aria-hidden='true'
            />
            <span class='copy-text'>Copy to clipboard</span>
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
              editorDisplayOptions=this.editorDisplayOptions
            }}
            data-test-editor
            data-test-percy-hide
          />
        </div>
      {{/if}}
      {{#if this.commandResultCard.card}}
        <CardContainer
          @displayBoundaries={{false}}
          class='command-result-card-preview'
          data-test-command-result-container
        >
          <CardHeader
            @cardTypeDisplayName={{this.headerTitle}}
            @cardTypeIcon={{cardTypeIcon this.commandResultCard.card}}
            @moreOptionsMenuItems={{this.moreOptionsMenuItems}}
            class='header'
            data-test-command-result-header
          />
          <Preview
            @card={{this.commandResultCard.card}}
            @format='embedded'
            @displayContainer={{false}}
            data-test-boxel-command-result
          />
        </CardContainer>
      {{/if}}
    </div>

    {{! template-lint-disable no-whitespace-for-layout  }}
    {{! ignore the above error because ember-template-lint complains about the whitespace in the multi-line comment below }}
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
      .command-result-card-preview {
        margin-top: var(--boxel-sp);
      }
      .preview-code {
        --spacing: var(--boxel-sp-sm);
        --fill-container-spacing: calc(
          -1 * var(--ai-assistant-message-padding)
        );
        margin: var(--boxel-sp) var(--fill-container-spacing)
          var(--fill-container-spacing) var(--fill-container-spacing);
        padding: var(--spacing) 0;
        background-color: var(--boxel-dark);
      }
      .code-copy-button {
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
      .code-copy-button > .copy-text {
        color: transparent;
      }
      .code-copy-button:hover:not(:disabled) > .copy-text {
        color: var(--boxel-highlight);
      }
      .monaco-container {
        height: var(--monaco-container-height);
        min-height: 10rem;
        max-height: 30vh;
      }
      .header {
        --boxel-label-color: var(--boxel-450);
        --boxel-label-font: 600 var(--boxel-font-xs);
        --boxel-header-padding: var(--boxel-sp-xxxs) var(--boxel-sp-xxxs) 0
          var(--left-padding);
      }
      .header :deep(.content) {
        gap: 0;
      }
      .icon-button {
        --icon-color: var(--boxel-dark);
      }
      .icon-button:hover {
        --icon-color: var(--boxel-highlight);
      }
      .options-menu :deep(.boxel-menu__item__content) {
        padding-right: var(--boxel-sp-xxs);
        padding-left: var(--boxel-sp-xxs);
      }
      .options-menu :deep(.check-icon) {
        display: none;
      }
    </style>
  </template>
}
