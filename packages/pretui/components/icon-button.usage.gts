// Pretui — IconButton usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { IconButton } from './icon-button';
import type { ButtonVariant } from './button';
import { PRETUI_SIZES } from '../pretui-primitives';
import type { PretuiSize } from '../pretui-primitives';

const ICON_VARIANTS = ['primary', 'secondary', 'ghost', 'destructive'];
const SIZES = [...PRETUI_SIZES];

// ── IconButton ← icon-button/usage.gts ───────────────────────────────────
// Dropped knobs: @round (use @shape='pill'), @class (pass class directly).
// @size takes Pret UI's scale rather than boxel-ui's fixed heights.
export class IconButtonUsage extends Component {
  variantOptions = ICON_VARIANTS;
  @tracked labelText = 'Add item';
  @tracked variant = 'secondary';
  @tracked size = 'm';
  @tracked pressed = false;
  @tracked busy = false;
  @tracked disabled = false;
  setLabel = (v: string) => (this.labelText = v);
  setVariant = (v: string) => (this.variant = v);
  setSize = (v: string) => (this.size = v);
  setPressed = (v: boolean) => (this.pressed = v);
  setBusy = (v: boolean) => (this.busy = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  get variantVal() {
    return this.variant as ButtonVariant;
  }
  get sizeVal() {
    return this.size as PretuiSize;
  }
  get pressedVal() {
    return this.pressed || undefined;
  }
  get usage() {
    let bits = [`@label='${this.labelText}'`, `@variant='${this.variant}'`];
    if (this.size !== 'm') bits.push(`@size='${this.size}'`);
    if (this.pressed) bits.push('@pressed={{true}}');
    if (this.busy) bits.push('@busy={{true}}');
    if (this.disabled) bits.push('@disabled={{true}}');
    return `<IconButton ${bits.join(' ')}>…icon svg…</IconButton>`;
  }
  <template>
    <FreestyleUsage
      @name='IconButton'
      @description='Button rendered as a single icon with no text — used in toolbars, table-row actions, and tight UI spots where a labelled button would not fit.'
      @source={{this.usage}}
    >
      <:example>
        <IconButton
          @label={{this.labelText}}
          @variant={{this.variantVal}}
          @size={{this.sizeVal}}
          @pressed={{this.pressedVal}}
          @busy={{this.busy}}
          @disabled={{this.disabled}}
        >
          <svg width='14' height='14' viewBox='0 0 14 14'><path
              d='M7 2v10M2 7h10'
              fill='none'
              stroke='currentColor'
              stroke-width='1.5'
              stroke-linecap='round'
            /></svg>
        </IconButton>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @required={{true}}
          @value={{this.labelText}}
          @description='Accessible name — rendered as aria-label and title.'
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='variant'
          @optional={{true}}
          @defaultValue='secondary'
          @value={{this.variant}}
          @options={{this.variantOptions}}
          @description='Legacy variant sugar over the tone + appearance axes.'
          @onInput={{this.setVariant}}
        />
        <Args.String
          @name='size'
          @value={{this.size}}
          @options={{SIZES}}
          @defaultValue='m'
          @description='Button size; the square and the @icon scale with it.'
          @onInput={{this.setSize}}
        />
        <Args.Bool
          @name='pressed'
          @value={{this.pressed}}
          @description='Toggle state, as aria-pressed; leave unset for a plain action.'
          @onInput={{this.setPressed}}
        />
        <Args.Bool
          @name='busy'
          @value={{this.busy}}
          @defaultValue={{false}}
          @description="Button's busy state; @busyLabel joins the accessible name."
          @onInput={{this.setBusy}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @defaultValue={{false}}
          @description='Disables the button.'
          @onInput={{this.setDisabled}}
        />
        <Args.Base
          @name='icon'
          @typeLabel='Component'
          @description='Icon component, sized by @size or @width / @height.'
          @hideControls={{true}}
        />
        <Args.Yield
          @description='The icon as block content, when it is not passed as @icon.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_ICON_BUTTON: Record<string, unknown> = {
  IconButton: IconButtonUsage,
};
