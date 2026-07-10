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
import { isAutoExecutableTool } from '@cardstack/host/lib/tool-auto-execute';

import type { RoomResource } from '@cardstack/host/resources/room';
import type MatrixService from '@cardstack/host/services/matrix-service';

import type { MonacoSDK } from '@cardstack/host/services/monaco-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type ToolService from '@cardstack/host/services/tool-service';

import CodeBlock from '../ai-assistant/code-block';
import CardRenderer from '../card-renderer';

import type { ApplyButtonState } from '../ai-assistant/apply-button';
import type { CardDef } from '@cardstack/base/card-api';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    roomResource: RoomResource;
    messageTool: MessageTool;
    roomId: string;
    runCommand: () => void;
    isError?: boolean;
    isPending?: boolean;
    isCompact?: boolean;
    isStreaming: boolean;
    monacoSDK: MonacoSDK;
  };
}

export default class RoomMessageTool extends Component<Signature> {
  @service declare private toolService: ToolService;
  @service declare private matrixService: MatrixService;
  @service declare private realm: RealmService;
  @service declare private operatorModeStateService: OperatorModeStateService;

  private get previewCommandCode() {
    let { name, arguments: payload } = this.args.messageTool;
    return JSON.stringify({ name, payload }, null, 2);
  }

  @cached
  private get applyButtonState(): ApplyButtonState {
    if (this.failedToolState) {
      return 'failed';
    }
    if (this.didFailCorrectnessCheck) {
      return 'applied-with-error';
    }
    let status = this.args.messageTool?.status;
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
      this.args.messageTool.eventId,
    );
    let isOwnedByCurrentAgent =
      this.args.messageTool.message.agentId === this.matrixService.agentId;
    return isAutoExecutableTool(
      this.args.messageTool,
      activeMode,
      isOwnedByCurrentAgent,
    );
  }

  @use private toolResultCard = resource(() => {
    let initialState = { card: undefined } as { card: CardDef | undefined };
    let state = new TrackedObject(initialState);
    if (this.args.messageTool.toolResultFileDef) {
      this.args.messageTool.getCommandResultCard().then((card) => {
        state.card = card;
      });
    }
    return state;
  });

  private get isDisplayingCode() {
    return this.args.roomResource.isDisplayingCode(
      this.args.messageTool.toolRequest as ToolRequest,
    );
  }

  private toggleViewCode = () => {
    this.args.roomResource.toggleViewCode(
      this.args.messageTool.toolRequest as ToolRequest,
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
    if (this.toolResultCard.card) {
      return cardTypeDisplayName(this.toolResultCard.card);
    }
    return '';
  }

  private get shouldDisplayResultCard() {
    let commandName = this.args.messageTool.name ?? '';
    return (
      !!this.toolResultCard.card &&
      commandName !== 'checkCorrectness' &&
      !commandName.startsWith('switch-submode')
    );
  }

  private get didFailCorrectnessCheck() {
    if (this.args.messageTool.name !== 'checkCorrectness') {
      return false;
    }
    let card = this.toolResultCard.card as
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
      this.toolResultCard.card?.[getMenuItems]?.({
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
    if (!this.toolResultCard.card) {
      throw new Error('Command result card is not available');
    }
    return this.toolResultCard.card;
  }

  @cached
  private get failedToolState() {
    let toolRequest = this.args.messageTool.toolRequest as ToolRequest;
    if (!toolRequest.id) {
      return undefined;
    }
    return this.matrixService.failedToolState.get(toolRequest.id);
  }

  private get invalidToolCallState() {
    return (
      this.args.messageTool.status === 'invalid' &&
      !!this.args.messageTool.failureReason
    );
  }

  private get commandDescription() {
    return this.args.messageTool.description ?? 'Preparing tool call...';
  }

  private get hasFailedState() {
    return !!(this.failedToolState || this.didFailCorrectnessCheck);
  }

  <template>
    <div
      class={{cn
        'room-message-tool'
        is-pending=@isPending
        is-error=@isError
        is-failed=(bool this.hasFailedState)
        compact=@isCompact
      }}
      data-test-tool-call-id={{@messageTool.toolRequest.id}}
      ...attributes
    >
      {{#if @isStreaming}}
        <CodeBlock
          class={{cn 'tool-code-block' compact=@isCompact}}
          @monacoSDK={{@monacoSDK}}
          @codeData={{hash code=this.previewCommandCode language='json'}}
          data-test-tool-call-card-idle={{not
            (eq this.applyButtonState 'applying')
          }}
          as |codeBlock|
        >
          <codeBlock.commandHeader
            @commandDescription={{this.commandDescription}}
            @action={{@runCommand}}
            @actionVerb={{@messageTool.actionVerb}}
            @code={{this.previewCommandCode}}
            @isCompact={{@isCompact}}
            @toolCallState='preparing'
          />
        </CodeBlock>
      {{else}}
        <CodeBlock
          class={{cn 'tool-code-block' compact=@isCompact}}
          {{this.scrollBottomIntoView}}
          @monacoSDK={{@monacoSDK}}
          @codeData={{hash code=this.previewCommandCode language='json'}}
          data-test-tool-call-card-idle={{not
            (eq this.applyButtonState 'applying')
          }}
          as |codeBlock|
        >
          <codeBlock.commandHeader
            @commandDescription={{@messageTool.description}}
            @action={{@runCommand}}
            @actionVerb={{@messageTool.actionVerb}}
            @code={{this.previewCommandCode}}
            @toolCallState={{this.applyButtonState}}
            @isCompact={{@isCompact}}
            @isDisplayingCode={{this.isDisplayingCode}}
            @toggleCode={{this.toggleViewCode}}
          />
          {{#if this.isDisplayingCode}}
            <codeBlock.editor />
          {{/if}}
        </CodeBlock>
        {{#if this.failedToolState}}
          <Alert @type='error' as |Alert|>
            <Alert.Messages @messages={{array this.failedToolState.message}} />
            <Alert.Action @action={{@runCommand}} @actionName='Retry' />
          </Alert>
        {{else if this.invalidToolCallState}}
          <Alert @type='warning' as |Alert|>
            <Alert.Messages @messages={{array @messageTool.failureReason}} />
            <Alert.Action @action={{@runCommand}} @actionName='Try Anyway' />
          </Alert>
        {{/if}}
        {{#if this.shouldDisplayResultCard}}
          <CardContainer
            @displayBoundaries={{false}}
            class='tool-result-card-preview'
            data-test-tool-result-container
          >
            <CardHeader
              @cardTypeDisplayName={{this.headerTitle}}
              @cardTypeIcon={{cardTypeIcon this.commandResultCardForRendering}}
              @moreOptionsMenuItems={{this.moreOptionsMenuItems}}
              class='tool-result-card-header'
              data-test-tool-result-header
            />
            <CardRenderer
              @card={{this.commandResultCardForRendering}}
              @format='embedded'
              @displayContainer={{false}}
              data-test-boxel-tool-call-result
            />
          </CardContainer>
        {{/if}}
      {{/if}}
    </div>

    <style scoped>
      .room-message-tool > * + * {
        margin-top: var(--boxel-sp-xs);
      }
      .tool-result-card-preview {
        margin-top: var(--boxel-sp);
      }
      .tool-result-card-header {
        --boxel-label-color: var(--boxel-450);
        --boxel-label-font-size: var(--boxel-font-size-xs);
        --boxel-label-line-height: calc(15 / 11);
        --boxel-header-padding: var(--boxel-sp-xxxs) var(--boxel-sp-xxxs) 0
          var(--left-padding);
      }
      .tool-result-card-header :deep(.content) {
        gap: 0;
      }
    </style>
  </template>
}
