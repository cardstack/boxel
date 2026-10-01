// Pretui — StepList usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { StepList } from './step-list';
import type { StepItem, StepListVariant } from './step-list';
import { DEPLOY_STEPS } from '../internal/composites-fixtures';

// Dropped knobs: @onSelectionChange/@selectedKey/@isReadOnly (Spectrum's
// steps are selectable links; wave-0 renders a presentational rail —
// nothing to mis-click), @size, @isEmphasized.
// Added: the 'error' state Spectrum doesn't ship; @variant='track' (the
// segmented bar rail, now the provenance pipeline on the component pages);
// @summary, a derived completion count tied to the list with
// aria-describedby; and container-query stacking at both presentations,
// which replaces Spectrum's caller-driven @orientation switch — the rail
// folds on its own box, so a caller never has to guess.
const CHECKOUT_STEPS: StepItem[] = [
  { label: 'Cart' },
  { label: 'Shipping' },
  { label: 'Payment' },
  { label: 'Review' },
];

const PIPELINE_STEPS: StepItem[] = [
  { label: 'Source', state: 'complete' },
  { label: 'Transcribe', state: 'complete' },
  { label: 'Lint', state: 'error' },
  { label: 'Publish', state: 'upcoming' },
];
// The two states that separate "where am I" from "why am I stuck": one stage
// running right now, one that cannot proceed and says what is holding it.

// the tea-trade cousin of the component-page provenance rail: a chest of
// Darjeeling second flush walking the trade pipeline
const CONSIGNMENT_STAGES: StepItem[] = [
  { label: 'sourced', state: 'complete' },
  { label: 'graded', state: 'complete' },
  { label: 'blended', state: 'complete' },
  { label: 'packed', state: 'complete' },
  { label: 'shipped', state: 'upcoming' },
];

const STEP_VARIANTS = ['steps', 'track'];

class StepListUsage extends Component {
  checkoutSteps = CHECKOUT_STEPS;
  pipelineSteps = PIPELINE_STEPS;
  deploySteps = DEPLOY_STEPS;
  consignmentStages = CONSIGNMENT_STAGES;
  variantOptions = STEP_VARIANTS;
  @tracked current = 1;
  @tracked labelText = 'Checkout progress';
  @tracked variant: StepListVariant = 'steps';
  @tracked summary = false;
  setCurrent = (v: number | null) => (this.current = v ?? 0);
  setLabel = (v: string) => (this.labelText = v);
  setVariant = (v: string) => (this.variant = v as StepListVariant);
  setSummary = (v: boolean) => (this.summary = v);
  get usage() {
    return `<StepList
  @steps={{this.steps}}
  @current={{${this.current}}}
  @variant='${this.variant}'
  @summary={{${this.summary}}}
/>`;
  }
  <template>
    <FreestyleUsage
      @name='StepList'
      @description="Step-progress rail in two presentations. 'steps' (default) is Spectrum's structure — numbered markers, connector lines, aria-current on the active step; 'track' is the segmented bar rail, one filled bar per stage with the caption beneath, for a pipeline read at a glance rather than walked through. Both share one <ol>, one state palette and one piece of wiring that matters: every step carries visually hidden state text ('Completed', 'Not completed', 'Error'), so completion is never conveyed by colour alone. States derive from @current or arrive explicitly per step; error is a Pretui addition. Reach for it whenever a fixed sequence of stages has to report where it stands — and set @summary when the reader needs the count as well as the shape."
      @source={{this.usage}}
    >
      <:example>
        <StepList
          @steps={{this.checkoutSteps}}
          @current={{this.current}}
          @label={{this.labelText}}
          @variant={{this.variant}}
          @summary={{this.summary}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='steps'
          @required={{true}}
          @value={{this.checkoutSteps}}
          @description="Items with a label, an optional explicit state ('complete' | 'current' | 'in-progress' | 'blocked' | 'upcoming' | 'error') and an optional detail line — explicit state wins over the @current derivation."
        />
        <Args.Number
          @name='current'
          @value={{this.current}}
          @min={{0}}
          @max={{3}}
          @description='Index of the current step — earlier steps derive complete, later ones upcoming.'
          @onInput={{this.setCurrent}}
        />
        <Args.String
          @name='label'
          @defaultValue='Steps'
          @value={{this.labelText}}
          @description='List label announced by assistive tech.'
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='variant'
          @defaultValue='steps'
          @value={{this.variant}}
          @options={{this.variantOptions}}
          @description="Presentation: 'steps' is the numbered-marker rail with connectors; 'track' is the segmented bar rail with the caption under each bar (the track drops the connectors — the bars already carry the progress)."
          @onInput={{this.setVariant}}
        />
        <Args.Bool
          @name='summary'
          @defaultValue={{false}}
          @value={{this.summary}}
          @description="Render the derived completion count ('3 of 4 complete') above the rail, tied to the list with aria-describedby so it is announced on entry. Derived from the step states — there is no count to keep in sync."
          @onInput={{this.setSummary}}
        />
        <Args.Base
          @name='summaryFormat'
          @type='Function'
          @description='(done, total) => string — wording for that summary. Default reads "3 of 5 complete".'
        />
        <Args.Bool
          @name='announce'
          @defaultValue={{true}}
          @description='Announce the most urgent step (error, then blocked, then in-progress, then current) and its detail through a polite live region when either changes. Live regions do not announce their initial content, so this is silent on mount.'
        />
      </:api>
    </FreestyleUsage>
    <FreestyleUsage
      @name='StepList states'
      @description="Explicit per-step states, including the error tone Spectrum doesn't ship — a failed lint gate mid-pipeline. Complete steps tint their connector; the error marker speaks --destructive. The accent is a state channel and nothing else: no step is emphasised for being first or last."
    >
      <:example>
        <StepList @steps={{this.pipelineSteps}} @label='Publish pipeline' />
      </:example>
    </FreestyleUsage>
    <FreestyleUsage
      @name='StepList in-progress and blocked'
      @description="Two states beyond where-you-are, and a detail line under each label. 'current' means you are here; 'in-progress' means the machine is working on this one, and they are usually not the same step. 'blocked' means a precondition has not been met — which is not the same as 'error', where something failed. Each carries its own glyph as well as its own tone (a play triangle, a bar across the marker), so the five-way distinction survives greyscale. The detail slot is reserved on every step as soon as one declares a detail, so a message arriving mid-run does not shove the rail down, and a polite live region announces the most urgent stage's state and detail whenever either changes — a rail that flips from running to blocked used to tell a sighted reader something and everyone else nothing."
    >
      <:example>
        <StepList @steps={{this.deploySteps}} @label='Deploy pipeline' />
      </:example>
    </FreestyleUsage>
    <FreestyleUsage
      @name='StepList track variant'
      @description="The bar rail: a consignment of second-flush Darjeeling walking the trade pipeline, with the completion summary switched on. This is the presentation the component pages' provenance panel uses — it replaced a hand-rolled track whose accent marked the last stage for being last, whose steps were div/span with no list semantics or state text, and whose count floated unassociated in the panel header. Both presentations are responsive on the component's own box (unnamed container queries, never the viewport): below 26rem the steps rail stacks into a column, below 24rem the track folds into a legend list, one stage per row — narrow the pane to watch it."
    >
      <:example>
        <StepList
          @steps={{this.consignmentStages}}
          @variant='track'
          @label='Consignment pipeline'
          @summary={{true}}
        />
      </:example>
    </FreestyleUsage>
  </template>
}

export const DEMOS_STEP_LIST: Record<string, unknown> = {
  StepList: StepListUsage,
};
