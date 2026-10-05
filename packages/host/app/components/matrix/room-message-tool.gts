import { array, hash } from '@ember/helper';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { cached } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';
import { consume, provide } from 'ember-provide-consume-context';

import { resource, use } from 'ember-resources';

import { TrackedObject } from 'tracked-built-ins';

import {
  Alert,
  CardContainer,
  CardHeader,
} from '@cardstack/boxel-ui/components';

import { bool, cn, eq, not, toMenuItems } from '@cardstack/boxel-ui/helpers';

import {
  CardContextName,
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
import type StoreService from '@cardstack/host/services/store';
import type ToolService from '@cardstack/host/services/tool-service';

import CodeBlock from '../ai-assistant/code-block';
import CardRenderer from '../card-renderer';

import type { ApplyButtonState } from '../ai-assistant/apply-button';
import type { CardContext, CardDef } from '@cardstack/base/card-api';

// Whether a card's class gives it an embedded view of its own. A class that
// leaves `embedded` alone inherits CardDef's default, which shows only a
// placeholder thumbnail and the card's title. `isCardDef` is declared on
// CardDef itself, so the class that declares `embedded` is CardDef exactly
// when it also declares `isCardDef`.
function hasOwnEmbeddedView(card: CardDef): boolean {
  let klass: object | null = card.constructor;
  while (klass && !Object.hasOwn(klass, 'embedded')) {
    klass = Object.getPrototypeOf(klass);
  }
  return !!klass && !Object.hasOwn(klass, 'isCardDef');
}

interface Signature {
  Element: HTMLDivElement;
  Args: {
    roomResource: RoomResource;
    messageTool: MessageTool;
    roomId: string;
    runCommand: () => void;
    // Declines a call ai-bot holds for the user's approval.
    declineCommand?: () => void;
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
  @service declare private store: StoreService;

  @consume(CardContextName) declare private cardContext: CardContext;

  // A tool's result card can show what the tool produced from the room's
  // media, such as an image it captured.
  @provide(CardContextName)
  // @ts-ignore "context" is declared but not used
  private get context(): CardContext {
    return {
      ...this.cardContext,
      loadRoomMedia: this.matrixService.loadRoomMedia,
    };
  }

  // How much of the call's arguments has arrived. On the element as a plain
  // data attribute so anything watching a session (the eval runner, and later
  // a deployed monitor) can tell a long tool call that is still streaming
  // from a stalled one, even while the box is collapsed.
  private get argumentsLength() {
    return (
      this.args.messageTool.argumentsText ??
      JSON.stringify(this.args.messageTool.arguments ?? {})
    ).length;
  }

  // While the arguments are still streaming they are not valid JSON yet, so
  // show the raw text received so far as it is.
  private get previewCommandCode() {
    let { name, arguments: payload, argumentsText } = this.args.messageTool;
    if (argumentsText) {
      return argumentsText;
    }
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

  // The result card is the live store instance when the result doc names a
  // saved card. Holding a store reference for as long as this component
  // renders it keeps the instance out of the store's GC sweep and subscribed
  // to realm invalidation; otherwise a sweep could evict it mid-render and the
  // next `store.get` would mint a second instance for the same id.
  @use private toolResultCard = resource(({ on }) => {
    let initialState = { card: undefined, isRealmCard: false } as {
      card: CardDef | undefined;
      isRealmCard: boolean;
    };
    let state = new TrackedObject(initialState);
    let referencedId: string | undefined;
    let isTornDown = false;
    on.cleanup(() => {
      isTornDown = true;
      if (referencedId) {
        this.store.dropReference(referencedId);
      }
    });
    if (this.args.messageTool.toolResultFileDef) {
      this.args.messageTool.getCommandResultCard().then((result) => {
        if (isTornDown || !result) {
          return;
        }
        let { card, isRealmCard } = result;
        if (card.id) {
          referencedId = card.id;
          this.store.addReference(card.id);
        }
        state.isRealmCard = isRealmCard;
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
    // Consume the toggle flag so this re-runs when the code area opens or
    // closes. The code block sizes to its content on its own — the Monaco
    // modifier sets the editor's height and CSS caps it — so there is no inline
    // height to stamp or clear; collapsing the editor lets the block shrink
    // back to its header. When the code opens, bring it into view.
    if (!this.isDisplayingCode) {
      return;
    }
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

  // Most result cards are data a tool hands back to the model, with nothing
  // in them for the user to look at. The chat shows one only when it is a
  // realm card the user may want to open, or when its type has a view of its
  // own; the tool's status row stands for the rest.
  private get shouldDisplayResultCard() {
    let { card, isRealmCard } = this.toolResultCard;
    if (!card) {
      return false;
    }
    return isRealmCard || hasOwnEmbeddedView(card);
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
        toolContext: this.toolService.toolContext,
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

  // Execution failure reported through a room event (as opposed to
  // failedToolState, which is this tab's in-memory state for a failure it
  // produced itself).
  private get failedToolCallState() {
    return this.args.messageTool.status === 'failed' && !this.failedToolState;
  }

  // "Try Anyway" re-runs a host tool; a call ai-bot runs has nothing on the
  // host to retry, so its failure reason shows without the action.
  private get invalidToolCallState() {
    return (
      this.args.messageTool.status === 'invalid' &&
      !!this.args.messageTool.failureReason &&
      !this.args.messageTool.isBotExecuted
    );
  }

  // Why the assistant wants a call held for approval, in its own words: a
  // bot tool that asks for approval takes a `reason` argument.
  private get approvalReason() {
    let reason = this.args.messageTool.toolRequest.arguments?.reason;
    return typeof reason === 'string' && reason.trim() ? reason.trim() : '';
  }

  private get commandDescription() {
    return this.args.messageTool.description ?? 'Preparing tool call...';
  }

  private get hasFailedState() {
    return !!(
      this.failedToolState ||
      this.failedToolCallState ||
      this.didFailCorrectnessCheck
    );
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
      data-tool-name={{@messageTool.name}}
      data-tool-arguments-length={{this.argumentsLength}}
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
            @isDisplayingCode={{this.isDisplayingCode}}
            @toggleCode={{this.toggleViewCode}}
          />
          {{#if this.isDisplayingCode}}
            <codeBlock.editor />
          {{/if}}
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
          data-test-tool-code-block
          as |codeBlock|
        >
          <codeBlock.commandHeader
            @commandDescription={{@messageTool.description}}
            @action={{@runCommand}}
            @secondaryAction={{if @messageTool.awaitsApproval @declineCommand}}
            @secondaryActionVerb='Decline'
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
        {{#if @messageTool.awaitsApproval}}
          <p class='approval-note' data-test-tool-call-approval>
            {{#if this.approvalReason}}
              The assistant asks for your approval and says: “{{this.approvalReason}}”
              Approve if that's OK with you.
            {{else}}
              The assistant asks for your approval to do this. Approve if that's
              OK with you.
            {{/if}}
          </p>
        {{/if}}
        {{#if this.failedToolState}}
          <Alert @type='error' as |Alert|>
            <Alert.Messages @messages={{array this.failedToolState.message}} />
            <Alert.Action @action={{@runCommand}} @actionName='Retry' />
          </Alert>
        {{else if this.failedToolCallState}}
          <Alert @type='error' as |Alert|>
            <Alert.Messages
              @messages={{array
                (if
                  @messageTool.failureReason
                  @messageTool.failureReason
                  'Tool call failed.'
                )
              }}
            />
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
      .approval-note {
        margin: 0;
        padding: 0 var(--boxel-sp-xxs);
        font: var(--boxel-font-xs);
        color: var(--boxel-450);
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
