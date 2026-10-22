// Pretui — ScrubInput usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { ScrubInput } from './scrub-input';
import type { ScaleStops } from '../internal/design-tools';
import { APERTURES } from '../demo-design-tools';

// ── ScrubInput ───────────────────────────────────────────────────────────
const SCRUB_FROM = ['grip', 'field', 'none'];

const UNIT_POSITIONS = ['suffix', 'prefix'];

class ScrubInputUsage extends Component {
  scrubFromOptions = SCRUB_FROM;
  unitPositionOptions = UNIT_POSITIONS;

  @tracked value: number | null = 24;
  @tracked committed: number | null = 24;
  @tracked step = 1;
  @tracked pixelsPerStep = 1;
  @tracked precision = 2;
  @tracked unit = 'px';
  @tracked unitPosition = 'suffix';
  @tracked scrubFrom = 'grip';
  @tracked steppers = true;
  @tracked mixed = false;
  @tracked disabled = false;
  @tracked labelText = 'Corner radius';
  @tracked min: number | null = 0;
  @tracked max: number | null = 200;
  @tracked stepped = false;

  setStepped = (v: boolean) => {
    this.stepped = v;
    // Swap the whole configuration together, so the knob shows the control
    // in the two shapes a caller actually uses it in rather than a hybrid
    // neither of them would ship.
    if (v) {
      this.value = 2.8;
      this.committed = 2.8;
      this.labelText = 'Aperture';
      this.unit = '';
      this.min = null;
      this.max = null;
      this.precision = 2;
    } else {
      this.value = 24;
      this.committed = 24;
      this.labelText = 'Corner radius';
      this.unit = 'px';
      this.min = 0;
      this.max = 200;
    }
  };
  get steps(): ScaleStops | undefined {
    return this.stepped ? APERTURES : undefined;
  }

