// Pretui — Wizard: a multi-step flow with validated navigation.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { Button } from './button';
import { EmptyState } from './empty-state';
import { StepList } from './step-list';
import type { StepItem, StepListVariant, StepState } from './step-list';
import { focusOnToken } from '../internal/structure-flow';

// ═════════════════════════════════════════════════════════════════════════
// Wizard
// ═════════════════════════════════════════════════════════════════════════
//
// From `b6ac3a-survey/components/form-wizard.gts` +
// `boxel-surface/src/components/form-wizard.gts` (the well-shaped rail) and
// `aef6db-stepper/stepper.gts` (the token ladder and the yielded api).
//
// Better than the inspiration, point by point:
//
//  1. **`back()` fires the change callback.** `aef6db-stepper` mutated the
//     index directly on the way back and bypassed its own `enter()`, so a
//     consumer persisting progress silently lost every backwards move. Here
//     there is exactly one mover (`travel`) and every path goes through it.
//  2. **The rail is not a second StepList.** Both upstreams hand-rolled a
//     numbered rail with its own state palette. Pretui already ships that
//     component, complete with the marker glyph set, the reserved detail
//     line, the summary and the container-query fold — so Wizard derives
//     `StepItem[]` and hands it over. A `<:rail>` block replaces it wholesale
//     for anyone who wants a clickable rail; the api is yielded into that
//     block, so `goTo`/`canGoTo` are right there.
//  3. **The rail is deliberately NOT a tablist.** `role='tab'` promises
//     equal, freely-selectable panels and takes `aria-selected` with it; a
//     gated flow has neither property, and a screen-reader user told "tab 4
//     of 6" will try to reach step 4. `<ol>` + `aria-current='step'` — which
//     is what StepList already emits — is the honest markup, and it is what
//     every design system that has thought about it (GOV.UK, SLDS) uses.
//  4. **Refusal explains itself.** Both upstreams wrote
//     `disabled={{if this.canAdvance false true}}` — an inverted-boolean
//     contortion producing a dead button with no stated reason. Here the
//     primary stays focusable and clickable with `aria-disabled='true'`; a
//     refused activation reveals `blockedReason` in a `role='alert'` slot
//     the button is `aria-describedby`. Nobody is left clicking a grey box.
//  5. **Jumping obeys the gate.** `@allowStepJump` let a reader land on step
//     5 while step 1 was invalid. `canGoTo` is one predicate, honoured by
//     the rail block, the api and the footer alike, and `@navigation`
//     (`linear | visited | free`) names the policy instead of leaving it
//     implicit.
//  6. **`activeIndex` is range-checked.** Neither upstream clamped, so an
//     out-of-range index rendered an empty panel with a live rail.
//  7. **One live region, not two.** StepList announces state changes; Wizard
//     announces position ("Step 2 of 5: Shipping"). Running both would
//     double-speak every move, so Wizard passes `@announce={{false}}` down
//     and owns the announcement, because position is the thing that changed.
//  8. **Focus follows the step.** Neither upstream moved focus at all, so a
//     keyboard user pressing Next stayed on a button whose panel had been
//     replaced underneath them. The panel is `tabindex='-1'` and takes focus
//     on every navigation — never on first render.
//  9. **`:focus-visible` with a real `outline`.** Both upstreams used
//     `outline: 0` plus a `box-shadow` ring, which vanishes entirely under
//     forced-colors, and `:focus` rather than `:focus-visible`, so a mouse
//     click painted the ring.
//
// Dropped upstream surface: `aef6db-stepper`'s modal mode (a wizard inside a
// dialog is `<Dialog><Wizard/></Dialog>` — Dialog already owns the
// focus trap, Esc and `aria-modal` that the upstream's 716 lines never
// implemented), and its `@allowStepJump` boolean (superseded by the
// three-valued `@navigation`).

export type WizardNavigation = 'linear' | 'visited' | 'free';

export type WizardReason = 'next' | 'back' | 'skip' | 'jump';

