import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { registerDestructor } from '@ember/destroyable';
import { hash } from '@ember/helper';
import { action } from '@ember/object';
import { service } from '@ember/service';
import type { SafeString } from '@ember/template';
import Component from '@glimmer/component';

import Modifier from 'ember-modifier';
import throttle from 'lodash/throttle';

import { Alert } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';

import { type getCardCollection } from '@cardstack/runtime-common';

import { type HtmlTagGroup } from '@cardstack/host/lib/formatted-message/utils';
import type MatrixService from '@cardstack/host/services/matrix-service';
import { type MonacoSDK } from '@cardstack/host/services/monaco-service';

import { type FileDef } from 'https://cardstack.com/base/file-api';

import AiBotMessage from './aibot-message';
import Attachments from './attachments';
import Meta from './meta';
import UserMessage from './user-message';

import type { ComponentLike } from '@glint/template';

interface Signature {
  Element: HTMLElement;
  Args: {
    reasoningContent?: string | null;
    messageHTML?: string;
    messageHTMLParts?: HtmlTagGroup[];
    datetime: Date;
    isFromAssistant: boolean;
    isStreaming: boolean;
    isLastAssistantMessage: boolean;
    profileAvatar?: ComponentLike;
    collectionResource?: ReturnType<getCardCollection>;
    files?: FileDef[] | undefined;
    index: number;
    roomId: string;
    eventId: string;
    monacoSDK: MonacoSDK;
    registerScroller: (args: {
      index: number;
      element: HTMLElement;
      scrollTo: Element['scrollIntoView'];
    }) => void;
    errorMessage?: string;
    isDebugMessage?: boolean;
    isPending?: boolean;
    retryAction?: () => void;
    hideMeta?: boolean;
  };
  Blocks: { default: [] };
}

interface MessageScrollerSignature {
  Args: {
    Named: {
      index: number;
      registerScroller: (args: {
        index: number;
        element: HTMLElement;
        scrollTo: Element['scrollIntoView'];
      }) => void;
    };
  };
}

class MessageScroller extends Modifier<MessageScrollerSignature> {
  private hasRegistered = false;
  private observer?: MutationObserver;
  modify(
    element: HTMLElement,
    _positional: [],
    { index, registerScroller }: MessageScrollerSignature['Args']['Named'],
  ) {
    if (!this.hasRegistered) {
      this.hasRegistered = true;
      registerScroller({
        index,
        element,
        scrollTo: element.scrollIntoView.bind(element),
      });
    }

    this.observer?.disconnect();

    this.observer = new MutationObserver(() => {
      registerScroller({
        index,
        element,
        scrollTo: element.scrollIntoView.bind(element),
      });
    });
    this.observer.observe(element, { childList: true, subtree: true });

    registerDestructor(this, () => {
      this.observer?.disconnect();
    });
  }
}

interface ScrollPositionSignature {
  Args: {
    Named: {
      setScrollPosition: (args: { isBottom: boolean }) => void;
      registerConversationScroller: (
        isScrollable: () => boolean,
        scrollToBottom: () => void,
      ) => void;
    };
  };
}

// an amount of pixels from the bottom of the element that we would consider to
// be scrolled "all the way down"
export const BOTTOM_THRESHOLD = 50;
class ScrollPosition extends Modifier<ScrollPositionSignature> {
  private hasRegistered = false;
  modify(
    element: HTMLElement,
    _positional: [],
    {
      setScrollPosition,
      registerConversationScroller,
    }: ScrollPositionSignature['Args']['Named'],
  ) {
    if (!this.hasRegistered) {
      this.hasRegistered = true;
      registerConversationScroller(
        () => element.scrollHeight > element.clientHeight,
        () => {
          element.scrollTop = element.scrollHeight - element.clientHeight;
        },
      );
    }

    let detectPosition = throttle(() => {
      let isBottom =
        Math.abs(
          element.scrollHeight - element.clientHeight - element.scrollTop,
        ) <= BOTTOM_THRESHOLD;
      setScrollPosition({ isBottom });
    }, 500);
    element.addEventListener('scroll', detectPosition);
    registerDestructor(this, () =>
      element.removeEventListener('scroll', detectPosition),
    );
  }
}

function isThinkingMessage(s: string | null | undefined) {
  if (!s) {
    return false;
  }
  return s.trim() === 'Thinking...';
}

function isPresent(val: SafeString | string | null | undefined) {
  if (val?.toString) {
    val = val?.toString().trim();
  }
  return val ? val !== '' : false;
}

function collectionResourceError(id: string | null | undefined) {
  return 'Cannot render ' + id;
}

export default class AiAssistantMessage extends Component<Signature> {
  @service private declare matrixService: MatrixService;

  private get isReasoningExpandedByDefault() {
    let result =
      this.args.isStreaming &&
      !isPresent(this.args.messageHTML) &&
      isPresent(this.args.reasoningContent) &&
      !isThinkingMessage(this.args.reasoningContent);
    return result;
  }
  private get isReasoningExpanded() {
    return (
      this.matrixService.reasoningExpandedState.get(this.args.eventId) ??
      this.isReasoningExpandedByDefault
    );
  }
  private updateReasoningExpanded = (ev: MouseEvent | KeyboardEvent) => {
    ev.preventDefault();
    this.matrixService.reasoningExpandedState.set(
      this.args.eventId,
      !this.isReasoningExpanded,
    );
  };