  setValue = (v: number | null) => (this.value = v);
  commit = (v: number | null) => (this.committed = v);
  setStep = (v: number) => (this.step = v);
  setPixels = (v: number) => (this.pixelsPerStep = v);
  setPrecision = (v: number) => (this.precision = v);
  setUnit = (v: string) => (this.unit = v);
  setUnitPosition = (v: string) => (this.unitPosition = v);
  setScrubFrom = (v: string) => (this.scrubFrom = v);
  setSteppers = (v: boolean) => (this.steppers = v);
  setMixed = (v: boolean) => (this.mixed = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setLabel = (v: string) => (this.labelText = v);
  setMin = (v: number) => (this.min = v);
  setMax = (v: number) => (this.max = v);

  get unitPositionVal() {
    return this.unitPosition as 'prefix' | 'suffix';
  }
  get scrubFromVal() {
    return this.scrubFrom as 'grip' | 'field' | 'none';
  }
  get minVal() {
    return this.min === null ? undefined : this.min;
  }
  get maxVal() {
    return this.max === null ? undefined : this.max;
  }
  get usage() {
    let bits = ["@label='" + this.labelText + "'", '@value={{this.value}}'];
    if (this.stepped) {
      bits.push('@steps={{APERTURES}}');
    }
    if (this.unit) {
      bits.push("@unit='" + this.unit + "'");
    }
    if (this.steppers) {
      bits.push('@steppers={{true}}');
    }
    if (this.scrubFrom !== 'grip') {
      bits.push("@scrubFrom='" + this.scrubFrom + "'");
    }
    bits.push('@onChange={{this.commit}}');
    return '<ScrubInput ' + bits.join(' ') + ' />';
  }
  <template>
    <FreestyleUsage
      @name='ScrubInput'
      @description='The numeric field a design tool lives on: drag the unit grip horizontally to change the value, or type into it. Shift coarsens ×10, Alt/⌘ refines ×0.1, and the same multipliers drive the arrow keys. PageUp/PageDown coarse-step, Home/End jump to min/max, Escape abandons a half-typed value. Ported from figui3 fig-input-number + fig-steppers. Turn on “stepped” to see the same control over a DISCRETE scale — the f-stop ladder, where the legal values are an ordered non-uniform list and the gesture travels whole stops.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-scrub-demo'>
          <ScrubInput
            @label={{this.labelText}}
            @value={{this.value}}
            @steps={{this.steps}}
            @min={{this.minVal}}
            @max={{this.maxVal}}
            @step={{this.step}}
            @pixelsPerStep={{this.pixelsPerStep}}
            @precision={{this.precision}}
            @unit={{this.unit}}
            @unitPosition={{this.unitPositionVal}}
            @scrubFrom={{this.scrubFromVal}}
            @steppers={{this.steppers}}
            @mixed={{this.mixed}}
            @disabled={{this.disabled}}
            @onInput={{this.setValue}}
            @onChange={{this.commit}}
          />
          <p class='pretui-demo-readout' data-test-scrub-readout>
            live = {{this.value}} · committed = {{this.committed}}
          </p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='value'
          @value={{this.value}}
          @description='Controlled value. Omit and seed @defaultValue for uncontrolled use (kit contract: args.value ?? internal).'
          @onInput={{this.setValue}}
        />
        <Args.Bool
          @name='steps'
          @defaultValue={{false}}
          @value={{this.stepped}}
          @description='A STEPPED SCALE — the ordered list of legal values, as numbers or {value,label} pairs. Numeric does not mean continuous: apertures, ISO speeds and type ramps have non-uniform gaps that @step cannot describe. With @steps the gesture addresses the scale by INDEX (a scrub, an arrow and a stepper each travel whole stops), @min/@max default to the ends of the list, a typed number snaps to the nearest legal value on commit, and the field shows the stop’s label while aria-valuenow keeps the number. The knob here swaps in the thirteen-stop aperture ladder.'
          @onInput={{this.setStepped}}
        />
        <Args.Number
          @name='min'
          @value={{this.min}}
          @description='Lower bound. Also the target of the Home key — without a min, Home is inert rather than wrong.'
          @onInput={{this.setMin}}
        />
        <Args.Number
          @name='max'
          @value={{this.max}}
          @description='Upper bound, and the End key target.'
          @onInput={{this.setMax}}
        />
        <Args.Number
          @name='step'
          @defaultValue={{1}}
          @value={{this.step}}
          @description='One arrow press, one stepper click, and one pixelsPerStep of scrub each move the value this far.'
          @onInput={{this.setStep}}
        />
        <Args.Number
          @name='pixelsPerStep'
          @defaultValue={{1}}
          @value={{this.pixelsPerStep}}
          @min={{1}}
          @max={{20}}
          @description='Pixels of pointer travel that buy one step. figui3 hardcodes 1; raise it for a control that needs a slower hand.'
          @onInput={{this.setPixels}}
        />
        <Args.Number
          @name='precision'
          @defaultValue={{2}}
          @value={{this.precision}}
          @min={{0}}
          @max={{6}}
          @description='Decimal places kept on commit. Rounding runs through roundTo (×10ⁿ integer round), not toFixed, so a long drag cannot accumulate drift.'
          @onInput={{this.setPrecision}}
        />
        <Args.String
          @name='unit'
          @value={{this.unit}}
          @description="Unit rendered in the grip and folded into aria-valuetext: 'px', '%', '°', 'ms'."
          @onInput={{this.setUnit}}
        />
        <Args.String
          @name='unitPosition'
          @defaultValue='suffix'
          @value={{this.unitPosition}}
          @options={{this.unitPositionOptions}}
          @description='Which side the grip sits on.'
          @onInput={{this.setUnitPosition}}
        />
        <Args.String
          @name='scrubFrom'
          @defaultValue='grip'
          @value={{this.scrubFrom}}
          @options={{this.scrubFromOptions}}
          @description="'grip' scrubs from the unit affix only (discoverable, and leaves text selection alone); 'field' makes the whole control a scrub surface; 'none' is a plain spinbutton."
          @onInput={{this.setScrubFrom}}
        />
        <Args.Bool
          @name='steppers'
          @defaultValue={{false}}
          @value={{this.steppers}}
          @description='The up/down pair — figui3 fig-steppers, folded in as an arg rather than shipped as a second component.'
          @onInput={{this.setSteppers}}
        />
        <Args.Bool
          @name='mixed'
          @defaultValue={{false}}
          @value={{this.mixed}}
          @description='Multi-selection with differing values. Rendered as the WORD “Mixed” in the placeholder and in aria-valuetext — never colour alone.'
          @onInput={{this.setMixed}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @description='readonly + aria-disabled rather than the disabled attribute, so the row stays keyboard-reachable and still announces its value.'
          @onInput={{this.setDisabled}}
        />
        <Args.String
          @name='label'
          @value={{this.labelText}}
          @description='Accessible name. A panel of twenty unnamed spinbuttons is unusable, so this is required in practice.'
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='grip'
          @description='Grip text when there is no unit — the scrub affordance needs something to grab.'
        />
        <Args.String
          @name='controlId'
          @description='id placed on the inner input, so a PropertyRow label can point at it.'
        />
        <Args.String
          @name='describedBy'
          @description='id of a description element (PropertyRow yields one).'
        />
        <Args.Action
          @name='onInput'
          @description='Continuous — every scrub frame and every keystroke.'
        />
        <Args.Action
          @name='onChange'
          @description='Committed — blur, Enter, scrub release, stepper click. This is the one to persist.'
        />
        <Args.Yield @description='The grip block replaces the grip content with an axis glyph or icon.' />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-scrub-demo {
        max-width: 220px;
      }
      .pretui-demo-readout {
        margin: 8px 0 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
        font-variant-numeric: tabular-nums;
      }
    </style>
  </template>
}

export const DEMOS_SCRUB_INPUT: Record<string, unknown> = {
  ScrubInput: ScrubInputUsage,
};
