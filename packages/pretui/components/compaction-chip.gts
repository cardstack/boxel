// Pretui — CompactionChip: a marker that earlier context was compacted, expandable to what was kept.
import Component from '@glimmer/component';
import ChevronDownIcon from '@cardstack/boxel-icons/chevron-down';
import ListFilterIcon from '@cardstack/boxel-icons/list-filter';
import XIcon from '@cardstack/boxel-icons/x';
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
    /** 'running' while compacting, 'done' once the summary exists,
     * 'failed' when it could not be made (the history is kept as it was) */
    state?: 'running' | 'done' | 'failed';
    /** label while running (default 'Compacting long history') */
    runningLabel?: string;
    /** label once settled (default 'History compacted') */
    doneLabel?: string;
    /** label when it failed (default 'Could not compact history') */
    failedLabel?: string;
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

  get state(): 'running' | 'done' | 'failed' {
    return this.args.state ?? 'done';
  }
  get running(): boolean {
    return this.state === 'running';
  }
  get failed(): boolean {
    return this.state === 'failed';
  }
  get label(): string {
    if (this.running) {
      return this.args.runningLabel ?? 'Compacting long history';
    }
    if (this.failed) {
      return this.args.failedLabel ?? 'Could not compact history';
    }
    return this.args.doneLabel ?? 'History compacted';
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
    return this.state === 'done';
  }
  get expanded(): boolean {
    return (
      this.args.expanded ??
      this.innerExpanded ??
      this.args.defaultExpanded ??
      false
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
            <ListFilterIcon width='13' height='13' aria-hidden='true' />
            <span class='pretui-compaction-label'>{{this.label}}</span>
            {{#if this.counts}}
              <span class='pretui-compaction-counts'>{{this.counts}}</span>
            {{/if}}
            <ChevronDownIcon
              class='pretui-compaction-chev'
              width='13'
              height='13'
              aria-hidden='true'
            />
          </button>
        {{else}}
          <span class='pretui-compaction-chip' role='status'>
            {{#if this.failed}}
              <XIcon
                class='pretui-compaction-failed'
                width='13'
                height='13'
                aria-hidden='true'
                data-test-pretui-compaction-failed-mark
              />
            {{else}}
              <Spinner @size={{11}} />
            {{/if}}
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
      @layer PretComponent {
        .pretui-compaction {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-4xs);
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
        }
        .pretui-compaction-marker {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        /* a failure colours its mark, not its words. The mark's rule names
           the chip as well, so it outranks the quiet colour every icon in
           the chip takes below */
        .pretui-compaction[data-state='failed'] .pretui-compaction-chip {
          color: var(--foreground);
        }
        .pretui-compaction-chip > .pretui-compaction-failed {
          color: var(--destructive-ink);
        }
        .pretui-compaction-rule {
          flex: 1;
          height: 1px;
          min-width: var(--boxel-sp-sm);
          background-color: var(--border);
        }
        .pretui-compaction-chip {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          min-height: 1.625rem;
          padding: 0 var(--boxel-sp-sm);
          border: 0;
          border-radius: var(--boxel-border-radius-sm);
          background-color: var(--inset);
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
          font-family: inherit;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          color: var(--muted-foreground);
          /* shrinks between its rules, so a narrow panel truncates the
             label instead of pushing the chip past the edge */
          flex: 0 1 auto;
          min-width: 0;
          max-width: 100%;
        }
        button.pretui-compaction-chip {
          cursor: pointer;
        }
        button.pretui-compaction-chip:hover {
          background-color: var(--hover);
          color: var(--foreground);
        }
        button.pretui-compaction-chip:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-compaction-chip > svg {
          flex: none;
          color: var(--subtle-foreground);
        }
        .pretui-compaction-label {
          font-weight: 400;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pretui-compaction-counts {
          flex: none;
          color: var(--subtle-foreground);
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
          margin: var(--boxel-sp-4xs) auto 0;
          max-inline-size: 68ch;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          border-radius: var(--boxel-border-radius-sm);
          background-color: var(--inset);
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
          color: var(--muted-foreground);
        }
        .pretui-compaction-summary p {
          margin: 0;
        }
        .pretui-compaction-none {
          color: var(--subtle-foreground);
          font-style: italic;
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-compaction-chev {
            transition: none;
          }
        }
        @media (any-pointer: coarse) {
          button.pretui-compaction-chip {
            min-height: 2.75rem;
            padding: 0 var(--boxel-sp);
          }
        }
      }
    </style>
  </template>
}
