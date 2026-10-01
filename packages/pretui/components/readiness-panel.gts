// Pretui — ReadinessPanel: a list of gates that adds up to a ready, blocked or pending verdict.
import Component from '@glimmer/component';
import { guidFor } from '@ember/object/internals';
import { Chip } from './chip';
import { Token } from './token';
import { EmptyState } from './empty-state';
import { Panel } from './panel';
import { Skeleton } from './skeleton';
import { cssStyle } from '../pretui-css';
import { ariaLevelFor } from '../internal/blocks';
import type { BlockHeadingLevel } from '../internal/blocks';

// ═════════════════════════════════════════════════════════════════════════
// B1 · ReadinessPanel
// ═════════════════════════════════════════════════════════════════════════
//
// From pr-card's mergeable-section / ci-section / review-section, with the
// pull request thrown away. The mechanism: ONE headline verdict above a
// list of named gates, each carrying a state indicator and a status
// caption, with explicit loading and empty states, and blocking reasons
// rendered as DATA. Deploy preconditions, publish gates, checkout
// validation, compliance checks, onboarding completion, order fulfilment.
//
// The composition is the value, and it is specific:
//
//   1. A not-ready panel does not merely change colour. When the verdict is
//      `blocked`, the blocking reasons are promoted to sit directly under
//      the verdict, ABOVE the gate inventory — you read WHY before you read
//      WHAT. A ready panel has no reasons block at all, so the whole middle
//      of the panel disappears and the gate list moves up. That is a
//      structural difference, legible in a still greyscale frame (Law 8),
//      not a hue swap.
//   2. State is carried on three channels at once — glyph, tone and
//      distinct words — so there is no colour-only failure anywhere.
//   3. Loading and empty are visually unmistakable from each other:
//      loading reserves the exact gate-row geometry with Skeletons, empty
//      is an EmptyState with a title and a message.
//
// BETTER THAN THE INSPIRATION — every defect boxel-catalog §B1 named:
//   · Hardcoded English domain strings ("Ready to merge", "All merge
//     requirements have been met") → `@title` is required, `@summary`,
//     `@verdictText`, `@reasonsTitle`, `@emptyTitle`/`@emptyMessage` and a
//     `@stateText` override record are args. The English in this file is a
//     DEFAULT, and every one of them is reachable.
//   · Banner flipping blocked→ready announced nothing → a polite live
//     region carries the verdict, the reason count and the gate tally.
//     Live regions do not announce initial content, so it is silent on
//     mount and speaks only on a real transition.
//   · Blocking reasons were a stack of <span>s → a real <ul> with an
//     announced count on its label.
//   · `aria-label` on a role-less <span> → every accessible name sits on an
//     element that has a role to carry it.
//   · Pending dot spinning `infinite` with no reduced-motion → there is no
//     animation in this block at all. `running` is distinguished by a
//     distinct glyph, a distinct tone and distinct words.
//   · Success/failure glyphs CSS-drawn from hardcoded #fff gradients,
//     invisible on a dark surface → glyphs are text, inked from the same
//     tone token as the row, so they follow a season and a dark theme.
//   · Empty and loading states near-identical → see (3) above.
//   · `key='name'` assuming names are unique → `ReadinessGate.id` is the
//     key, falling back to name+index, so two gates called "lint" coexist.
//   · An XL name in a row sized around a 13px dot → one type size, the
//     kit's `--text-ui-md`.
//   · Three whitelisted states with everything else rendering NOTHING → an
//     unrecognised state resolves to `unknown`, which is a real, visible,
//     announced state. A gate can never silently disappear.
//   · A <ul>/<li> shape whose args could only ever hold one item → `gates`
//     is a list and the markup is a list.
//   · `#9a6700` raw beside tokenised siblings → every tone is a token with
//     a light-value fallback (Appendix F, Law 2).
//   · Boolean-only, no neutral state → seven states, three of which
//     (`pending`, `skipped`, `unknown`) are neutral.
//
// KEPT from the source, because it was right: rendering NOTHING when the
// panel does not apply rather than showing an empty shell (`@applicable`),
// and generating the row tint from the same semantic token as the pill with
// `color-mix(in oklch, <tone> 10%, var(--card))`.

