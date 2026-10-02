// Pretui — ColorStopEditor usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { GradientStop } from '../color-engine';
import { ColorStopEditor } from './color-stop-editor';
import { FreestyleUsage } from './freestyle-usage';

// ── ColorStopEditor ──────────────────────────────────────────────────────
class ColorStopEditorUsage extends Component {
  @tracked stop: GradientStop = {
    id: 'demo-stop',
    position: 40,
    color: '#7c3aed',
  };
  @tracked removable = true;
  setRemovable = (v: boolean) => (this.removable = v);
  setColor = (_id: string, color: string) =>
    (this.stop = { ...this.stop, color });
  setPosition = (_id: string, position: number | null) => {
    if (position !== null) {
      this.stop = { ...this.stop, position };
    }
  };
  noop = () => {
    // the demo keeps its single stop
  };
  get usage() {
    return '<ColorStopEditor @stop={{this.stop}} @onColorChange={{this.setColor}} @onPositionChange={{this.setPosition}} />';
  }
  <template>
    <FreestyleUsage
      @name='ColorStopEditor'
      @description='One row of a gradient stop list — the swatch that opens a picker, the position, and remove. This is the whole of the COLOUR half of a stop, and the component the design-tools GradientInput should reuse when it needs "let the user change this stop’s colour".'
      @source={{this.usage}}
    >
      <:example>
        <ColorStopEditor
          @stop={{this.stop}}
          @selected={{true}}
          @removable={{this.removable}}
          @onColorChange={{this.setColor}}
          @onPositionChange={{this.setPosition}}
          @onRemove={{this.noop}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='stop'
          @required={{true}}
          @description='{ id, position, color }. The id is a monotonic counter, never Math.random() — indexing determinism.'
          @value={{this.stop}}
        />
        <Args.Bool
          @name='removable'
          @defaultValue={{false}}
          @description='False disables remove and explains why in the title — a gradient needs two stops.'
          @value={{this.removable}}
          @onInput={{this.setRemovable}}
        />
        <Args.Action
          @name='onColorChange'
          @description='Receives (id, color).'
        />
        <Args.Action
          @name='onPositionChange'
          @description='Receives (id, position).'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_COLOR_STOP_EDITOR: Record<string, unknown> = {
  ColorStopEditor: ColorStopEditorUsage,
};
