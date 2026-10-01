// Pretui — Onboarding: a first-run checklist that tracks what is done.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { Button } from './button';
import { StepList } from './step-list';
import type { StepItem } from './step-list';
import { EmptyState } from './empty-state';

// ── Onboarding ───────────────────────────────────────────────────────────
// The first-run walkthrough. Four decisions carry it:
//
//   · The rail is `StepList`, the same component SessionPrep uses, so the
//     kit has one visual grammar for "where am I in a sequence".
//   · The media is a slot, not a prop. An onboarding step shows a video, a
//     screenshot, a live component or nothing, and no prop shape covers all
//     four (Law 7).
//   · Position is announced. "Step 2 of 4 — Attach a card" goes to a polite
//     live region, because a walkthrough whose progress is only visible is a
//     walkthrough a screen-reader user has to count.
//   · Skip is always available and never hidden behind a corner glyph. A
//     walkthrough you cannot leave is a modal, and this is not one.

export interface OnboardingStep {
  /** stable id */
  id: string;
  /** the step's heading, also its rail caption */
  title: string;
  /** the step's copy */
  body?: string;
  /** shorter caption for the rail, when the title is too long for it */
  caption?: string;
}

export interface OnboardingSignature {
  Args: {
    /** the walkthrough, in order */
    steps: OnboardingStep[];
    /** controlled step index */
    current?: number;
    /** starting index when uncontrolled (default 0) */
    defaultCurrent?: number;
    /** fires with the requested index */
    onStepChange?: (index: number) => void;
    /** fires when the reader finishes the last step */
    onDone?: () => void;
    /** fires when the reader leaves early; omit to hide the skip */
    onSkip?: () => void;
    /** accessible name for the whole scene (default 'Getting started') */
    label?: string;
    /** final-step button wording (default 'Get started') */
    doneLabel?: string;
    /** skip wording (default 'Skip') */
    skipLabel?: string;
    /** rail presentation, passed to StepList (default 'track') */
    variant?: 'steps' | 'track';
  };
  Blocks: {
    /** the step's illustration — receives the step and its index */
    media: [step: OnboardingStep, index: number];
  };
  Element: HTMLElement;
}

export class Onboarding extends Component<OnboardingSignature> {
  @tracked private innerCurrent?: number;

  private sceneId = guidFor(this) + '-scene';

  get steps(): OnboardingStep[] {
    return this.args.steps ?? [];
  }
  get count(): number {
    return this.steps.length;
  }
  get current(): number {
    let requested =
      this.args.current ?? this.innerCurrent ?? this.args.defaultCurrent ?? 0;
    if (this.count === 0) {
      return 0;
    }
    return Math.min(Math.max(Math.round(requested), 0), this.count - 1);
  }
  get step(): OnboardingStep | undefined {
    return this.steps[this.current];
  }
  get railSteps(): StepItem[] {
    return this.steps.map((step) => ({
      label: step.caption ?? step.title,
    }));
  }
  get isFirst(): boolean {
    return this.current === 0;
  }
  get isLast(): boolean {
    return this.count === 0 || this.current === this.count - 1;
  }
  get label(): string {
    return this.args.label ?? 'Getting started';
  }
  get nextLabel(): string {
    return this.isLast ? (this.args.doneLabel ?? 'Get started') : 'Next';
  }
  get position(): string {
    if (!this.step) {
      return '';
    }
    return (
      'Step ' +
      (this.current + 1) +
      ' of ' +
      this.count +
      ' — ' +
      this.step.title
    );
  }

  private go = (index: number) => {
    if (this.args.current === undefined) {
      this.innerCurrent = index;
    }
    this.args.onStepChange?.(index);
  };

  back = () => {
    if (!this.isFirst) {
      this.go(this.current - 1);
    }
  };

  next = () => {
    if (this.isLast) {
      this.args.onDone?.();
      return;
    }
    this.go(this.current + 1);
  };

  skip = () => this.args.onSkip?.();

  <template>
    <section
      class='pretui-onb'
      aria-label={{this.label}}
      data-test-pretui-onboarding
      ...attributes
    >
      {{#if this.railSteps.length}}
        <StepList
          @steps={{this.railSteps}}
          @current={{this.current}}
          @variant={{if @variant @variant 'track'}}
          @label='Walkthrough progress'
        />
      {{/if}}

      <span class='pretui-sr' role='status'>{{this.position}}</span>

      {{#if this.step}}
        <div class='pretui-onb-scene' id={{this.sceneId}}>
          {{#if (has-block 'media')}}
            <div class='pretui-onb-media'>
              {{yield this.step this.current to='media'}}
            </div>
          {{/if}}
          <div class='pretui-onb-copy'>
            <h3 class='pretui-onb-title'>{{this.step.title}}</h3>
            {{#if this.step.body}}
              <p class='pretui-onb-body'>{{this.step.body}}</p>
            {{/if}}
          </div>
        </div>
      {{else}}
        <EmptyState
          @title='Nothing to walk through'
          @message='This walkthrough has no steps yet.'
        />
      {{/if}}

      <div class='pretui-onb-nav'>
        {{#if @onSkip}}
          <Button
            @tone='neutral'
            @appearance='plain'
            @size='s'
            data-test-pretui-onboarding-skip
            {{on 'click' this.skip}}
          >{{if @skipLabel @skipLabel 'Skip'}}</Button>
        {{/if}}
        <span class='pretui-onb-nav-end'>
          <Button
            @tone='neutral'
            @appearance='outlined'
            @size='s'
            @disabled={{if this.isFirst true}}
            data-test-pretui-onboarding-back
            {{on 'click' this.back}}
          >Back</Button>
          <Button
            @size='s'
            @disabled={{unless this.step true}}
            aria-controls={{this.sceneId}}
            data-test-pretui-onboarding-next
            {{on 'click' this.next}}
          >{{this.nextLabel}}</Button>
        </span>
      </div>
    </section>

    <style scoped>
      .pretui-onb {
        display: flex;
        flex-direction: column;
        gap: var(--space-4, 13px);
        padding: var(--space-4, 15px);
        border-radius: var(--radius-surface, 14px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-card,
          0 0 0 1px var(--border),
          0 1px 2px rgb(0 0 0 / 0.08)
        );
        font-size: var(--text-ui-md, 12.5px);
        container-type: inline-size;
      }
      .pretui-onb-scene {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: var(--space-4, 15px);
        align-items: center;
        min-height: 9rem;
      }
      .pretui-onb-scene:not(:has(.pretui-onb-media)) {
        grid-template-columns: minmax(0, 1fr);
      }
      /* unnamed container query — resolves against .pretui-onb */
      @container (max-width: 34rem) {
        .pretui-onb-scene {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .pretui-onb-media {
        border-radius: 10px;
        overflow: hidden;
        background: var(--inset, var(--boxel-100));
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
      }
      .pretui-onb-copy {
        min-width: 0;
      }
      .pretui-onb-title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        letter-spacing: -0.02em;
      }
      .pretui-onb-body {
        margin: 6px 0 0;
        max-width: 52ch;
        line-height: 1.65;
        color: var(--muted-foreground);
      }
      .pretui-onb-nav {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .pretui-onb-nav-end {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-left: auto;
      }
      .pretui-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
    </style>
  </template>
}