/** Every state a gate can be in. `unknown` is a real answer, not an error
 * — it is what an unrecognised or not-yet-reported gate resolves to, and it
 * renders and announces like any other state. */
export type ReadinessGateState =
  | 'pass'
  | 'fail'
  | 'blocked'
  | 'running'
  | 'pending'
  | 'skipped'
  | 'unknown';

export interface ReadinessGate {
  /**
   * Stable key. Names are NOT assumed unique — the source keyed its list on
   * the name, so two gates called "lint" collapsed into one row.
   */
  id?: string;
  /** The gate's name, as the reader knows it. */
  name: string;
  /** Where the gate is now. */
  state: ReadinessGateState;
  /** One line of status under the name — what it is doing, or why it
   * failed. Never a substitute for the state. */
  caption?: string;
  /** A machine value the gate reports (`12 / 14`, `3.2 s`, `v4.1.0`),
   * set like jewelry per Law 3. */
  value?: string;
}

/** The headline answer. Derived from the gates unless the caller states it. */
export type ReadinessVerdict = 'ready' | 'blocked' | 'pending' | 'unknown';

interface GateTreatment {
  glyph: string;
  hue: string;
  text: string;
}

// One record, read by BOTH the template (glyph, words, the Chip hue) and
// the CSS (through --pretui-gate-tone). The tone token never appears twice.
const GATE_TREATMENT: Readonly<Record<ReadinessGateState, GateTreatment>> = {
  pass: { glyph: '✓', hue: 'var(--success, var(--boxel-success))', text: 'Passed' },
  fail: { glyph: '✕', hue: 'var(--destructive)', text: 'Failed' },
  blocked: { glyph: '⊘', hue: 'var(--warning, var(--boxel-warning))', text: 'Blocked' },
  running: { glyph: '◐', hue: 'var(--pretui-info, var(--boxel-blue))', text: 'Running' },
  pending: {
    glyph: '○',
    hue: 'var(--muted-foreground)',
    text: 'Pending',
  },
  skipped: {
    glyph: '–',
    hue: 'var(--muted-foreground)',
    text: 'Skipped',
  },
  unknown: {
    glyph: '?',
    hue: 'var(--muted-foreground)',
    text: 'Unknown',
  },
};

const VERDICT_TREATMENT: Readonly<Record<ReadinessVerdict, GateTreatment>> = {
  ready: { glyph: '✓', hue: 'var(--success, var(--boxel-success))', text: 'Ready' },
  blocked: { glyph: '✕', hue: 'var(--destructive)', text: 'Blocked' },
  pending: { glyph: '◐', hue: 'var(--pretui-info, var(--boxel-blue))', text: 'In progress' },
  unknown: {
    glyph: '?',
    hue: 'var(--muted-foreground)',
    text: 'Not known',
  },
};

/** States that keep the panel from being ready, most severe first. The
 * derivation walks this order, so one failure outranks any number of
 * pending gates. */
const BLOCKING_STATES: ReadinessGateState[] = ['fail', 'blocked'];
const BUSY_STATES: ReadinessGateState[] = ['running', 'pending'];

interface GateView {
  key: string;
  name: string;
  state: ReadinessGateState;
  stateText: string;
  glyph: string;
  hue: string;
  caption?: string;
  value?: string;
  style: ReturnType<typeof cssStyle>;
}

