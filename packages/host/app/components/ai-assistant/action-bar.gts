import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import ArrowDownIcon from '@cardstack/boxel-icons/arrow-down';

import { BoxelButton, LoadingIndicator } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';

interface Signature {
  Args: {
    acceptAll: () => void;
    cancel: () => void;
    acceptingAll: boolean;
    acceptingAllLabel?: string;
    generatingResults: boolean;
    stop: () => void;
    stopping: boolean;
    showUnreadIndicator: boolean;
    unreadMessageText: string;
    scrollToFirstUnread: () => void;
  };
}

export default class AiAssistantActionBar extends Component<Signature> {
  @action
  private stop() {
    this.args.stop?.();
  }

  <template>
    <div
      class={{cn
        'ai-assistant-action-bar'
        unread-indicator=@showUnreadIndicator
      }}
      data-test-ai-assistant-action-bar
    >
      {{#if @showUnreadIndicator}}
        <BoxelButton
          @kind='primary'
          class='unread-btn'
          {{on 'click' @scrollToFirstUnread}}
          data-test-unread-messages-button
        >
          {{@unreadMessageText}}
          <ArrowDownIcon class='unread-btn__icon' />
        </BoxelButton>
      {{else if @generatingResults}}
        <div class='generating-results-container'>
          <span class='generating-results'>
            Generating results<span class='dot'>.</span><span
              class='dot'
            >.</span><span class='dot'>.</span>
          </span>
          <BoxelButton
            @kind='primary'
            @disabled={{@stopping}}
            class='stop-btn'
            {{on 'click' this.stop}}
            data-test-stop-generating
          >Stop</BoxelButton>
        </div>
      {{else if @acceptingAll}}
        <span class='accepting-all'>
          <LoadingIndicator />
          {{if @acceptingAllLabel @acceptingAllLabel 'Apply Diff'}}
        </span>
      {{else}}
        <BoxelButton
          @kind='primary'
          @disabled={{@acceptingAll}}
          class='action-btn'
          data-test-accept-all
          {{on 'click' @acceptAll}}
        >Accept All</BoxelButton>
        <BoxelButton
          @kind='secondary-dark'
          @disabled={{@acceptingAll}}
          class='action-btn cancel-btn'
          data-test-cancel
          {{on 'click' @cancel}}
        >Cancel</BoxelButton>
      {{/if}}
    </div>

    <style scoped>
      .ai-assistant-action-bar {
        background-color: #3b394b;
        display: flex;
        gap: var(--boxel-sp-sm);
        padding: 10px 13px;
        padding-bottom: calc(10px + var(--boxel-sp-xs));
        margin-bottom: calc(-1 * var(--boxel-sp-xs));
        border-top-right-radius: var(--boxel-border-radius-lg);
        border-top-left-radius: var(--boxel-border-radius-lg);
        align-items: center;
        border: 1px solid #777;
      }
      .ai-assistant-action-bar.unread-indicator {
        padding: 0;
        padding-bottom: var(--boxel-sp-xs);
      }
      .action-btn {
        flex: 1;
        --boxel-button-font: 600 var(--boxel-font-xs);
        --boxel-button-min-height: 0;
        --boxel-button-min-width: 0;
      }
      .cancel-btn {
        --boxel-button-text-color: var(--boxel-light);
      }
      .accepting-all {
        font: 600 var(--boxel-font-sm);
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        letter-spacing: 0.2px;
        --icon-color: var(--boxel-teal);
      }
      .generating-results-container {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        width: 100%;
      }
      .generating-results {
        font: 600 var(--boxel-font-sm);
        display: flex;
        align-items: center;
        gap: 2px;
        letter-spacing: 0.2px;
      }
      .generating-results .dot {
        animation: blink 1.4s infinite both;
        opacity: 0.5;
      }
      .generating-results .dot:nth-child(2) {
        animation-delay: 0.2s;
      }
      .generating-results .dot:nth-child(3) {
        animation-delay: 0.4s;
      }
      @keyframes blink {
        0%,
        80%,
        100% {
          opacity: 0.5;
        }
        40% {
          opacity: 1;
        }
      }
      .stop-btn {
        --boxel-button-font: 600 var(--boxel-font-xs);
        --boxel-button-min-height: 0;
        --boxel-button-min-width: 0;
        --boxel-button-padding: 4px 12px;
      }
      .unread-btn {
        --boxel-button-font: 600 var(--boxel-font-sm);
        --boxel-button-padding: 10px 13px;
        --boxel-button-text-color: var(--boxel-teal);
        --boxel-button-color: transparent;
        --boxel-button-border: none;
        width: 100%;
        display: flex;
        justify-content: space-between;
      }
      .unread-btn__icon {
        height: 18px;
        width: 18px;
      }
    </style>
  </template>
}