  @action
  private async downloadFile(file: FileDef) {
    try {
      await this.matrixService.downloadAsFileInBrowser(file);
    } catch (error) {
      console.error('Error downloading file:', error);
    }
  }

  <template>
    <section
      class={{cn 'ai-assistant-message' meta-hidden=@hideMeta}}
      {{MessageScroller index=@index registerScroller=@registerScroller}}
      data-test-ai-assistant-message
      data-test-ai-assistant-message-pending={{@isPending}}
      ...attributes
    >
      {{#unless @hideMeta}}
        <Meta
          @datetime={{@datetime}}
          @isFromAssistant={{@isFromAssistant}}
          @profileAvatar={{@profileAvatar}}
          @isAvatarAnimated={{this.isAvatarAnimated}}
        />
      {{/unless}}
      <div class='content' data-test-ai-message-content>
        {{#if @isFromAssistant}}
          <AiBotMessage
            @monacoSDK={{@monacoSDK}}
            @htmlParts={{@messageHTMLParts}}
            @roomId={{@roomId}}
            @eventId={{@eventId}}
            @isStreaming={{@isStreaming}}
            @isLastAssistantMessage={{@isLastAssistantMessage}}
            @reasoning={{if
              @reasoningContent
              (hash
                content=@reasoningContent
                isExpanded=this.isReasoningExpanded
                updateExpanded=this.updateReasoningExpanded
              )
            }}
          />
          {{#if this.hasItems}}
            <Attachments
              @items={{this.items}}
              @downloadFile={{if @isDebugMessage this.downloadFile}}
            />
          {{/if}}
        {{else}}
          <UserMessage @html={{@messageHTML}} @isPending={{@isPending}}>
            {{#if this.hasItems}}
              <Attachments
                @items={{this.items}}
                @downloadFile={{if @isDebugMessage this.downloadFile}}
              />
            {{/if}}
          </UserMessage>
        {{/if}}

        {{yield}}

        {{#if this.errorMessages.length}}
          <Alert
            @type='error'
            @messages={{this.errorMessages}}
            @retryAction={{@retryAction}}
          />
        {{/if}}
      </div>
    </section>

    <style scoped>
      .ai-assistant-message {
        --ai-bot-message-background-color: var(--boxel-650);
        --ai-assistant-message-avatar-size: 0.75rem; /* 12px. */
        --ai-assistant-message-meta-height: 0.75rem; /* 12px */
        --ai-assistant-message-gap: var(--boxel-sp-xxxs);
        --profile-avatar-icon-size: var(--ai-assistant-message-avatar-size);
        --profile-avatar-icon-border: 1px solid var(--boxel-400);
      }
      .ai-assistant-message > * + * {
        margin-top: var(--boxel-sp-xs);
      }
      .content {
        overflow: hidden;
      }
      .content > :deep(* + *) {
        margin-top: var(--boxel-sp-sm);
      }
      :deep(pre) {
        white-space: pre-wrap;
      }
      :deep(code) {
        overflow-wrap: break-word;
      }
    </style>
  </template>

  private get isAvatarAnimated() {
    return this.args.isStreaming && !this.args.errorMessage;
  }

  private get hasItems() {
    return (
      (this.args.files && this.args.files.length > 0) ||
      (this.args.collectionResource &&
        (this.args.collectionResource.cards.length > 0 ||
          this.args.collectionResource.cardErrors.length > 0))
    );
  }

  private get items() {
    return [
      ...(this.args.collectionResource ? [this.args.collectionResource] : []),
      ...(this.args.files ?? []),
    ];
  }

  private get errorMessages() {
    return [
      ...(this.args.errorMessage ? [this.args.errorMessage] : []),
      ...(this.args.collectionResource?.cardErrors.map((error) =>
        collectionResourceError(error.id),
      ) ?? []),
    ];
  }
}

interface AiAssistantConversationSignature {
  Element: HTMLDivElement;
  Args: {
    setScrollPosition: (args: { isBottom: boolean }) => void;
    registerConversationScroller: (
      isScrollable: () => boolean,
      scrollToBottom: () => void,
    ) => void;
  };
  Blocks: {
    default: [];
  };
}

const AiAssistantConversation: TemplateOnlyComponent<AiAssistantConversationSignature> =
  <template>
    <section
      {{ScrollPosition
        setScrollPosition=@setScrollPosition
        registerConversationScroller=@registerConversationScroller
      }}
      class='ai-assistant-conversation'
      tabindex='0'
      aria-label='AI Bot conversation'
      aria-live='polite'
      data-test-ai-assistant-conversation
    >
      {{yield}}
    </section>
    <style scoped>
      .ai-assistant-conversation {
        display: flex;
        flex-direction: column;
        padding: 0 var(--ai-assistant-panel-padding)
          calc(
            var(--ai-assistant-panel-padding) +
              var(--chat-input-area-border-radius) +
              var(--ai-assistant-panel-bottom-gradient-height)
          )
          var(--ai-assistant-panel-padding);
        overflow-y: auto;

        /* This lets the conversation be visible in the missing border radius of the form, with its gradient */
        margin-bottom: calc(var(--chat-input-area-border-radius) * -1);
      }
      .ai-assistant-conversation > :deep(* + *) {
        margin-top: var(--boxel-sp-lg);
      }
      .ai-assistant-conversation > :deep(* + .meta-hidden) {
        margin-top: var(--boxel-sp-xs);
      }
    </style>
  </template>;

export { AiAssistantConversation };