export interface ReadinessPanelSignature {
  Args: {
    /** What is being judged — "Deploy to production", "Publish listing".
     * Required, because the source's hardcoded domain title is the single
     * thing that made it unreusable. */
    title: string;
    /** Optional sub-line under the verdict. */
    summary?: string;
    /** The gates, in the order they should be read. */
    gates?: readonly ReadinessGate[];
    /** State the verdict outright. Omit it and the verdict is derived:
     * any fail or blocked gate → blocked; else any running or pending →
     * pending; else any unknown → unknown; else, with at least one gate,
     * ready. */
    verdict?: ReadinessVerdict;
    /** Override the verdict wording. The defaults are English; this is how
     * they stop being. */
    verdictText?: string;
    /** Why it is blocked, as DATA — one string per reason, rendered as a
     * counted list. Never a paragraph. */
    reasons?: readonly string[];
    /** Heading over the reasons list. */
    reasonsTitle?: string;
    /** Reserve the gate rows while the gates are being fetched. */
    loading?: boolean;
    /** How many rows to reserve while loading (default 3) — reserve the
     * space the answer will need, so nothing reflows when it lands. */
    loadingRows?: number;
    /** Empty-state wording when there are no gates at all. */
    emptyTitle?: string;
    /** Empty-state message. */
    emptyMessage?: string;
    /** Accessible name for the gate list. Defaults to the title. */
    gatesLabel?: string;
    /** Per-state wording, for another language or another domain
     * ("Passed" → "Cleared", "Running" → "Underway"). */
    stateText?: Partial<Record<ReadinessGateState, string>>;
    /** Announce verdict changes through a polite live region. On by
     * default: a panel that flips from blocked to ready has told a sighted
     * reader something and told everyone else nothing. */
    announce?: boolean;
    /** Render nothing at all when the panel does not apply. The source got
     * this right and it is worth keeping: an empty shell reads as "no
     * problems", which is not what "not applicable" means. */
    applicable?: boolean;
    /** Heading level for the title within the host page. */
    headingLevel?: BlockHeadingLevel;
  };
  Blocks: {
    /** The action the verdict is about — sits beside the verdict, not in a
     * detached footer, because "Deploy" belongs next to "Ready". */
    actions: [];
    /** Replaces the built-in EmptyState. */
    empty: [];
    /** Anything that belongs under the gate list. */
    default: [];
  };
  Element: HTMLElement;
}

export class ReadinessPanel extends Component<ReadinessPanelSignature> {
  private titleId = guidFor(this) + '-title';
  private reasonsId = guidFor(this) + '-reasons';

  get applicable() {
    return this.args.applicable ?? true;
  }
  get gates(): readonly ReadinessGate[] {
    return this.args.gates ?? [];
  }
  get reasons(): readonly string[] {
    return this.args.reasons ?? [];
  }
  get isLoading() {
    return this.args.loading ?? false;
  }
  get headingAriaLevel() {
    return ariaLevelFor(this.args.headingLevel);
  }

  /** Unrecognised input resolves to `unknown` rather than to nothing. */
  /** One normalisation, used everywhere a state is read: a state this panel
   * does not recognise (an `'error'` from a backend) is `unknown`, on its row,
   * in its word and in the verdict alike. */
  private normState(state: ReadinessGateState): ReadinessGateState {
    return GATE_TREATMENT[state] ? state : 'unknown';
  }
  private treatmentFor(state: ReadinessGateState): GateTreatment {
    return GATE_TREATMENT[this.normState(state)] ?? GATE_TREATMENT.unknown;
  }
  private wordFor(state: ReadinessGateState): string {
    let norm = this.normState(state);
    return this.args.stateText?.[norm] ?? this.treatmentFor(norm).text;
  }
  private has(states: ReadinessGateState[]): boolean {
    return this.gates.some((gate) => states.includes(this.normState(gate.state)));
  }

