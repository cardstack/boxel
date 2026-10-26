// Pretui — ComposerCap: the dark cap on the composer's top edge. One status row, what the agent does now; the messages queued behind it; then the box.
import Component from '@glimmer/component';
import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import type { ComponentLike } from '@glint/template';
import ArrowDownIcon from '@cardstack/boxel-icons/arrow-down';
import ChevronDownIcon from '@cardstack/boxel-icons/chevron-down';
import ChevronUpIcon from '@cardstack/boxel-icons/chevron-up';
import ListIcon from '@cardstack/boxel-icons/list';
import PencilIcon from '@cardstack/boxel-icons/pencil';
import PlayerStopIcon from '@cardstack/boxel-icons/player-stop';
import RotateCcwIcon from '@cardstack/boxel-icons/rotate-ccw';
import XIcon from '@cardstack/boxel-icons/x';
import { AgentMark } from './agent-mark';

export type CapTone = 'working' | 'waiting' | 'problem' | 'done' | 'idle';
export type CapButtonKind = 'primary' | 'secondary' | 'quiet' | 'icon';
export type CapGlyph =
  | 'stop'
  | 'retry'
  | 'jump'
  | 'edit'
  | 'remove'
  | 'collapse'
  | 'expand';

export interface CapButtonSignature {
  Args: {
    /** primary is the moment's one action, in solid --primary. Default 'secondary' */
    kind?: CapButtonKind;
    /** a glyph before the words, or alone for kind 'icon' */
    glyph?: CapGlyph;
    /** the click is running: the button holds its size and greys */
    busy?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLButtonElement;
}

/** A button sized for the cap's row: 26 px in the status row, 22 px in a queued row. */
export class CapButton extends Component<CapButtonSignature> {
  <template>
    <button
      type='button'
      class='pretui-cap-button'
      data-kind={{if @kind @kind 'secondary'}}
      data-busy={{if @busy 'true'}}
      aria-busy={{if @busy 'true'}}
      ...attributes
    >{{#if @glyph}}<CapGlyphIcon @glyph={{@glyph}} />{{/if}}{{yield}}</button>
  </template>
}

type CapIcon = ComponentLike<{ Element: SVGSVGElement }>;

/** each glyph is a boxel-icons mark, so the cap draws its icons the way
 * the rest of the kit does and a theme recolours them all */
const CAP_ICONS: Record<CapGlyph, CapIcon> = {
  stop: PlayerStopIcon as CapIcon,
  retry: RotateCcwIcon as CapIcon,
  jump: ArrowDownIcon as CapIcon,
  edit: PencilIcon as CapIcon,
  remove: XIcon as CapIcon,
  collapse: ChevronUpIcon as CapIcon,
  expand: ChevronDownIcon as CapIcon,
};

class CapGlyphIcon extends Component<{ Args: { glyph: CapGlyph } }> {
  get icon(): CapIcon {
    return CAP_ICONS[this.args.glyph];
  }
  <template>
    <this.icon
      class='pretui-cap-glyph'
      data-glyph={{@glyph}}
      width='12'
      height='12'
      aria-hidden='true'
    />
  </template>
}

export interface CapStatusSignature {
  Args: {
    /** what kind of moment: working animates the agent's mark; waiting is the
        attention dot; problem the destructive dot; done the success dot;
        idle the still mark, dimmed. Default 'working' */
    tone?: CapTone;
    /** the status in a few words: "Generating results", "Run 3 tool calls" */
    title: string;
    /** what qualifies it, quieter: "3 calls", "1 of 3" */
    detail?: string;
    /** three breathing dots after the title, for a reply still arriving */
    dots?: boolean;
    /** let the words wrap: an instruction ("You need a minimum of…") */
    wrap?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

/** The cap's one status row. Its actions are the block, right-aligned. */
export class CapStatus extends Component<CapStatusSignature> {
  get tone(): CapTone {
    return this.args.tone ?? 'working';
  }
  get showsMark() {
    return this.tone === 'working' || this.tone === 'idle';
  }
  get working() {
    return this.tone === 'working';
  }
  <template>
    <div
      class='pretui-cap-row pretui-cap-status'
      role='status'
      data-tone={{this.tone}}
      data-wrap={{if @wrap 'true'}}
      data-test-pretui-cap-status={{this.tone}}
      ...attributes
    >
      <span class='pretui-cap-lead' aria-hidden='true'>
        {{#if this.showsMark}}
          <AgentMark @working={{this.working}} @size={{18}} />
        {{else}}
          <span class='pretui-cap-dot'></span>
        {{/if}}
      </span>
      <span class='pretui-cap-text'><span
          class='pretui-cap-title'
        >{{@title}}</span>{{#if @dots}}<span
            class='pretui-cap-dots'
            aria-hidden='true'
          ><span>.</span><span>.</span><span>.</span></span>{{/if}}{{#if
          @detail
        }}<span class='pretui-cap-detail'> · {{@detail}}</span>{{/if}}</span>
      <span class='pretui-cap-actions'>{{yield}}</span>
    </div>
  </template>
}

export interface CapQueuedSignature {
  Args: {
    /** where it stands in line: "Next", "Then" */
    order?: string;
    text: string;
    /** pull it back into the box to change it */
    onEdit?: () => void;
    /** take it out of the queue */
    onRemove?: () => void;
  };
  Element: HTMLDivElement;
}

/** A message waiting behind the running turn, in send order under the status. */
export class CapQueued extends Component<CapQueuedSignature> {
  edit = () => this.args.onEdit?.();
  remove = () => this.args.onRemove?.();
  <template>
    <div
      class='pretui-cap-row pretui-cap-queued'
      data-test-pretui-cap-queued
      ...attributes
    >
      <ListIcon
        class='pretui-cap-lead pretui-cap-glyph'
        width='13'
        height='13'
        aria-hidden='true'
      />
      <span class='pretui-cap-text'>{{#if @order}}<span
            class='pretui-cap-detail'
          >{{@order}} · </span>{{/if}}{{@text}}</span>
      <span class='pretui-cap-actions'>
        {{#if @onEdit}}
          <CapButton
            @kind='icon'
            @glyph='edit'
            aria-label='Edit queued message'
            data-test-pretui-cap-queued-edit
            {{on 'click' this.edit}}
          />
        {{/if}}
        {{#if @onRemove}}
          <CapButton
            @kind='icon'
            @glyph='remove'
            aria-label='Remove queued message'
            data-test-pretui-cap-queued-remove
            {{on 'click' this.remove}}
          />
        {{/if}}
      </span>
    </div>
  </template>
}

export interface CapSectionSignature {
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

/** Room under the status for what belongs to it: a script's plan. */
const CapSection = <template>
  <div class='pretui-cap-section' ...attributes>{{yield}}</div>
</template> satisfies import('@ember/component/template-only').TemplateOnlyComponent<CapSectionSignature>;

export interface ComposerCapSignature {
  Args: {
    /** the group's accessible name. Default 'Assistant status' */
    label?: string;
  };
  Blocks: {
    default: [
      {
        Status: typeof CapStatus;
        Queued: typeof CapQueued;
        Section: typeof CapSection;
        Button: typeof CapButton;
      },
    ];
  };
  Element: HTMLDivElement;
}

/**
 * The dark cap on the composer's top edge. Read down, the panel is a
 * timeline: the transcript (done), the cap's status (now), its queue (next),
 * the box (what you are still writing). One status at a time, the most
 * urgent: a decision, a problem, work, idle.
 */
export class ComposerCap extends Component<ComposerCapSignature> {
  <template>
    <div
      class='pretui-cap'
      role='group'
      aria-label={{if @label @label 'Assistant status'}}
      data-test-pretui-composer-cap
      ...attributes
    >
      {{yield
        (hash
          Status=CapStatus Queued=CapQueued Section=CapSection Button=CapButton
        )
      }}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-cap {
          --pretui-cap-ink: var(--foreground);
          display: flex;
          flex-direction: column;
          margin-inline: var(--pretui-cap-inset, var(--boxel-sp-sm));
          border-radius: var(--boxel-border-radius-lg)
            var(--boxel-border-radius-lg) 0 0;
          background: var(
            --pretui-cap-surface,
            color-mix(in oklch, var(--foreground) 8%, var(--background))
          );
          box-shadow: 0 0 0 1px
            var(--pretui-cap-edge, var(--border-strong, var(--border)));
          color: var(--pretui-cap-ink);
          font-family: var(--font-sans, inherit);
          container: pretui-cap / inline-size;
        }
        /* a narrow cap keeps the moment's primary and drops what it can
           reach another way */
        @container pretui-cap (width < 20rem) {
          .pretui-cap :deep([data-cap-optional]) {
            display: none;
          }
        }
        /* every row is UI size; a queued row is the compact one */
        .pretui-cap :deep(.pretui-cap-row) {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          min-height: 28px;
          padding: 0 var(--boxel-sp-4xs) 0 var(--boxel-sp-xs);
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          font-weight: 400;
          min-width: 0;
        }
        .pretui-cap > :deep(* + *) {
          box-shadow: inset 0 1px 0
            var(--pretui-cap-edge, var(--border-strong, var(--border)));
        }
        /* the status is the row you read first: one step stronger than the
           queue by weight (its title is 600) and height, never by size */
        .pretui-cap :deep(.pretui-cap-status) {
          min-height: 36px;
          padding: 0 var(--boxel-sp-4xs) 0 var(--boxel-sp-xs);
        }
        .pretui-cap :deep(.pretui-cap-status[data-wrap]) {
          align-items: flex-start;
          padding-block: var(--boxel-sp-xs);
        }
        .pretui-cap :deep(.pretui-cap-status[data-wrap] .pretui-cap-lead) {
          margin-top: 0;
        }
        .pretui-cap :deep(.pretui-cap-status[data-wrap] .pretui-cap-actions) {
          margin-top: calc(-1 * var(--boxel-sp-4xs));
        }
        .pretui-cap :deep(.pretui-cap-lead) {
          flex: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
        }
        .pretui-cap :deep(.pretui-cap-queued .pretui-cap-lead) {
          width: 16px;
          height: 16px;
          color: var(--subtle-foreground);
        }
        .pretui-cap
          :deep(.pretui-cap-status[data-tone='idle'] .pretui-cap-lead) {
          opacity: 0.55;
        }
        .pretui-cap :deep(.pretui-cap-dot) {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: currentColor;
          box-shadow: 0 0 0 3px
            color-mix(in oklch, currentColor 20%, transparent);
          transition: color 160ms ease;
        }
        /* a state colours the mark only: waiting on you is attention, a
           problem is failed, done and live work are live */
        .pretui-cap
          :deep(.pretui-cap-status[data-tone='waiting'] .pretui-cap-lead) {
          color: var(--attention-ink);
        }
        .pretui-cap
          :deep(.pretui-cap-status[data-tone='problem'] .pretui-cap-lead) {
          color: var(--destructive-ink);
        }
        .pretui-cap
          :deep(.pretui-cap-status[data-tone='done'] .pretui-cap-lead) {
          color: var(--primary-ink);
        }
        /* the title holds its words; the detail gives way first */
        .pretui-cap :deep(.pretui-cap-text) {
          flex: 1 1 auto;
          display: flex;
          align-items: baseline;
          min-width: 0;
          overflow: hidden;
          white-space: nowrap;
        }
        .pretui-cap :deep(.pretui-cap-title) {
          flex: 0 1 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pretui-cap :deep(.pretui-cap-dots) {
          flex: none;
        }
        .pretui-cap :deep(.pretui-cap-text > .pretui-cap-detail) {
          flex: 0 4 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: pre;
        }
        .pretui-cap :deep(.pretui-cap-status[data-wrap] .pretui-cap-text) {
          display: block;
          white-space: normal;
          overflow-wrap: anywhere;
          color: var(--muted-foreground);
        }
        .pretui-cap :deep(.pretui-cap-status[data-wrap] .pretui-cap-title) {
          font-weight: 400;
        }
        .pretui-cap :deep(.pretui-cap-title) {
          font-weight: 600;
        }
        .pretui-cap :deep(.pretui-cap-queued .pretui-cap-text) {
          color: var(--muted-foreground);
        }
        .pretui-cap :deep(.pretui-cap-detail) {
          color: var(--muted-foreground);
          font-weight: 400;
          font-variant-numeric: tabular-nums;
        }
        .pretui-cap :deep(.pretui-cap-dots span) {
          animation: pretui-cap-blink 1.4s infinite both;
          opacity: 0.4;
        }
        .pretui-cap :deep(.pretui-cap-dots span:nth-child(2)) {
          animation-delay: 0.2s;
        }
        .pretui-cap :deep(.pretui-cap-dots span:nth-child(3)) {
          animation-delay: 0.4s;
        }
        @keyframes pretui-cap-blink {
          0%,
          80%,
          100% {
            opacity: 0.4;
          }
          40% {
            opacity: 1;
          }
        }
        .pretui-cap :deep(.pretui-cap-actions) {
          flex: none;
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
        }
        .pretui-cap :deep(.pretui-cap-actions:empty) {
          display: none;
        }
        .pretui-cap :deep(.pretui-cap-section) {
          padding: var(--boxel-sp-4xs) var(--boxel-sp-sm) var(--boxel-sp-xs)
            var(--boxel-sp-xl);
        }
        .pretui-cap :deep(.pretui-cap-button) {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: var(--boxel-sp-4xs);
          height: 24px;
          min-width: 24px;
          padding: 0 var(--boxel-sp-xs);
          border: 0;
          border-radius: var(--boxel-border-radius-sm);
          background: none;
          color: var(--muted-foreground);
          font-family: var(--font-sans, inherit);
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          font-weight: 600;
          white-space: nowrap;
          cursor: pointer;
        }
        .pretui-cap :deep(.pretui-cap-status .pretui-cap-button) {
          height: 28px;
          min-width: 28px;
          padding: 0 var(--boxel-sp-sm);
        }
        .pretui-cap
          :deep(.pretui-cap-status .pretui-cap-button[data-kind='icon']) {
          padding: 0;
        }
        .pretui-cap :deep(.pretui-cap-button[data-kind='icon']) {
          padding: 0;
        }
        /* the moment's one action */
        .pretui-cap :deep(.pretui-cap-button[data-kind='primary']) {
          background: var(--primary);
          color: var(--primary-foreground);
        }
        .pretui-cap
          :deep(.pretui-cap-button[data-kind='primary']:hover:not(:disabled)) {
          background: color-mix(
            in oklch,
            var(--primary) 88%,
            var(--pretui-cap-ink)
          );
        }
        .pretui-cap :deep(.pretui-cap-button[data-kind='secondary']) {
          box-shadow: inset 0 0 0 1px var(--border-strong, var(--border));
          color: var(--pretui-cap-ink);
        }
        .pretui-cap :deep(.pretui-cap-button[data-kind='quiet']),
        .pretui-cap :deep(.pretui-cap-button[data-kind='icon']) {
          color: var(--muted-foreground);
        }
        .pretui-cap
          :deep(.pretui-cap-button[data-kind='quiet']:hover:not(:disabled)),
        .pretui-cap
          :deep(.pretui-cap-button[data-kind='icon']:hover:not(:disabled)) {
          color: var(--pretui-cap-ink);
          background: color-mix(
            in oklch,
            var(--pretui-cap-ink) 8%,
            transparent
          );
        }
        .pretui-cap :deep(.pretui-cap-button:disabled),
        .pretui-cap :deep(.pretui-cap-button[data-busy]) {
          cursor: default;
          background: color-mix(
            in oklch,
            var(--pretui-cap-ink) 10%,
            transparent
          );
          color: var(--subtle-foreground);
          box-shadow: none;
        }
        .pretui-cap :deep(.pretui-cap-button:focus-visible) {
          outline: 2px solid var(--ring, var(--primary));
          outline-offset: 1px;
        }
        .pretui-cap :deep(.pretui-cap-glyph) {
          width: 12px;
          height: 12px;
          flex: none;
        }
        .pretui-cap
          :deep(.pretui-cap-status .pretui-cap-button .pretui-cap-glyph) {
          width: 13px;
          height: 13px;
        }
        .pretui-cap :deep(.pretui-cap-queued > .pretui-cap-glyph) {
          width: 13px;
          height: 13px;
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-cap :deep(.pretui-cap-dots span) {
            animation: none;
            opacity: 0.7;
          }
        }
      }
    </style>
  </template>
}