export interface WizardStep {
  /** Stable identity. Used for `api.isStep` and as the key of the rail. */
  id: string;
  /** The rail label, and the panel's title unless `@hideTitle`. */
  label: string;
  /** One line under the label on the rail — what this stage is for. */
  detail?: string;
  /** An optional step gets a Skip control and is never a blocker. */
  optional?: boolean;
  /**
   * **What a step declares about its own validity.** `false` blocks forward
   * navigation OUT of this step (and, on the last step, completion).
   * `undefined` means "not declared", which is treated as valid — a wizard
   * whose caller has no validation must still work.
   */
  valid?: boolean;
  /**
   * Why it is not valid. Shown, and announced, only after the reader has
   * actually been refused — a pristine form must not open shouting.
   */
  blockedReason?: string;
  /**
   * Force the rail state (`error`, `in-progress`, …). Wins over the
   * derivation. For a step whose server-side check failed after the reader
   * had already moved on.
   */
  state?: StepState;
}

export interface WizardChange {
  /** The index navigated away from. */
  from: number;
  reason: WizardReason;
}

export interface WizardApi {
  steps: WizardStep[];
  activeIndex: number;
  activeStep: WizardStep | undefined;
  /** Highest index reached so far — what `visited` navigation is measured against. */
  furthest: number;
  isFirst: boolean;
  isLast: boolean;
  /** True when the active step permits leaving it forward. */
  canAdvance: boolean;
  /** True once a forward move has been refused; resets on any successful move. */
  refused: boolean;
  /** The refusal text currently on show, or undefined. */
  refusalText: string | undefined;
  next: () => void;
  back: () => void;
  skip: () => void;
  goTo: (index: number) => void;
  canGoTo: (index: number) => boolean;
  isStep: (id: string) => boolean;
  wasSkipped: (id: string) => boolean;
}

export interface WizardSignature {
  Args: {
    /** The ordered stages. */
    steps: WizardStep[];
    /** Controlled active index. Omit and seed `@defaultActiveIndex`. */
    activeIndex?: number;
    /** Uncontrolled seed. Default 0. */
    defaultActiveIndex?: number;
    /** Fires on every move, backwards included. */
    onStepChange?: (index: number, change: WizardChange) => void;
    /** Fires when the terminal step's primary is activated and allowed. */
    onComplete?: () => void;
    /** Fires when a forward move was refused, with the index refused at. */
    onRefused?: (index: number) => void;
    /**
     * Coarse override of the per-step `valid` flag, for callers holding
     * validation outside the step model. Resolution order:
     * `@canAdvance ?? step.valid ?? true`.
     */
    canAdvance?: boolean;
    /**
     * How freely a reader may move.
     * `linear` — Back and Next only.
     * `visited` (default) — back to anywhere already reached, forward through the gate.
     * `free` — anywhere, any time.
     */
    navigation?: WizardNavigation;
    /** Accessible name for the rail. Default 'Steps'. */
    label?: string;
    /** Rail presentation, forwarded to StepList. */
    railVariant?: StepListVariant;
    /** Show StepList's '3 of 5 complete' summary above the rail. */
    summary?: boolean;
    /** Suppress the panel's title line — for a panel that heads itself. */
    hideTitle?: boolean;
    /** The primary is busy (an async commit is in flight). */
    busy?: boolean;
    /** Footer wording. */
    backLabel?: string;
    nextLabel?: string;
    skipLabel?: string;
    completeLabel?: string;
    /** Heading for the zero-steps state. */
    emptyTitle?: string;
  };
  Blocks: {
    /** The active step's content. Receives (step, index, api). */
    step: [WizardStep, number, WizardApi];
    /** Replaces the StepList rail entirely — this is where a clickable rail goes. */
    rail: [WizardApi];
    /** Replaces the Back / Skip / Next footer. */
    footer: [WizardApi];
  };
  Element: HTMLDivElement;
}

const DEFAULT_REFUSAL = 'This step is not finished yet.';

export class Wizard extends Component<WizardSignature> {
  private guid = guidFor(this);

  @tracked private internalIndex = this.args.defaultActiveIndex ?? 0;
  @tracked private furthestSeen = this.args.defaultActiveIndex ?? 0;
  @tracked private skippedIds: string[] = [];
  /** Set by a refused move; cleared by any successful one. */
  @tracked refused = false;
  /** Monotonic; every increment is one navigation, and drives panel focus. */
  @tracked private navToken = 0;

  get panelId(): string {
    return this.guid + '-panel';
  }
  get titleId(): string {
    return this.guid + '-title';
  }
  get refusalId(): string {
    return this.guid + '-refusal';
  }

