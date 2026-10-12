// Pretui — Token usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Token } from './token';
import { PRETUI_SIZES, type PretuiSize } from '../pretui-primitives';

// The size knob's choices: the 2xs default plus the house scale.
const BODY_SIZE = 'default';
const SIZES = [BODY_SIZE, ...PRETUI_SIZES];
// The hue knob's choices: the default plus inks, since the hue is the text
// color and has to read on --card.
const DEFAULT_HUE = 'var(--card-foreground)';
const HUES = [
  DEFAULT_HUE,
  'var(--muted-foreground)',
  'var(--primary-ink)',
  'var(--success-ink)',
  'var(--destructive-ink)',
];

class TokenUsage extends Component {
  @tracked value = 'records@2.4.0';
  @tracked size = BODY_SIZE;
  @tracked hue = DEFAULT_HUE;
  @tracked wrap = false;
  setValue = (v: string) => (this.value = v);
  setSize = (v: string) => (this.size = v);
  setHue = (v: string) => (this.hue = v);
  toggleWrap = (v: boolean) => (this.wrap = v);
  get sizeVal() {
    return this.size === BODY_SIZE ? undefined : (this.size as PretuiSize);
  }
  get hueVal() {
    return this.hue === DEFAULT_HUE ? undefined : this.hue;
  }
  get usage() {
    let bits = [`@value='${this.value}'`];
    if (this.sizeVal) {
      bits.push(`@size='${this.sizeVal}'`);
    }
    if (this.hueVal) {
      bits.push(`@hue='${this.hueVal}'`);
    }
    if (this.wrap) {
      bits.push('@wrap={{true}}');
    }
    return `<Token ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='Token'
      @description='Machine values set as jewelry: compact mono pills that remain inline in prose and trim their margin when flush-set in a cell.'
      @source={{this.usage}}
    >
      <:example>
        <p class='foundation-prose'>Imported
          <Token
            @value={{this.value}}
            @size={{this.sizeVal}}
            @hue={{this.hueVal}}
            @wrap={{this.wrap}}
          />
          for lot
          <Token @value='LOT-B-103' />
          in
          <Token @value='ctse/pretui' />.</p>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='value'
          @value={{this.value}}
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='size'
          @value={{this.size}}
          @options={{SIZES}}
          @defaultValue={{BODY_SIZE}}
          @description='House scale xs|s|m|l|xl, the same steps as Button; sets the font-size, with the line box growing past 18px. Omitted, the size is --boxel-font-size-2xs, or --pretui-token-font-size when that is set (Pretui addition).'
          @onInput={{this.setSize}}
        />
        <Args.String
          @name='hue'
          @value={{this.hue}}
          @options={{HUES}}
          @defaultValue={{DEFAULT_HUE}}
          @description='Validated CSS color for the text. Sets --pretui-token-hue, and stays set when the caller also passes a style attribute.'
          @onInput={{this.setHue}}
        />
        <Args.Bool
          @name='wrap'
          @value={{this.wrap}}
          @defaultValue={{false}}
          @description='Let a long value (a path, a rule, free text) wrap and break instead of overflowing on one line (Pretui addition).'
          @onInput={{this.toggleWrap}}
        />
        <Args.Yield
          @name='default'
          @description='Alternative to value for inline content.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-token-hue'
          @type='color'
          @description='Text color. Set on the Token or any ancestor, or through @hue.'
          @defaultValue='var(--card-foreground)'
        />
        <Css.Basic
          @name='pretui-token-font-size'
          @type='dimension'
          @description='Exact font-size for a Token with no @size, such as var(--boxel-font-size-xs). Set on the Token or any ancestor; @size wins over it.'
          @defaultValue='var(--boxel-font-size-2xs)'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .foundation-prose {
        margin: 0;
      }
    </style>
  </template>
}

export const DEMOS_TOKEN: Record<string, unknown> = {
  Token: TokenUsage,
};
