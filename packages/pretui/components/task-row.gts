// Pretui — TaskRow: one row of an agent work queue, with its receipt.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { Collapse } from '../internal/agentic-chat';
import { cssStyleFrom } from '../pretui-css';

// ── TaskRow ──────────────────────────────────────────────────────────────
// A queue of agent work reads as a list of rows, each one a claim ("Reprice
// the Kandy lots") plus what happened to it. The row is closed by default
// because a settled task has earned quiet; opening it shows the receipt —
// the named sub-results with their figures.
//
// The state is never colour alone: `completed` carries a check glyph AND the
// word, `failed` carries a cross AND the named error, and `pending`/
// `running` carry the queue position inside the ring. In greyscale the row
// still says which of the four it is.

export type TaskRowState = 'pending' | 'running' | 'completed' | 'failed';

export interface TaskRowDetail {
  /** stable id — the {{#each}} key */
  id: string;
  /** what the sub-result is */
  label: string;
  /** its figure, set as a machine value (mono, tabular) */
  meta?: string;
}

export interface TaskRowSignature {
  Args: {
    /** where the task is in its life (default 'pending') */
    state?: TaskRowState;
    /** queue position, shown inside the ring while pending or running */
    index?: number | string;
    /** the claim */
    label: string;
    /** right-side tabular figure, e.g. '7 SKUs' */
    amount?: string;
    /**
     * pill wording. A `failed` row SHOULD pass one and name the error — the
     * default 'Failed' is a placeholder, not an explanation.
     */
    statusText?: string;
    /** the receipt; without any, the row does not offer to open */
    details?: TaskRowDetail[];
    /** starting disclosure state when uncontrolled */
    defaultOpen?: boolean;
    /** controlled disclosure state */
    open?: boolean;
    /** fires with the requested disclosure state */
    onOpenChange?: (open: boolean) => void;
    /** flat list style — no capsule shadow or radius, for dense stacks */
    flat?: boolean;
  };
  Blocks: {
    /** extra receipt content below the detail rows */
    default: [];
  };
  Element: HTMLDivElement;
}

const TASK_STATUS_DEFAULT: Record<TaskRowState, string> = {
  pending: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};


// The row face, extracted so the expandable and non-expandable heads are one
// piece of markup rather than two copies that can drift. It owns its own
// state styling — including the running ring's spin — because a scoped
// stylesheet may only address elements authored in its own template.
interface TaskFaceSignature {
  Args: {
    state: TaskRowState;
    index: string;
    label: string;
    amount?: string;
    statusText: string;
  };
  Element: HTMLSpanElement;
}

