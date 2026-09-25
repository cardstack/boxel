// Pretui — StepList: a presentational progress rail of ordered steps.
import Component from '@glimmer/component';
import { guidFor } from '@ember/object/internals';

// Transcribed from React Spectrum's StepList structure — ordered list,
// numbered markers, aria-current='step' on the active item, visually
// hidden state text per step — re-cut as a PRESENTATIONAL progress rail
// (Spectrum's is selectable navigation; wave-0 drops the link/keyboard
// machinery and renders state only, so there is nothing to mis-click).
// Adds an 'error' state Spectrum doesn't ship (tone: --destructive).
// Per-state treatment flows through one --pretui-step-tone custom prop
// per state.
// Review pass 2026-08-12: the <ol> carries an explicit role='list' because
// `list-style: none` strips list semantics in WebKit; and each state's four
// internals now read a --pretui-step-<state>-* knob first, so a consumer can
// re-tone a state from any ancestor (they were previously literal values on
// the element itself, i.e. unreachable from outside).
//
// Review pass 2026-08-13 — @variant='track' + @summary. The provenance
// panel on the Pretui component pages used to hand-roll its own five-stage
// rail (.wb-pipe/.wb-pstep/.wb-pbar/.wb-pcap) with three defects this
// component now absorbs, rather than a cousin component repeating them:
//   1. it painted the LAST bar with the accent purely because it was last,
//      so the accent read as information and encoded nothing. Here the
//      accent is a state channel only — 'current' speaks --primary,
//      'complete' speaks --success, 'error' speaks --destructive, and a
//      run of five complete stages is five identical bars.
//   2. its steps were div/span with a data-on attribute: no list
//      semantics, no state text, completion by colour alone (WCAG 1.4.1).
//      The track variant inherits the <ol>/<li>, the per-step visually
//      hidden state text, and adds the check glyph as a second, non-colour
//      visual channel.
//   3. its '5 / 5 complete' count was a floating <span> in the panel
//      header with no relationship to the rail. @summary renders that
//      count from the step states and ties it to the list with
//      aria-describedby, so it is announced when the list is entered.
// Also new: the root is now a wrapper div declaring container-type:
// inline-size, which buys the component the responsive behaviour BOTH
// presentations were missing — the steps rail stacked its nowrap labels
// into a column, the track rail folds into a legend list — measured
// against the component's own box, never the viewport. Spectrum's
// orientation prop is viewport-blind and leaves this to the caller.
// Element changed HTMLOListElement -> HTMLDivElement in that pass;
// data-test-pretui-step-list rides the root, the <ol> carries
// data-test-pretui-step-list-items.

// Review pass 2026-08-13 (boxel-catalog E6) — two states and a detail line.
// `complete | current | upcoming | error` describes where you ARE. It cannot
// say that a stage is running right now, and it cannot say that a stage
// cannot proceed and why — the two things a reader of a deploy pipeline, a
// KYC flow, an order or an approval chain actually wants. So:
//   · 'in-progress' — running now. Distinct from 'current' on purpose:
//     'current' is "you are here", 'in-progress' is "the machine is working".
//     A wizard has a current step and no in-progress step; a pipeline has
//     both, and they are usually not the same step.
//   · 'blocked' — cannot proceed. Distinct from 'error': an error happened,
//     a block is a precondition that has not been met.
//   · `detail` — a per-step sub-line ("Re-running lint…", "3 unfixable lint
//     errors"). This is the difference between a list that shows where you
//     are and one that shows why you are stuck.
// Every state keeps a glyph as well as a tone, so the five-way distinction
// survives greyscale, and a polite live region announces the active step's
// state and detail when either changes.
export type StepState =
  | 'complete'
  | 'current'
  | 'in-progress'
  | 'blocked'
  | 'upcoming'
  | 'error';
export type StepListVariant = 'steps' | 'track';

export interface StepItem {
  label: string;
  /** explicit state — wins over the @current-index derivation */
  state?: StepState;
  /**
   * One line of detail under the label — what is happening, or why this
   * stage cannot proceed. Never a substitute for the state: a blocked step
   * is blocked whether or not it explains itself.
   */
  detail?: string;
}

