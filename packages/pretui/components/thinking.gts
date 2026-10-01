// Pretui — Thinking: the agent reasoning trace, folded to a rail once settled.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
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
        <svg
          class='pretui-trace-spark'
          viewBox='0 0 24 24'
          aria-hidden='true'
          focusable='false'
        >
          <path d='M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z' />
        </svg>
        {{#if this.working}}
          <span class='pretui-trace-label' data-shimmer='true'
          >{{this.label}}</span>
        {{else}}
          <span class='pretui-trace-label'>{{this.doneLabel}}</span>
        {{/if}}
        <svg
          class='pretui-trace-chev'
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
              <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
                <circle
                  cx='11'
                  cy='11'
                  r='7'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                />
                <path
                  d='M21 21l-4.3-4.3'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                  stroke-linecap='round'
                />
              </svg>
              <span class='pretui-trace-primary'>{{@query}}</span>
            </div>
          {{/if}}
          {{#each this.rows key='id' as |row|}}
            <div class='pretui-trace-row' style={{row.style}}>
              {{#if row.isRunning}}
                <Spinner @size={{11}} />
              {{else if row.isDone}}
                <svg
                  class='pretui-trace-check'
                  viewBox='0 0 24 24'
                  aria-hidden='true'
                  focusable='false'
                >
                  <path
                    d='M20 6L9 17l-5-5'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2.5'
                    stroke-linecap='round'
                    stroke-linejoin='round'
                  />
                </svg>
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
          font-size: var(--text-ui-md, 12.5px);
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
          gap: 8px;
          min-height: 28px;
          padding: 4px 6px;
          margin: -4px -6px;
          border: 0;
          border-radius: 8px;
          background: none;
          font: inherit;
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .pretui-trace-head:hover {
          background: var(--hover, var(--boxel-100));
        }
        .pretui-trace-head:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-trace-spark {
          width: 15px;
          height: 15px;
          flex: none;
          fill: var(--ink-3, var(--boxel-400));
        }
        .pretui-trace-head[data-working] .pretui-trace-spark {
          fill: var(--muted-foreground);
        }
        .pretui-trace-label {
          font-weight: 500;
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
          width: 14px;
          height: 14px;
          flex: none;
          color: var(--ink-3, var(--boxel-400));
          transition: transform 300ms
            var(--pretui-ease-enter, cubic-bezier(0.22, 0.61, 0.25, 1));
        }
        .pretui-trace-head[aria-expanded='true'] .pretui-trace-chev {
          transform: rotate(180deg);
        }
        .pretui-trace-rail {
          position: relative;
          margin: 6px 0 0 5px;
          padding-left: 16px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .pretui-trace-rail::before {
          content: '';
          position: absolute;
          left: 3px;
          top: 4px;
          bottom: 6px;
          width: 1px;
          background: var(--border);
        }
        .pretui-trace-row {
          display: flex;
          align-items: center;
          gap: 8px;
          min-height: 26px;
          padding: 2px 6px;
          border-radius: 6px;
          color: var(--foreground);
        }
        .pretui-trace-row:hover {
          background: var(--hover, var(--boxel-100));
        }
        .pretui-trace-row[data-kind='query'] {
          color: var(--muted-foreground);
        }
        .pretui-trace-row > svg {
          width: 13px;
          height: 13px;
          flex: none;
        }
        .pretui-trace-check {
          color: var(--ink-3, var(--boxel-400));
        }
        .pretui-trace-primary {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 500;
        }
        .pretui-trace-primary[data-wrap] {
          white-space: normal;
          font-weight: 400;
          line-height: 1.55;
          color: var(--muted-foreground);
        }
        .pretui-trace-sec {
          margin-left: auto;
          flex: none;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--ink-3, var(--boxel-400));
        }
        .pretui-trace-sec[data-mono] {
          font-family: var(--font-mono);
        }
        .pretui-trace-diff {
          flex: none;
          display: inline-flex;
          gap: 6px;
          font-family: var(--font-mono);
          font-size: 11px;
          font-variant-numeric: tabular-nums;
        }
        .pretui-trace-add {
          color: var(--success, var(--boxel-success));
        }
        .pretui-trace-del {
          color: var(--pretui-destructive-ink, var(--boxel-danger));
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
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-trace-label[data-shimmer] {
            animation: none;
            background: none;
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
