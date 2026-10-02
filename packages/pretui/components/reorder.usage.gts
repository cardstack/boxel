// Pretui — demo-controls-reorder: freestyle usage pages for Reorder and
// ActionBar. Knob sets derived from each component's Pretui signature.
//
// The Reorder page is written so the keyboard path can be exercised without
// a mouse at all: Tab to a handle, Enter to pick the row up, arrows to move
// it, Enter to drop, Escape to put it back. The live-region text is mirrored
// on screen underneath, so a reviewer can SEE what a screen reader would
// hear — the part of this component that is otherwise unreviewable.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Button } from './button';
import { Reorder } from './reorder';
import { TEAS } from '../examples-kit';

// ── Reorder ─────────────────────────────────────────────────────────────
class ReorderDemo extends Component {
  @tracked items: string[] = TEAS.slice(0, 6);
  @tracked label = 'Cupping order';
  @tracked disabled = false;
  @tracked lastMove = 'No moves yet.';

  setLabel = (v: string) => (this.label = v);
  setDisabled = (v: boolean) => (this.disabled = v);

  keyFor = (item: string) => item;
  labelFor = (item: string) => item;

  onReorder = (next: string[], from: number, to: number) => {
    this.items = next;
    this.lastMove =
      'Moved from position ' + (from + 1) + ' to position ' + (to + 1) + '.';
  };

  reset = () => {
    this.items = TEAS.slice(0, 6);
    this.lastMove = 'Reset.';
  };

  get orderText(): string {
    return this.items.join(' · ');
  }

  get usage(): string {
    return (
      '<Reorder @items={{this.teas}} @label=' +
      "'" +
      this.label +
      "'" +
      ' @keyFor={{this.keyFor}} @labelFor={{this.labelFor}}' +
      ' @onReorder={{this.reorder}} as |tea|>{{tea}}</Reorder>'
    );
  }

  <template>
    <FreestyleUsage
      @name='Reorder'
      @description='Rearrange a list by dragging a handle, or from the keyboard with exactly equal capability. It consumes the kit shared drag foundation from design-tools (pointer capture, and keyboardNudge for the key map) rather than adding a third drag engine. Focus a handle, press Enter or Space to pick the row up, move it with the arrows, drop with Enter, cancel with Escape.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-reorder-demo'>
          <Reorder
            @items={{this.items}}
            @label={{this.label}}
            @disabled={{this.disabled}}
            @keyFor={{this.keyFor}}
            @labelFor={{this.labelFor}}
            @onReorder={{this.onReorder}}
            as |tea index|
          >
            <span class='pretui-reorder-demo-row'>
              <span class='pretui-reorder-demo-rank'>{{index}}</span>
              <span class='pretui-reorder-demo-name'>{{tea}}</span>
            </span>
          </Reorder>
          <p class='pretui-reorder-demo-note'>{{this.lastMove}}</p>
          <p class='pretui-reorder-demo-order'>{{this.orderText}}</p>
          <Button
            @size='xs'
            @appearance='outlined'
            {{on 'click' this.reset}}
          >Reset order</Button>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Array
          @name='items'
          @required={{true}}
          @description='The list, in its current order. Reorder never mutates it — onReorder receives a new array.'
        />
        <Args.String
          @name='label'
          @value={{this.label}}
          @defaultValue='Reorderable list'
          @description='Accessible name for the list.'
          @onInput={{this.setLabel}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @defaultValue={{false}}
          @description='Dimmed; neither pointer nor keyboard can move a row.'
          @onInput={{this.setDisabled}}
        />
        <Args.Action
          @name='keyFor'
          @description='A stable key per item. Without one, moving a row re-creates every row after it and focus is lost mid-drag.'
        />
        <Args.Action
          @name='labelFor'
          @description='The row name used for the handle accessible name and for every announcement.'
        />
        <Args.Action
          @name='onReorder'
          @description='Receives the reordered list plus where the row came from and went. Called once per completed move, never during one.'
        />
        <Args.Yield
          @name='default'
          @description='The row content, receiving the item and its index. Only the handle starts a drag, so controls in the row keep their own focus.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-reorder-handle-size'
          @type='dimension'
          @description='The drag handle box on a fine pointer.'
        />
        <Css.Basic
          @name='pretui-reorder-handle-touch'
          @type='dimension'
          @description='The handle box on a coarse pointer, where 44px is the floor.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .pretui-reorder-demo {
        display: grid;
        gap: var(--space-3, 8px);
        justify-items: start;
        max-width: 420px;
      }
      .pretui-reorder-demo-row {
        display: flex;
        align-items: baseline;
        gap: var(--space-3, 8px);
      }
      .pretui-reorder-demo-rank {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground);
      }
      .pretui-reorder-demo-name {
        font-size: var(--text-ui-md, 12.5px);
        color: var(--foreground);
      }
      .pretui-reorder-demo-note,
      .pretui-reorder-demo-order {
        margin: 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_CONTROLS_REORDER: Record<string, unknown> = {
  Reorder: ReorderDemo,
};