export interface StepListSignature {
  Args: {
    /** the ordered stages — one <li> each, in the order given */
    steps: StepItem[];
    /** index of the current step — derives complete/current/upcoming for
        steps without an explicit state */
    current?: number;
    /** list label announced by assistive tech — 'Steps' default */
    label?: string;
    /**
     * Presentation. 'steps' (default) is the numbered-marker rail with
     * connector lines between items. 'track' is the segmented bar rail —
     * one filled bar per stage with its caption beneath — for a pipeline
     * read at a glance rather than walked through. Same markup, same
     * semantics, same state palette; only the arrangement differs.
     */
    variant?: StepListVariant;
    /**
     * Render the completion summary above the rail ('3 of 5 complete').
     * It is derived from the step states and wired to the list with
     * aria-describedby — never a decorative count the caller has to keep
     * in sync. Off by default.
     */
    summary?: boolean;
    /** wording for that summary — receives (completed, total) */
    summaryFormat?: (done: number, total: number) => string;
    /**
     * Announce the active step's state and detail through a polite live
     * region when either changes. On by default: a rail whose stage flips
     * from running to blocked while nobody is looking at it has told a
     * sighted reader something and told everyone else nothing. Live regions
     * do not announce their initial content, so this is silent on mount.
     */
    announce?: boolean;
  };
  Element: HTMLDivElement;
}

interface StepView {
  label: string;
  state: StepState;
  detail?: string;
  number: number;
  stateText: string;
  last: boolean;
  connector: boolean;
  isCurrent: boolean;
  isComplete: boolean;
  isError: boolean;
  isBlocked: boolean;
  isRunning: boolean;
  isPending: boolean;
}

const STEP_STATE_TEXT: Record<StepState, string> = {
  complete: 'Completed',
  current: 'Current',
  'in-progress': 'In progress',
  blocked: 'Blocked',
  upcoming: 'Not completed',
  error: 'Error',
};

// Which step the live region speaks for, most urgent first. A blocked or
// failed stage outranks the one that merely happens to be running.
const STEP_ANNOUNCE_ORDER: StepState[] = [
  'error',
  'blocked',
  'in-progress',
  'current',
];

const defaultStepSummary = (done: number, total: number) =>
  `${done} of ${total} complete`;

