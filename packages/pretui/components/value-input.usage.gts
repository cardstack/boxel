// Pretui — ValueInput usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { ValueInput } from './value-input';
import type { ValueKind, ValueOf, ValueSpec } from './value-input';
import { BLEND_OPTIONS } from '../demo-design-value';

const KINDS = [
  'number',
  'text',
  'toggle',
  'select',
  'angle',
  'point',
  'origin',
  'curve',
  'custom',
];

class ValueInputUsage extends Component {
  kindOptions = KINDS;
  blendOptions = BLEND_OPTIONS;

  @tracked kind = 'number';
  @tracked value: ValueOf = 24;
  @tracked mixed = false;
  @tracked disabled = false;

  setKind = (v: string) => {
    this.kind = v;
    this.value = this.seedFor(v);
  };
  setMixed = (v: boolean) => (this.mixed = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  change = (v: ValueOf) => (this.value = v);

  private seedFor(kind: string): ValueOf {
    if (kind === 'number') {
      return 24;
    }
    if (kind === 'text') {
      return 'Layer 1';
    }
    if (kind === 'toggle') {
      return true;
    }
    if (kind === 'select') {
      return 'multiply';
    }
    if (kind === 'angle') {
      return 45;
    }
    if (kind === 'point' || kind === 'origin') {
      return { x: 50, y: 50 };
    }
    if (kind === 'curve') {
      return { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };
    }
    return null;
  }

  get kindVal() {
    return this.kind as ValueKind;
  }
  get spec(): Partial<ValueSpec> {
    return {
      label: 'Value',
      min: this.kind === 'number' ? 0 : undefined,
      max: this.kind === 'number' ? 200 : undefined,
      unit: this.kind === 'number' ? 'px' : undefined,
      precision: 0,
      options: BLEND_OPTIONS,
      placeholder: 'Type a name',
      mixed: this.mixed,
    };
  }
  get readout() {
    return JSON.stringify(this.value);
  }
  get usage() {
    return (
      "<ValueInput @kind='" +
      this.kind +
      "' @value={{this.value}} @spec={{this.spec}} @onChange={{this.change}} />"
    );
  }
  <template>
    <FreestyleUsage
      @name='ValueInput'
      @description='One control chosen by a kind discriminator, behind a single value/onChange contract — the natural consumer of every control this territory ships. The COMPONENT does the narrowing (asNumber, asPoint, asCurve, each with a sane fallback), never the caller, so a template never narrows a union. Unknown kinds fall through to a <:custom> block rather than crashing; kind="color" routes there deliberately, because colour belongs to the colour territory.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-value-demo'>
          <ValueInput
            @kind={{this.kindVal}}
            @value={{this.value}}
            @spec={{this.spec}}
            @disabled={{this.disabled}}
            @onChange={{this.change}}
          >
            <:custom as |kind|>
              <p class='pretui-value-slot'>
                No built-in editor for “{{kind}}” — this is the
                <code>&lt;:custom&gt;</code>
                slot a consumer fills (colour routes here).
              </p>
            </:custom>
          </ValueInput>
          <p class='pretui-demo-readout' data-test-value-readout>{{this.readout}}</p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='kind'
          @defaultValue='number'
          @value={{this.kind}}
          @options={{this.kindOptions}}
          @description='Which control to render. Anything outside the union — or the literal “custom” — falls through to the <:custom> block.'
          @onInput={{this.setKind}}
        />
        <Args.Object
          @name='value'
          @description='The value in whatever shape the kind implies: number, string, boolean, { x, y }, or { x1, y1, x2, y2 }.'
        />
        <Args.Object
          @name='spec'
          @description='Knobs for the chosen kind (min/max/step/precision/unit/options/placeholder/mixed). Fields the kind does not use are simply unread.'
        />
        <Args.Bool
          @name='mixed'
          @defaultValue={{false}}
          @value={{this.mixed}}
          @description='Demo knob for spec.mixed — multi-selection with differing values.'
          @onInput={{this.setMixed}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.String @name='controlId' @description='id for the control, so a PropertyRow label points at it.' />
        <Args.Action @name='onChange' @description='Receives the value in the kind’s own shape.' />
        <Args.Yield @description='The custom block receives (kind, value).' />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-value-demo {
        max-width: 240px;
        container-type: inline-size;
      }
      .pretui-value-slot {
        margin: 0;
        padding: 8px;
        border-radius: var(--radius);
        background: var(--field, var(--boxel-light));
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .pretui-demo-readout {
        margin: 8px 0 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
        overflow-x: auto;
        white-space: nowrap;
      }
    </style>
  </template>
}

export const DEMOS_VALUE_INPUT: Record<string, unknown> = {
  ValueInput: ValueInputUsage,
};
