// Pretui — Thinking: the agent reasoning trace, folded to a rail once settled.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import CheckIcon from '@cardstack/boxel-icons/check';
import ChevronDownIcon from '@cardstack/boxel-icons/chevron-down';
import SearchIcon from '@cardstack/boxel-icons/search';
import SparklesIcon from '@cardstack/boxel-icons/sparkles';
import { Spinner } from './spinner';
import { cssStyleFrom } from '../pretui-css';
import { Collapse } from '../internal/agentic-chat';

// ── Thinking ─────────────────────────────────────────────────────────────
// The reasoning-trace rail. Collapsed, it is one quiet line; open, it is the
// ordered list of what the agent looked at, with the diff counts for the
// rows that changed something.
//
// The label is the component's only piece of theatre and it is a deliberate
// one under Law 5: a shimmer that runs while `@working` is the state
// transition "this is still going", and it stops — permanently — the moment
// the settled label replaces it. It is a CSS background sweep, not a frame
// loop, and `prefers-reduced-motion` lands it on the plain label.
//
// The elapsed time in `@doneLabel` is a caller string on purpose. A kit
// component that computed it would need `Date.now()`, which is forbidden in
// a realm and wrong anyway — the number belongs to the run, not to the
// render.

export interface ThinkingRow {
  /** stable id — the {{#each}} key */
  id: string;
  /** the row's main text */
  primary: string;
  /** running shows a spinner, done shows a check, omit for a plain row */
  state?: 'running' | 'done';
  /** right-aligned secondary, e.g. a file path or a match count */
  secondary?: string;
  /** render `secondary` as a machine value (Law 3) */
  mono?: boolean;
  /** added lines, for a row that touched code */
  add?: number;
  /** removed lines */
  del?: number;
  /** a prose reasoning row: wraps, quieter, normal weight */
  wrap?: boolean;
}

export interface ThinkingSignature {
  Args: {
    /** the shimmering label while `@working` (default 'Thinking') */
    label?: string;
    /** the settled label, e.g. 'Thought for 4 seconds' (default 'Done') */
    doneLabel?: string;
    /** the trace is still being produced */
    working?: boolean;
    /** the trace itself */
    rows?: ThinkingRow[];
    /** a search-trace query line pinned above the rows */
    query?: string;
    /** starting disclosure state when uncontrolled; defaults to `@working` */
    defaultExpanded?: boolean;
    /** controlled disclosure state */
    expanded?: boolean;
    /** fires with the requested disclosure state */
    onExpandedChange?: (expanded: boolean) => void;
  };
  Blocks: {
    /** extra content appended inside the rail, below the rows */
    default: [];
  };
  Element: HTMLDivElement;
}

export class Thinking extends Component<ThinkingSignature> {
  @tracked private innerExpanded?: boolean;

  private panelId = guidFor(this) + '-trace';

  get expanded(): boolean {
    return (
      this.args.expanded ??
      this.innerExpanded ??
      this.args.defaultExpanded ??
      this.args.working ??
      false
    );
  }
  get label(): string {
    return this.args.label ?? 'Thinking';
  }
  get doneLabel(): string {
    return this.args.doneLabel ?? 'Done';
  }
  get working(): boolean {
    return this.args.working ?? false;
  }
  get rows(): (ThinkingRow & {
    style: ReturnType<typeof cssStyleFrom>;
    hasDiff: boolean;
    isRunning: boolean;
    isDone: boolean;
    addText: string;
    delText: string;
  })[] {
    return (this.args.rows ?? []).map((row, index) => ({
      ...row,
      hasDiff: row.add !== undefined || row.del !== undefined,
      isRunning: row.state === 'running',
      isDone: row.state === 'done',
      addText: '+' + (row.add ?? 0),
      delText: '\u2212' + (row.del ?? 0),
      // precomputed stagger: a number we formatted, never a caller string
      style: cssStyleFrom(['--pretui-trace-delay: ' + index * 90 + 'ms']),
    }));
  }

  toggle = () => {
    let next = !this.expanded;
    if (this.args.expanded === undefined) {
      this.innerExpanded = next;
    }
    this.args.onExpandedChange?.(next);
  };

