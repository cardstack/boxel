// Pretui — WorkItem: one unit of agent work at three densities (step, action, run), with status text for every state.
import Component from '@glimmer/component';
import { ProgressBar } from './progress-bar';
import { Spinner } from './spinner';
import { StateGlyph } from './state-glyph';

type Tone = 'idle' | 'running' | 'attention' | 'done' | 'failed';
const TONES: Record<string, Tone> = {
  pending: 'idle',
  preparing: 'running',
  running: 'running',
  applying: 'running',
  handoff: 'running',
  starting: 'running',
  // a reload lost the page that watched the run, not the run: grey, never red
  reconnecting: 'idle',
  'host-attached': 'running',
  fallback: 'running',
  ready: 'attention',
  'awaiting-approval': 'attention',
  ask: 'attention',
  input: 'attention',
  completed: 'done',
  kept: 'done',
  delivered: 'done',
  failed: 'failed',
  invalid: 'failed',
  reverted: 'idle',
  canceled: 'idle',
  superseded: 'idle',
  stopped: 'idle',
  // staged writes: the preview waits on the reader, the commit runs, a file
  // that moved since the preview waits again; a partial keep is still done
  previewed: 'attention',
  committing: 'running',
  conflict: 'attention',
  partial: 'done',
  resumed: 'running',
  // a transient failure that will try again by itself is not red yet
  retrying: 'idle',
  // the run spent its budget: it stopped with what it had, and can continue
  budget: 'idle',
  // the decision belongs to someone else in the room
  routed: 'idle',
};
const GLYPHS: Record<Tone, string> = {
  idle: '·',
  running: '',
  attention: '●',
  done: '✓',
  failed: '✕',
};
const DEFAULT_STATUS: Record<string, string> = {
  pending: 'queued',
  preparing: 'preparing…',
  running: 'running…',
  applying: 'applying…',
  handoff: 'handing off…',
  starting: 'starting…',
  reconnecting: 'reconnecting…',
  'host-attached': 'attached',
  fallback: 'fallback…',
  ready: 'needs you',
  'awaiting-approval': 'needs you',
  ask: 'needs you',
  input: 'needs you',
  completed: 'done',
  kept: 'kept',
  delivered: 'delivered',
  failed: 'failed',
  invalid: 'invalid',
  reverted: 'reverted',
  canceled: 'canceled',
  superseded: 'retried below',
  stopped: 'stopped',
  previewed: 'review',
  committing: 'writing…',
  conflict: 'conflict',
  partial: 'partly kept',
  resumed: 'resumed…',
  retrying: 'retrying soon',
  budget: 'budget reached',
  routed: 'waiting on someone',
};

/** The tone an agent state collapses to. Exported so components built on the
 * same vocabulary (ToolRow) map states identically rather than keeping a
 * second table that drifts. */
export function workTone(state: string): Tone {
  return TONES[state] ?? 'idle';
}
/** The glyph for a tone; empty for `running`, which shows a Spinner. */
export function workGlyph(tone: Tone): string {
  return GLYPHS[tone];
}
/** The default status phrase for a state. */
export function workStatus(state: string): string {
  return DEFAULT_STATUS[state] ?? state;
}
export type WorkTone = Tone;

export interface WorkItemSignature {
  Args: {
    tier?: 'step' | 'action' | 'run';
    state?: string;
    verb?: string;
    title: string;
    status?: string;
    progressValue?: number;
    progressMax?: number;
    count?: string;
    activity?: string;
    /** whether settled work recedes (default: done or idle states). Only
     * shows inside a container that sets --pretui-recede-opacity */
    recede?: boolean;
  };
  Blocks: { default: []; footer: [] };
  Element: HTMLDivElement;
}

