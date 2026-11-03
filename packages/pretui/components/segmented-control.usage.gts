// Pretui — SegmentedControl usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import LayoutGrid from '@cardstack/boxel-icons/layout-grid';
import List from '@cardstack/boxel-icons/list';
import Kanban from '@cardstack/boxel-icons/kanban';
import { SEGMENTED_DISPLAYS, SegmentedControl } from './segmented-control';
import type { SegmentedDisplay } from './segmented-control';

const VIEW_OPTIONS = [
  { value: 'card', label: 'Card', icon: Kanban },
  { value: 'strip', label: 'Strip', icon: List },
  { value: 'grid', label: 'Grid', icon: LayoutGrid },
];
const VIEW_VALUES = VIEW_OPTIONS.map((o) => o.value);
const DISPLAYS = [...SEGMENTED_DISPLAYS];
// ── SegmentedControl ← view-selector/usage.gts ───────────────────────────
export class SegmentedControlUsage extends Component {
  viewOptions = VIEW_OPTIONS;
  viewValues = VIEW_VALUES;
  @tracked value = 'card';
  @tracked display = 'text';
  displays = DISPLAYS;
  setDisplay = (v: string) => (this.display = v);
  get displayVal() {
    return this.display as SegmentedDisplay;
  }
  setValue = (v: string) => (this.value = v);
  get usage() {
    return `<SegmentedControl @options={{this.views}} @value='${this.value}' @onValueChange={{this.setValue}}${this.display === 'text' ? '' : ` @display='${this.display}'`} />`;
  }
  <template>
    <FreestyleUsage
      @name='SegmentedControl'
      @description="A compact segmented control for switching between a small set of views or modes — text-labeled segments on an inset rail, superseding boxel-ui's ViewSelector. The active card face is not the segment's own background: it composes motion-core's SlidingHighlight (pill cut), so one indicator travels between segments and the reader sees where the selection came from. Under reduced motion it lands on the new segment instantly."
      @source={{this.usage}}
    >
      <:example>
        <SegmentedControl
          @options={{this.viewOptions}}
          @value={{this.value}}
          @onValueChange={{this.setValue}}
          @display={{this.displayVal}}
          @label='View'
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='options'
          @required={{true}}
          @description="Items with a value, a label and an optional icon component to render on the selector."
          @value={{this.viewOptions}}
        />
        <Args.String
          @name='value'
          @required={{true}}
          @defaultValue='card'
          @value={{this.value}}
          @options={{this.viewValues}}
          @description="Id of the currently selected item — boxel-ui ViewSelector's @selectedId."
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='display'
          @value={{this.display}}
          @options={{this.displays}}
          @defaultValue='text'
          @description="How much each segment shows: text (every label, after its icon), selected-text (the label on the selected segment only) or icon (icons only). A hidden label still names its radio and is its title; an option without an icon always shows its label. --pretui-seg-h sets the control's height."
          @onInput={{this.setDisplay}}
        />
        <Args.Action
          @name='onValueChange'
          @required={{true}}
          @description='Receives the selected id as a string'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_SEGMENTED_CONTROL: Record<string, unknown> = {
  SegmentedControl: SegmentedControlUsage,
};
