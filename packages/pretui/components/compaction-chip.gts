// Pretui — CompactionChip: a marker that earlier context was compacted, expandable to what was kept.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { Spinner } from './spinner';
import { Collapse } from '../internal/agentic-chat';

// ── CompactionChip ───────────────────────────────────────────────────────
// Compaction is the moment a session quietly loses its history. The law the
// spec states is that it must be *rendered* — a transcript that silently
// forgets is a transcript the reader cannot reason about. So: a marker in
// the stream while it runs, and a receipt afterwards that expands to the
// written summary of what was condensed.
//
// The counts are caller data and are rendered as text beside the label, not
// only as a tooltip, so the receipt survives the screenshot test.

export interface CompactionChipSignature {
  Args: {
    /** 'running' while compacting, 'done' once the summary exists */
    state?: 'running' | 'done';
    /** label while running (default 'Compacting long history') */
    runningLabel?: string;
    /** label once settled (default 'History compacted') */
    doneLabel?: string;
    /** how many messages were condensed */
    messageCount?: number;
    /** how many tool calls were condensed */
    toolCallCount?: number;
    /** the written summary; without one, the chip does not offer to expand */
    summary?: string;
    /** starting disclosure state when uncontrolled */
    defaultExpanded?: boolean;
    /** controlled disclosure state */
    expanded?: boolean;
    /** fires with the requested disclosure state */
    onExpandedChange?: (expanded: boolean) => void;
  };
  Blocks: {
    /** rich summary content, replacing the `@summary` string */
    summary: [];
  };
  Element: HTMLDivElement;
}

export class CompactionChip extends Component<CompactionChipSignature> {
  @tracked private innerExpanded?: boolean;

  private panelId = guidFor(this) + '-summary';

  get state(): 'running' | 'done' {
    return this.args.state ?? 'done';
  }
  get running(): boolean {
    return this.state === 'running';
  }
  get label(): string {
    return this.running
      ? (this.args.runningLabel ?? 'Compacting long history')
      : (this.args.doneLabel ?? 'History compacted');
  }
  /** the condensed-counts line, assembled as text so it reads in greyscale */
  get counts(): string | undefined {
    let parts: string[] = [];
    let messages = this.args.messageCount;
    let calls = this.args.toolCallCount;
    if (messages !== undefined) {
      parts.push(messages + (messages === 1 ? ' message' : ' messages'));
    }
    if (calls !== undefined) {
      parts.push(calls + (calls === 1 ? ' tool call' : ' tool calls'));
    }
    return parts.length ? parts.join(' · ') + ' condensed' : undefined;
  }
  get expandable(): boolean {
    return !this.running;
  }
  get expanded(): boolean {
    return (
      this.args.expanded ?? this.innerExpanded ?? this.args.defaultExpanded ?? false
    );
  }

  toggle = () => {
    let next = !this.expanded;
    if (this.args.expanded === undefined) {
      this.innerExpanded = next;
    }
    this.args.onExpandedChange?.(next);
  };

  <template>
    <div
      class='pretui-compaction'
      data-state={{this.state}}
      data-test-pretui-compaction-chip
      ...attributes
    >
      <div class='pretui-compaction-marker'>
        <span class='pretui-compaction-rule' aria-hidden='true'></span>
        {{#if this.expandable}}
          <button
            type='button'
            class='pretui-compaction-chip'
            aria-expanded={{if this.expanded 'true' 'false'}}
            aria-controls={{this.panelId}}
            data-test-pretui-compaction-toggle
            {{on 'click' this.toggle}}
          >
            <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
              <path
                d='M4 8h16M7 12h10M10 16h4'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
                stroke-linecap='round'
              />
            </svg>
            <span class='pretui-compaction-label'>{{this.label}}</span>
            {{#if this.counts}}
              <span class='pretui-compaction-counts'>{{this.counts}}</span>
            {{/if}}
            <svg
              class='pretui-compaction-chev'
              viewBox='0 0 24 24'
              aria-hidden='true'
              focusable='false'
            >
              <path
                d='M6 9l6 6 6-6'
                fill='none'
                stroke='currentColor'
                stroke-width='2.2'
                stroke-linecap='round'
                stroke-linejoin='round'
              />
            </svg>
          </button>
        {{else}}
          <span class='pretui-compaction-chip' role='status'>
            <Spinner @size={{11}} />
            <span class='pretui-compaction-label'>{{this.label}}</span>
          </span>
        {{/if}}
        <span class='pretui-compaction-rule' aria-hidden='true'></span>
      </div>

      {{#if this.expandable}}
        <Collapse @open={{this.expanded}} id={{this.panelId}}>
          <div class='pretui-compaction-summary'>
            {{#if (has-block 'summary')}}
              {{yield to='summary'}}
            {{else if @summary}}
              <p>{{@summary}}</p>
            {{else}}
              <p class='pretui-compaction-none'>No written summary was kept for
                this compaction.</p>
            {{/if}}
          </div>
        </Collapse>
      {{/if}}
    </div>

    <style scoped>
      .pretui-compaction {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: var(--text-ui-sm, 11.5px);
      }
      .pretui-compaction-marker {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .pretui-compaction-rule {
        flex: 1;
        height: 1px;
        min-width: 12px;
        background: var(--border);
      }
      .pretui-compaction-chip {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        min-height: 26px;
        padding: 0 10px;
        border: 0;
        border-radius: 999px;
        background: var(--inset, var(--boxel-100));
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
        font: inherit;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
        flex: none;
        max-width: 100%;
      }
      button.pretui-compaction-chip {
        cursor: pointer;
      }
      button.pretui-compaction-chip:hover {
        background: var(--hover, var(--boxel-100));
        color: var(--foreground);
      }
      button.pretui-compaction-chip:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }
      .pretui-compaction-chip > svg {
        width: 13px;
        height: 13px;
        flex: none;
        color: var(--ink-3, var(--boxel-400));
      }
      .pretui-compaction-label {
        font-weight: 500;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pretui-compaction-counts {
        flex: none;
        color: var(--ink-3, var(--boxel-400));
        font-variant-numeric: tabular-nums;
      }
      .pretui-compaction-chev {
        transition: transform 300ms
          var(--pretui-ease-enter, cubic-bezier(0.22, 0.61, 0.25, 1));
      }
      .pretui-compaction-chip[aria-expanded='true'] .pretui-compaction-chev {
        transform: rotate(180deg);
      }
      .pretui-compaction-summary {
        margin: 4px auto 0;
        max-width: 62ch;
        padding: 9px 12px;
        border-radius: 10px;
        background: var(--inset, var(--boxel-100));
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
        color: var(--muted-foreground);
        line-height: 1.6;
      }
      .pretui-compaction-summary p {
        margin: 0;
      }
      .pretui-compaction-none {
        color: var(--ink-3, var(--boxel-400));
        font-style: italic;
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-compaction-chev {
          transition: none;
        }
      }
      @media (any-pointer: coarse) {
        button.pretui-compaction-chip {
          min-height: 44px;
          padding: 0 16px;
        }
      }
    </style>
  </template>
}