  get steps(): WizardStep[] {
    return this.args.steps ?? [];
  }
  get hasSteps(): boolean {
    return this.steps.length > 0;
  }
  get lastIndex(): number {
    return Math.max(0, this.steps.length - 1);
  }
  /** Range-checked, which neither upstream did. */
  get activeIndex(): number {
    let raw = this.args.activeIndex ?? this.internalIndex;
    if (!Number.isFinite(raw)) {
      return 0;
    }
    return Math.max(0, Math.min(this.lastIndex, Math.trunc(raw)));
  }
  get activeStep(): WizardStep | undefined {
    return this.steps[this.activeIndex];
  }
  get furthest(): number {
    // Read-only max: a controlled caller may move the index without going
    // through `travel`, and writing a tracked field from a getter is how you
    // earn a backtracking assertion.
    return Math.max(this.furthestSeen, this.activeIndex);
  }
  get navigation(): WizardNavigation {
    return this.args.navigation ?? 'visited';
  }
  get isFirst(): boolean {
    return this.activeIndex === 0;
  }
  get isLast(): boolean {
    return this.activeIndex === this.lastIndex;
  }
  get canAdvance(): boolean {
    return this.args.canAdvance ?? this.activeStep?.valid ?? true;
  }
  get stepNumber(): number {
    return this.activeIndex + 1;
  }
  get stepCount(): number {
    return this.steps.length;
  }

  // ── skip bookkeeping ───────────────────────────────────────────────────
  wasSkipped = (id: string): boolean => this.skippedIds.includes(id);
  get showSkip(): boolean {
    return Boolean(this.activeStep?.optional);
  }

  // ── the rail model ─────────────────────────────────────────────────────
  // Derived, never mutated in place: the caller's step objects are theirs.
  get railSteps(): StepItem[] {
    let active = this.activeIndex;
    let blocked = this.refused && !this.canAdvance;
    return this.steps.map((step, i) => {
      let skipped = this.wasSkipped(step.id);
      let state: StepState =
        step.state ??
        (i < active
          ? skipped
            ? 'upcoming'
            : 'complete'
          : i === active
            ? blocked
              ? 'blocked'
              : 'current'
            : 'upcoming');
      let detail =
        step.detail ??
        (skipped && i < active
          ? 'Skipped'
          : step.optional && i >= active
            ? 'Optional'
            : undefined);
      return { label: step.label, state, detail };
    });
  }

  // ── refusal ────────────────────────────────────────────────────────────
  get refusalText(): string | undefined {
    if (!this.refused || this.canAdvance) {
      return undefined;
    }
    return this.activeStep?.blockedReason ?? DEFAULT_REFUSAL;
  }
  get nextDisabledAttr(): string {
    return this.canAdvance ? 'false' : 'true';
  }
  get backDisabledAttr(): string {
    return this.isFirst ? 'true' : 'false';
  }

  // ── announcement ───────────────────────────────────────────────────────
  // Position, politely, once per move. A live region never announces its
  // initial content, so this is silent on mount.
  get announcement(): string {
    if (!this.hasSteps || !this.activeStep) {
      return '';
    }
    return (
      'Step ' +
      this.stepNumber +
      ' of ' +
      this.stepCount +
      ': ' +
      this.activeStep.label
    );
  }

  // ── movement ───────────────────────────────────────────────────────────
  canGoTo = (index: number): boolean => {
    if (!this.hasSteps || index < 0 || index > this.lastIndex) {
      return false;
    }
    if (index === this.activeIndex) {
      return true;
    }
    if (index < this.activeIndex) {
      return this.navigation === 'linear'
        ? index === this.activeIndex - 1
        : true;
    }
    if (this.navigation === 'free') {
      return true;
    }
    // Forward always passes through this step's own gate — that is the fix
    // for the upstream's "jump to 5 while 1 is invalid".
    if (!this.canAdvance) {
      return false;
    }
    if (this.navigation === 'linear') {
      return index === this.activeIndex + 1;
    }
    return index <= Math.max(this.furthest, this.activeIndex + 1);
  };

  private refuse = (): void => {
    this.refused = true;
    this.args.onRefused?.(this.activeIndex);
  };