export class WorkItem extends Component<WorkItemSignature> {
  get state() {
    return this.args.state ?? 'pending';
  }
  get tone(): Tone {
    return TONES[this.state] ?? 'idle';
  }
  get glyph() {
    return GLYPHS[this.tone];
  }
  get isRunning() {
    return this.tone === 'running';
  }
  get isAttention() {
    return this.tone === 'attention';
  }
  get recedes() {
    return this.args.recede ?? (this.tone === 'done' || this.tone === 'idle');
  }
  get statusText() {
    return this.args.status ?? DEFAULT_STATUS[this.state] ?? this.state;
  }
  get hasProgress() {
    return this.args.progressValue !== undefined;
  }
  get progressValue() {
    return this.args.progressValue ?? 0;
  }
  get countText() {
    if (this.args.count) {
      return this.args.count;
    }
    return `${this.progressValue} / ${this.args.progressMax ?? 100}`;
  }
  get hasBody() {
    return this.hasProgress || this.args.activity;
  }
  <template>
    <div
      class='pretui-workitem'
      data-tier={{if @tier @tier 'step'}}
      data-state={{this.state}}
      data-attention={{if this.isAttention 'true'}}
      data-recede={{if this.recedes 'true'}}
      data-test-pretui-work-item
      ...attributes
    >
      <div class='pretui-workitem-row'>
        <span
          class='pretui-disc'
          data-tone={{this.tone}}
          data-test-pretui-work-item-disc
        >
          {{#if this.isRunning}}<Spinner @size={{9}} />{{else}}<StateGlyph
              @glyph={{this.glyph}}
            />{{/if}}
        </span>
        {{#if @verb}}<span
            class='pretui-verb'
            data-test-pretui-work-item-verb
          >{{@verb}}</span>{{/if}}
        <span
          class='pretui-workitem-title'
          data-test-pretui-work-item-title
        >{{@title}}</span>
        <span
          class='pretui-workitem-status'
          data-tone={{this.tone}}
          data-test-pretui-work-item-status
        >{{this.statusText}}</span>
      </div>
      {{#if this.hasBody}}
        <div class='pretui-workitem-body' data-test-pretui-work-item-body>
          {{#if this.hasProgress}}
            <ProgressBar
              @value={{this.progressValue}}
              @max={{@progressMax}}
              @count={{this.countText}}
            />
          {{/if}}
          {{#if @activity}}<div
              class='pretui-activity'
              data-test-pretui-work-item-activity
            >{{@activity}}</div>{{/if}}
          {{yield}}
        </div>
      {{else}}
        {{yield}}
      {{/if}}
      {{yield to='footer'}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-workitem {
          /* the row's inset, disc and gap, which the body's leading edge
             adds up to so its text lines up under the title */
          --_workitem-inset: var(--boxel-sp-sm);
          --_workitem-disc: 1rem;
          --_workitem-gap: var(--boxel-sp-xs);
          display: flex;
          flex-direction: column;
          background-color: var(--card);
          border-radius: var(--boxel-border-radius);
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
          font-size: var(--boxel-font-size-xs);
        }
        /* needs you: the attention hue tints the face and draws the edge;
           the status words and the disc's mark take its ink (below) */
        .pretui-workitem[data-attention] {
          box-shadow:
            0 0 0 1px color-mix(in oklch, var(--attention) 60%, var(--border)),
            0 0.125rem 0.625rem
              color-mix(in oklch, var(--attention) 14%, transparent);
          background-image: linear-gradient(
            180deg,
            color-mix(in oklch, var(--attention) 7%, var(--card)),
            var(--card) 55%
          );
        }
        .pretui-workitem[data-state='failed'],
        .pretui-workitem[data-state='invalid'] {
          box-shadow: 0 0 0 1px
            color-mix(in oklch, var(--destructive) 45%, var(--border));
        }
        .pretui-workitem[data-recede] > .pretui-workitem-row {
          opacity: var(--pretui-recede-opacity, 1);
          transition: opacity 200ms linear;
        }
        .pretui-workitem[data-recede]:is(:hover, :focus-within)
          > .pretui-workitem-row {
          opacity: 1;
        }
        .pretui-workitem-row {
          display: flex;
          align-items: center;
          gap: var(--_workitem-gap);
          padding: var(--boxel-sp-2xs) var(--_workitem-inset);
          min-height: 2rem;
        }
        .pretui-workitem-body {
          padding: 0 var(--_workitem-inset) var(--boxel-sp-xs)
            calc(
              var(--_workitem-inset) + var(--_workitem-disc) +
                var(--_workitem-gap)
            );
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }
        .pretui-disc {
          width: var(--_workitem-disc);
          height: var(--_workitem-disc);
          border-radius: 50%;
          display: grid;
          place-items: center;
          flex: none;
          font-size: 0.5625rem;
          font-weight: 700;
          background-color: var(--inset);
          color: var(--muted-foreground);
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        }
        .pretui-disc[data-tone='failed'] {
          background-color: color-mix(
            in oklch,
            var(--destructive) 15%,
            var(--card)
          );
          color: var(--destructive-ink);
        }
        .pretui-disc[data-tone='attention'] {
          background-color: color-mix(
            in oklch,
            var(--attention) 22%,
            var(--card)
          );
          color: var(--attention-ink);
        }
        .pretui-verb {
          font-family: var(--font-mono);
          font-size: 0.625rem;
          font-weight: 600;
          letter-spacing: 0.06em;
          color: var(--muted-foreground);
          flex: none;
        }
        .pretui-workitem-title {
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
          flex: 1;
        }
        .pretui-workitem-status {
          margin-left: auto;
          flex: none;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground);
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-3xs);
          font-variant-numeric: tabular-nums;
        }
        .pretui-workitem-status[data-tone='attention'] {
          color: var(--attention-ink);
          font-weight: 600;
        }
        .pretui-workitem-status[data-tone='failed'] {
          color: var(--destructive-ink);
          font-weight: 500;
        }
        .pretui-activity {
          font-family: var(--font-mono);
          font-size: var(--boxel-font-size-2xs);
          color: var(--subtle-foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      }
    </style>
  </template>
}