  get verdict(): ReadinessVerdict {
    if (this.args.verdict) {
      return this.args.verdict;
    }
    if (this.isLoading) {
      return 'pending';
    }
    if (this.reasons.length > 0 || this.has(BLOCKING_STATES)) {
      return 'blocked';
    }
    if (this.has(BUSY_STATES)) {
      return 'pending';
    }
    if (this.has(['unknown']) || this.gates.length === 0) {
      return 'unknown';
    }
    return 'ready';
  }
  get verdictTreatment(): GateTreatment {
    return VERDICT_TREATMENT[this.verdict] ?? VERDICT_TREATMENT.unknown;
  }
  get verdictText(): string {
    return this.args.verdictText ?? this.verdictTreatment.text;
  }
  get verdictStyle() {
    return cssStyle('--pretui-verdict-tone', this.verdictTreatment.hue);
  }
  get isBlocked() {
    return this.verdict === 'blocked';
  }
  get showReasons() {
    return this.reasons.length > 0;
  }
  get reasonsTitle(): string {
    return this.args.reasonsTitle ?? 'Blocking';
  }
  /** The count lives on the list's accessible name, so it is announced with
   * the list rather than floating beside it as decoration. */
  get reasonsLabel(): string {
    return this.reasonsTitle + ' — ' + String(this.reasons.length);
  }

  get views(): GateView[] {
    return this.gates.map((gate, index) => {
      let treatment = this.treatmentFor(gate.state);
      return {
        key: gate.id ?? gate.name + '#' + String(index),
        name: gate.name,
        state: this.normState(gate.state),
        stateText: this.wordFor(gate.state),
        glyph: treatment.glyph,
        hue: treatment.hue,
        caption: gate.caption,
        value: gate.value,
        style: cssStyle('--pretui-gate-tone', treatment.hue),
      };
    });
  }
  get passedCount(): number {
    return this.gates.filter((gate) => this.normState(gate.state) === 'pass').length;
  }
  get skeletonRows(): number[] {
    let count = Math.max(1, Math.min(12, this.args.loadingRows ?? 3));
    let rows: number[] = [];
    for (let i = 0; i < count; i++) {
      rows.push(i);
    }
    return rows;
  }
  get gatesLabel(): string {
    return this.args.gatesLabel ?? this.args.title;
  }
  get emptyTitle(): string {
    return this.args.emptyTitle ?? 'No checks';
  }
  get emptyMessage(): string {
    return (
      this.args.emptyMessage ??
      'Nothing has reported yet, so there is nothing to judge.'
    );
  }
  get announce() {
    return this.args.announce ?? true;
  }
  /** One sentence, assembled from the same data the panel paints: the
   * verdict, then the blocking count, then the gate tally. */
  get liveText(): string {
    let parts: string[] = [this.args.title + ' — ' + this.verdictText];
    if (this.reasons.length > 0) {
      parts.push(String(this.reasons.length) + ' blocking');
    }
    if (this.gates.length > 0) {
      parts.push(
        String(this.passedCount) + ' of ' + String(this.gates.length) + ' passed',
      );
    }
    return parts.join('. ') + '.';
  }

