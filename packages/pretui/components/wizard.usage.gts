// Pretui — Wizard usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Wizard } from './wizard';
import type { WizardStep } from './wizard';

// ── Wizard ───────────────────────────────────────────────────────────────
const NAVIGATIONS = ['linear', 'visited', 'free'];

const RAIL_VARIANTS = ['steps', 'track'];

// Dropped upstream surface: aef6db-stepper's modal mode (compose
// <Dialog><Wizard /></Dialog> — Dialog already owns the focus trap,
// Escape and aria-modal that the upstream never implemented) and its
// @allowStepJump boolean, superseded by the three-valued @navigation.
class WizardUsage extends Component {
  navigations = NAVIGATIONS;
  railVariants = RAIL_VARIANTS;

  @tracked activeIndex = 0;
  @tracked navigation = 'visited';
  @tracked railVariant = 'steps';
  @tracked summary = true;
  @tracked busy = false;
  @tracked emailFilled = false;
  @tracked lastEvent = 'nothing yet';

  get steps(): WizardStep[] {
    return [
      {
        id: 'account',
        label: 'Account',
        detail: 'Who is signing up',
        valid: this.emailFilled,
        blockedReason: 'Enter an email address before continuing.',
      },
      { id: 'plan', label: 'Plan', detail: 'Pick a tier' },
      { id: 'team', label: 'Team', detail: 'Invite colleagues', optional: true },
      { id: 'review', label: 'Review', detail: 'Confirm and start' },
    ];
  }

  setNavigation = (v: string) => (this.navigation = v);
  setRailVariant = (v: string) => (this.railVariant = v);
  setSummary = (v: boolean) => (this.summary = v);
  setBusy = (v: boolean) => (this.busy = v);
  setEmailFilled = (v: boolean) => (this.emailFilled = v);

  onStepChange = (index: number) => {
    this.activeIndex = index;
    this.lastEvent = 'moved to step ' + (index + 1);
  };
  onComplete = () => (this.lastEvent = 'completed');
  onRefused = (index: number) =>
    (this.lastEvent = 'refused at step ' + (index + 1));

  get navigationValue() {
    return this.navigation as 'linear' | 'visited' | 'free';
  }
  get railVariantValue() {
    return this.railVariant as 'steps' | 'track';
  }
  get usage() {
    return "<Wizard @steps={{this.steps}} @activeIndex={{this.i}} @navigation='" +
      this.navigation +
      "' @onStepChange={{this.go}} @onComplete={{this.done}} as |step index api| />";
  }

  <template>
    <FreestyleUsage
      @name='Wizard'
      @description='A gated multi-step flow: a step model that declares its own validity, a footer that refuses forward movement and says why, and a progress rail that is StepList rather than a second copy of it. Turn the email switch off and press Next to see a refusal explain itself instead of greying out.'
      @source={{this.usage}}
    >
      <:example>
        <Wizard
          @steps={{this.steps}}
          @activeIndex={{this.activeIndex}}
          @navigation={{this.navigationValue}}
          @railVariant={{this.railVariantValue}}
          @summary={{this.summary}}
          @busy={{this.busy}}
          @label='Set-up steps'
          @onStepChange={{this.onStepChange}}
          @onComplete={{this.onComplete}}
          @onRefused={{this.onRefused}}
        >
          <:step as |step|>
            <p class='pretui-demo-steptext'>
              Panel for
              {{step.label}}.
              {{step.detail}}.
            </p>
          </:step>
        </Wizard>
        <p class='pretui-demo-readout' data-test-wizard-readout>
          step
          {{this.activeIndex}}
          ·
          {{this.lastEvent}}
        </p>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='activeIndex'
          @defaultValue={{0}}
          @value={{this.activeIndex}}
          @description='Controlled index, range-checked against the step list. Omit and seed defaultActiveIndex for uncontrolled use.'
        />
        <Args.String
          @name='navigation'
          @defaultValue='visited'
          @value={{this.navigation}}
          @options={{this.navigations}}
          @description='How freely a reader may move. linear is Back and Next only; visited allows returning to anywhere already reached; free allows anything. Forward movement always passes the active step gate, which is the fix for the upstream jump-past-invalid bug.'
          @onInput={{this.setNavigation}}
        />
        <Args.Bool
          @name='step.valid'
          @defaultValue={{false}}
          @value={{this.emailFilled}}
          @description='Stands in here for the first step declaring itself valid. When false, Next is aria-disabled but still focusable and clickable, and activating it reveals the blockedReason in a live alert.'
          @onInput={{this.setEmailFilled}}
        />
        <Args.String
          @name='railVariant'
          @defaultValue='steps'
          @value={{this.railVariant}}
          @options={{this.railVariants}}
          @description='Forwarded straight to StepList — the rail is that component, not a reimplementation of it.'
          @onInput={{this.setRailVariant}}
        />
        <Args.Bool
          @name='summary'
          @defaultValue={{false}}
          @value={{this.summary}}
          @description="Show StepList's derived completion summary above the rail."
          @onInput={{this.setSummary}}
        />
        <Args.Bool
          @name='busy'
          @defaultValue={{false}}
          @value={{this.busy}}
          @description='An async commit is in flight — the primary shows its spinner and stops accepting pointer events.'
          @onInput={{this.setBusy}}
        />
        <Args.Action
          @name='onStepChange'
          @description='Fires on every move, backwards included. The survey and stepper sources both bypassed this on the way back, so a consumer persisting progress lost every backwards move.'
        />
        <Args.Action
          @name='onComplete'
          @description='The terminal step primary commits rather than advancing, and only if the gate allows.'
        />
        <Args.Yield
          @name='step'
          @description='The active step content, receiving (step, index, api).'
        />
        <Args.Yield
          @name='rail'
          @description='Replaces the StepList rail entirely — this is where a clickable rail goes, and the api arrives with goTo and canGoTo already wired.'
        />
        <Args.Yield
          @name='footer'
          @description='Replaces the Back / Skip / Next footer.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-demo-steptext {
        margin: 0;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
      }
      .pretui-demo-readout {
        margin: var(--space-4, 12px) 0 0;
        font-size: var(--text-ui-sm, 11.5px);
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_WIZARD: Record<string, unknown> = {
  Wizard: WizardUsage,
};