  /**
   * The one mover. Every path — Next, Back, Skip, a rail jump, the yielded
   * api — goes through here, which is why `onStepChange` can no longer be
   * skipped on the way back (the upstream's real bug). `force` exists for
   * Skip alone: bypassing this step's gate is precisely what "optional"
   * means.
   */
  private travel = (
    index: number,
    reason: WizardReason,
    force = false,
  ): void => {
    if (!force && !this.canGoTo(index)) {
      this.refuse();
      return;
    }
    let from = this.activeIndex;
    if (index === from) {
      return;
    }
    this.refused = false;
    this.navToken = this.navToken + 1;
    if (index > this.furthestSeen) {
      this.furthestSeen = index;
    }
    if (this.args.activeIndex === undefined) {
      this.internalIndex = index;
    }
    this.args.onStepChange?.(index, { from, reason });
  };

  next = (): void => {
    if (this.isLast) {
      this.finish();
      return;
    }
    this.travel(this.activeIndex + 1, 'next');
  };

  /** Backwards moves fire `onStepChange` — the upstream's real bug. */
  back = (): void => {
    if (this.isFirst) {
      return;
    }
    this.travel(this.activeIndex - 1, 'back');
  };

  skip = (): void => {
    let step = this.activeStep;
    if (!step?.optional) {
      return;
    }
    if (!this.wasSkipped(step.id)) {
      this.skippedIds = [...this.skippedIds, step.id];
    }
    if (this.isLast) {
      this.args.onComplete?.();
      return;
    }
    this.travel(this.activeIndex + 1, 'skip', true);
  };

  goTo = (index: number): void => {
    this.travel(index, 'jump');
  };

  /** The terminal step: the primary commits rather than advances. */
  finish = (): void => {
    if (!this.canAdvance) {
      this.refuse();
      return;
    }
    this.args.onComplete?.();
  };

  isStep = (id: string): boolean => this.activeStep?.id === id;

  get primaryLabel(): string {
    return this.isLast
      ? (this.args.completeLabel ?? 'Finish')
      : (this.args.nextLabel ?? 'Next');
  }

  get api(): WizardApi {
    return {
      steps: this.steps,
      activeIndex: this.activeIndex,
      activeStep: this.activeStep,
      furthest: this.furthest,
      isFirst: this.isFirst,
      isLast: this.isLast,
      canAdvance: this.canAdvance,
      refused: this.refused,
      refusalText: this.refusalText,
      next: this.next,
      back: this.back,
      skip: this.skip,
      goTo: this.goTo,
      canGoTo: this.canGoTo,
      isStep: this.isStep,
      wasSkipped: this.wasSkipped,
    };
  }