  <template>
    <div class='pretui-trace' data-test-pretui-thinking ...attributes>
      <button
        type='button'
        class='pretui-trace-head'
        data-working={{if this.working 'true'}}
        aria-expanded={{if this.expanded 'true' 'false'}}
        aria-controls={{this.panelId}}
        data-test-pretui-thinking-toggle
        {{on 'click' this.toggle}}
      >
        <SparklesIcon
          class='pretui-trace-spark'
          width='15'
          height='15'
          aria-hidden='true'
        />
        {{#if this.working}}
          <span
            class='pretui-trace-label'
            data-shimmer='true'
          >{{this.label}}</span>
        {{else}}
          <span class='pretui-trace-label'>{{this.doneLabel}}</span>
        {{/if}}
        <ChevronDownIcon
          class='pretui-trace-chev'
          width='14'
          height='14'
          aria-hidden='true'
        />
      </button>
      {{! the state change announces once, politely, from outside the button }}
      <span class='pretui-sr' role='status'>{{if
          this.working
          this.label
          this.doneLabel
        }}</span>

      <Collapse @open={{this.expanded}} id={{this.panelId}}>
        <div class='pretui-trace-rail' data-open={{if this.expanded 'true'}}>
          {{#if @query}}
            <div class='pretui-trace-row' data-kind='query'>
              <SearchIcon width='13' height='13' aria-hidden='true' />
              <span class='pretui-trace-primary'>{{@query}}</span>
            </div>
          {{/if}}
          {{#each this.rows key='id' as |row|}}
            <div class='pretui-trace-row' style={{row.style}}>
              {{#if row.isRunning}}
                <Spinner @size={{11}} />
              {{else if row.isDone}}
                <CheckIcon
                  class='pretui-trace-check'
                  width='13'
                  height='13'
                  aria-hidden='true'
                />
              {{/if}}
              <span
                class='pretui-trace-primary'
                data-wrap={{if row.wrap 'true'}}
              >{{row.primary}}</span>
              {{#if row.secondary}}
                <span
                  class='pretui-trace-sec'
                  data-mono={{if row.mono 'true'}}
                >{{row.secondary}}</span>
              {{/if}}
              {{#if row.hasDiff}}
                <span class='pretui-trace-diff'>
                  <span class='pretui-trace-add'>{{row.addText}}</span>
                  <span class='pretui-trace-del'>{{row.delText}}</span>
                </span>
              {{/if}}
            </div>
          {{/each}}
          {{yield}}
        </div>
      </Collapse>
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-trace {
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
        }
        .pretui-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
        .pretui-trace-head {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          min-height: 1.75rem;
          padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
          margin: calc(-1 * var(--boxel-sp-4xs)) calc(-1 * var(--boxel-sp-xs));
          border: 0;
          border-radius: var(--boxel-border-radius-sm);
          background-color: transparent;
          font-family: inherit;
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .pretui-trace-head:hover {
          background-color: var(--hover);
        }
        .pretui-trace-head:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-trace-spark {
          flex: none;
          color: var(--subtle-foreground);
        }
        .pretui-trace-head[data-working] .pretui-trace-spark {
          color: var(--muted-foreground);
        }
        .pretui-trace-label {
          font-weight: 600;
        }
        /* Law 5: the sweep says "still going" and nothing else animates */
        .pretui-trace-label[data-shimmer] {
          background: linear-gradient(
            100deg,
            var(--muted-foreground) 30%,
            var(--foreground) 48%,
            var(--muted-foreground) 66%
          );
          background-size: 300% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: pretui-trace-shimmer 2.2s linear infinite;
        }
        @keyframes pretui-trace-shimmer {
          from {
            background-position: 150% 0;
          }
          to {
            background-position: -150% 0;
          }
        }
        .pretui-trace-chev {
          flex: none;
          color: var(--subtle-foreground);
          transition: transform 300ms
            var(--pretui-ease-enter, cubic-bezier(0.22, 0.61, 0.25, 1));
        }
        .pretui-trace-head[aria-expanded='true'] .pretui-trace-chev {
          transform: rotate(180deg);
        }
        .pretui-trace-rail {
          position: relative;
          margin: var(--boxel-sp-3xs) 0 0 var(--boxel-sp-3xs);
          padding-left: var(--boxel-sp);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-6xs);
        }
        .pretui-trace-rail::before {
          content: '';
          position: absolute;
          left: var(--boxel-sp-5xs);
          top: var(--boxel-sp-4xs);
          bottom: var(--boxel-sp-3xs);
          width: 1px;
          background-color: var(--border);
        }
        .pretui-trace-row {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          min-height: 1.625rem;
          padding: var(--boxel-sp-6xs) var(--boxel-sp-xs);
          border-radius: var(--boxel-border-radius-sm);
          color: var(--foreground);
        }
        .pretui-trace-row:hover {
          background-color: var(--hover);
        }
        .pretui-trace-row[data-kind='query'] {
          color: var(--muted-foreground);
        }
        .pretui-trace-row > svg {
          flex: none;
        }
        .pretui-trace-check {
          color: var(--subtle-foreground);
        }
        .pretui-trace-primary {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 400;
        }
        .pretui-trace-primary[data-wrap] {
          white-space: normal;
          color: var(--muted-foreground);
        }
        .pretui-trace-sec {
          margin-left: auto;
          flex: none;
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-variant-numeric: tabular-nums;
          color: var(--subtle-foreground);
        }
        /* a machine value is a pasteable string: mono at the data size */
        .pretui-trace-sec[data-mono] {
          font-family: var(--font-mono);
          font-size: var(--boxel-font-size-xs);
          line-height: var(--boxel-line-height-xs);
        }
        /* the counts are figures, not strings to paste: sans, tabular */
        .pretui-trace-diff {
          flex: none;
          display: inline-flex;
          gap: var(--boxel-sp-4xs);
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          font-variant-numeric: tabular-nums;
        }
        .pretui-trace-add {
          color: var(--success-ink);
        }
        .pretui-trace-del {
          color: var(--destructive-ink);
        }
        /* the stagger is a precomputed delay, retriggered by the open flip.
           The flag lives on the rail, not on Collapse's own element: a
           scoped stylesheet may only address elements authored in ITS template,
           so reaching into a child component's markup would silently match
           nothing (and `:deep()` is not allowed in the kit). */
        .pretui-trace-rail[data-open] .pretui-trace-row {
          animation: pretui-trace-in 320ms
            var(--pretui-ease-enter, cubic-bezier(0.22, 0.61, 0.25, 1))
            var(--pretui-trace-delay, 0ms) both;
        }
        @keyframes pretui-trace-in {
          from {
            opacity: 0;
            transform: translateY(var(--boxel-sp-4xs));
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-trace-label[data-shimmer] {
            animation: none;
            background-image: none;
            -webkit-background-clip: border-box;
            background-clip: border-box;
            color: var(--foreground);
          }
          .pretui-trace-chev {
            transition: none;
          }
          .pretui-trace-rail[data-open] .pretui-trace-row {
            animation: none;
          }
        }
      }
    </style>
  </template>
}
