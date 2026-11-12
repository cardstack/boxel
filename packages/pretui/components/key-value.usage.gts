// Pretui — KeyValue usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Token } from './token';
import { KeyValue, KEY_VALUE_VALUE_ALIGNS } from './key-value';
import type { KeyValueLayout, KeyValueValueAlign } from './key-value';

const LOT_DETAILS = [
  { key: 'Lot', value: 'B-103' },
  { key: 'Tea', value: 'Gyokuro' },
  { key: 'Origin', value: 'Shizuoka' },
  { key: 'Harvest', value: 'First flush' },
];
const LAYOUTS: KeyValueLayout[] = ['horizontal', 'stacked', 'inline'];
const LABEL_STYLES = ['default', 'eyebrow'];
const VALUE_ALIGNS = [...KEY_VALUE_VALUE_ALIGNS];

class KeyValueUsage extends Component {
  items = LOT_DETAILS;
  @tracked layout: KeyValueLayout = 'horizontal';
  @tracked labelStyle = 'default';
  @tracked divided = false;
  @tracked valueAlign: KeyValueValueAlign = 'start';
  setDivided = (v: boolean) => (this.divided = v);
  setValueAlign = (v: string) => (this.valueAlign = v as KeyValueValueAlign);
  setLayout = (v: string) => (this.layout = v as KeyValueLayout);
  setLabelStyle = (v: string) => (this.labelStyle = v);
  get labelStyleVal(): 'eyebrow' | undefined {
    return this.labelStyle === 'eyebrow' ? 'eyebrow' : undefined;
  }
  get usage() {
    let bits = ['@items={{this.items}}'];
    if (this.layout !== 'horizontal') {
      bits.push(`@layout='${this.layout}'`);
    }
    if (this.labelStyleVal) {
      bits.push(`@labelStyle='${this.labelStyleVal}'`);
    }
    if (this.divided) {
      bits.push('@divided={{true}}');
    }
    if (this.valueAlign !== 'start') {
      bits.push(`@valueAlign='${this.valueAlign}'`);
    }
    return `<KeyValue ${bits.join(' ')} />`;
  }
  isLot = (item: { key: string }) => item.key === 'Lot';
  <template>
    <FreestyleUsage
      @name='KeyValue'
      @description='A semantic description list for compact record facts, with an optional value block for links, tokens or status.'
      @source={{this.usage}}
    >
      <:example>
        <KeyValue
          @items={{this.items}}
          @layout={{this.layout}}
          @labelStyle={{this.labelStyleVal}}
          @divided={{this.divided}}
          @valueAlign={{this.valueAlign}}
        ><:value as |item|>{{#if (this.isLot item)}}<Token
                @value={{item.value}}
              />{{else}}{{item.value}}{{/if}}</:value></KeyValue>
      </:example>
      <:api as |Args|>
        <Args.Object @name='items' @value={{this.items}} />
        <Args.String
          @name='layout'
          @value={{this.layout}}
          @options={{LAYOUTS}}
          @defaultValue='horizontal'
          @description="'horizontal': keys in one column, values beside them. 'stacked': each key above its value ('vertical' is an alias). 'inline': pairs side by side on one line, wrapping when space runs out (Pretui addition)."
          @onInput={{this.setLayout}}
        />
        <Args.String
          @name='labelStyle'
          @value={{this.labelStyle}}
          @options={{LABEL_STYLES}}
          @defaultValue='default'
          @description="'eyebrow' sets the keys in the theme's eyebrow role, uppercase; the --pretui-kv-label-* properties still win (Pretui addition)."
          @onInput={{this.setLabelStyle}}
        />
        <Args.Bool
          @name='divided'
          @value={{this.divided}}
          @defaultValue={{false}}
          @description='Draws a --border hairline between rows, unbroken across both columns. Horizontal layout only (Pretui addition).'
          @onInput={{this.setDivided}}
        />
        <Args.String
          @name='valueAlign'
          @value={{this.valueAlign}}
          @options={{VALUE_ALIGNS}}
          @defaultValue='start'
          @description="'end' aligns the values to the inline end of their column. Horizontal layout only (Pretui addition)."
          @onInput={{this.setValueAlign}}
        />
        <Args.Yield
          @name='value'
          @description='Receives the current item.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-kv-pad-inline'
          @type='length'
          @description='Inline padding between the text and the container edges. Divided hairlines stay full width. Set on the KeyValue or any ancestor.'
          @defaultValue='0'
        />
        <Css.Basic
          @name='pretui-kv-label-color'
          @type='color'
          @description='Key ink. Set on the KeyValue or any ancestor.'
          @defaultValue='var(--muted-foreground)'
        />
        <Css.Basic
          @name='pretui-kv-label-font-family'
          @type='string'
          @description="Key font family; the eyebrow role's with @labelStyle."
          @defaultValue='var(--boxel-ui-label-font-family)'
        />
        <Css.Basic
          @name='pretui-kv-label-font-size'
          @type='dimension'
          @description="Key font size; the eyebrow role's with @labelStyle."
          @defaultValue='var(--boxel-ui-label-font-size)'
        />
        <Css.Basic
          @name='pretui-kv-label-font-weight'
          @type='string'
          @description="Key font weight; the eyebrow role's with @labelStyle."
          @defaultValue='var(--boxel-ui-label-font-weight)'
        />
        <Css.Basic
          @name='pretui-kv-label-line-height'
          @type='dimension'
          @description="Key line height; the eyebrow role's with @labelStyle."
          @defaultValue='var(--boxel-ui-label-line-height)'
        />
        <Css.Basic
          @name='pretui-kv-label-letter-spacing'
          @type='dimension'
          @description="Key tracking; the eyebrow role's with @labelStyle."
          @defaultValue='var(--boxel-ui-label-letter-spacing)'
        />
        <Css.Basic
          @name='pretui-kv-label-text-transform'
          @type='keyword'
          @description='Key case. Unset, the keys inherit it, or are uppercase with @labelStyle.'
        />
      </:cssVars>
    </FreestyleUsage>
  </template>
}

export const DEMOS_KEY_VALUE: Record<string, unknown> = {
  KeyValue: KeyValueUsage,
};