  <template>
    <div
      class='pretui-wizard'
      data-state={{if @busy 'busy' (if this.refused 'refused' 'idle')}}
      data-navigation={{this.navigation}}
      data-first={{if this.isFirst 'true' 'false'}}
      data-last={{if this.isLast 'true' 'false'}}
      data-test-pretui-wizard
      ...attributes
    >
      {{#if this.hasSteps}}
        <div class='pretui-wizard-rail' data-test-pretui-wizard-rail>
          {{#if (has-block 'rail')}}
            {{yield this.api to='rail'}}
          {{else}}
            <StepList
              @steps={{this.railSteps}}
              @current={{this.activeIndex}}
              @label={{@label}}
              @variant={{@railVariant}}
              @summary={{@summary}}
              @announce={{false}}
            />
          {{/if}}
        </div>

        <div
          class='pretui-wizard-panel'
          id={{this.panelId}}
          role='group'
          aria-labelledby={{this.titleId}}
          tabindex='-1'
          data-test-pretui-wizard-panel
          {{focusOnToken this.navToken}}
        >
          <p
            class='pretui-wizard-title'
            id={{this.titleId}}
            data-hidden={{if @hideTitle 'true' 'false'}}
            data-test-pretui-wizard-title
          >{{this.activeStep.label}}</p>
          {{#if this.activeStep}}
            {{yield this.activeStep this.activeIndex this.api to='step'}}
          {{/if}}
        </div>

        {{!--
          Always rendered, so it reserves its line and so the alert region
          exists before it has anything to say. An empty live region is
          silent; one that is inserted already-populated is a race.
        --}}
        <p
          class='pretui-wizard-refusal'
          id={{this.refusalId}}
          role='alert'
          data-test-pretui-wizard-refusal
        >{{this.refusalText}}</p>

        <div class='pretui-wizard-footer' data-test-pretui-wizard-footer>
          {{#if (has-block 'footer')}}
            {{yield this.api to='footer'}}
          {{else}}
            <Button
              @tone='neutral'
              @appearance='outlined'
              aria-disabled={{this.backDisabledAttr}}
              data-test-pretui-wizard-back
              {{on 'click' this.back}}
            >{{if @backLabel @backLabel 'Back'}}</Button>
            <span class='pretui-wizard-gap'></span>
            {{#if this.showSkip}}
              <Button
                @tone='neutral'
                @appearance='plain'
                data-test-pretui-wizard-skip
                {{on 'click' this.skip}}
              >{{if @skipLabel @skipLabel 'Skip'}}</Button>
            {{/if}}
            <Button
              @tone='primary'
              @appearance='accent'
              @busy={{@busy}}
              aria-disabled={{this.nextDisabledAttr}}
              aria-describedby={{this.refusalId}}
              data-test-pretui-wizard-next
              {{on 'click' this.next}}
            >{{this.primaryLabel}}</Button>
          {{/if}}
        </div>

        <span
          class='pretui-sr'
          role='status'
          data-test-pretui-wizard-live
        >{{this.announcement}}</span>
      {{else}}
        {{!-- Zero steps renders a stated empty state rather than an empty
              box with a live footer. --}}
        <EmptyState
          @title={{if @emptyTitle @emptyTitle 'Nothing to complete'}}
          @message='This flow has no steps.'
          @texture={{false}}
          data-test-pretui-wizard-empty
        />
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        /* Unnamed container (the named forms silently delete every rule that
           follows them) — the footer folds against the wizard's own box, not
           the viewport, because a card never knows the viewport. */
        .pretui-wizard {
          container-type: inline-size;
          display: grid;
          gap: var(--pretui-wizard-gap, var(--space-5, 16px));
          min-width: 0;
          font-size: var(--text-ui-md, 12.5px);
          color: var(--foreground);
        }
        .pretui-wizard-rail {
          min-width: 0;
        }
        .pretui-wizard-panel {
          display: grid;
          gap: var(--space-4, 12px);
          align-content: start;
          min-width: 0;
          min-block-size: var(--pretui-wizard-panel-min-h, 6rem);
          padding: var(--pretui-wizard-panel-pad, var(--space-5, 16px));
          border-radius: var(--radius-surface, 10px);
          background: var(--card);
          box-shadow: 0 0 0 1px var(--border);
        }
        /* The panel takes focus on navigation, so it needs a focus ring of its
           own — and a real outline, which forced-colors preserves and the
           box-shadow ring both upstreams used does not. */
        .pretui-wizard-panel:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-wizard-title {
          margin: 0;
          font-family: var(--font-serif);
          font-size: var(--text-heading, 19px);
          line-height: 1.25;
        }
        /* Hidden from sight, never from the accessibility tree: it is the
           panel group's accessible name. */
        .pretui-wizard-title[data-hidden='true'] {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          padding: 0;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
        /* Reserved line: a refusal arriving late must not shove the footer
           down the page (Appendix O — a value that arrives late reserves its
           space). */
        .pretui-wizard-refusal {
          margin: 0;
          min-height: 1.35em;
          font-size: var(--text-ui-sm, 11.5px);
          font-weight: 500;
          color: var(--pretui-wizard-refusal-color, var(--destructive));
        }
        .pretui-wizard-footer {
          display: flex;
          align-items: center;
          gap: var(--space-3, 8px);
          min-width: 0;
          flex-wrap: wrap;
        }
        .pretui-wizard-gap {
          flex: 1 1 auto;
          min-width: 0;
        }
        /* Narrow box: the footer stops being a row of small targets and
           becomes a stack of full-width ones. */
        @container (max-width: 22rem) {
          .pretui-wizard-footer {
            display: grid;
            grid-auto-flow: row;
            gap: var(--space-2, 6px);
          }
          .pretui-wizard-gap {
            display: none;
          }
        }
        /* Coarse pointers get the 44px hit target the desktop control does not
           need — applied to the footer's own children so a caller's <:footer>
           inherits it too. */
        @media (any-pointer: coarse) {
          .pretui-wizard-footer > * {
            min-height: 44px;
          }
        }
        .pretui-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          padding: 0;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
          border: 0;
        }
      }
    </style>
  </template>
}
