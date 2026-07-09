import { array, hash } from '@ember/helper';
import { service } from '@ember/service';
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

import { bool, cn, eq, not, toMenuItems } from '@cardstack/boxel-ui/helpers';

import {
  cardTypeDisplayName,
  cardTypeIcon,
  getMenuItems,
} from '@cardstack/runtime-common';

import type { ToolRequest } from '@cardstack/runtime-common/commands';

import type MessageTool from '@cardstack/host/lib/matrix-classes/message-tool';
import { isAutoExecutableCommand } from '@cardstack/host/lib/tool-auto-execute';

import type { RoomResource } from '@cardstack/host/resources/room';
import type MatrixService from '@cardstack/host/services/matrix-service';

import type { MonacoSDK } from '@cardstack/host/services/monaco-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type ToolService from '@cardstack/host/services/tool-service';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import CodeBlock from '../ai-assistant/code-block';
import CardRenderer from '../card-renderer';

import type { ApplyButtonState } from '../ai-assistant/apply-button';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    roomResource: RoomResource;
    messageCommand: MessageTool;
    roomId: string;
    runCommand: () => void;
    isError?: boolean;
    isPending?: boolean;
    isCompact?: boolean;
    isStreaming: boolean;
    monacoSDK: MonacoSDK;
  };
}

export default class RoomMessageCommand extends Component<Signature> {
  @service declare private toolService: ToolService;
  @service declare private matrixService: MatrixService;
  @service declare private realm: RealmService;
  @service declare private operatorModeStateService: OperatorModeStateService;

  private get previewCommandCode() {
    let { name, arguments: payload } = this.args.messageCommand;
    return JSON.stringify({ name, payload }, null, 2);
  }

  @cached
  private get applyButtonState(): ApplyButtonState {
    if (this.failedCommandState) {
      return 'failed';
    }
    if (this.didFailCorrectnessCheck) {
      return 'applied-with-error';
    }
    let status = this.args.messageCommand?.status;
    // Mirror the Accept All bar fix: for any command the host will
    // auto-execute (checkCorrectness, requiresApproval=false, LLM mode
    // 'act'), present the applying spinner immediately on message-landed
    // instead of the clickable Run button. Without this, the per-command
    // Apply button flashes through 'ready' for the ~100ms debounce window
    // before tool-service starts the run. If validation later fails
    // in the drain, tool-service dispatches an `invalid` commandResult
    // event and the button transitions to its invalid state — no risk of
    // the spinner sticking.
    if ((status === 'ready' || status === undefined) && this.willAutoExecute) {
      return 'applying';
    }
    return status ?? 'ready';
  }

