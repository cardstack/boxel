// Pretui — CopyButton usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { CopyButton } from './copy-button';

const COPY_VARIANTS = ['primary', 'secondary', 'ghost', 'destructive'];

// ── CopyButton ← copy-button/usage.gts ───────────────────────────────────
// Dropped knobs: @tooltipText / @placement / @offset (boxel-ui wraps the
// button in an ember-velcro Tooltip — wart list forbids; the result is the
// glyph swap plus a status announcement), @width / @height (the glyph
// follows @size). @textToCopy and @ariaLabel are accepted as aliases of
// @text and @label. Adaptation on record: the result resets on
// pointerleave/blur, not a 2s setTimeout — realm code takes no timers.
class CopyButtonUsage extends Component {
  variantOptions = COPY_VARIANTS;
  @tracked textToCopy = 'Text to copy';
  @tracked labelText = 'Copy to clipboard';
  @tracked variant = 'secondary';
  setText = (v: string) => (this.textToCopy = v);
  setLabel = (v: string) => (this.labelText = v);
  setVariant = (v: string) => (this.variant = v);
  get variantVal() {
    return this.variant as 'primary' | 'secondary' | 'ghost' | 'destructive';
  }
  get usage() {
    let bits = [`@text='${this.textToCopy}'`];
    if (this.variant !== 'secondary') bits.push(`@variant='${this.variant}'`);
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
          @variant={{this.variantVal}}
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
          @name='variant'
          @defaultValue='secondary'
          @value={{this.variant}}
          @options={{this.variantOptions}}
          @description='IconButton variant sugar over the tone + appearance axes.'
          @onInput={{this.setVariant}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_COPY_BUTTON: Record<string, unknown> = {
  CopyButton: CopyButtonUsage,
};
