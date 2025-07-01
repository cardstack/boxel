import { array, hash } from '@ember/helper';
import { action } from '@ember/object';
import { inject as service } from '@ember/service';
import Component from '@glimmer/component';

import { cached } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';

import { resource, use } from 'ember-resources';

import { TrackedObject } from 'tracked-built-ins';

import {
  Alert,
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

import { type MonacoSDK } from '@cardstack/host/services/monaco-service';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { type ApplyButtonState } from '../ai-assistant/apply-button';
import CodeBlock from '../ai-assistant/code-block';
import CardRenderer from '../card-renderer';

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
    if (this.args.messageCommand.commandResultFileDef) {
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
    let editor = this.args.monacoSDK.editor
      .getEditors()
      .find((editor) => element.contains(editor.getContainerDomNode()));
    let editorHeight = editor?.getContentHeight() ?? 0;
    if (!editorHeight || editorHeight < 0) {
      return;
    }
    let heightOfOtherChildren = [...element.children]
      .filter((childEl) => childEl !== editor?.getContainerDomNode())
      .reduce((acc, childEl) => acc + (childEl as HTMLElement).offsetHeight, 0);
    element.style.height = `${editorHeight + heightOfOtherChildren}px`; // max-height is constrained by CSS
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
    const { newCardId } = await new CopyCardCommand(commandContext).execute({
      sourceCard: this.commandResultCard.card as CardDef,
    });

    let showCardCommand = new ShowCardCommand(commandContext);
    await showCardCommand.execute({
      cardId: newCardId,
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
        'room-message-command'
        is-pending=@isPending
        is-error=@isError
        is-failed=(bool this.failedCommandState)
      }}
      data-test-command-id={{@messageCommand.commandRequest.id}}
      ...attributes
    >
      {{#if @isStreaming}}
        <PreparingRoomMessageCommand />
      {{else}}
        <CodeBlock
          class='command-code-block'
          {{this.scrollBottomIntoView}}
          @monacoSDK={{@monacoSDK}}
          @codeData={{hash code=this.previewCommandCode language='json'}}
          data-test-command-card-idle={{not
            (eq @messageCommand.status 'applying')
          }}
          as |codeBlock|
        >
          <codeBlock.commandHeader
            @commandDescription={{@messageCommand.description}}
            @action={{@runCommand}}
            @actionVerb={{@messageCommand.actionVerb}}
            @code={{this.previewCommandCode}}
            @commandState={{this.applyButtonState}}
            @isDisplayingCode={{this.isDisplayingCode}}
            @toggleCode={{this.toggleViewCode}}
          />
          {{#if this.isDisplayingCode}}
            <codeBlock.editor />
          {{/if}}
        </CodeBlock>
        {{#if this.failedCommandState}}
          <Alert
            @type='error'
            @messages={{array this.failedCommandState.message}}
            @retryAction={{@runCommand}}
          />
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
              class='command-result-card-header'
              data-test-command-result-header
            />
            <CardRenderer
              @card={{this.commandResultCard.card}}
              @format='embedded'
              @displayContainer={{false}}
              data-test-boxel-command-result
            />
          </CardContainer>
        {{/if}}
      {{/if}}
    </div>

    <style scoped>
      .room-message-command > * + * {
        margin-top: var(--boxel-sp-xs);
      }
      .command-result-card-preview {
        margin-top: var(--boxel-sp);
      }
      .command-result-card-header {
        --boxel-label-color: var(--boxel-450);
        --boxel-label-font: 600 var(--boxel-font-xs);
        --boxel-header-padding: var(--boxel-sp-xxxs) var(--boxel-sp-xxxs) 0
          var(--left-padding);
      }
      .command-result-card-header :deep(.content) {
        gap: 0;
      }
    </style>
  </template>
}
