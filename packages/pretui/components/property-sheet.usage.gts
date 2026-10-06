// Pretui — PropertySheet usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Panel } from './panel';
import { PanelSection } from './panel-section';
import { PropertySheet } from './property-sheet';
import type { ValueOf, ValueSpec } from './value-input';
import { BLEND_OPTIONS } from '../demo-design-value';

const SHEET_SPECS: ValueSpec[] = [
  { key: 'name', kind: 'text', label: 'Name', placeholder: 'Untitled' },
  { key: 'visible', kind: 'toggle', label: 'Visible' },
  {
    key: 'opacity',
    kind: 'number',
    label: 'Opacity',
    min: 0,
    max: 100,
    unit: '%',
    precision: 0,
  },
  {
    key: 'blend',
    kind: 'select',
    label: 'Blend',
    options: BLEND_OPTIONS,
  },
  {
    key: 'radius',
    kind: 'number',
    label: 'Radius',
    min: 0,
    max: 200,
    unit: 'px',
    precision: 0,
    modified: true,
  },
  { key: 'rotate', kind: 'angle', label: 'Rotate' },
  { key: 'shadow', kind: 'number', label: 'Shadow', unit: 'px', mixed: true },
  {
    key: 'origin',
    kind: 'origin',
    label: 'Origin',
    layout: 'stack',
  },
];

class PropertySheetUsage extends Component {
  @tracked values: Record<string, ValueOf> = {
    name: 'Hero card',
    visible: true,
    opacity: 100,
    blend: 'normal',
    radius: 24,
    rotate: 0,
    shadow: null,
    origin: { x: 50, y: 50 },
  };

  change = (key: string, value: ValueOf) => {
    this.values = { ...this.values, [key]: value };
  };
  reset = (key: string) => {
    this.values = { ...this.values, [key]: key === 'radius' ? 8 : null };
  };
  specs = SHEET_SPECS;

  <template>
    <FreestyleUsage
      @name='PropertySheet'
      @description='A property panel rendered from data. The point is not brevity — it is that a panel defined as ValueSpec[] can come from a card schema, a plugin manifest, or a diffing multi-selection, and still get every affordance the hand-written rows have: labels wired to controls, hints wired to aria-describedby, mixed state as text, a reset where a value differs from its default, and the container-query fold.'
      @source='<PropertySheet @specs={{this.specs}} @values={{this.values}} @onChange={{this.change}} />'
    >
      <:example>
        <div class='pretui-sheet-demo'>
          <Panel
            @title='Properties'
            @eyebrow='Hero card'
            @variant='inspector'
            @scroll={{true}}
          >
            <PanelSection @title='Layer' @summary='8'>
              <PropertySheet
                @specs={{this.specs}}
                @values={{this.values}}
                @onChange={{this.change}}
                @onReset={{this.reset}}
              />
            </PanelSection>
          </Panel>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Array
          @name='specs'
          @description='The rows, in order. Each carries its key, kind, label, hint, per-kind knobs and its mixed / modified state.'
        />
        <Args.Object
          @name='values'
          @description='Current values keyed by spec.key.'
        />
        <Args.String
          @name='layout'
          @description="Default row layout ('row' | 'stack' | 'split'); each spec may override."
        />
        <Args.Action
          @name='onChange'
          @description='Receives (key, value).'
        />
        <Args.Action
          @name='onReset'
          @description='Receives the key. A row only shows a reset control when its spec is modified AND this is supplied.'
        />
        <Args.Yield
          @description='The custom block receives (kind, value, spec) for kinds ValueInput does not own.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-sheet-demo {
        max-width: 300px;
        height: 380px;
        display: grid;
      }
    </style>
  </template>
}

export const DEMOS_PROPERTY_SHEET: Record<string, unknown> = {
  PropertySheet: PropertySheetUsage,
};
