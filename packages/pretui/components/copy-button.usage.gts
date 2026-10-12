// Pretui — CopyButton usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { CopyButton } from './copy-button';
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

// ── CopyButton ← copy-button/usage.gts ───────────────────────────────────
// Dropped knobs: @tooltipText / @placement / @offset (boxel-ui wraps the
// button in an ember-velcro Tooltip — wart list forbids; the result is the
// glyph swap plus a status announcement), @width / @height (the glyph
// follows the button's font size, which @size sets). @textToCopy and
// @ariaLabel are accepted as aliases of @text and @label. The result holds
// for 2 s on every input.
class CopyButtonUsage extends Component {
  @tracked textToCopy = 'Text to copy';
  @tracked labelText = 'Copy to clipboard';
  @tracked tone = 'neutral';
  @tracked appearance = 'outlined';
  @tracked size = 'm';
  @tracked disabled = false;
  setText = (v: string) => (this.textToCopy = v);
  setLabel = (v: string) => (this.labelText = v);
  setTone = (v: string) => (this.tone = v);
  setAppearance = (v: string) => (this.appearance = v);
  setSize = (v: string) => (this.size = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  get sizeVal() {
    return this.size as PretuiSize;
  }
  get toneVal() {
    return this.tone as PretuiTone;
  }
  get appearanceVal() {
    return this.appearance as PretuiAppearance;
  }
  get usage() {
    let bits = [`@text='${this.textToCopy}'`];
    if (this.tone !== 'neutral') bits.push(`@tone='${this.tone}'`);
    if (this.appearance !== 'outlined') {
      bits.push(`@appearance='${this.appearance}'`);
    }
    if (this.size !== 'm') bits.push(`@size='${this.size}'`);
    if (this.disabled) bits.push('@disabled={{true}}');
    return `<CopyButton ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='CopyButton'
      @description='Button that copies a string to the clipboard on click and surfaces a brief confirmation — common in code blocks, share-link rows, and developer tools. The glyph swaps to a check, or a cross on failure, until the pointer leaves.'
      @source={{this.usage}}
    >
      <:example>
        <CopyButton
          @text={{this.textToCopy}}
          @label={{this.labelText}}
          @tone={{this.toneVal}}
          @appearance={{this.appearanceVal}}
          @size={{this.sizeVal}}
          @disabled={{this.disabled}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='text'
          @required={{true}}
          @value={{this.textToCopy}}
          @description='The string written to navigator.clipboard; @value and @textToCopy are aliases.'
          @onInput={{this.setText}}
        />
        <Args.String
          @name='label'
          @defaultValue='Copy to clipboard'
          @value={{this.labelText}}
          @description='Accessible name, fixed through the result; @ariaLabel is an alias.'
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
          @description='Button size; the square and the glyph scale with it.'
          @onInput={{this.setSize}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @defaultValue={{false}}
          @description='Disables the button.'
          @onInput={{this.setDisabled}}
        />
        <Args.Base
          @name='variant'
          @typeLabel='String'
          @description='Deprecated sugar over @tone + @appearance, as on Button.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_COPY_BUTTON: Record<string, unknown> = {
  CopyButton: CopyButtonUsage,
};
