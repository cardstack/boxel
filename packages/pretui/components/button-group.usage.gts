// Pretui — ButtonGroup usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import {
  PRETUI_APPEARANCES,
  PRETUI_SIZES,
  PRETUI_TONES,
} from '../pretui-primitives';
import { Button } from './button';
import { ButtonGroup } from './button-group';
import { ORIENTATIONS } from '../internal/composites-fixtures';

// ── ButtonGroup ← wa-button-group ────────────────────────────────────────
const TONES = [...PRETUI_TONES];

const APPEARANCES = [...PRETUI_APPEARANCES];

const SIZES = [...PRETUI_SIZES];

// Dropped knobs: slotted radio-button support and WA's JS focus/hover
// class relay (pure CSS here — z-index raises the active button's ring).
// The Pretui addition: @tone/@appearance/@size cascade to the child
// Buttons through the group's CSS custom-prop channel, so children carry
// no args at all.
class ButtonGroupUsage extends Component {
  toneOptions = TONES;
  appearanceOptions = APPEARANCES;
  sizeOptions = SIZES;
  orientationOptions = ORIENTATIONS;
  @tracked labelText = 'Text alignment';
  @tracked orientation = 'horizontal';
  @tracked tone = 'neutral';
  @tracked appearance = 'outlined';
  @tracked size = 'm';
  setLabel = (v: string) => (this.labelText = v);
  setOrientation = (v: string) => (this.orientation = v);
  setTone = (v: string) => (this.tone = v);
  setAppearance = (v: string) => (this.appearance = v);
  setSize = (v: string) => (this.size = v);
  get orientationVal() {
    return this.orientation as 'horizontal' | 'vertical';
  }
  get toneVal() {
    return this.tone as
      | 'neutral'
      | 'primary'
      | 'info'
      | 'success'
      | 'warning'
      | 'danger'
      | 'attention';
  }
  get appearanceVal() {
    return this.appearance as
      | 'accent'
      | 'filled'
      | 'outlined'
      | 'filled-outlined'
      | 'plain';
  }
  get sizeVal() {
    return this.size as 'xs' | 's' | 'm' | 'l' | 'xl';
  }
  get usage() {
    let bits = [`@label='${this.labelText}'`];
    if (this.tone !== 'neutral') bits.push(`@tone='${this.tone}'`);
    if (this.appearance !== 'outlined')
      bits.push(`@appearance='${this.appearance}'`);
    return `<ButtonGroup ${bits.join(' ')}>\n  <Button>Left</Button>\n  <Button>Center</Button>\n  <Button>Right</Button>\n</ButtonGroup>`;
  }
  <template>
    <FreestyleUsage
      @name='ButtonGroup'
      @description="Related Pretui Buttons fused into one visual unit — toolbars, segmented actions, split alignments. Inner corners square off and adjacent hairlines collapse to one shared line; the group's tone/appearance/size cascade to the children through CSS custom props, so the Buttons themselves carry no args. Transcribed from wa-button-group."
      @source={{this.usage}}
    >
      <:example>
        <ButtonGroup
          @label={{this.labelText}}
          @orientation={{this.orientationVal}}
          @tone={{this.toneVal}}
          @appearance={{this.appearanceVal}}
          @size={{this.sizeVal}}
        >
          <Button>Left</Button>
          <Button>Center</Button>
          <Button>Right</Button>
        </ButtonGroup>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @value={{this.labelText}}
          @description="Group label announced by assistive tech — WA marks it strongly recommended; this kit agrees."
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='orientation'
          @defaultValue='horizontal'
          @value={{this.orientation}}
          @options={{this.orientationOptions}}
          @description='Row or column; the shared-hairline math follows.'
          @onInput={{this.setOrientation}}
        />
        <Args.String
          @name='tone'
          @value={{this.tone}}
          @options={{this.toneOptions}}
          @description="Tone inherited by every child Button — re-points the same --pretui-tone channel Button's recipes read."
          @onInput={{this.setTone}}
        />
        <Args.String
          @name='appearance'
          @value={{this.appearance}}
          @options={{this.appearanceOptions}}
          @description='Appearance recipe applied to every child Button at group specificity.'
          @onInput={{this.setAppearance}}
        />
        <Args.String
          @name='size'
          @value={{this.size}}
          @options={{this.sizeOptions}}
          @description='Font-size scale applied to every child Button (internals ride the em).'
          @onInput={{this.setSize}}
        />
        <Args.Yield
          @description='Plain <Button> children — no per-child args needed.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_BUTTON_GROUP: Record<string, unknown> = {
  ButtonGroup: ButtonGroupUsage,
};
