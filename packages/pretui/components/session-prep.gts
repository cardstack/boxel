// Pretui — SessionPrep: the session lifecycle made visible before turn one.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { Button } from './button';
import { StepList } from './step-list';
import type { StepItem, StepState } from './step-list';

// ── SessionPrep ──────────────────────────────────────────────────────────
// Everything an agent does before the first message — summarising the last
// session, reading the file history, assembling context — happens whether or
// not it is shown. The spec's law is that it must be shown, with a way out.
//
// The rail is `StepList` unmodified: it already owns the numbered markers,
// the connector lines, the four-state palette, the per-step state text for
// screen readers, and the derived "2 of 3 complete" summary wired with
// `aria-describedby`. Re-implementing that here would have been a second,
// worse copy — so SessionPrep is the frame, the note, and the escape hatch.
//
// Not built, and named rather than hidden (Law 7): per-step detail lines
// ('41 messages scanned'). `StepItem` is `{label, state}` and widening it is
// StepList's call, not this component's.

export type SessionPrepState = 'pending' | 'running' | 'complete' | 'failed';

export interface SessionPrepStep {
  /** stable id — the {{#each}} key */
  id: string;
  /** what this preparation step does */
  label: string;
  /** where it is (default 'pending') */
  state?: SessionPrepState;
}

const PREP_STATE: Record<SessionPrepState, StepState> = {
  pending: 'upcoming',
  running: 'current',
  complete: 'complete',
  failed: 'error',
};

export interface SessionPrepSignature {
  Args: {
    /** the preparation steps, in order */
    steps: SessionPrepStep[];
    /** heading (default 'Preparing your session') */
    title?: string;
    /** one line under the heading explaining why the wait exists */
    note?: string;
    /** fires when the reader skips the remaining preparation */
    onSkip?: () => void;
    /** skip-button wording (default 'Skip preparation') */
    skipLabel?: string;
    /** rail presentation, passed through to StepList (default 'steps') */
    variant?: 'steps' | 'track';
  };
  Blocks: {
    /** extra content below the rail — a model picker, a skill chooser */
    default: [];
  };
  Element: HTMLElement;
}

export class SessionPrep extends Component<SessionPrepSignature> {
  get steps(): SessionPrepStep[] {
    return this.args.steps ?? [];
  }
  get railSteps(): StepItem[] {
    return this.steps.map((step) => ({
      label: step.label,
      state: PREP_STATE[step.state ?? 'pending'],
    }));
  }
  get current(): number {
    let index = this.steps.findIndex((s) => s.state === 'running');
    return index === -1 ? this.steps.length : index;
  }
  get title(): string {
    return this.args.title ?? 'Preparing your session';
  }
  get skipLabel(): string {
    return this.args.skipLabel ?? 'Skip preparation';
  }
  get done(): boolean {
    return (
      this.steps.length > 0 &&
      this.steps.every((s) => s.state === 'complete' || s.state === 'failed')
    );
  }

  skip = () => this.args.onSkip?.();

  <template>
    <section
      class='pretui-prep'
      data-done={{if this.done 'true'}}
      aria-label={{this.title}}
      data-test-pretui-session-prep
      ...attributes
    >
      <header class='pretui-prep-head'>
        <h3 class='pretui-prep-title'>{{this.title}}</h3>
        {{#if @onSkip}}
          <Button
            @tone='neutral'
            @appearance='plain'
            @size='s'
            data-test-pretui-session-prep-skip
            {{on 'click' this.skip}}
          >{{this.skipLabel}}</Button>
        {{/if}}
      </header>
      {{#if @note}}
        <p class='pretui-prep-note'>{{@note}}</p>
      {{/if}}
      <StepList
        @steps={{this.railSteps}}
        @current={{this.current}}
        @variant={{@variant}}
        @label='Session preparation'
        @summary={{true}}
      />
      {{yield}}
    </section>

    <style scoped>
      @layer PretComponent {
        .pretui-prep {
          display: flex;
          flex-direction: column;
          gap: var(--space-4, 11px);
          padding: var(--space-4, 13px);
          border-radius: var(--radius-surface, 14px);
          background: var(--card);
          box-shadow: var(
            --pretui-shadow-card,
            0 0 0 1px var(--border),
            0 1px 2px rgb(0 0 0 / 0.08)
          );
        }
        .pretui-prep-head {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .pretui-prep-title {
          margin: 0;
          flex: 1;
          min-width: 0;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
        .pretui-prep-note {
          margin: 0;
          max-width: 62ch;
          font-size: var(--text-ui-sm, 11.5px);
          line-height: 1.6;
          color: var(--muted-foreground);
        }
      }
    </style>
  </template>
}
