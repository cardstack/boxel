// Pretui — TaskChecklist: what the agent is doing now, over the plan it is working through.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import ChevronRightIcon from '@cardstack/boxel-icons/chevron-right';
import { ToolPlan } from './tool-plan';
import type { ToolPlanStep } from './tool-plan';

export interface TaskChecklistSignature {
  Args: {
    steps: ToolPlanStep[];
    /** what the agent is doing this moment, in its own words: "Fixing the
     * regex lint error; read host approval test". Shimmers while it runs */
    activity?: string;
    /** open the activity's detail (the call it is making). Omit and the
     * line is plain text */
    onActivity?: () => void;
    /** the run is still going. Default: a step is under way */
    running?: boolean;
    /** the list's accessible name. Default 'Tasks' */
    label?: string;
  };
  Element: HTMLElement;
}

/**
 * The plan the agent keeps while it works, as the reader follows it: the
 * thing it is doing now on one line, then every step with its mark — a
 * soft tick for done, a thin turning ring for the one under way, a dashed
 * circle for what is left. Steps finish in any order; a done step steps
 * back in ink so the eye lands on the work still to do. One soft card, no
 * stripe.
 */
export class TaskChecklist extends Component<TaskChecklistSignature> {
  get running(): boolean {
    return (
      this.args.running ??
      this.args.steps.some((step) => step.state === 'current')
    );
  }
  get done(): number {
    return this.args.steps.filter((step) => step.state === 'done').length;
  }
  get summary(): string {
    return `${this.done} of ${this.args.steps.length} done`;
  }
  activity = () => this.args.onActivity?.();
  <template>
    <section
      class='pretui-checklist'
      data-running={{if this.running 'true'}}
      aria-label={{if @label @label 'Tasks'}}
      data-test-pretui-task-checklist
      ...attributes
    >
      {{#if @activity}}
        {{#if @onActivity}}
          <button
            type='button'
            class='pretui-checklist-activity'
            data-test-pretui-task-checklist-activity
            {{on 'click' this.activity}}
          >
            <span class='pretui-checklist-activity-text'>{{@activity}}</span>
            <ChevronRightIcon
              class='pretui-checklist-chevron'
              width='14'
              height='14'
            />
          </button>
        {{else}}
          <p
            class='pretui-checklist-activity'
            data-test-pretui-task-checklist-activity
          >
            <span class='pretui-checklist-activity-text'>{{@activity}}</span>
          </p>
        {{/if}}
      {{/if}}
      <div class='pretui-checklist-card'>
        <ToolPlan
          @steps={{@steps}}
          @density='comfortable'
          @label={{if @label @label 'Tasks'}}
        />
        <span
          class='pretui-checklist-summary'
          role='status'
          data-test-pretui-task-checklist-summary
        >{{this.summary}}</span>
      </div>
    </section>
    <style scoped>
      @layer PretComponent {
        .pretui-checklist {
          display: grid;
          gap: var(--boxel-sp-xs);
          min-width: 0;
        }
        .pretui-checklist-activity {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          justify-self: start;
          max-width: 100%;
          margin: 0;
          padding: 0;
          border: 0;
          background-color: transparent;
          font-family: inherit;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          text-align: start;
          color: var(--muted-foreground);
        }
        button.pretui-checklist-activity {
          cursor: pointer;
        }
        button.pretui-checklist-activity:hover {
          color: var(--foreground);
        }
        button.pretui-checklist-activity:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
          border-radius: var(--boxel-border-radius-xs);
        }
        .pretui-checklist-activity-text {
          min-width: 0;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
        /* while it runs, the line's tail shimmers as TextShimmer does */
        .pretui-checklist[data-running] .pretui-checklist-activity-text {
          background: linear-gradient(
              90deg,
              var(--muted-foreground) 0%,
              var(--muted-foreground) 40%,
              var(--foreground) 50%,
              var(--muted-foreground) 60%,
              var(--muted-foreground) 100%
            )
            0 0 / 300% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: pretui-checklist-shimmer 2.4s linear infinite;
        }
        @keyframes pretui-checklist-shimmer {
          from {
            background-position: 100% 0;
          }
          to {
            background-position: 0% 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-checklist[data-running] .pretui-checklist-activity-text {
            animation: none;
            background-image: none;
            color: var(--muted-foreground);
          }
        }
        .pretui-checklist-chevron {
          flex: none;
        }
        .pretui-checklist-card {
          padding: var(--boxel-sp-sm);
          border-radius: var(--boxel-border-radius-lg);
          box-shadow: inset 0 0 0 1px var(--border);
          background-color: var(--card);
        }
        /* the count is for a screen reader; the marks say it to the eye */
        .pretui-checklist-summary {
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
