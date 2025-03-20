import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { inject as service } from '@ember/service';
import Component from '@glimmer/component';

import { cached } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';

import { resource, use } from 'ember-resources';

import { TrackedObject } from 'tracked-built-ins';

import {
  Button,
  CardContainer,
  CardHeader,
} from '@cardstack/boxel-ui/components';

import { MenuItem, bool, cn, eq, not } from '@cardstack/boxel-ui/helpers';
import { ArrowLeft } from '@cardstack/boxel-ui/icons';

import { cardTypeDisplayName, cardTypeIcon } from '@cardstack/runtime-common';

import type { CommandRequest } from '@cardstack/runtime-common/commands';

import CopyCardCommand from '@cardstack/host/commands/copy-card';
import ShowCardCommand from '@cardstack/host/commands/show-card';
import MessageCommand from '@cardstack/host/lib/matrix-classes/message-command';

import { RoomResource } from '@cardstack/host/resources/room';
import type CommandService from '@cardstack/host/services/command-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type MonacoService from '@cardstack/host/services/monaco-service';

import { type MonacoSDK } from '@cardstack/host/services/monaco-service';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import ApplyButton from '../ai-assistant/apply-button';
import { type ApplyButtonState } from '../ai-assistant/apply-button';
import CodeBlock from '../ai-assistant/code-block';
import Preview from '../preview';

import PreparingRoomMessageCommand from './preparing-room-message-command';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    roomResource: RoomResource;
    messageCommand: MessageCommand;
    roomId: string;
    runCommand: () => void;
    isError?: boolean;
    isPending?: boolean;
    isStreaming: boolean;
    monacoSDK: MonacoSDK;
  };
}

export default class RoomMessageCommand extends Component<Signature> {
  @service private declare commandService: CommandService;
  @service private declare matrixService: MatrixService;
  @service private declare monacoService: MonacoService;

  private get previewCommandCode() {
    let { name, arguments: payload } = this.args.messageCommand;
    return JSON.stringify({ name, payload }, null, 2);
  }

  @cached
  private get applyButtonState(): ApplyButtonState {
    if (this.failedCommandState) {
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

  private get isDisplayingCode() {
    return this.args.roomResource.isDisplayingCode(
      this.args.messageCommand.commandRequest as CommandRequest,
    );
  }

  private toggleViewCode = () => {
    this.args.roomResource.toggleViewCode(
      this.args.messageCommand.commandRequest as CommandRequest,
    );
  };

  private scrollBottomIntoView = modifier((element: HTMLElement) => {
    let height = this.monacoService.getContentHeight();
    if (!height || height < 0) {
      return;
    }
    element.style.height = `${height}px`; // max-height is constrained by CSS
    this.scrollIntoView(element.parentElement as HTMLElement);
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
      cardIdToShow: newCard.id,
    });
  }

  @cached
  private get failedCommandState() {
    let commandRequest = this.args.messageCommand
      .commandRequest as CommandRequest;
    if (!commandRequest.id) {
      return undefined;
    }
    return this.matrixService.failedCommandState.get(commandRequest.id);
  }

  <template>
    <div
      class={{cn
        is-pending=@isPending
        is-error=@isError
        is-failed=(bool this.failedCommandState)
      }}
      data-test-command-id={{@messageCommand.commandRequest.id}}
      ...attributes
    >
      {{#if @messageCommand.description}}
        <div class='command-description'>{{@messageCommand.description}}</div>
      {{/if}}
      {{#if @isStreaming}}
        <PreparingRoomMessageCommand />
      {{else}}
        <div
          class='command-button-bar'
          data-test-command-card-idle={{not
            (eq @messageCommand.status 'applying')
          }}
        >
          <Button
            class='view-code-button'
            {{on 'click' this.toggleViewCode}}
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
          <CodeBlock
            {{this.scrollBottomIntoView}}
            @monacoSDK={{@monacoSDK}}
            @code={{this.previewCommandCode}}
            @language='json'
            as |codeBlock|
          >
            <codeBlock.actions as |actions|>
              <actions.copyCode />
            </codeBlock.actions>
            <codeBlock.editor />
          </CodeBlock>
        {{/if}}
        {{#if this.failedCommandState}}
          <div class='failed-command-result'>
            <span class='failed-command-text'>
              {{this.failedCommandState.message}}
            </span>
            <Button
              {{on 'click' @runCommand}}
              class='retry-button'
              @size='small'
              @kind='secondary-dark'
              data-test-retry-command-button
            >
              Retry
            </Button>
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
      {{/if}}
    </div>

    {{! template-lint-disable no-whitespace-for-layout  }}
    {{! ignore the above error because ember-template-lint complains about the whitespace in the multi-line comment below }}
    <style scoped>
      .command-description {
        font-size: var(--boxel-font-sm);
        font-weight: 500;
        line-height: 1.25rem;
        letter-spacing: var(--boxel-lsp-xs);
        color: var(--boxel-light);
        /* the below font-smoothing options are only recommended for light-colored
          text on dark background (otherwise not good for accessibility) */
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      .is-pending .view-code-button,
      .is-error .view-code-button {
        background: var(--boxel-200);
        color: var(--boxel-500);
      }
      .is-failed {
        border: 1px solid var(--boxel-danger);
        border-radius: var(--boxel-border-radius);
      }
      .command-button-bar {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-xs);
        margin-top: var(--boxel-sp);
      }
      .is-failed .command-button-bar {
        padding-right: var(--boxel-sp-xs);
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
      .options-menu :deep(.boxel-menu__item__content) {
        padding-right: var(--boxel-sp-xxs);
        padding-left: var(--boxel-sp-xxs);
      }
      .options-menu :deep(.check-icon) {
        display: none;
      }
      .retry-button {
        --boxel-button-padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        --boxel-button-min-height: max-content;
        --boxel-button-min-width: max-content;
        border-color: var(--boxel-light);
      }
      .failed-command-result {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--boxel-sp-xs);
        background-color: var(--boxel-danger);
        padding: var(--boxel-sp-xs);
        border-bottom-left-radius: var(--boxel-border-radius);
        border-bottom-right-radius: var(--boxel-border-radius);
        margin-top: var(--boxel-sp-xs);
      }
      .failed-command-text {
        color: var(--boxel-light);
      }
      :deep(.code-block-actions) {
        margin-top: var(--boxel-sp);
      }
    </style>
  </template>
}