  private get willAutoExecute() {
    let activeMode = this.args.roomResource.getActiveLLMModeForMessage(
      this.args.messageCommand.eventId,
    );
    let isOwnedByCurrentAgent =
      this.args.messageCommand.message.agentId === this.matrixService.agentId;
    return isAutoExecutableCommand(
      this.args.messageCommand,
      activeMode,
      isOwnedByCurrentAgent,
    );
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
      this.args.messageCommand.commandRequest as ToolRequest,
    );
  }

  private toggleViewCode = () => {
    this.args.roomResource.toggleViewCode(
      this.args.messageCommand.commandRequest as ToolRequest,
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

  private get shouldDisplayResultCard() {
    let commandName = this.args.messageCommand.name ?? '';
    return (
      !!this.commandResultCard.card &&
      commandName !== 'checkCorrectness' &&
      !commandName.startsWith('switch-submode')
    );
  }

  private get didFailCorrectnessCheck() {
    if (this.args.messageCommand.name !== 'checkCorrectness') {
      return false;
    }
    let card = this.commandResultCard.card as
      | { correct?: boolean; errors?: unknown[] }
      | undefined;
    if (!card) {
      return false;
    }
    let hasErrors =
      Array.isArray(card.errors) && card.errors.filter(Boolean).length > 0;
    let isMarkedIncorrect = card.correct === false;
    return hasErrors || isMarkedIncorrect;
  }

  private get moreOptionsMenuItems() {
    let menuItems =
      this.commandResultCard.card?.[getMenuItems]?.({
        canEdit: false,
        cardCrudFunctions: {},
        menuContext: 'ai-assistant',
        menuContextParams: {
          activeRealmURL: this.activeRealmURL,
          canEditActiveRealm: this.canEditActiveRealm,
        },
        commandContext: this.toolService.commandContext,
      }) ?? [];
    return toMenuItems(menuItems);
  }

  private get canEditActiveRealm() {
    let activeRealmURL = this.activeRealmURL;
    return activeRealmURL ? this.realm.canWrite(activeRealmURL) : false;
  }

  private get activeRealmURL() {
    return this.operatorModeStateService.realmURL;
  }

  private get commandResultCardForRendering(): CardDef {
    if (!this.commandResultCard.card) {
      throw new Error('Command result card is not available');
    }
    return this.commandResultCard.card;
  }

  @cached
  private get failedCommandState() {
    let commandRequest = this.args.messageCommand.commandRequest as ToolRequest;
    if (!commandRequest.id) {
      return undefined;
    }
    return this.matrixService.failedCommandState.get(commandRequest.id);
  }

  private get invalidCommandState() {
    return (
      this.args.messageCommand.status === 'invalid' &&
      !!this.args.messageCommand.failureReason
    );
  }

  private get commandDescription() {
    return this.args.messageCommand.description ?? 'Preparing tool call...';
  }

  private get hasFailedState() {
    return !!(this.failedCommandState || this.didFailCorrectnessCheck);
  }

  <template>
    <div
      class={{cn
        'room-message-command'
        is-pending=@isPending
        is-error=@isError
        is-failed=(bool this.hasFailedState)
        compact=@isCompact
      }}
      data-test-command-id={{@messageCommand.commandRequest.id}}
      ...attributes
    >
      {{#if @isStreaming}}
        <CodeBlock
          class={{cn 'command-code-block' compact=@isCompact}}
          @monacoSDK={{@monacoSDK}}
          @codeData={{hash code=this.previewCommandCode language='json'}}
          data-test-command-card-idle={{not
            (eq this.applyButtonState 'applying')
          }}
          as |codeBlock|
        >
          <codeBlock.commandHeader
            @commandDescription={{this.commandDescription}}
            @action={{@runCommand}}
            @actionVerb={{@messageCommand.actionVerb}}
            @code={{this.previewCommandCode}}
            @isCompact={{@isCompact}}
            @commandState='preparing'
          />
        </CodeBlock>
      {{else}}
        <CodeBlock
          class={{cn 'command-code-block' compact=@isCompact}}
          {{this.scrollBottomIntoView}}
          @monacoSDK={{@monacoSDK}}
          @codeData={{hash code=this.previewCommandCode language='json'}}
          data-test-command-card-idle={{not
            (eq this.applyButtonState 'applying')
          }}
          as |codeBlock|
        >
          <codeBlock.commandHeader
            @commandDescription={{@messageCommand.description}}
            @action={{@runCommand}}
            @actionVerb={{@messageCommand.actionVerb}}
            @code={{this.previewCommandCode}}
            @commandState={{this.applyButtonState}}
            @isCompact={{@isCompact}}
            @isDisplayingCode={{this.isDisplayingCode}}
            @toggleCode={{this.toggleViewCode}}
          />
          {{#if this.isDisplayingCode}}
            <codeBlock.editor />
          {{/if}}
        </CodeBlock>
        {{#if this.failedCommandState}}
          <Alert @type='error' as |Alert|>
            <Alert.Messages
              @messages={{array this.failedCommandState.message}}
            />
            <Alert.Action @action={{@runCommand}} @actionName='Retry' />
          </Alert>
        {{else if this.invalidCommandState}}
          <Alert @type='warning' as |Alert|>
            <Alert.Messages @messages={{array @messageCommand.failureReason}} />
            <Alert.Action @action={{@runCommand}} @actionName='Try Anyway' />
          </Alert>
        {{/if}}
        {{#if this.shouldDisplayResultCard}}
          <CardContainer
            @displayBoundaries={{false}}
            class='command-result-card-preview'
            data-test-command-result-container
          >
            <CardHeader
              @cardTypeDisplayName={{this.headerTitle}}
              @cardTypeIcon={{cardTypeIcon this.commandResultCardForRendering}}
              @moreOptionsMenuItems={{this.moreOptionsMenuItems}}
              class='command-result-card-header'
              data-test-command-result-header
            />
            <CardRenderer
              @card={{this.commandResultCardForRendering}}
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
        --boxel-label-font-size: var(--boxel-font-size-xs);
        --boxel-label-line-height: calc(15 / 11);
        --boxel-header-padding: var(--boxel-sp-xxxs) var(--boxel-sp-xxxs) 0
          var(--left-padding);
      }
      .command-result-card-header :deep(.content) {
        gap: 0;
      }
    </style>
  </template>
}
