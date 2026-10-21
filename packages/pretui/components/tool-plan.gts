// Pretui — ToolPlan: a run's plan as a checklist that ticks, on ToolRow's grid.
import Component from '@glimmer/component';
import { PlanMark } from './plan-mark';

export type ToolPlanStepState = 'done' | 'current' | 'next' | 'failed' | 'skipped';

export interface ToolPlanStep {
  label: string;
  state: ToolPlanStepState;
  /** a quieter note after the label: "3 of 5", "kept 4" */
  note?: string;
  /** what the step did, one small line each under its label: "3 results
   * for running clubs Manhattan" */
  details?: string[];
}

export interface ToolPlanSignature {
  Args: {
    steps: ToolPlanStep[];
    /** the list's accessible name. Default 'Plan' */
    label?: string;
    /** 'compact' (default) sits in a ToolRow's 16px disc column;
     * 'comfortable' is a checklist read on its own, as TaskChecklist shows it */
    density?: 'compact' | 'comfortable';
  };
  Element: HTMLOListElement;
}

const SPOKEN: Record<ToolPlanStepState, string> = {
  done: 'done',
  current: 'in progress',
  next: 'not started',
  failed: 'failed',
  skipped: 'skipped',
};

/**
 * The steps a run means to take, shown before it takes them, so the reader
 * sees how far it is and what comes next:
 *
 * ```hbs
 * <ToolRow @name='research' @state='running' @framed={{true}}>
 *   <:rows><ToolPlan @steps={{this.steps}} /></:rows>
 * </ToolRow>
 * ```
 */
export class ToolPlan extends Component<ToolPlanSignature> {
  spoken = (state: ToolPlanStepState) => SPOKEN[state];
  get markSize(): number {
    return this.args.density === 'comfortable' ? 16 : 14;
  }
  isCurrent = (state: ToolPlanStepState) =>
    state === 'current' ? 'step' : undefined;
  <template>
    <ol
      class='pretui-toolplan'
      data-density={{if @density @density 'compact'}}
      aria-label={{if @label @label 'Plan'}}
      data-test-pretui-tool-plan
      ...attributes
    >
      {{! keyed by label: a caller that rebuilds its steps (a clock, a
          poll) keeps each row, so a running ring keeps turning }}
      {{#each @steps key='label' as |step|}}
        <li
          class='pretui-toolplan-step'
          data-scroll-anchor
          data-state={{step.state}}
          aria-current={{this.isCurrent step.state}}
          data-test-pretui-tool-plan-step={{step.state}}
        >
          <PlanMark class='pretui-toolplan-glyph' @state={{step.state}} @size={{this.markSize}} />
          <span class='pretui-toolplan-label'>
            {{step.label}}
            <span class='pretui-toolplan-spoken'>, {{this.spoken
                step.state
              }}</span>
            {{#if step.note}}<span
                class='pretui-toolplan-note'
              >{{step.note}}</span>{{/if}}
          </span>
          {{#if step.details.length}}
            <ul class='pretui-toolplan-details'>
              {{#each step.details as |detail|}}
                <li class='pretui-toolplan-detail'>{{detail}}</li>
              {{/each}}
            </ul>
          {{/if}}
        </li>
      {{/each}}
    </ol>
    <style scoped>
      @layer PretComponent {
        .pretui-toolplan {
          display: grid;
          gap: 1px;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        /* ToolLine's grid: the glyph in the disc column, the words on the
           row's text edge */
        .pretui-toolplan-step {
          display: grid;
          grid-template-columns: var(--pretui-toolrow-disc, 16px) minmax(0, 1fr);
          column-gap: var(--pretui-toolrow-gap, 8px);
          align-items: center;
          font-size: var(--type-ui, 12.5px);
          line-height: var(--leading-ui, 18px);
          color: var(--pretui-toolrow-settled-ink, var(--foreground));
        }
        .pretui-toolplan-glyph {
          justify-self: center;
          align-self: center;
        }
        /* done steps step back; the step under way and what is left keep
           the ink, so the eye lands on the work still to do */
        .pretui-toolplan-step[data-state='done'] {
          color: var(--ink-2, var(--muted-foreground));
        }
        .pretui-toolplan-step[data-state='current'] {
          color: var(--foreground);
        }
        .pretui-toolplan-step[data-state='next'] {
          color: var(--foreground);
        }
        .pretui-toolplan-step[data-state='skipped'] {
          color: var(--ink-3, var(--muted-foreground));
        }
        .pretui-toolplan-step[data-state='skipped'] .pretui-toolplan-label {
          text-decoration: line-through;
        }
        /* a failed step keeps ink-1: its mark carries the state */
        .pretui-toolplan-step[data-state='failed'] {
          color: var(--foreground);
        }
        .pretui-toolplan[data-density='comfortable'] {
          gap: var(--step-8, 8px);
        }
        .pretui-toolplan[data-density='comfortable'] .pretui-toolplan-step {
          grid-template-columns: 16px minmax(0, 1fr);
          column-gap: var(--step-8, 8px);
          align-items: center;
        }
        .pretui-toolplan-label {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .pretui-toolplan-note {
          margin-inline-start: var(--step-8, 8px);
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          font-weight: 400;
          font-variant-numeric: tabular-nums;
          color: var(--ink-3, var(--muted-foreground));
        }
        /* what a step did sits under its words, smaller and quieter: it
           belongs to the step, it is not a step of its own */
        .pretui-toolplan-details {
          grid-column: 2;
          display: grid;
          gap: 2px;
          margin: 2px 0 var(--step-4, 4px);
          padding: 0;
          list-style: none;
          font-size: var(--type-caption, 11px);
          line-height: var(--leading-caption, 16px);
          color: var(--ink-3, var(--muted-foreground));
        }
        .pretui-toolplan-detail {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        /* the state in words, for a reader who does not see the glyph */
        .pretui-toolplan-spoken {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
      }
    </style>
  </template>
}
