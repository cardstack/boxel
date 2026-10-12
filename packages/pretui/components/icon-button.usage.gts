// Pretui — IconButton usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import PlusIcon from '@cardstack/boxel-icons/plus';
import { FreestyleUsage } from './freestyle-usage';
import { IconButton } from './icon-button';
import { BUTTON_SHAPES } from './button';
import type { ButtonShape } from './button';
import {
  PRETUI_APPEARANCES,
  PRETUI_SIZES,
  PRETUI_TONES,
} from '../pretui-primitives';
import type {
  PretuiAppearance,
  PretuiSize,
  PretuiTone,
} from '../pretui-primitives';

const TONES = [...PRETUI_TONES];
const APPEARANCES = [...PRETUI_APPEARANCES];
const SIZES = [...PRETUI_SIZES];
const SHAPES = [...BUTTON_SHAPES];

// ── IconButton ← icon-button/usage.gts ───────────────────────────────────
// Dropped knobs: @round (use @shape='pill'), @class (pass class directly).
// @size takes Pret UI's scale rather than boxel-ui's fixed heights. The
// tone and appearance knobs start at neutral / outlined, the 'secondary'
// default.
export class IconButtonUsage extends Component {
  @tracked labelText = 'Add item';
  @tracked tone = 'neutral';
  @tracked appearance = 'outlined';
  @tracked size = 'm';
  @tracked busy = false;
  @tracked busyLabel = '';
  @tracked disabled = false;
  @tracked href = '';
  @tracked shape = 'rounded';
  @tracked pressed: boolean | undefined;
  setLabel = (v: string) => (this.labelText = v);
  setTone = (v: string) => (this.tone = v);
  setAppearance = (v: string) => (this.appearance = v);
  setSize = (v: string) => (this.size = v);
  setBusy = (v: boolean) => (this.busy = v);
  setBusyLabel = (v: string) => (this.busyLabel = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setHref = (v: string) => (this.href = v);
  setShape = (v: string) => (this.shape = v);
  setPressed = (v: boolean) => (this.pressed = v);
  get toneVal() {
    return this.tone as PretuiTone;
  }
  get appearanceVal() {
    return this.appearance as PretuiAppearance;
  }
  get sizeVal() {
    return this.size as PretuiSize;
  }
  get hrefVal() {
    return this.href || undefined;
  }
  get shapeVal() {
    return this.shape as ButtonShape;
  }
  get usage() {
    let bits = [`@label='${this.labelText}'`];
    if (this.tone !== 'neutral') bits.push(`@tone='${this.tone}'`);
    if (this.appearance !== 'outlined') {
      bits.push(`@appearance='${this.appearance}'`);
    }
    if (this.size !== 'm') bits.push(`@size='${this.size}'`);
    if (this.busy) bits.push('@busy={{true}}');
    if (this.busyLabel) bits.push(`@busyLabel='${this.busyLabel}'`);
    if (this.disabled) bits.push('@disabled={{true}}');
    if (this.href) bits.push(`@href='${this.href}'`);
    if (this.shape !== 'rounded') bits.push(`@shape='${this.shape}'`);
    if (this.pressed !== undefined) bits.push(`@pressed={{${this.pressed}}}`);
    return `<IconButton ${bits.join(' ')} @icon={{PlusIcon}} />`;
  }
  <template>
    <FreestyleUsage
      @name='IconButton'
      @description='Button rendered as a single icon with no text — used in toolbars, table-row actions, and tight UI spots where a labeled button would not fit.'
      @source={{this.usage}}
    >
      <:example>
        <IconButton
          @label={{this.labelText}}
          @tone={{this.toneVal}}
          @appearance={{this.appearanceVal}}
          @size={{this.sizeVal}}
          @busy={{this.busy}}
          @busyLabel={{this.busyLabel}}
          @disabled={{this.disabled}}
          @href={{this.hrefVal}}
          @shape={{this.shapeVal}}
          @pressed={{this.pressed}}
          @icon={{PlusIcon}}
        />
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
          @name='tone'
          @value={{this.tone}}
          @options={{TONES}}
          @defaultValue='neutral'
          @description='Semantic color, as on Button.'
          @onInput={{this.setTone}}
        />
        <Args.String
          @name='appearance'
          @value={{this.appearance}}
          @options={{APPEARANCES}}
          @defaultValue='outlined'
          @description='Visual weight, as on Button.'
          @onInput={{this.setAppearance}}
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
          @name='busy'
          @value={{this.busy}}
          @defaultValue={{false}}
          @description="Button's busy state; the button keeps focus. @loading, @isLoading and @isPending are aliases."
          @onInput={{this.setBusy}}
        />
        <Args.String
          @name='busyLabel'
          @value={{this.busyLabel}}
          @description='Added after @label in the accessible name while busy.'
          @onInput={{this.setBusyLabel}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @defaultValue={{false}}
          @description='Disables the button; @isDisabled is an alias.'
          @onInput={{this.setDisabled}}
        />
        <Args.String
          @name='href'
          @value={{this.href}}
          @description='Renders a link (an <a>) with the same look; @busy and @pressed do not apply.'
          @onInput={{this.setHref}}
        />
        <Args.String
          @name='shape'
          @value={{this.shape}}
          @options={{SHAPES}}
          @defaultValue='rounded'
          @description='Corner treatment; pill is a circle, since the button is square.'
          @onInput={{this.setShape}}
        />
        <Args.Bool
          @name='pressed'
          @value={{this.pressed}}
          @description='Toggle state, as aria-pressed; leave unset for a plain action.'
          @onInput={{this.setPressed}}
        />
        <Args.Base
          @name='icon'
          @typeLabel='Component'
          @description="Icon component, sized to the button's font size or by @iconWidth / @iconHeight."
          @hideControls={{true}}
        />
        <Args.Base
          @name='iconWidth'
          @typeLabel='String | Number'
          @description="The @icon's width; 1.25em of the button's font size by default."
          @hideControls={{true}}
        />
        <Args.Base
          @name='iconHeight'
          @typeLabel='String | Number'
          @description="The @icon's height; 1.25em of the button's font size by default."
          @hideControls={{true}}
        />
        <Args.Base
          @name='variant'
          @typeLabel='String'
          @description='Deprecated sugar over @tone + @appearance, as on Button; defaults to secondary.'
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