class TaskFace extends Component<TaskFaceSignature> {
  get showsRing(): boolean {
    return this.args.state === 'pending' || this.args.state === 'running';
  }
  get isRunning(): boolean {
    return this.args.state === 'running';
  }
  get isCompleted(): boolean {
    return this.args.state === 'completed';
  }
  <template>
    <span class='face' data-state={{@state}} ...attributes>
      <span class='badge'>
        {{#if this.showsRing}}
          <svg class='ring' viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
            <circle cx='12' cy='12' r='11' fill='none' stroke='currentColor' stroke-width='2' class='ring-track' />
            {{#if this.isRunning}}
              <circle cx='12' cy='12' r='11' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-dasharray='19 50' class='ring-arc' />
            {{/if}}
          </svg>
          <span class='index'>{{@index}}</span>
        {{else if this.isCompleted}}
          <span class='disc' data-tone='ok'>
            <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
              <path d='M20 6L9 17l-5-5' fill='none' stroke='currentColor' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round' />
            </svg>
          </span>
        {{else}}
          <span class='disc' data-tone='bad'>
            <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
              <path d='M18 6L6 18M6 6l12 12' fill='none' stroke='currentColor' stroke-width='3.5' stroke-linecap='round' />
            </svg>
          </span>
        {{/if}}
      </span>
      <span class='label'>{{@label}}</span>
      {{#if @amount}}<span class='amount'>{{@amount}}</span>{{/if}}
      <span class='pill' data-state={{@state}}>{{@statusText}}</span>
    </span>
    <style scoped>
      .face {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
        min-width: 0;
      }
      .badge {
        position: relative;
        display: inline-grid;
        place-items: center;
        width: 24px;
        height: 24px;
        flex: none;
      }
      .ring {
        position: absolute;
        inset: 0;
        width: 24px;
        height: 24px;
        color: var(--ink-3, var(--boxel-400));
      }
      .ring-arc {
        color: var(--muted-foreground);
      }
      .face[data-state='running'] .ring {
        animation: pretui-taskrow-spin 1.1s linear infinite;
      }
      @keyframes pretui-taskrow-spin {
        to {
          transform: rotate(360deg);
        }
      }
      .index {
        position: relative;
        font-size: 10.5px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .disc {
        display: inline-grid;
        place-items: center;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        color: var(--pretui-on-neutral, var(--boxel-light));
      }
      .disc[data-tone='ok'] {
        background: var(--success, var(--boxel-success));
      }
      .disc[data-tone='bad'] {
        background: var(--destructive);
      }
      .disc svg {
        width: 12px;
        height: 12px;
      }
      .label {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 500;
      }
      .amount {
        flex: none;
        color: var(--muted-foreground);
        font-variant-numeric: tabular-nums;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        flex: none;
        min-height: 22px;
        padding: 0 9px;
        border-radius: 11px;
        font-size: var(--text-ui-sm, 11.5px);
        font-weight: 500;
        background: var(--inset, var(--boxel-100));
        color: var(--muted-foreground);
      }
      .pill[data-state='completed'] {
        background: color-mix(in oklch, var(--success, var(--boxel-success)) 15%, var(--card));
        color: color-mix(in oklch, var(--foreground) 16%, var(--success, var(--boxel-success)));
      }
      .pill[data-state='failed'] {
        background: color-mix(in oklch, var(--destructive) 15%, var(--card));
        color: color-mix(in oklch, var(--foreground) 16%, var(--destructive));
      }
      @media (prefers-reduced-motion: reduce) {
        .face[data-state='running'] .ring {
          animation: none;
        }
      }
    </style>
  </template>
}

export class TaskRow extends Component<TaskRowSignature> {
  @tracked private innerOpen?: boolean;

  private panelId = guidFor(this) + '-detail';

  get state(): TaskRowState {
    return this.args.state ?? 'pending';
  }
  get isRunning(): boolean {
    return this.state === 'running';
  }
  get isCompleted(): boolean {
    return this.state === 'completed';
  }
  get isFailed(): boolean {
    return this.state === 'failed';
  }
  get showsRing(): boolean {
    return !this.isCompleted && !this.isFailed;
  }
  get statusText(): string {
    return this.args.statusText ?? TASK_STATUS_DEFAULT[this.state];
  }
  get details(): (TaskRowDetail & {
    style: ReturnType<typeof cssStyleFrom>;
  })[] {
    return (this.args.details ?? []).map((detail, i) => ({
      ...detail,
      style: cssStyleFrom(['--pretui-task-delay: ' + (100 + i * 90) + 'ms']),
    }));
  }
  get expandable(): boolean {
    return this.details.length > 0;
  }
  get open(): boolean {
    return (
      this.args.open ?? this.innerOpen ?? this.args.defaultOpen ?? false
    );
  }
  /** the ring's index face; blank rather than 'undefined' when unset */
  get indexFace(): string {
    let index = this.args.index;
    return index === undefined || index === null ? '' : String(index);
  }

  toggle = () => {
    let next = !this.open;
    if (this.args.open === undefined) {
      this.innerOpen = next;
    }
    this.args.onOpenChange?.(next);
  };

  <template>
    <div
      class='pretui-taskrow'
      data-state={{this.state}}
      data-open={{if this.open 'true'}}
      data-flat={{if @flat 'true'}}
      data-test-pretui-task-row
      ...attributes
    >
      {{#if this.expandable}}
        <button
          type='button'
          class='pretui-taskrow-head'
          aria-expanded={{if this.open 'true' 'false'}}
          aria-controls={{this.panelId}}
          data-test-pretui-task-row-toggle
          {{on 'click' this.toggle}}
        >
          <TaskFace
            @state={{this.state}}
            @index={{this.indexFace}}
            @label={{@label}}
            @amount={{@amount}}
            @statusText={{this.statusText}}
          />
          <svg
            class='pretui-taskrow-chev'
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
        <div class='pretui-taskrow-head' data-static='true'>
          <TaskFace
            @state={{this.state}}
            @index={{this.indexFace}}
            @label={{@label}}
            @amount={{@amount}}
            @statusText={{this.statusText}}
          />
        </div>
      {{/if}}

      {{#if this.expandable}}
        <Collapse @open={{this.open}} id={{this.panelId}}>
          <div class='pretui-taskrow-body' data-open={{if this.open 'true'}}>
            <dl class='pretui-taskrow-details'>
              {{#each this.details key='id' as |detail|}}
                <div class='pretui-taskrow-detail' style={{detail.style}}>
                  <dt>{{detail.label}}</dt>
                  <dd>{{detail.meta}}</dd>
                </div>
              {{/each}}
            </dl>
            {{yield}}
          </div>
        </Collapse>
      {{/if}}
    </div>

    <style scoped>
      .pretui-taskrow {
        background: var(--card);
        font-size: var(--text-ui-md, 12.5px);
        border-radius: 22px;
        box-shadow: var(
          --pretui-shadow-card,
          0 0 0 1px var(--border),
          0 1px 2px rgb(0 0 0 / 0.08)
        );
        overflow: hidden;
        transition: border-radius 300ms
          var(--pretui-ease-enter, cubic-bezier(0.22, 0.61, 0.25, 1));
        container-type: inline-size;
      }
      .pretui-taskrow[data-open] {
        border-radius: 14px;
      }
      .pretui-taskrow[data-flat] {
        border-radius: 0;
        box-shadow: 0 1px 0 var(--border);
      }
      .pretui-taskrow[data-state='failed'] {
        box-shadow: 0 0 0 1px
          color-mix(
            in oklch,
            var(--destructive) 45%,
            var(--border)
          );
      }
      .pretui-taskrow-head {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-height: 44px;
        padding: 0 10px;
        border: 0;
        background: none;
        font: inherit;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--foreground);
        text-align: left;
        cursor: pointer;
      }
      .pretui-taskrow-head[data-static] {
        cursor: default;
      }
      button.pretui-taskrow-head:hover {
        background: var(--inset, var(--boxel-100));
      }
      button.pretui-taskrow-head:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: -3px;
      }
      .pretui-taskrow-chev {
        width: 15px;
        height: 15px;
        flex: none;
        color: var(--ink-3, var(--boxel-400));
        transition: transform 300ms
          var(--pretui-ease-enter, cubic-bezier(0.22, 0.61, 0.25, 1));
      }
      .pretui-taskrow-head[aria-expanded='true'] .pretui-taskrow-chev {
        transform: rotate(180deg);
      }
      .pretui-taskrow-body {
        display: grid;
        grid-template-columns: 24px 1fr;
        gap: 10px;
        padding: 0 10px 10px;
      }
      .pretui-taskrow-body::before {
        content: '';
        justify-self: center;
        width: 1px;
        height: 100%;
        background: var(--border);
      }
      .pretui-taskrow-details {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin: 0;
      }
      .pretui-taskrow-detail {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
      }
      .pretui-taskrow-detail dt {
        color: var(--muted-foreground);
        font-size: var(--text-ui-md, 12.5px);
        min-width: 0;
      }
      .pretui-taskrow-detail dd {
        margin: 0;
        flex: none;
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--ink-3, var(--boxel-400));
        font-variant-numeric: tabular-nums;
      }
      .pretui-taskrow-body[data-open] .pretui-taskrow-detail {
        animation: pretui-taskrow-in 300ms
          var(--pretui-ease-enter, cubic-bezier(0.22, 0.61, 0.25, 1))
          var(--pretui-task-delay, 0ms) both;
      }
      @keyframes pretui-taskrow-in {
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
        .pretui-taskrow,
        .pretui-taskrow-chev {
          transition: none;
        }
        .pretui-taskrow-body[data-open] .pretui-taskrow-detail {
          animation: none;
        }
      }
    </style>
  </template>
}
