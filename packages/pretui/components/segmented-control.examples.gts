// Pretui — SegmentedControl example gallery.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { ExampleSpec } from '../examples-kit';
import { Button } from './button';
import { Input as PretuiInput } from './input';
import { SegmentedControl } from './segmented-control';

const VIEW_OPTIONS = [
  { value: 'card', label: 'Card' },
  { value: 'strip', label: 'Strip' },
  { value: 'grid', label: 'Grid' },
];

// ── Beside an Input and a Button ─────────────────────────────────────────
class SegmentedControlToolbar extends Component {
  viewOptions = VIEW_OPTIONS;
  @tracked value = 'card';
  setValue = (v: string) => (this.value = v);
  <template>
    <div class='pretui-seg-example-toolbar' role='group' aria-label='View'>
      <div class='pretui-seg-example-search'>
        <PretuiInput @type='search' @placeholder='Search' aria-label='Search' />
      </div>
      <SegmentedControl
        @options={{this.viewOptions}}
        @value={{this.value}}
        @onValueChange={{this.setValue}}
      />
      <Button>New</Button>
    </div>
    <style scoped>
      .pretui-seg-example-toolbar {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        width: 100%;
      }
      .pretui-seg-example-search {
        flex: 1 1 12rem;
      }
    </style>
  </template>
}

export const EXAMPLES_SEGMENTED_CONTROL: Record<string, ExampleSpec[]> = {
  SegmentedControl: [
    {
      title: 'In a toolbar',
      note: 'Beside an Input and a Button: all three share the field height and corner.',
      component: SegmentedControlToolbar,
    },
  ],
};