export class StepList extends Component<StepListSignature> {
  // stable per-instance id so the summary can be referenced by the list
  // without the caller having to invent one
  private summaryId = `${guidFor(this)}-summary`;
  get label() {
    return this.args.label ?? 'Steps';
  }
  get variant(): StepListVariant {
    return this.args.variant ?? 'steps';
  }
  get isTrack() {
    return this.variant === 'track';
  }
  get showSummary() {
    return this.args.summary ?? false;
  }
  get summaryText() {
    let format = this.args.summaryFormat ?? defaultStepSummary;
    let views = this.views;
    return format(views.filter((v) => v.isComplete).length, views.length);
  }
  get views(): StepView[] {
    let current = this.args.current ?? -1;
    let steps = this.args.steps;
    let track = this.isTrack;
    return steps.map((step, i) => {
      let state: StepState =
        step.state ??
        (i < current ? 'complete' : i === current ? 'current' : 'upcoming');
      let last = i === steps.length - 1;
      return {
        label: step.label,
        state,
        detail: step.detail,
        number: i + 1,
        stateText: STEP_STATE_TEXT[state],
        last,
        // the track variant reads its progress off the bars; a connector
        // between them would be a second, redundant progress channel
        connector: !last && !track,
        isCurrent: state === 'current',
        isComplete: state === 'complete',
        isError: state === 'error',
        isBlocked: state === 'blocked',
        isRunning: state === 'in-progress',
        isPending: state === 'upcoming',
      };
    });
  }
  /** Reserve the detail slot on every step as soon as one step declares a
   * detail, so a line arriving late does not re-flow the rail (Appendix O:
   * a value that arrives late reserves its space). */
  get reserveDetail() {
    return this.args.steps.some((s) => s.detail !== undefined);
  }
  get announce() {
    return this.args.announce ?? true;
  }
  get liveText() {
    if (!this.announce) return undefined;
    let views = this.views;
    for (let state of STEP_ANNOUNCE_ORDER) {
      let hit = views.find((v) => v.state === state);
      if (hit) {
        return hit.detail
          ? `${hit.label}: ${hit.stateText}. ${hit.detail}`
          : `${hit.label}: ${hit.stateText}`;
      }
    }
    return undefined;
  }
  <template>
    <div class='pretui-steplist-wrap' data-test-pretui-step-list ...attributes>
      {{#if this.showSummary}}
        <p
          class='pretui-steplist-summary'
          id={{this.summaryId}}
          data-test-pretui-step-list-summary
        >{{this.summaryText}}</p>
      {{/if}}
      <ol
        class='pretui-steplist'
        role='list'
        data-variant={{this.variant}}
        aria-label={{this.label}}
        aria-describedby={{if this.showSummary this.summaryId}}
        data-test-pretui-step-list-items
      >
        {{#each this.views as |step|}}
          <li
            class='pretui-step'
            data-state={{step.state}}
            aria-current={{if step.isCurrent 'step'}}
          >
            {{#if this.isTrack}}
              <span class='pretui-step-bar' aria-hidden='true'></span>
            {{/if}}
            <span class='pretui-step-marker' aria-hidden='true'>
              {{#if step.isComplete}}
                <svg width='9' height='9' viewBox='0 0 10 10'><path
                    d='M1.5 5.5 4 8l4.5-6'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='1.6'
                    stroke-linecap='round'
                    stroke-linejoin='round'
                  /></svg>
              {{else if step.isError}}
                <svg width='9' height='9' viewBox='0 0 10 10'><path
                    d='M5 1.5v4.5M5 8.4v.1'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='1.6'
                    stroke-linecap='round'
                  /></svg>
              {{else if step.isBlocked}}
                {{!-- a bar across the marker — "the way through is shut", and
                    unmistakably not the error exclamation beside it --}}
                <svg width='9' height='9' viewBox='0 0 10 10'><path
                    d='M1.6 5h6.8'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='1.8'
                    stroke-linecap='round'
                  /></svg>
              {{else if step.isRunning}}
                {{!-- a play triangle — "the machine is working on this one".
                    Static on purpose: a spinning marker would be motion that
                    encodes nothing the tone and the state text do not --}}
                <svg width='9' height='9' viewBox='0 0 10 10'><path
                    d='M3.2 2.1 7.6 5 3.2 7.9Z'
                    fill='currentColor'
                  /></svg>
              {{else}}
                {{step.number}}
              {{/if}}
            </span>
            <span class='pretui-step-label'>
              <span class='pretui-step-name'>{{step.label}}</span>
              <span class='pretui-vh'>{{step.stateText}}</span>
              {{#if this.reserveDetail}}
                <span
                  class='pretui-step-detail'
                  data-test-pretui-step-detail
                >{{step.detail}}</span>
              {{/if}}
            </span>
            {{#if step.connector}}
              <span class='pretui-step-connector' aria-hidden='true'></span>
            {{/if}}
          </li>
        {{/each}}
      </ol>
      {{#if this.liveText}}
        <span
          class='pretui-vh'
          role='status'
          data-test-pretui-step-list-live
        >{{this.liveText}}</span>
      {{/if}}
    </div>
    <style scoped>
      /* the root is the query container for both presentations — unnamed,
         so the rules below resolve against THIS box and not the viewport */
      .pretui-steplist-wrap {
        container-type: inline-size;
        display: grid;
        gap: var(--pretui-step-summary-gap, 7px);
        min-width: 0;
      }
      .pretui-steplist-summary {
        justify-self: end;
        margin: 0;
        font-size: var(--text-ui, 12px);
        font-variant-numeric: tabular-nums;
        color: var(--pretui-step-summary-color, var(--muted-foreground));
      }
      .pretui-steplist {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
        min-width: 0;
      }
      .pretui-step {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        font-size: var(--text-ui, 12px);
        font-weight: 500;
        letter-spacing: var(--track-ui, 0.01em);
      }
      .pretui-step:not(:last-child) {
        flex: 1;
      }
      /* per-state treatment: each state only re-points the tone props, and
         each of those reads a per-state consumer knob first — set
         --pretui-step-error-marker-bg (etc.) on any ancestor to re-tone one
         state without touching the rest */
      .pretui-step[data-state='upcoming'] {
        --pretui-step-tone: var(--pretui-step-upcoming-tone, var(--muted-foreground));
        --pretui-step-marker-bg: var(--pretui-step-upcoming-marker-bg, var(--inset, var(--boxel-100)));
        --pretui-step-marker-fg: var(--pretui-step-upcoming-marker-fg, var(--muted-foreground));
        --pretui-step-ring: var(--pretui-step-upcoming-ring, var(--border));
        --pretui-step-bar-fill: var(--pretui-step-upcoming-bar, var(--border));
      }
      .pretui-step[data-state='current'] {
        --pretui-step-tone: var(--pretui-step-current-tone, var(--foreground));
        --pretui-step-marker-bg: var(--pretui-step-current-marker-bg, var(--primary));
        --pretui-step-marker-fg: var(--pretui-step-current-marker-fg, var(--primary-foreground));
        --pretui-step-ring: var(--pretui-step-current-ring, color-mix(in oklch, var(--primary) 70%, var(--border)));
        --pretui-step-bar-fill: var(--pretui-step-current-bar, var(--primary));
      }
      .pretui-step[data-state='complete'] {
        --pretui-step-tone: var(--pretui-step-complete-tone, var(--muted-foreground));
        --pretui-step-marker-bg: var(--pretui-step-complete-marker-bg, color-mix(in oklch, var(--success, var(--boxel-success)) 15%, var(--card)));
        --pretui-step-marker-fg: var(--pretui-step-complete-marker-fg, var(--success, var(--boxel-success)));
        --pretui-step-ring: var(--pretui-step-complete-ring, color-mix(in oklch, var(--success, var(--boxel-success)) 40%, var(--border)));
        --pretui-step-bar-fill: var(--pretui-step-complete-bar, var(--success, var(--boxel-success)));
      }
      .pretui-step[data-state='error'] {
        --pretui-step-tone: var(--pretui-step-error-tone, var(--destructive));
        --pretui-step-marker-bg: var(--pretui-step-error-marker-bg, color-mix(in oklch, var(--destructive) 12%, var(--card)));
        --pretui-step-marker-fg: var(--pretui-step-error-marker-fg, var(--destructive));
        --pretui-step-ring: var(--pretui-step-error-ring, color-mix(in oklch, var(--destructive) 45%, var(--border)));
        --pretui-step-bar-fill: var(--pretui-step-error-bar, var(--destructive));
      }
      /* running now: the primary hue filled solid, like 'current', but the
         glyph is a play triangle rather than a number so the two never read
         the same at a glance */
      .pretui-step[data-state='in-progress'] {
        --pretui-step-tone: var(--pretui-step-in-progress-tone, var(--foreground));
        --pretui-step-marker-bg: var(--pretui-step-in-progress-marker-bg, color-mix(in oklch, var(--pretui-info, var(--primary)) 16%, var(--card)));
        --pretui-step-marker-fg: var(--pretui-step-in-progress-marker-fg, var(--pretui-info, var(--primary)));
        --pretui-step-ring: var(--pretui-step-in-progress-ring, color-mix(in oklch, var(--pretui-info, var(--primary)) 55%, var(--border)));
        --pretui-step-bar-fill: var(--pretui-step-in-progress-bar, var(--pretui-info, var(--primary)));
      }
      /* cannot proceed: warning tone, not destructive — nothing has failed */
      .pretui-step[data-state='blocked'] {
        --pretui-step-tone: var(--pretui-step-blocked-tone, var(--foreground));
        --pretui-step-marker-bg: var(--pretui-step-blocked-marker-bg, color-mix(in oklch, var(--warning, var(--boxel-warning)) 14%, var(--card)));
        --pretui-step-marker-fg: var(--pretui-step-blocked-marker-fg, var(--warning, var(--boxel-warning)));
        --pretui-step-ring: var(--pretui-step-blocked-ring, color-mix(in oklch, var(--warning, var(--boxel-warning)) 50%, var(--border)));
        --pretui-step-bar-fill: var(--pretui-step-blocked-bar, var(--warning, var(--boxel-warning)));
      }
      .pretui-step-marker {
        display: inline-grid;
        place-items: center;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        flex: none;
        font-size: 10px;
        font-variant-numeric: tabular-nums;
        background: var(--pretui-step-marker-bg);
        color: var(--pretui-step-marker-fg);
        box-shadow: 0 0 0 1px var(--pretui-step-ring);
      }
      .pretui-step-label {
        position: relative; /* containing block for the sr-only state text */
        display: grid;
        min-width: 0;
        color: var(--pretui-step-tone);
      }
      .pretui-step-name {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* The detail slot is rendered on every step as soon as ONE step
         declares a detail, and reserves a line's height, so a message
         arriving mid-run does not shove the whole rail down. */
      .pretui-step-detail {
        min-height: 1.35em;
        font-size: var(--text-ui-xs, 11px);
        font-weight: 400;
        white-space: normal;
        overflow-wrap: break-word;
        color: var(--pretui-step-detail-color, var(--muted-foreground));
      }
      .pretui-step[data-state='blocked'] .pretui-step-detail,
      .pretui-step[data-state='error'] .pretui-step-detail {
        color: var(--pretui-step-marker-fg);
      }
      .pretui-step-connector {
        flex: 1;
        min-width: 12px;
        height: 1px;
        background: var(--border);
      }
      .pretui-step[data-state='complete'] .pretui-step-connector {
        background: color-mix(in oklch, var(--success, var(--boxel-success)) 45%, var(--border));
      }
      /* ── track variant ── equal-width bars, caption beneath each. The
         caption keeps the marker glyph, so 'complete' is carried by shape
         (✓) and by the visually hidden state text, not by the bar fill
         alone. */
      .pretui-steplist[data-variant='track'] {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: minmax(0, 1fr);
        align-items: start;
        gap: var(--pretui-step-track-gap, 4px);
      }
      .pretui-steplist[data-variant='track'] .pretui-step {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        grid-template-areas:
          'bar bar'
          'marker label';
        align-items: center;
        gap: 7px 5px;
      }
      .pretui-steplist[data-variant='track'] .pretui-step-bar {
        grid-area: bar;
        height: var(--pretui-step-bar-height, 3px);
        border-radius: 2px;
        background: var(--pretui-step-bar-fill);
      }
      .pretui-steplist[data-variant='track'] .pretui-step-marker {
        grid-area: marker;
        width: auto;
        height: auto;
        min-width: 9px;
        border-radius: 0;
        background: none;
        box-shadow: none;
        font-size: var(--text-ui-xs, 11px);
      }
      .pretui-steplist[data-variant='track'] .pretui-step-label {
        grid-area: label;
      }
      .pretui-steplist[data-variant='track'] .pretui-step-name {
        white-space: normal;
        overflow: visible;
        overflow-wrap: break-word;
      }
      /* ── narrow container: the steps rail stacks. Its labels are nowrap
         and its connectors want horizontal slack, so below this width the
         row becomes a column rather than clipping. */
      @container (max-width: 26rem) {
        .pretui-steplist[data-variant='steps'] {
          flex-direction: column;
          align-items: stretch;
          gap: 7px;
        }
        .pretui-steplist[data-variant='steps'] .pretui-step {
          flex: none;
        }
        .pretui-steplist[data-variant='steps'] .pretui-step-connector {
          display: none;
        }
        .pretui-steplist[data-variant='steps'] .pretui-step-name {
          white-space: normal;
          overflow: visible;
        }
      }
      /* ── narrow container: five captions no longer sit side by side, so
         the track folds into a legend list — one stage per row, each
         keeping its own bar as a leading dash. */
      @container (max-width: 24rem) {
        .pretui-steplist[data-variant='track'] {
          grid-auto-flow: row;
          grid-auto-columns: auto;
          gap: 6px;
        }
        .pretui-steplist[data-variant='track'] .pretui-step {
          grid-template-columns: 14px auto minmax(0, 1fr);
          grid-template-areas: 'bar marker label';
          gap: 7px;
        }
      }
      .pretui-vh {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
      }
    </style>
  </template>
}
