// Pretui — MessageActions: the icon bar under a reply: regenerate, rate it, copy it, share it.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import RefreshIcon from '@cardstack/boxel-icons/refresh-cw';
import ThumbUpIcon from '@cardstack/boxel-icons/thumb-up';
import ThumbDownIcon from '@cardstack/boxel-icons/thumb-down';
import ShareIcon from '@cardstack/boxel-icons/share';
import MoreIcon from '@cardstack/boxel-icons/more-horizontal';
import { Popover } from './popover';
import { IconButton } from './icon-button';
import { CopyButton } from './copy-button';

export type MessageFeedback = 'up' | 'down' | undefined;

export interface MessageActionsSignature {
  Args: {
    /** the reply as text, for Copy */
    text: string;
    /** ask again: the reply is regenerated */
    onRetry?: () => void;
    /** the reader's rating, controlled; omit to let the bar hold it */
    feedback?: MessageFeedback;
    /** fires with 'up', 'down', or undefined when a rating is taken back */
    onFeedback?: (feedback: MessageFeedback) => void;
    /** share the reply (a link, the system share sheet) */
    onShare?: () => void;
    /** 'hover' (default): quiet until the reply is hovered or focused, and
     * always shown on a touch screen; 'always': the latest reply's bar,
     * which a host shows in full while older ones stay quiet */
    reveal?: 'hover' | 'always';
    /** the turn is still working: the bar is held back until it settles */
    working?: boolean;
  };
  Blocks: {
    /** a ⋯ overflow for the rarer actions: Copy link, Fork from here,
     * Export as markdown. It yields `close` */
    more: [close: () => void];
  };
  Element: HTMLDivElement;
}

/**
 * ↻ 👍 👎 ⧉ ⇪ under an assistant's reply. Each is a labelled icon button;
 * the two ratings are toggles, one at a time, and pressing the pressed one
 * again takes the rating back. Only the actions given handlers show,
 * except Copy, which every reply has.
 */
export class MessageActions extends Component<MessageActionsSignature> {
  @tracked private innerFeedback: MessageFeedback;
  get feedback(): MessageFeedback {
    return 'feedback' in this.args ? this.args.feedback : this.innerFeedback;
  }
  get isUp() {
    return this.feedback === 'up';
  }
  get isDown() {
    return this.feedback === 'down';
  }
  get rates() {
    return Boolean(this.args.onFeedback) || !('feedback' in this.args);
  }
  private rate(next: 'up' | 'down') {
    let value: MessageFeedback = this.feedback === next ? undefined : next;
    this.innerFeedback = value;
    this.args.onFeedback?.(value);
  }
  up = () => this.rate('up');
  down = () => this.rate('down');
  retry = () => this.args.onRetry?.();
  share = () => this.args.onShare?.();
  <template>
    {{#unless @working}}
    <div
      class='pretui-msgactions'
      role='toolbar'
      aria-label='Reply actions'
      data-reveal={{if @reveal @reveal 'hover'}}
      data-test-pretui-message-actions
      ...attributes
    >
      {{#if @onRetry}}
        <IconButton
          @label='Regenerate'
          @icon={{RefreshIcon}}
          @appearance='plain'
          @size='s'
          data-test-pretui-message-retry
          {{on 'click' this.retry}}
        />
      {{/if}}
      {{#if this.rates}}
        <IconButton
          @label='Good reply'
          @icon={{ThumbUpIcon}}
          @appearance='plain'
          @size='s'
          @pressed={{this.isUp}}
          data-test-pretui-message-up
          {{on 'click' this.up}}
        />
        <IconButton
          @label='Bad reply'
          @icon={{ThumbDownIcon}}
          @appearance='plain'
          @size='s'
          @pressed={{this.isDown}}
          data-test-pretui-message-down
          {{on 'click' this.down}}
        />
      {{/if}}
      <CopyButton
        @text={{@text}}
        @label='Copy reply'
        @appearance='plain'
        @size='s'
        data-test-pretui-message-copy
      />
      {{#if @onShare}}
        <IconButton
          @label='Share'
          @icon={{ShareIcon}}
          @appearance='plain'
          @size='s'
          data-test-pretui-message-share
          {{on 'click' this.share}}
        />
      {{/if}}
      {{#if (has-block 'more')}}
        <Popover @placement='bottom-start' @label='More reply actions'>
          <:trigger as |open toggle|>
            <IconButton
              @label='More'
              @icon={{MoreIcon}}
              @appearance='plain'
              @size='s'
              aria-expanded={{if open 'true' 'false'}}
              data-test-pretui-message-more
              {{on 'click' toggle}}
            />
          </:trigger>
          <:default as |close|>
            <div class='pretui-msgactions-menu' role='menu' data-test-pretui-message-menu>{{yield close to='more'}}</div>
          </:default>
        </Popover>
      {{/if}}
    </div>
    {{/unless}}
    <style scoped>
      @layer PretComponent {
        .pretui-msgactions {
          display: flex;
          align-items: center;
          gap: 2px;
          /* plain-row hang: the first icon's box sits in the gutter */
          margin-inline-start: calc(-1 * var(--step-8, 8px));
          color: var(--ink-3, var(--subtle-foreground, var(--muted-foreground)));
          transition: opacity 160ms
            var(--pretui-ease-enter, cubic-bezier(0.22, 0.61, 0.25, 1));
        }
        .pretui-msgactions :deep(button) {
          color: inherit;
        }
        .pretui-msgactions :deep(button:hover) {
          color: var(--pretui-link, var(--primary));
        }
        /* a rating, once given, stays in the foreground */
        .pretui-msgactions :deep(button[aria-pressed='true']) {
          color: var(--foreground);
        }
        @media (hover: hover) {
          .pretui-msgactions[data-reveal='hover'] {
            opacity: 0.55;
          }
          .pretui-msgactions[data-reveal='hover']:hover,
          .pretui-msgactions[data-reveal='hover']:focus-within {
            opacity: 1;
          }
        }
        .pretui-msgactions-menu {
          display: grid;
          min-width: 180px;
          padding: var(--step-4, 4px);
        }
        .pretui-msgactions-menu :deep(button) {
          display: flex;
          align-items: center;
          width: 100%;
          min-height: 32px;
          padding: 0 var(--step-8, 8px);
          border: 0;
          border-radius: var(--round-row, 8px);
          background: none;
          font: inherit;
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          text-align: start;
          color: var(--foreground);
          cursor: pointer;
        }
        .pretui-msgactions-menu :deep(button:hover) {
          background: var(--hover, var(--inset));
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-msgactions {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