  <template>
    {{#if this.applicable}}
      <Panel
        class='pretui-readiness'
        aria-labelledby={{this.titleId}}
        data-verdict={{this.verdict}}
        data-loading={{if this.isLoading 'true'}}
        data-test-pretui-readiness-panel
        ...attributes
      >
        <:header>
          <div
            class='pretui-verdict'
            style={{this.verdictStyle}}
            data-test-pretui-readiness-verdict
          >
            <span class='pretui-verdict-glyph' aria-hidden='true'>
              {{this.verdictTreatment.glyph}}
            </span>
            <div class='pretui-verdict-head'>
              <h2
                id={{this.titleId}}
                class='pretui-verdict-title'
                aria-level={{this.headingAriaLevel}}
              >{{@title}}</h2>
              <p
                class='pretui-verdict-state'
                data-test-pretui-readiness-verdict-text
              >{{this.verdictText}}</p>
              {{#if @summary}}
                <p class='pretui-verdict-summary'>{{@summary}}</p>
              {{/if}}
            </div>
            {{#if (has-block 'actions')}}
              <div class='pretui-verdict-actions'>{{yield to='actions'}}</div>
            {{/if}}
          </div>
        </:header>
        <:default>
          {{#if this.showReasons}}
            {{! Promoted ABOVE the gate inventory: why, before what. }}
            <div class='pretui-reasons' data-test-pretui-readiness-reasons>
              <p class='pretui-reasons-title' id={{this.reasonsId}}>
                {{this.reasonsTitle}}
                <span class='pretui-reasons-count'>{{this.reasons.length}}</span>
              </p>
              <ul
                class='pretui-reasons-list'
                role='list'
                aria-label={{this.reasonsLabel}}
              >
                {{#each this.reasons key='@index' as |reason|}}
                  <li class='pretui-reasons-item'>{{reason}}</li>
                {{/each}}
              </ul>
            </div>
          {{/if}}

          {{#if this.isLoading}}
            <ul
              class='pretui-gates'
              role='list'
              aria-busy='true'
              aria-label={{this.gatesLabel}}
              data-test-pretui-readiness-loading
            >
              {{#each this.skeletonRows key='@identity' as |line|}}
                <li class='pretui-gate' data-state='pending' data-row={{line}}>
                  <span class='pretui-gate-glyph' aria-hidden='true'>○</span>
                  <span class='pretui-gate-body'>
                    <Skeleton @width='42%' @height='13px' />
                    <Skeleton @width='68%' @height='11px' />
                  </span>
                  <span class='pretui-gate-side'>
                    <Skeleton @width='58px' @height='18px' />
                  </span>
                </li>
              {{/each}}
            </ul>
          {{else if this.views.length}}
            <ul
              class='pretui-gates'
              role='list'
              aria-label={{this.gatesLabel}}
              data-test-pretui-readiness-gates
            >
              {{#each this.views key='key' as |row|}}
                <li
                  class='pretui-gate'
                  data-state={{row.state}}
                  style={{row.style}}
                  data-test-pretui-readiness-gate
                >
                  <span class='pretui-gate-glyph' aria-hidden='true'>
                    {{row.glyph}}
                  </span>
                  <span class='pretui-gate-body'>
                    <span class='pretui-gate-name'>{{row.name}}</span>
                    {{#if row.caption}}
                      <span class='pretui-gate-caption'>{{row.caption}}</span>
                    {{/if}}
                  </span>
                  <span class='pretui-gate-side'>
                    {{#if row.value}}
                      <Token @value={{row.value}} />
                    {{/if}}
                    <Chip
                      @label={{row.stateText}}
                      @hue={{row.hue}}
                      @dot={{false}}
                    />
                  </span>
                </li>
              {{/each}}
            </ul>
          {{else if (has-block 'empty')}}
            {{yield to='empty'}}
          {{else}}
            <EmptyState
              @title={{this.emptyTitle}}
              @message={{this.emptyMessage}}
              @texture={{false}}
              data-test-pretui-readiness-empty
            />
          {{/if}}

          {{yield}}

          {{#if this.announce}}
            <p
              class='pretui-vh'
              role='status'
              data-test-pretui-readiness-live
            >{{this.liveText}}</p>
          {{/if}}
        </:default>
      </Panel>
    {{/if}}

    <style scoped>
      /* Layout and the Law-2 tint. Every colour below is derived from
         --pretui-verdict-tone / --pretui-gate-tone, which are written from
         one TypeScript record — the same record the glyphs and the Chip
         hues come from. */
      .pretui-verdict {
        display: flex;
        align-items: flex-start;
        gap: var(--space-3, 8px);
        padding: var(--space-3, 8px) var(--space-4, 11px);
        border-radius: var(--radius);
        background: color-mix(
          in oklch,
          var(--pretui-verdict-tone, var(--muted-foreground)) 10%,
          var(--card)
        );
        box-shadow: 0 0 0 1px
          color-mix(
            in oklch,
            var(--pretui-verdict-tone, var(--muted-foreground)) 28%,
            var(--border)
          );
      }
      .pretui-verdict-glyph {
        flex: none;
        width: 20px;
        height: 20px;
        margin-top: 1px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
        background: color-mix(
          in oklch,
          var(--pretui-verdict-tone, var(--muted-foreground)) 22%,
          var(--card)
        );
        color: var(--pretui-verdict-tone, var(--muted-foreground));
      }
      .pretui-verdict-head {
        display: grid;
        gap: 2px;
        min-width: 0;
        flex: 1;
      }
      .pretui-verdict-title {
        margin: 0;
        font-size: var(--text-body, 15px);
        font-weight: 600;
        letter-spacing: var(--track-heading, -0.02em);
        color: var(--foreground);
      }
      .pretui-verdict-state {
        margin: 0;
        font-size: var(--text-ui-md, 12.5px);
        font-weight: 600;
        color: color-mix(
          in oklch,
          var(--foreground) 30%,
          var(--pretui-verdict-tone, var(--muted-foreground))
        );
      }
      .pretui-verdict-summary {
        margin: 0;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
        max-width: 60ch;
      }
      .pretui-verdict-actions {
        flex: none;
        display: flex;
        align-items: center;
        gap: var(--space-2, 6px);
      }

      /* Reasons — only present when blocked, which is what makes a blocked
         panel read structurally differently rather than merely redder. */
      .pretui-reasons {
        display: grid;
        gap: var(--space-2, 6px);
        margin-bottom: var(--space-4, 11px);
      }
      .pretui-reasons-title {
        margin: 0;
        display: flex;
        align-items: center;
        gap: 6px;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-weight: 500;
        letter-spacing: var(--track-eyebrow, 0.08em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .pretui-reasons-count {
        font-variant-numeric: tabular-nums;
        min-width: 1.4em;
        height: 1.4em;
        padding: 0 0.35em;
        border-radius: 999px;
        display: inline-grid;
        place-items: center;
        letter-spacing: 0;
        background: color-mix(
          in oklch,
          var(--destructive) 16%,
          var(--card)
        );
        color: color-mix(
          in oklch,
          var(--foreground) 30%,
          var(--destructive)
        );
      }
      .pretui-reasons-list {
        margin: 0;
        padding: 0 0 0 1.1em;
        display: grid;
        gap: 3px;
        list-style: disc;
      }
      .pretui-reasons-item {
        font-size: var(--text-ui-md, 12.5px);
        color: var(--foreground);
        overflow-wrap: break-word;
      }

      /* Gate rows. The tint is generated from the row's own tone token —
         the technique review-section arrived at independently, which is
         Law 2. */
      .pretui-gates {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: var(--space-2, 6px);
      }
      .pretui-gate {
        display: flex;
        align-items: center;
        gap: var(--space-3, 8px);
        min-height: 34px;
        padding: var(--space-2, 6px) var(--space-3, 8px);
        border-radius: var(--radius-chip, 6px);
        background: color-mix(
          in oklch,
          var(--pretui-gate-tone, var(--muted-foreground)) 10%,
          var(--card)
        );
      }
      .pretui-gate-glyph {
        flex: none;
        width: 16px;
        text-align: center;
        font-size: 12px;
        line-height: 1;
        color: var(--pretui-gate-tone, var(--muted-foreground));
      }
      .pretui-gate-body {
        display: grid;
        gap: 1px;
        min-width: 0;
        flex: 1;
      }
      .pretui-gate-name {
        font-size: var(--text-ui-md, 12.5px);
        font-weight: 500;
        color: var(--foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pretui-gate-caption {
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
        overflow-wrap: break-word;
      }
      .pretui-gate-side {
        flex: none;
        display: flex;
        align-items: center;
        gap: var(--space-2, 6px);
      }
      /* A skipped gate is quiet, but it is still there and still named —
         the one place opacity is used, and it never falls below the 4.5:1
         floor because the tone is already muted. */
      .pretui-gate[data-state='skipped'] .pretui-gate-name {
        color: var(--muted-foreground);
      }

      /* Narrow containers stack the side column under the name rather than
         crushing the name. Unnamed query against this block's own box. */
      .pretui-readiness {
        container-type: inline-size;
      }
      @container (max-width: 26rem) {
        .pretui-gate {
          flex-wrap: wrap;
        }
        .pretui-gate-side {
          width: 100%;
          padding-left: calc(16px + var(--space-3, 8px));
        }
        .pretui-verdict {
          flex-wrap: wrap;
        }
        .pretui-verdict-actions {
          width: 100%;
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
